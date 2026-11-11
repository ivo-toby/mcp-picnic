import http from "http"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  StreamableHttpServer,
  StreamableHttpServerOptions,
} from "../../../src/transports/streamable-http"
import { createMCPServer } from "../../../src/utils/server-factory"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"

// Mock dependencies
vi.mock("../../../src/utils/server-factory")
vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "test-session-id"),
  timingSafeEqual: vi.fn((a: Buffer, b: Buffer) => Buffer.compare(a, b) === 0),
}))

const mockTransport = {
  sessionId: "test-session-id",
  close: vi.fn().mockResolvedValue(undefined),
  onclose: undefined,
  handleRequest: vi.fn().mockResolvedValue(undefined),
}

vi.mock("@modelcontextprotocol/sdk/server/streamableHttp.js", () => ({
  StreamableHTTPServerTransport: vi.fn().mockImplementation((options) => {
    const transport = {
      ...mockTransport,
      sessionId: "test-session-id",
      close: vi.fn().mockResolvedValue(undefined),
      onclose: undefined,
      handleRequest: vi.fn().mockResolvedValue(undefined),
    }

    if (options?.onsessioninitialized) {
      const sessionId = options.sessionIdGenerator
        ? options.sessionIdGenerator()
        : transport.sessionId
      transport.sessionId = sessionId
      options.onsessioninitialized(sessionId)
    }
    return transport
  }),
}))

describe("StreamableHttpServer", () => {
  let server: StreamableHttpServer
  const mockCreateMCPServer = vi.mocked(createMCPServer)
  const mockUnderlyingServer = {
    setRequestHandler: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
  }
  const mockSDKServer = {
    server: mockUnderlyingServer,
    connect: vi.fn().mockResolvedValue(undefined),
    handleRequest: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockCreateMCPServer.mockReturnValue(mockSDKServer as any)
    mockSDKServer.connect.mockResolvedValue(undefined)
    vi.useFakeTimers()
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.useRealTimers()
    if (server) {
      try {
        await server.stop()
      } catch (error) {
        // Ignore errors during test cleanup
      }
    }
  })

  it("should create a server with default options", () => {
    server = new StreamableHttpServer()
    // @ts-expect-error - private property access
    expect(server.port).toBe(3000)
    // @ts-expect-error - private property access
    expect(server.host).toBe("localhost")
  })

  it("should create a server with custom options", () => {
    const options: StreamableHttpServerOptions = {
      port: 4000,
      host: "0.0.0.0",
      enableRequestLogging: true,
      rateLimitConfig: { windowMs: 1000, maxRequests: 10 },
    }
    server = new StreamableHttpServer(options)
    // @ts-expect-error - private property access
    expect(server.port).toBe(4000)
    // @ts-expect-error - private property access
    expect(server.host).toBe("0.0.0.0")
    // @ts-expect-error - private property access
    expect(server.rateLimiter).toBeDefined()
  })

  it("should start and stop the server", async () => {
    server = new StreamableHttpServer()
    const listenSpy = vi.spyOn(http.Server.prototype, "listen").mockImplementation(function (
      this: any,
      _port: any,
      callback: any,
    ) {
      if (typeof callback === "function") {
        callback()
      }
      return this
    })
    const closeSpy = vi.spyOn(http.Server.prototype, "close").mockImplementation(function (
      this: any,
      callback?: any,
    ) {
      if (typeof callback === "function") {
        callback()
      }
      return this
    })

    await server.start()
    // @ts-expect-error - private property access
    expect(server.server).toBeInstanceOf(http.Server)
    expect(listenSpy).toHaveBeenCalledWith(3000, expect.any(Function))

    await server.stop()
    expect(closeSpy).toHaveBeenCalled()
  })

  it("should cleanup sessions on stop", async () => {
    server = new StreamableHttpServer()
    vi.spyOn(http.Server.prototype, "listen").mockImplementation(function (
      this: any,
      _port: any,
      callback: any,
    ) {
      if (callback) callback()
      return this
    })
    vi.spyOn(http.Server.prototype, "close").mockImplementation(function (
      this: any,
      callback: any,
    ) {
      if (callback) callback()
      return this
    })

    await server.start()
    await server.createNewSession()
    await server.stop()

    expect(server.getActiveSessions()).toHaveLength(0)
  })

  it("should provide a health check", async () => {
    vi.useRealTimers()
    server = new StreamableHttpServer({ port: 0, enableRequestLogging: false })
    await server.start()

    // @ts-expect-error - private property access
    const httpServer = server.server as http.Server
    const address = httpServer.address() as { port: number }

    const res = await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
      const req = http.request(
        { hostname: "127.0.0.1", port: address.port, path: "/health", method: "GET" },
        (response) => {
          let data = ""
          response.on("data", (chunk: string) => (data += chunk))
          response.on("end", () => {
            resolve({ statusCode: response.statusCode!, body: JSON.parse(data) })
          })
        },
      )
      req.on("error", reject)
      req.end()
    })

    expect(res.statusCode).toBe(200)
    expect(res.body).toEqual(
      expect.objectContaining({
        sessions: {
          active: 0,
          max: 100,
        },
      }),
    )
  })

  it("should not rate limit health checks", async () => {
    vi.useRealTimers()
    server = new StreamableHttpServer({
      port: 0,
      enableRequestLogging: false,
      rateLimitConfig: { windowMs: 60000, maxRequests: 1, skipPaths: ["/health"] },
    })
    await server.start()

    // @ts-expect-error - private property access
    const httpServer = server.server as http.Server
    const address = httpServer.address() as { port: number }

    const checkHealth = () =>
      new Promise<number>((resolve, reject) => {
        const req = http.request(
          { hostname: "127.0.0.1", port: address.port, path: "/health", method: "GET" },
          (response) => {
            response.resume()
            response.on("end", () => resolve(response.statusCode!))
          },
        )
        req.on("error", reject)
        req.end()
      })

    await expect(Promise.all([checkHealth(), checkHealth(), checkHealth()])).resolves.toEqual([
      200, 200, 200,
    ])
  })

  describe("rate limit identity", () => {
    const get = (port: number, headers: Record<string, string> = {}) =>
      new Promise<number>((resolve, reject) => {
        const req = http.request(
          { hostname: "127.0.0.1", port, path: "/sessions", method: "GET", headers },
          (response) => {
            response.resume()
            response.on("end", () => resolve(response.statusCode!))
          },
        )
        req.on("error", reject)
        req.end()
      })

    const startServer = async (options: StreamableHttpServerOptions) => {
      vi.useRealTimers()
      server = new StreamableHttpServer({ port: 0, enableRequestLogging: false, ...options })
      await server.start()
      // @ts-expect-error - private property access
      return ((server.server as http.Server).address() as { port: number }).port
    }

    /**
     * Spend the client IP's own bucket with one session-less request and return the IP the
     * server saw (IPv4 or IPv4-mapped IPv6, depending on how the socket was bound).
     */
    const spendIpBucket = async (port: number, headers: Record<string, string> = {}) => {
      expect(await get(port, headers)).toBe(200)
      // @ts-expect-error - private property access
      const keys = [...server.rateLimiter.ipLimiter["store"].keys()] as string[]
      return keys[0].replace(/^ip:/, "")
    }

    const registerSession = (id: string, clientIp: string) => {
      // The SDK mock can't run a real initialize handshake, so register the session directly.
      // @ts-expect-error - private property access
      server.transports[id] = { ...mockTransport }
      // @ts-expect-error - private property access
      server.sessionClientIps.set(id, clientIp)
    }

    it("should limit live sessions separately from their client IP", async () => {
      const port = await startServer({ rateLimitConfig: { windowMs: 60000, maxRequests: 1 } })
      registerSession("test-session-id", await spendIpBucket(port))

      expect(await get(port, { "mcp-session-id": "test-session-id" })).toBe(200)
      expect(await get(port)).toBe(429)
      expect(await get(port, { "mcp-session-id": "unknown-session" })).toBe(429)
      expect(await get(port, { "mcp-session-id": "test-session-id" })).toBe(429)
    })

    /** Make the SDK mock initialize the session while handling the request, like the real SDK. */
    const mockInitializingTransport = () =>
      vi.mocked(StreamableHTTPServerTransport).mockImplementationOnce((options: any) => {
        const transport: any = {
          sessionId: undefined,
          close: vi.fn().mockResolvedValue(undefined),
          handleRequest: vi.fn(async (_req: any, res: any) => {
            transport.sessionId = options.sessionIdGenerator()
            options.onsessioninitialized(transport.sessionId)
            res.status(200).json({ jsonrpc: "2.0", id: 1, result: {} })
          }),
        }
        return transport
      })

    const postInitialize = (port: number, headers: Record<string, string> = {}) =>
      new Promise<number>((resolve, reject) => {
        const req = http.request(
          {
            hostname: "127.0.0.1",
            port,
            path: "/mcp",
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
              ...headers,
            },
          },
          (response) => {
            response.resume()
            response.on("end", () => resolve(response.statusCode!))
          },
        )
        req.on("error", reject)
        req.end(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            method: "initialize",
            params: {
              protocolVersion: "2025-06-18",
              capabilities: {},
              clientInfo: { name: "test", version: "1.0.0" },
            },
          }),
        )
      })

    it("should bind a session created via initialize to the caller's IP", async () => {
      mockInitializingTransport()
      const port = await startServer({ rateLimitConfig: { windowMs: 60000, maxRequests: 2 } })

      expect(await postInitialize(port)).toBe(200)
      // @ts-expect-error - private property access
      expect(server.sessionClientIps.get("test-session-id")).toBe("127.0.0.1")

      // A follow-up request on that session lands in the session's bucket.
      expect(await get(port, { "mcp-session-id": "test-session-id" })).toBe(200)
      // @ts-expect-error - private property access
      expect(server.rateLimiter.limiter.getStatus("session:test-session-id")?.count).toBe(1)
    })

    it("should keep initialize IP-limited when it carries a live session ID", async () => {
      const port = await startServer({ rateLimitConfig: { windowMs: 60000, maxRequests: 1 } })
      registerSession("existing-session", await spendIpBucket(port))
      vi.mocked(StreamableHTTPServerTransport).mockClear()

      // The session bucket has quota, but the IP bucket that pays for new sessions is spent.
      expect(await postInitialize(port, { "mcp-session-id": "existing-session" })).toBe(429)
      expect(StreamableHTTPServerTransport).not.toHaveBeenCalled()
      expect(server.getActiveSessions()).toEqual(["existing-session"])
    })

    it("should charge both buckets for initialize sent with a live session ID", async () => {
      mockInitializingTransport()
      const port = await startServer({ rateLimitConfig: { windowMs: 60000, maxRequests: 5 } })
      const ip = await spendIpBucket(port)
      registerSession("existing-session", ip)

      expect(await postInitialize(port, { "mcp-session-id": "existing-session" })).toBe(200)
      // @ts-expect-error - private property access
      const { limiter } = server.rateLimiter
      expect(limiter.getStatus("session:existing-session")?.count).toBe(1)
      expect(limiter.getStatus(`ip:${ip}`)?.count).toBe(2)
    })

    it("should not charge a session for requests from another client IP", async () => {
      const port = await startServer({ rateLimitConfig: { windowMs: 60000, maxRequests: 1 } })
      await spendIpBucket(port)
      registerSession("test-session-id", "203.0.113.7")

      // Same session ID, different IP: falls back to the (spent) IP bucket.
      expect(await get(port, { "mcp-session-id": "test-session-id" })).toBe(429)
      // @ts-expect-error - private property access
      expect(server.rateLimiter.limiter.getStatus("session:test-session-id")).toBeNull()
    })

    it("should not charge a session for unauthenticated requests", async () => {
      const port = await startServer({
        authToken: "secret",
        rateLimitConfig: { windowMs: 60000, maxRequests: 1 },
      })
      registerSession("test-session-id", await spendIpBucket(port, { "x-mcp-token": "secret" }))

      // No token: limited on the (spent) IP bucket, never reaching the session bucket.
      expect(await get(port, { "mcp-session-id": "test-session-id" })).toBe(429)
      // @ts-expect-error - private property access
      expect(server.rateLimiter.limiter.getStatus("session:test-session-id")).toBeNull()

      // The session owner still has its full quota.
      expect(
        await get(port, { "mcp-session-id": "test-session-id", "x-mcp-token": "secret" }),
      ).toBe(200)
    })

    it("should forget a session's client IP when the session ends", async () => {
      const port = await startServer({ rateLimitConfig: { windowMs: 60000, maxRequests: 1 } })
      registerSession("test-session-id", await spendIpBucket(port))
      server.cleanupSession("test-session-id")

      // @ts-expect-error - private property access
      expect(server.sessionClientIps.has("test-session-id")).toBe(false)
    })

    it("should key on X-Forwarded-For when trustProxy is set", async () => {
      const port = await startServer({
        trustProxy: "loopback",
        rateLimitConfig: { windowMs: 60000, maxRequests: 1 },
      })

      expect(await get(port, { "X-Forwarded-For": "100.64.0.1" })).toBe(200)
      expect(await get(port, { "X-Forwarded-For": "100.64.0.2" })).toBe(200)
      expect(await get(port, { "X-Forwarded-For": "100.64.0.1" })).toBe(429)
    })

    it("should ignore X-Forwarded-For when trustProxy is not set", async () => {
      const port = await startServer({ rateLimitConfig: { windowMs: 60000, maxRequests: 1 } })

      expect(await get(port, { "X-Forwarded-For": "100.64.0.1" })).toBe(200)
      expect(await get(port, { "X-Forwarded-For": "100.64.0.2" })).toBe(429)
    })
  })

  it("should not resolve Object.prototype members as sessions", () => {
    server = new StreamableHttpServer({ port: 0, enableRequestLogging: false })

    expect(server.getTransport("constructor")).toBeUndefined()
    expect(server.getTransport("__proto__")).toBeUndefined()
    expect(() => server.cleanupSession("constructor")).not.toThrow()
  })

  it("should setup routes", async () => {
    vi.useRealTimers()
    server = new StreamableHttpServer({ port: 0, enableRequestLogging: false })
    await server.start()

    // @ts-expect-error - private property access
    const httpServer = server.server as http.Server
    const address = httpServer.address() as { port: number }

    const res = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path: "/mcp",
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
        (response) => {
          let data = ""
          response.on("data", (chunk: string) => (data += chunk))
          response.on("end", () => {
            resolve({ statusCode: response.statusCode! })
          })
        },
      )
      req.on("error", reject)
      req.write("{}")
      req.end()
    })

    // We get a response (not 404), meaning the /mcp route exists
    expect(res.statusCode).not.toBe(404)
  })

  it("should require authentication when authToken is configured", async () => {
    vi.useRealTimers()
    server = new StreamableHttpServer({ port: 0, enableRequestLogging: false, authToken: "secret" })
    await server.start()

    // @ts-expect-error - private property access
    const httpServer = server.server as http.Server
    const address = httpServer.address() as { port: number }

    const res = await new Promise<{ statusCode: number; body: any }>((resolve, reject) => {
      const req = http.request(
        { hostname: "127.0.0.1", port: address.port, path: "/sessions", method: "GET" },
        (response) => {
          let data = ""
          response.on("data", (chunk: string) => (data += chunk))
          response.on("end", () => {
            resolve({ statusCode: response.statusCode!, body: JSON.parse(data) })
          })
        },
      )
      req.on("error", reject)
      req.end()
    })

    expect(res.statusCode).toBe(401)
    expect(res.body).toEqual(
      expect.objectContaining({
        error: "Unauthorized",
      }),
    )
  })

  it("should require auth for /mcp POST when authToken is configured", async () => {
    vi.useRealTimers()
    server = new StreamableHttpServer({ port: 0, enableRequestLogging: false, authToken: "secret" })
    await server.start()

    // @ts-expect-error - private property access
    const httpServer = server.server as http.Server
    const address = httpServer.address() as { port: number }

    const mcpRes = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path: "/mcp",
          method: "POST",
          headers: { "Content-Type": "application/json" },
        },
        (response) => {
          response.on("data", () => {})
          response.on("end", () => {
            resolve({ statusCode: response.statusCode! })
          })
        },
      )
      req.on("error", reject)
      req.write("{}")
      req.end()
    })

    const healthRes = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const req = http.request(
        { hostname: "127.0.0.1", port: address.port, path: "/health", method: "GET" },
        (response) => {
          response.on("data", () => {})
          response.on("end", () => {
            resolve({ statusCode: response.statusCode! })
          })
        },
      )
      req.on("error", reject)
      req.end()
    })

    expect(mcpRes.statusCode).toBe(401)
    expect(healthRes.statusCode).toBe(200)
  })

  it("should reject wrong auth header token", async () => {
    vi.useRealTimers()
    server = new StreamableHttpServer({
      port: 0,
      enableRequestLogging: false,
      authToken: "secret",
      authHeaderName: "x-api-token",
    })
    await server.start()

    // @ts-expect-error - private property access
    const httpServer = server.server as http.Server
    const address = httpServer.address() as { port: number }

    const sessionsRes = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path: "/sessions",
          method: "GET",
          headers: { "x-api-token": "wrong" },
        },
        (response) => {
          response.on("data", () => {})
          response.on("end", () => {
            resolve({ statusCode: response.statusCode! })
          })
        },
      )
      req.on("error", reject)
      req.end()
    })

    expect(sessionsRes.statusCode).toBe(401)
  })

  it("should allow custom header token authentication", async () => {
    vi.useRealTimers()
    server = new StreamableHttpServer({
      port: 0,
      enableRequestLogging: false,
      authToken: "secret",
      authHeaderName: "x-api-token",
    })
    await server.start()

    // @ts-expect-error - private property access
    const httpServer = server.server as http.Server
    const address = httpServer.address() as { port: number }

    const sessionsRes = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path: "/sessions",
          method: "GET",
          headers: { "x-api-token": "secret" },
        },
        (response) => {
          response.on("data", () => {})
          response.on("end", () => {
            resolve({ statusCode: response.statusCode! })
          })
        },
      )
      req.on("error", reject)
      req.end()
    })

    expect(sessionsRes.statusCode).toBe(200)
  })

  it("should allow authorization bearer token authentication", async () => {
    vi.useRealTimers()
    server = new StreamableHttpServer({ port: 0, enableRequestLogging: false, authToken: "secret" })
    await server.start()

    // @ts-expect-error - private property access
    const httpServer = server.server as http.Server
    const address = httpServer.address() as { port: number }

    const sessionsRes = await new Promise<{ statusCode: number }>((resolve, reject) => {
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path: "/sessions",
          method: "GET",
          headers: { Authorization: "Bearer secret" },
        },
        (response) => {
          response.on("data", () => {})
          response.on("end", () => {
            resolve({ statusCode: response.statusCode! })
          })
        },
      )
      req.on("error", reject)
      req.end()
    })

    expect(sessionsRes.statusCode).toBe(200)
  })

  it("should not recurse when transport close fires onclose during session cleanup", () => {
    server = new StreamableHttpServer({ enableRequestLogging: false })
    const sessionId = "regression-session"

    const transport: {
      sessionId: string
      closeCalls: number
      onclose?: () => void
      close: () => void
    } = {
      sessionId,
      closeCalls: 0,
      close() {
        this.closeCalls++
        this.onclose?.()
      },
    }

    transport.onclose = () => {
      if (transport.sessionId) {
        server.cleanupSession(transport.sessionId)
      }
    }

    // @ts-expect-error - private property access
    server.transports[sessionId] = transport

    expect(() => server.cleanupSession(sessionId)).not.toThrow()
    expect(transport.closeCalls).toBe(1)
    expect(server.getActiveSessions()).toEqual([])
  })
})
