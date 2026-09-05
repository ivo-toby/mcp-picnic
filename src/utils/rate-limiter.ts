import { ANNIE } from "../types/annie.js"
import { TransportError, ErrorCode } from "../types/errors.js"

export interface RateLimitConfig {
  windowMs: number // Time window in milliseconds
  maxRequests: number // Maximum requests per window
  skipPaths?: string[] // Request paths excluded from rate limiting
  skipSuccessfulRequests?: boolean // Don't count successful requests
  skipFailedRequests?: boolean // Don't count failed requests
  keyGenerator?: (identifier: string) => string // Custom key generation
}

interface RateLimitEntry {
  count: number
  resetTime: number
  firstRequestTime: number
}

export class RateLimiter {
  private store = new Map<string, RateLimitEntry>()
  private config: Required<RateLimitConfig>
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
 * Express middleware factory for rate limiting
 */
export function createRateLimitMiddleware(config: RateLimitConfig) {
  const limiter = new RateLimiter(config)

  return {
    middleware: (req: ANNIE, res: ANNIE, next: ANNIE) => {
      if (config.skipPaths?.includes(req.path)) {
        return next()
      }

      // Use IP address as default identifier, but allow custom extraction
      const identifier = req.ip || req.connection.remoteAddress || "unknown"
      const result = limiter.checkLimit(identifier)

      // Add rate limit headers
      res.set({
        "X-RateLimit-Limit": config.maxRequests.toString(),
        "X-RateLimit-Remaining": (result.remaining || 0).toString(),
        "X-RateLimit-Reset": result.resetTime ? Math.ceil(result.resetTime / 1000).toString() : "",
      })

      if (!result.allowed) {
        const retryAfter = result.resetTime ? Math.ceil((result.resetTime - Date.now()) / 1000) : 60
        res.set("Retry-After", retryAfter.toString())

        const error = new TransportError(ErrorCode.TRANSPORT_RATE_LIMITED, "Too many requests", {
          retryAfter,
          resetTime: result.resetTime,
        })

        return res.status(429).json({
          jsonrpc: "2.0",
          error: error.toMCPError(),
          id: null,
        })
      }

      next()
    },
    limiter,
  }
}
