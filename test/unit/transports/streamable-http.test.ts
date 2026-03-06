import http from "http"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  StreamableHttpServer,
  StreamableHttpServerOptions,
} from "../../../src/transports/streamable-http"
import { createMCPServer } from "../../../src/utils/server-factory"

// Mock dependencies
vi.mock("../../../src/utils/server-factory")
vi.mock("crypto", () => ({
  randomUUID: vi.fn(() => "test-session-id"),
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
})
