import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  RateLimiter,
  createRateLimitMiddleware,
  normalizeIp,
  RateLimitConfig,
} from "../../../src/utils/rate-limiter.js"
import { TransportError, ErrorCode } from "../../../src/types/errors.js"

describe("RateLimiter", () => {
  let rateLimiter: RateLimiter
  let config: RateLimitConfig

  beforeEach(() => {
    vi.useFakeTimers()
    // Mock clearInterval
    vi.spyOn(global, "clearInterval")
    config = {
      windowMs: 60000, // 1 minute
      maxRequests: 10,
    }
    rateLimiter = new RateLimiter(config)
  })

  afterEach(() => {
    rateLimiter.destroy()
    vi.useRealTimers()
  })

  describe("constructor", () => {
    it("should create rate limiter with default options", () => {
      const limiter = new RateLimiter(config)
      expect(limiter).toBeInstanceOf(RateLimiter)
    })

    it("should merge config with defaults", () => {
      const customConfig: RateLimitConfig = {
        windowMs: 30000,
        maxRequests: 5,
        skipSuccessfulRequests: true,
        keyGenerator: (id) => `custom:${id}`,
      }
      const limiter = new RateLimiter(customConfig)
      expect(limiter["config"].skipSuccessfulRequests).toBe(true)
      expect(limiter["config"].keyGenerator("test")).toBe("custom:test")
      limiter.destroy()
    })

    it("should start cleanup interval", () => {
      const limiter = new RateLimiter(config)
      expect(limiter["cleanupInterval"]).toBeDefined()
      limiter.destroy()
    })
  })

  describe("checkLimit", () => {
    it("should allow first request", () => {
      const result = rateLimiter.checkLimit("user1")

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(9)
      expect(result.resetTime).toBeDefined()
    })

    it("should track multiple requests from same identifier", () => {
      rateLimiter.checkLimit("user1")
      rateLimiter.checkLimit("user1")
      const result = rateLimiter.checkLimit("user1")

      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(7)
    })

    it("should reject when limit exceeded", () => {
      // Make 10 requests (the limit)
      for (let i = 0; i < 10; i++) {
        rateLimiter.checkLimit("user1")
      }

      // 11th request should be rejected
      const result = rateLimiter.checkLimit("user1")

      expect(result.allowed).toBe(false)
      expect(result.remaining).toBe(0)
      expect(result.resetTime).toBeDefined()
    })

    it("should reset window after expiry", () => {
      // Make 10 requests (the limit)
      for (let i = 0; i < 10; i++) {
        rateLimiter.checkLimit("user1")
      }

      // Should be rejected
      expect(rateLimiter.checkLimit("user1").allowed).toBe(false)

      // Advance time past window
      vi.advanceTimersByTime(60001)

      // Should be allowed again
      const result = rateLimiter.checkLimit("user1")
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(9)
    })

    it("should handle different identifiers separately", () => {
      // Make 10 requests for user1
      for (let i = 0; i < 10; i++) {
        rateLimiter.checkLimit("user1")
      }

      // user1 should be rejected
      expect(rateLimiter.checkLimit("user1").allowed).toBe(false)

      // user2 should still be allowed
      const result = rateLimiter.checkLimit("user2")
      expect(result.allowed).toBe(true)
      expect(result.remaining).toBe(9)
    })

    it("should use custom key generator", () => {
      const customLimiter = new RateLimiter({
        ...config,
        keyGenerator: (id) => `prefix:${id}`,
      })

      customLimiter.checkLimit("user1")
      expect(customLimiter["store"].has("prefix:user1")).toBe(true)
      expect(customLimiter["store"].has("user1")).toBe(false)

      customLimiter.destroy()
    })
  })

  describe("recordRequest", () => {
    it("should record successful requests by default", () => {
      rateLimiter.recordRequest("user1", true)
      const status = rateLimiter.getStatus("user1")

      expect(status?.count).toBe(1)
    })

    it("should record failed requests by default", () => {
      rateLimiter.recordRequest("user1", false)
      const status = rateLimiter.getStatus("user1")

      expect(status?.count).toBe(1)
    })

    it("should skip successful requests when configured", () => {
      const limiter = new RateLimiter({
        ...config,
        skipSuccessfulRequests: true,
      })

      limiter.recordRequest("user1", true)
      const status = limiter.getStatus("user1")

      expect(status).toBeNull()
      limiter.destroy()
    })

    it("should skip failed requests when configured", () => {
      const limiter = new RateLimiter({
        ...config,
        skipFailedRequests: true,
      })

      limiter.recordRequest("user1", false)
      const status = limiter.getStatus("user1")

      expect(status).toBeNull()
      limiter.destroy()
    })
  })

  describe("getStatus", () => {
    it("should return null for unknown identifier", () => {
      const status = rateLimiter.getStatus("unknown")
      expect(status).toBeNull()
    })

    it("should return current status", () => {
      rateLimiter.checkLimit("user1")
      rateLimiter.checkLimit("user1")

      const status = rateLimiter.getStatus("user1")

      expect(status).toEqual({
        count: 2,
        remaining: 8,
        resetTime: expect.any(Number),
      })
    })

    it("should return reset status for expired window", () => {
      rateLimiter.checkLimit("user1")

      // Spy on cleanup to prevent it from running
      const cleanupSpy = vi.spyOn(rateLimiter as any, "cleanup").mockImplementation(() => {})

      // Advance time past window
      vi.advanceTimersByTime(60001)

      const status = rateLimiter.getStatus("user1")

      expect(status?.count).toBe(0)
      expect(status?.remaining).toBe(10)

      cleanupSpy.mockRestore()
    })
  })

  describe("reset", () => {
    it("should reset specific identifier", () => {
      rateLimiter.checkLimit("user1")
      rateLimiter.checkLimit("user2")

      rateLimiter.reset("user1")

      expect(rateLimiter.getStatus("user1")).toBeNull()
      expect(rateLimiter.getStatus("user2")).not.toBeNull()
    })
  })

  describe("resetAll", () => {
    it("should reset all identifiers", () => {
      rateLimiter.checkLimit("user1")
      rateLimiter.checkLimit("user2")

      rateLimiter.resetAll()

      expect(rateLimiter.getStatus("user1")).toBeNull()
      expect(rateLimiter.getStatus("user2")).toBeNull()
    })
  })

  describe("cleanup", () => {
    it("should remove expired entries", () => {
      rateLimiter.checkLimit("user1")

      // Advance time a bit, then create user2
      vi.advanceTimersByTime(30000)
      rateLimiter.checkLimit("user2")

      // Advance time past window for user1 entry only
      vi.advanceTimersByTime(30002)

      // Trigger cleanup
      rateLimiter["cleanup"]()

      // user1 should be cleaned up, user2 should remain
      expect(rateLimiter["store"].has("user1")).toBe(false)
      expect(rateLimiter["store"].has("user2")).toBe(true)
    })

    it("should run automatically on interval", () => {
      const cleanupSpy = vi.spyOn(rateLimiter as any, "cleanup")

      // Advance time to trigger cleanup interval
      vi.advanceTimersByTime(60000)

      expect(cleanupSpy).toHaveBeenCalled()
    })
  })

  describe("destroy", () => {
    it("should clear interval and store", () => {
      rateLimiter.checkLimit("user1")
      const intervalId = rateLimiter["cleanupInterval"]

      rateLimiter.destroy()

      expect(rateLimiter["store"].size).toBe(0)
      expect(clearInterval).toHaveBeenCalledWith(intervalId)
    })
  })

  describe("getStats", () => {
    it("should return correct statistics", () => {
      rateLimiter.checkLimit("user1")
      rateLimiter.checkLimit("user1")
      rateLimiter.checkLimit("user2")

      const stats = rateLimiter.getStats()

      expect(stats).toEqual({
        totalIdentifiers: 2,
        activeIdentifiers: 2,
        totalRequests: 3,
      })
    })

    it("should exclude expired identifiers from active count", () => {
      rateLimiter.checkLimit("user1")
      rateLimiter.checkLimit("user2")

      // Spy on cleanup to prevent it from running
      const cleanupSpy = vi.spyOn(rateLimiter as any, "cleanup").mockImplementation(() => {})

      // Advance time past window
      vi.advanceTimersByTime(60001)

      const stats = rateLimiter.getStats()

      expect(stats.totalIdentifiers).toBe(2)
      expect(stats.activeIdentifiers).toBe(0)

      cleanupSpy.mockRestore()
    })
  })
})

describe("createRateLimitMiddleware", () => {
  let mockReq: any
  let mockRes: any
  let mockNext: any

  beforeEach(() => {
    vi.useFakeTimers()
    mockReq = {
      ip: "127.0.0.1",
      connection: { remoteAddress: "127.0.0.1" },
    }
    mockRes = {
      set: vi.fn(),
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    }
    mockNext = vi.fn()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe("middleware creation", () => {
    it("should create middleware with limiter", () => {
      const config: RateLimitConfig = {
        windowMs: 60000,
        maxRequests: 10,
      }

      const { middleware, limiter } = createRateLimitMiddleware(config)

      expect(typeof middleware).toBe("function")
      expect(limiter).toBeInstanceOf(RateLimiter)

      limiter.destroy()
    })
  })

  describe("middleware function", () => {
    it("should allow requests within limit", () => {
      const config: RateLimitConfig = {
        windowMs: 60000,
        maxRequests: 10,
      }

      const { middleware, limiter } = createRateLimitMiddleware(config)

      middleware(mockReq, mockRes, mockNext)

      expect(mockRes.set).toHaveBeenCalledWith({
        "X-RateLimit-Limit": "10",
        "X-RateLimit-Remaining": "9",
        "X-RateLimit-Reset": expect.any(String),
      })
      expect(mockNext).toHaveBeenCalled()
      expect(mockRes.status).not.toHaveBeenCalled()

      limiter.destroy()
    })

    it("should reject requests over limit", () => {
      const config: RateLimitConfig = {
        windowMs: 60000,
        maxRequests: 1,
      }

      const { middleware, limiter } = createRateLimitMiddleware(config)

      // First request should pass
      middleware(mockReq, mockRes, mockNext)
      expect(mockNext).toHaveBeenCalledTimes(1)

      // Reset mocks
      vi.clearAllMocks()

      // Second request should be rejected
      middleware(mockReq, mockRes, mockNext)

      expect(mockRes.set).toHaveBeenCalledWith({
        "X-RateLimit-Limit": "1",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": expect.any(String),
      })
      expect(mockRes.set).toHaveBeenCalledWith("Retry-After", expect.any(String))
      expect(mockRes.status).toHaveBeenCalledWith(429)
      expect(mockRes.json).toHaveBeenCalledWith({
        jsonrpc: "2.0",
        error: expect.objectContaining({
          code: expect.any(Number),
          message: "Too many requests",
        }),
        id: null,
      })
      expect(mockNext).not.toHaveBeenCalled()

      limiter.destroy()
    })

    it("should use IP address as identifier", () => {
      const config: RateLimitConfig = {
        windowMs: 60000,
        maxRequests: 10,
      }

      const { middleware, limiter } = createRateLimitMiddleware(config)

      middleware(mockReq, mockRes, mockNext)

      expect(limiter.getStatus("ip:127.0.0.1")).not.toBeNull()

      limiter.destroy()
    })

    it("should handle missing IP address", () => {
      const config: RateLimitConfig = {
        windowMs: 60000,
        maxRequests: 10,
      }

      const { middleware, limiter } = createRateLimitMiddleware(config)

      const reqWithoutIP = { connection: {} }
      middleware(reqWithoutIP, mockRes, mockNext)

      expect(limiter.getStatus("ip:unknown")).not.toBeNull()
      expect(mockNext).toHaveBeenCalled()

      limiter.destroy()
    })

    it("should set correct rate limit headers", () => {
      const config: RateLimitConfig = {
        windowMs: 60000,
        maxRequests: 5,
      }

      const { middleware, limiter } = createRateLimitMiddleware(config)

      // Make 3 requests
      middleware(mockReq, mockRes, mockNext)
      middleware(mockReq, mockRes, mockNext)
      middleware(mockReq, mockRes, mockNext)

      expect(mockRes.set).toHaveBeenLastCalledWith({
        "X-RateLimit-Limit": "5",
        "X-RateLimit-Remaining": "2",
        "X-RateLimit-Reset": expect.any(String),
      })

      limiter.destroy()
    })

    it("should calculate retry-after correctly", () => {
      const config: RateLimitConfig = {
        windowMs: 60000,
        maxRequests: 1,
      }

      const { middleware, limiter } = createRateLimitMiddleware(config)

      // First request
      middleware(mockReq, mockRes, mockNext)

      // Reset mocks
      vi.clearAllMocks()

      // Second request (should be rejected)
      middleware(mockReq, mockRes, mockNext)

      const retryAfterCall = mockRes.set.mock.calls.find((call) => call[0] === "Retry-After")
      expect(retryAfterCall).toBeDefined()
      expect(parseInt(retryAfterCall[1])).toBeGreaterThan(0)

      limiter.destroy()
    })

    it("should create TransportError for rate limiting", () => {
      const config: RateLimitConfig = {
        windowMs: 60000,
        maxRequests: 1,
      }

      const { middleware, limiter } = createRateLimitMiddleware(config)

      // First request
      middleware(mockReq, mockRes, mockNext)

      // Reset mocks
      vi.clearAllMocks()

      // Second request (should be rejected)
      middleware(mockReq, mockRes, mockNext)

      const jsonCall = mockRes.json.mock.calls[0][0]
      expect(jsonCall.error.data.errorCode).toBe(ErrorCode.TRANSPORT_RATE_LIMITED)

      limiter.destroy()
    })
  })

  describe("skipPaths", () => {
    it("should not count or limit requests to skipped paths", () => {
      const { middleware, limiter } = createRateLimitMiddleware({
        windowMs: 60000,
        maxRequests: 1,
        skipPaths: ["/health"],
      })

      for (const path of ["/health", "/health/", "/HEALTH"]) {
        middleware({ ...mockReq, path }, mockRes, mockNext)
      }

      expect(mockNext).toHaveBeenCalledTimes(3)
      expect(mockRes.set).not.toHaveBeenCalled()
      expect(limiter.getStatus("ip:127.0.0.1")).toBeNull()

      // The MCP endpoint still has its full quota
      middleware({ ...mockReq, path: "/mcp" }, mockRes, mockNext)
      expect(mockRes.status).not.toHaveBeenCalled()
      middleware({ ...mockReq, path: "/mcp" }, mockRes, mockNext)
      expect(mockRes.status).toHaveBeenCalledWith(429)

      limiter.destroy()
    })

    it("should only skip exact path matches", () => {
      const { middleware, limiter } = createRateLimitMiddleware({
        windowMs: 60000,
        maxRequests: 10,
        skipPaths: ["/health"],
      })

      middleware({ ...mockReq, path: "/healthz" }, mockRes, mockNext)
      middleware({ ...mockReq, path: "/health/details" }, mockRes, mockNext)

      expect(limiter.getStatus("ip:127.0.0.1")?.count).toBe(2)

      limiter.destroy()
    })
  })

  describe("session-aware identifiers", () => {
    const sessionReq = (ip: string, sessionId?: string) => ({
      ip,
      connection: {},
      header: (name: string) => (name === "mcp-session-id" ? sessionId : undefined),
    })
    const fromHeader = (req: any) => req.header("mcp-session-id")

    it("should give each resolved session its own bucket behind a shared IP", () => {
      const { middleware, limiter, ipLimiter } = createRateLimitMiddleware({
        windowMs: 60000,
        maxRequests: 1,
        resolveSessionId: fromHeader,
      })

      middleware(sessionReq("127.0.0.1", "session-a"), mockRes, mockNext)
      middleware(sessionReq("127.0.0.1", "session-b"), mockRes, mockNext)
      middleware(sessionReq("127.0.0.1"), mockRes, mockNext)

      expect(mockNext).toHaveBeenCalledTimes(3)
      expect(mockRes.status).not.toHaveBeenCalled()
      expect(limiter.getStatus("session:session-a")?.count).toBe(1)
      expect(limiter.getStatus("session:session-b")?.count).toBe(1)
      expect(limiter.getStatus("ip:127.0.0.1")?.count).toBe(1)

      middleware(sessionReq("127.0.0.1", "session-a"), mockRes, mockNext)
      expect(mockRes.status).toHaveBeenCalledWith(429)

      limiter.destroy()
      ipLimiter.destroy()
    })

    it("should limit by IP when no session is resolved", () => {
      const { middleware, limiter, ipLimiter } = createRateLimitMiddleware({
        windowMs: 60000,
        maxRequests: 1,
        resolveSessionId: () => undefined,
      })

      middleware(sessionReq("127.0.0.1", "made-up-1"), mockRes, mockNext)
      middleware(sessionReq("127.0.0.1", "made-up-2"), mockRes, mockNext)

      expect(mockNext).toHaveBeenCalledTimes(1)
      expect(mockRes.status).toHaveBeenCalledWith(429)
      expect(limiter.getStatus("session:made-up-1")).toBeNull()
      expect(limiter.getStatus("ip:127.0.0.1")?.count).toBe(1)

      limiter.destroy()
      ipLimiter.destroy()
    })

    it("should ignore session IDs when no session resolver is configured", () => {
      const { middleware, limiter, ipLimiter } = createRateLimitMiddleware({
        windowMs: 60000,
        maxRequests: 10,
      })

      middleware(sessionReq("127.0.0.1", "session-a"), mockRes, mockNext)

      expect(limiter.getStatus("session:session-a")).toBeNull()
      expect(limiter.getStatus("ip:127.0.0.1")).not.toBeNull()

      limiter.destroy()
      ipLimiter.destroy()
    })

    it("should cap all requests from one IP across its sessions", () => {
      const { middleware, limiter, ipLimiter } = createRateLimitMiddleware({
        windowMs: 60000,
        maxRequests: 2,
        maxRequestsPerIp: 3,
        resolveSessionId: fromHeader,
      })

      middleware(sessionReq("127.0.0.1", "session-a"), mockRes, mockNext)
      middleware(sessionReq("127.0.0.1", "session-a"), mockRes, mockNext)
      middleware(sessionReq("127.0.0.1", "session-b"), mockRes, mockNext)
      expect(mockNext).toHaveBeenCalledTimes(3)

      // session-b still has quota, but the IP's aggregate ceiling is spent.
      middleware(sessionReq("127.0.0.1", "session-b"), mockRes, mockNext)
      expect(mockNext).toHaveBeenCalledTimes(3)
      expect(mockRes.status).toHaveBeenCalledWith(429)
      expect(mockRes.set).toHaveBeenCalledWith(
        expect.objectContaining({ "X-RateLimit-Limit": "3" }),
      )

      // Another IP is unaffected.
      middleware(sessionReq("10.0.0.2", "session-c"), mockRes, mockNext)
      expect(mockNext).toHaveBeenCalledTimes(4)

      limiter.destroy()
      ipLimiter.destroy()
    })

    it("should not charge the per-IP total for rejected requests", () => {
      const { middleware, limiter, ipLimiter } = createRateLimitMiddleware({
        windowMs: 60000,
        maxRequests: 2,
        maxRequestsPerIp: 5,
        resolveSessionId: fromHeader,
      })

      // session-a exhausts its own bucket and keeps retrying.
      for (let i = 0; i < 10; i++) {
        middleware(sessionReq("127.0.0.1", "session-a"), mockRes, mockNext)
      }
      expect(mockNext).toHaveBeenCalledTimes(2)
      expect(ipLimiter.getStatus("ip:127.0.0.1")?.count).toBe(2)

      // Other sessions behind the same IP are unaffected.
      middleware(sessionReq("127.0.0.1", "session-b"), mockRes, mockNext)
      expect(mockNext).toHaveBeenCalledTimes(3)

      limiter.destroy()
      ipLimiter.destroy()
    })

    it("should treat IPv4-mapped IPv6 and IPv4 as the same client", () => {
      const { middleware, limiter, ipLimiter } = createRateLimitMiddleware({
        windowMs: 60000,
        maxRequests: 1,
      })

      middleware(sessionReq("::ffff:100.64.0.1"), mockRes, mockNext)
      middleware(sessionReq("100.64.0.1"), mockRes, mockNext)

      expect(mockNext).toHaveBeenCalledTimes(1)
      expect(limiter.getStatus("ip:100.64.0.1")?.count).toBe(1)

      limiter.destroy()
      ipLimiter.destroy()
    })

    it("should default the per-IP ceiling to 10x maxRequests", () => {
      const { middleware, limiter, ipLimiter } = createRateLimitMiddleware({
        windowMs: 60000,
        maxRequests: 1,
        resolveSessionId: fromHeader,
      })

      for (let i = 0; i < 11; i++) {
        middleware(sessionReq("127.0.0.1", `session-${i}`), mockRes, mockNext)
      }

      expect(mockNext).toHaveBeenCalledTimes(10)
      expect(ipLimiter.getStatus("ip:127.0.0.1")?.count).toBe(10)

      limiter.destroy()
      ipLimiter.destroy()
    })
  })

  describe("edge cases", () => {
    it("should handle connection.remoteAddress fallback", () => {
      const config: RateLimitConfig = {
        windowMs: 60000,
        maxRequests: 10,
      }

      const { middleware, limiter } = createRateLimitMiddleware(config)

      const reqWithConnectionIP = {
        connection: { remoteAddress: "192.168.1.1" },
      }

      middleware(reqWithConnectionIP, mockRes, mockNext)

      expect(limiter.getStatus("ip:192.168.1.1")).not.toBeNull()
      expect(mockNext).toHaveBeenCalled()

      limiter.destroy()
    })

    it("should handle completely unknown identifier", () => {
      const config: RateLimitConfig = {
        windowMs: 60000,
        maxRequests: 10,
      }

      const { middleware, limiter } = createRateLimitMiddleware(config)

      const reqWithoutAnyIP = { connection: {} }

      middleware(reqWithoutAnyIP, mockRes, mockNext)

      expect(limiter.getStatus("ip:unknown")).not.toBeNull()
      expect(mockNext).toHaveBeenCalled()

      limiter.destroy()
    })
  })
})

describe("normalizeIp", () => {
  it("should strip the IPv4-mapped IPv6 prefix", () => {
    expect(normalizeIp("::ffff:127.0.0.1")).toBe("127.0.0.1")
    expect(normalizeIp("::FFFF:10.0.0.1")).toBe("10.0.0.1")
  })

  it("should leave plain IPv4 and IPv6 addresses alone", () => {
    expect(normalizeIp("127.0.0.1")).toBe("127.0.0.1")
    expect(normalizeIp("::1")).toBe("::1")
    expect(normalizeIp("::ffff:abcd")).toBe("::ffff:abcd")
  })
})
