import { ANNIE } from "../types/annie.js"
import { TransportError, ErrorCode } from "../types/errors.js"

export interface RateLimitConfig {
  windowMs: number // Time window in milliseconds
  maxRequests: number // Maximum requests per window
  skipPaths?: string[] // Request paths excluded from rate limiting
  skipSuccessfulRequests?: boolean // Don't count successful requests
  skipFailedRequests?: boolean // Don't count failed requests
  keyGenerator?: (identifier: string) => string // Custom key generation
  /**
   * Returns the MCP session ID to rate-limit this request under, or `undefined` to limit it by
   * client IP. Callers decide when a session bucket is legitimate (live session, authenticated,
   * same client that created it), so a request can't be charged to someone else's session.
   */
  resolveSessionId?: (req: ANNIE) => string | undefined
  /**
   * Ceiling on all requests from one client IP across its sessions, so a client can't multiply
   * its quota by opening sessions. Defaults to 10x `maxRequests`.
   */
  maxRequestsPerIp?: number
}

interface RateLimitEntry {
  count: number
  resetTime: number
  firstRequestTime: number
}

export class RateLimiter {
  private store = new Map<string, RateLimitEntry>()
  private config: Required<Omit<RateLimitConfig, "resolveSessionId" | "maxRequestsPerIp">>
  private cleanupInterval: NodeJS.Timeout

  constructor(config: RateLimitConfig) {
    this.config = {
      skipPaths: [],
      skipSuccessfulRequests: false,
      skipFailedRequests: false,
      keyGenerator: (id: string) => id,
      ...config,
    }

    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 60000)
    // Don't keep the process alive just for cleanup.
    this.cleanupInterval.unref?.()
  }

  /**
   * Check if request should be rate limited
   */
  checkLimit(identifier: string): { allowed: boolean; resetTime?: number; remaining?: number } {
    const key = this.config.keyGenerator(identifier)
    const now = Date.now()
    const entry = this.store.get(key)

    if (!entry) {
      // First request for this identifier
      this.store.set(key, {
        count: 1,
        resetTime: now + this.config.windowMs,
        firstRequestTime: now,
      })
      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetTime: now + this.config.windowMs,
      }
    }

    // Check if window has expired
    if (now >= entry.resetTime) {
      // Reset the window
      entry.count = 1
      entry.resetTime = now + this.config.windowMs
      entry.firstRequestTime = now
      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetTime: entry.resetTime,
      }
    }

    // Check if limit exceeded
    if (entry.count >= this.config.maxRequests) {
      return {
        allowed: false,
        resetTime: entry.resetTime,
        remaining: 0,
      }
    }

    // Increment count and allow
    entry.count++
    return {
      allowed: true,
      remaining: this.config.maxRequests - entry.count,
      resetTime: entry.resetTime,
    }
  }

  /**
   * True when a request for this identifier would currently be allowed, without counting it.
   */
  wouldAllow(identifier: string): boolean {
    const entry = this.store.get(this.config.keyGenerator(identifier))
    return !entry || Date.now() >= entry.resetTime || entry.count < this.config.maxRequests
  }

  /**
   * Record a request (for post-processing rate limiting)
   */
  recordRequest(identifier: string, wasSuccessful: boolean = true) {
    if (
      (wasSuccessful && this.config.skipSuccessfulRequests) ||
      (!wasSuccessful && this.config.skipFailedRequests)
    ) {
      return
    }

    this.checkLimit(identifier)
  }

  /**
   * Get current status for an identifier
   */
  getStatus(identifier: string): { count: number; remaining: number; resetTime: number } | null {
    const key = this.config.keyGenerator(identifier)
    const entry = this.store.get(key)

    if (!entry) {
      return null
    }

    const now = Date.now()
    if (now >= entry.resetTime) {
      // Reset the entry for expired window
      entry.count = 0
      entry.resetTime = now + this.config.windowMs
      entry.firstRequestTime = now

      return {
        count: 0,
        remaining: this.config.maxRequests,
        resetTime: entry.resetTime,
      }
    }

    return {
      count: entry.count,
      remaining: Math.max(0, this.config.maxRequests - entry.count),
      resetTime: entry.resetTime,
    }
  }

  /**
   * Reset rate limit for a specific identifier
   */
  reset(identifier: string): void {
    const key = this.config.keyGenerator(identifier)
    this.store.delete(key)
  }

  /**
   * Reset all rate limits
   */
  resetAll(): void {
    this.store.clear()
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now()
    for (const [key, entry] of this.store.entries()) {
      if (now >= entry.resetTime) {
        this.store.delete(key)
      }
    }
  }

  /**
   * Destroy the rate limiter and clean up resources
   */
  destroy(): void {
    clearInterval(this.cleanupInterval)
    this.store.clear()
  }

  /**
   * Get statistics about current rate limiting
   */
  getStats(): {
    totalIdentifiers: number
    activeIdentifiers: number
    totalRequests: number
  } {
    const now = Date.now()
    let totalRequests = 0
    let activeIdentifiers = 0

    for (const entry of this.store.values()) {
      totalRequests += entry.count
      if (now < entry.resetTime) {
        activeIdentifiers++
      }
    }

    return {
      totalIdentifiers: this.store.size,
      activeIdentifiers,
      totalRequests,
    }
  }
}

/**
 * Normalize a request path the way Express routes it by default (case-insensitive,
 * trailing slash optional), so `/health/` and `/HEALTH` match a `/health` skip entry.
 */
function normalizePath(path: string): string {
  const trimmed = path.replace(/\/+$/, "")
  return (trimmed || "/").toLowerCase()
}

/**
 * Normalize an IP so IPv4-mapped IPv6 (`::ffff:10.0.0.1`) and plain IPv4 (`10.0.0.1`) match.
 */
export function normalizeIp(ip: string): string {
  return ip.toLowerCase().startsWith("::ffff:") && ip.includes(".") ? ip.slice(7) : ip
}

/** Client IP for a request; `req.ip` honours Express `trust proxy`. */
function clientIp(req: ANNIE): string {
  const ip = req.ip || req.connection?.remoteAddress
  return typeof ip === "string" && ip.length > 0 ? normalizeIp(ip) : "unknown"
}

/**
 * Express middleware factory for rate limiting.
 *
 * Each request counts against a `maxRequests` bucket: its session's when `resolveSessionId`
 * returns one, otherwise its client IP's. Admitted requests also count against the IP's
 * aggregate bucket (`maxRequestsPerIp`); rejected ones don't, so one client retrying on 429
 * can't lock out other clients sharing its IP.
 */
export function createRateLimitMiddleware(config: RateLimitConfig) {
  const limiter = new RateLimiter(config)
  const maxRequestsPerIp = config.maxRequestsPerIp ?? config.maxRequests * 10
  const ipLimiter = new RateLimiter({ windowMs: config.windowMs, maxRequests: maxRequestsPerIp })
  const skipPaths = new Set((config.skipPaths ?? []).map(normalizePath))

  const reject = (res: ANNIE, limit: number, resetTime?: number) => {
    const retryAfter = resetTime ? Math.ceil((resetTime - Date.now()) / 1000) : 60
    res.set({
      "X-RateLimit-Limit": limit.toString(),
      "X-RateLimit-Remaining": "0",
      "X-RateLimit-Reset": resetTime ? Math.ceil(resetTime / 1000).toString() : "",
    })
    res.set("Retry-After", retryAfter.toString())

    const error = new TransportError(ErrorCode.TRANSPORT_RATE_LIMITED, "Too many requests", {
      retryAfter,
      resetTime,
    })

    return res.status(429).json({
      jsonrpc: "2.0",
      error: error.toMCPError(),
      id: null,
    })
  }

  return {
    middleware: (req: ANNIE, res: ANNIE, next: ANNIE) => {
      if (
        skipPaths.size > 0 &&
        typeof req.path === "string" &&
        skipPaths.has(normalizePath(req.path))
      ) {
        return next()
      }

      // Namespaced keys, so a spoofed IP (e.g. via `trust proxy = true`) can't collide with
      // a session bucket.
      const ipKey = `ip:${clientIp(req)}`
      if (!ipLimiter.wouldAllow(ipKey)) {
        return reject(res, maxRequestsPerIp, ipLimiter.getStatus(ipKey)?.resetTime)
      }

      const sessionId = config.resolveSessionId?.(req)
      const result = limiter.checkLimit(sessionId ? `session:${sessionId}` : ipKey)
      if (!result.allowed) {
        return reject(res, config.maxRequests, result.resetTime)
      }
      ipLimiter.checkLimit(ipKey)

      res.set({
        "X-RateLimit-Limit": config.maxRequests.toString(),
        "X-RateLimit-Remaining": (result.remaining || 0).toString(),
        "X-RateLimit-Reset": result.resetTime ? Math.ceil(result.resetTime / 1000).toString() : "",
      })

      next()
    },
    limiter,
    ipLimiter,
  }
}
