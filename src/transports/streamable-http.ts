import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import express, { Request, Response, NextFunction } from "express"
import cors from "cors"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import { BaseTransportServer } from "./base.js"
import { TransportError, ErrorCode, ErrorUtils } from "../types/errors.js"
import { createRateLimitMiddleware, RateLimitConfig } from "../utils/rate-limiter.js"
import { randomUUID, timingSafeEqual } from "crypto"

/**
 * Configuration options for the HTTP server
 */
export interface StreamableHttpServerOptions {
  port?: number
  host?: string
  authToken?: string
  authHeaderName?: string
  corsOptions?: cors.CorsOptions
  rateLimitConfig?: RateLimitConfig
  requestTimeoutMs?: number
  maxRequestSizeBytes?: number
  enableRequestLogging?: boolean
  maxConcurrentSessions?: number
  sessionTimeoutMs?: number
}

/**
 * Class to handle HTTP server setup and configuration using the official MCP StreamableHTTP transport
 */
export class StreamableHttpServer extends BaseTransportServer {
  private app: express.Application
  // @ts-expect-error - This property will be initialized in the start() method
  private server: import("http").Server
  private port: number
  private host: string
  private options: StreamableHttpServerOptions
  private rateLimiter?: ReturnType<typeof createRateLimitMiddleware>
  private transports: Record<string, StreamableHTTPServerTransport> = {}
  private sessionTimeouts = new Map<string, NodeJS.Timeout>()

  /**
   * Create a new HTTP server for MCP over HTTP
   *
   * @param options Configuration options
   */
  constructor(options: StreamableHttpServerOptions = {}) {
    super()
    this.options = {
      port: 3000,
      host: "localhost",
      authHeaderName: "x-mcp-token",
      corsOptions: { origin: "*" },
      rateLimitConfig: { windowMs: 15 * 60 * 1000, maxRequests: 100 },
      requestTimeoutMs: 10000,
      maxRequestSizeBytes: 1024 * 1024 * 10, // 10MB
      enableRequestLogging: true,
      maxConcurrentSessions: 100,
      sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
      ...options,
    }
    this.app = express()

    this.port = this.options.port!
    this.host = this.options.host!

    // Set up middleware
    this.setupMiddleware()

    // Set up routes
    this.setupRoutes()
  }

  /**
   * Set up middleware for the Express app
   */
  private setupMiddleware(): void {
    // Request logging middleware
    if (this.options.enableRequestLogging) {
      this.app.use((req: Request, res: Response, next: NextFunction) => {
        const start = Date.now()
        console.error(`[${new Date().toISOString()}] ${req.method} ${req.url} - ${req.ip}`)

        res.on("finish", () => {
          const duration = Date.now() - start
          console.error(
            `[${new Date().toISOString()}] ${req.method} ${req.url} - ${res.statusCode} - ${duration}ms`,
          )
        })
        next()
      })
    }

    // Rate limiting middleware
    if (this.options.rateLimitConfig) {
      this.rateLimiter = createRateLimitMiddleware(this.options.rateLimitConfig)
      this.app.use(this.rateLimiter.middleware)
    }

    if (this.options.authToken) {
      this.app.use((req: Request, res: Response, next: NextFunction) => {
        if (req.path === "/health") {
          return next()
        }

        const headerName = this.options.authHeaderName ?? "x-mcp-token"
        const headerToken = req.header(headerName)
        const authorizationHeader = req.header("authorization")

        const headerTokenValid = this.compareAuthTokens(headerToken)
        const bearerTokenValid =
          typeof authorizationHeader === "string" &&
          authorizationHeader.startsWith("Bearer ") &&
          this.compareAuthTokens(authorizationHeader.slice(7))

        const hasValidToken = headerTokenValid || bearerTokenValid

        if (!hasValidToken) {
          return res.status(401).json({
            error: "Unauthorized",
            message:
              "Missing or invalid authentication token. Provide a valid auth header.",
          })
        }

        return next()
      })
    }

    // Request timeout middleware
    this.app.use((req: Request, res: Response, next: NextFunction) => {
      const timeout = setTimeout(() => {
        if (!res.headersSent) {
          const error = new TransportError(ErrorCode.TRANSPORT_TIMEOUT, "Request timeout", {
            timeoutMs: this.options.requestTimeoutMs,
          })
          res.status(408).json({
            jsonrpc: "2.0",
            error: error.toMCPError(),
            id: null,
          })
        }
      }, this.options.requestTimeoutMs)

      res.on("finish", () => clearTimeout(timeout))
      res.on("close", () => clearTimeout(timeout))
      next()
    })

    // Configure CORS
    this.app.use(
      cors(
        this.options.corsOptions || {
          origin: "*",
          methods: ["GET", "POST", "DELETE"],
          allowedHeaders: ["Content-Type", "MCP-Session-ID"],
          exposedHeaders: ["MCP-Session-ID"],
        },
      ),
    )

    // Configure JSON body parsing with size limit
    this.app.use(
      express.json({
        limit: this.options.maxRequestSizeBytes,
        verify: (req: any, res: Response, buf: Buffer) => {
          if (buf.length > this.options.maxRequestSizeBytes!) {
            const error = new TransportError(ErrorCode.INVALID_REQUEST, "Request body too large", {
              maxSize: this.options.maxRequestSizeBytes,
              actualSize: buf.length,
            })
            throw error
          }
        },
      }),
    )

    // Global error handler for middleware
    this.app.use((error: any, req: Request, res: Response, next: NextFunction) => {
      ErrorUtils.logError(error, "HTTP Middleware")

      if (res.headersSent) {
        return next(error)
      }

      if (ErrorUtils.isMCPError(error)) {
        return res.status(error.statusCode).json({
          jsonrpc: "2.0",
          error: error.toMCPError(),
          id: null,
        })
      }

      // Handle specific Express errors
      if (error.type === "entity.too.large") {
        const transportError = new TransportError(
          ErrorCode.INVALID_REQUEST,
          "Request body too large",
        )
        return res.status(413).json({
          jsonrpc: "2.0",
          error: transportError.toMCPError(),
          id: null,
        })
      }

      // Generic error response
      const genericError = new TransportError(ErrorCode.INTERNAL_ERROR, "Internal server error")
      res.status(500).json({
        jsonrpc: "2.0",
        error: genericError.toMCPError(),
        id: null,
      })
    })
  }

  private compareAuthTokens(token: string | undefined): boolean {
    if (!this.options.authToken || typeof token !== "string") {
      return false
    }

    const provided = Buffer.from(token)
    const expected = Buffer.from(this.options.authToken)
    if (provided.length !== expected.length) {
      return false
    }

    return timingSafeEqual(provided, expected)
  }

  /**
   * Set up the routes for MCP over HTTP
   */
  private setupRoutes(): void {
    // Handle all MCP requests (POST, GET, DELETE) on a single endpoint
    this.app.all("/mcp", async (req: Request, res: Response) => {
      try {
        await this.handleMCPRequest(req, res)
      } catch (error) {
        ErrorUtils.logError(error, "MCP Request Handler")
        if (!res.headersSent) {
          const errorResponse = ErrorUtils.createSafeErrorResponse(error)
          res.status(500).json({
            jsonrpc: "2.0",
            error: errorResponse,
            id: null,
          })
        }
      }
    })

    // Add a health check endpoint
    this.app.get("/health", (_req: Request, res: Response) => {
      try {
        const stats = this.rateLimiter?.limiter.getStats()
        res.status(200).json({
          status: "ok",
          timestamp: new Date().toISOString(),
          sessions: {
            active: this.getActiveSessions().length,
            max: this.getMaxSessions(),
          },
          rateLimit: stats || null,
        })
      } catch (error) {
        ErrorUtils.logError(error, "Health Check")
        res.status(500).json({
          status: "error",
          message: "Health check failed",
        })
      }
    })

    // Add session management endpoint
    this.app.get("/sessions", (req: Request, res: Response) => {
      try {
        const sessions = this.getActiveSessions().map((sessionId) => ({
          id: sessionId,
          createdAt: new Date().toISOString(), // Would need to track this
        }))

        res.status(200).json({
          sessions,
          total: sessions.length,
          max: this.getMaxSessions(),
        })
      } catch (error) {
        ErrorUtils.logError(error, "Session List")
        res.status(500).json({
          error: "Failed to retrieve sessions",
        })
      }
    })

    // Add session cleanup endpoint (for debugging/admin)
    this.app.delete("/sessions/:sessionId", (req: Request, res: Response) => {
      const { sessionId } = req.params
      this.cleanupSession(sessionId)
      res.status(204).send()
    })
  }

  /**
   * Handle MCP requests with enhanced error handling
   */
  private async handleMCPRequest(req: Request, res: Response): Promise<void> {
    const { method } = req

    switch (method) {
      case "POST":
        await this.handlePostRequest(req, res)
        break
      case "GET":
        await this.handleGetRequest(req, res)
        break
      case "DELETE":
        await this.handleDeleteRequest(req, res)
        break
      default:
        res.setHeader("Allow", "POST, GET, DELETE")
        res.status(405).json({ error: "Method Not Allowed" })
    }
  }

  /**
   * Handle POST requests (main MCP communication)
   */
  private async handlePostRequest(req: Request, res: Response): Promise<void> {
    const sessionId = req.header("mcp-session-id")
    const isInitialize = isInitializeRequest(req.body)

    if (isInitialize) {
      const transport = await this.createNewSession()
      await transport.handleRequest(req, res, req.body)
    } else {
      if (!sessionId) {
        throw new TransportError(
          ErrorCode.TRANSPORT_INVALID_SESSION,
          "Missing mcp-session-id header",
        )
      }
      const transport = this.getTransport(sessionId)
      if (!transport) {
        throw new TransportError(ErrorCode.TRANSPORT_INVALID_SESSION, "Invalid session ID")
      }
      this.refreshSessionTimeout(sessionId)
      await transport.handleRequest(req, res, req.body)
    }
  }

  /**
   * Handle GET requests (server-sent events)
   */
  private async handleGetRequest(req: Request, res: Response): Promise<void> {
    const sessionId = req.header("mcp-session-id")

    if (!sessionId) {
      throw new TransportError(ErrorCode.TRANSPORT_INVALID_SESSION, "Missing mcp-session-id header")
    }

    const transport = this.getTransport(sessionId)
    if (!transport) {
      throw new TransportError(ErrorCode.TRANSPORT_INVALID_SESSION, "Invalid session ID")
    }

    this.refreshSessionTimeout(sessionId)
    await transport.handleRequest(req, res)
  }

  /**
   * Handle DELETE requests (session termination)
   */
  private async handleDeleteRequest(req: Request, res: Response): Promise<void> {
    const sessionId = req.header("mcp-session-id")

    if (!sessionId) {
      throw new TransportError(ErrorCode.TRANSPORT_INVALID_SESSION, "Missing mcp-session-id header")
    }

    const transport = this.getTransport(sessionId)
    if (!transport) {
      throw new TransportError(ErrorCode.TRANSPORT_INVALID_SESSION, "Invalid session ID")
    }

    await transport.handleRequest(req, res, req.body)

    this.cleanupSession(sessionId)
  }

  /**
   * Start the HTTP server
   *
   * @returns Promise that resolves when the server is started
   */
  public async start(): Promise<void> {
    // Load resources based on available tokens

    return new Promise((resolve) => {
      this.server = this.app.listen(this.port, () => {
        console.error(`MCP StreamableHTTP server running on http://${this.host}:${this.port}/mcp`)
        resolve()
      })

      // Handle server errors
      this.server.on("error", (err: Error) => {
        console.error(`Server error: ${err.message}`)
      })
    })
  }

  /**
   * Stop the HTTP server
   *
   * @returns Promise that resolves when the server is stopped
   */
  public async stop(): Promise<void> {
    console.error("Stopping HTTP server...")

    // Clean up all sessions
    const sessionIds = this.getActiveSessions()
    console.error(`Cleaning up ${sessionIds.length} active sessions...`)

    await Promise.allSettled(
      sessionIds.map(async (sessionId) => {
        try {
          this.cleanupSession(sessionId)
        } catch (error) {
          ErrorUtils.logError(error, `Session ${sessionId} cleanup`)
        }
      }),
    )

    // Clean up rate limiter
    if (this.rateLimiter) {
      this.rateLimiter.limiter.destroy()
    }

    // Close the HTTP server
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Server shutdown timed out"))
        }, 10000) // 10 second timeout

        this.server.close((err?: Error) => {
          clearTimeout(timeout)
          if (err) {
            reject(err)
          } else {
            resolve()
          }
        })
      })
    }

    console.error("HTTP server stopped successfully")
  }

  public async createNewSession(): Promise<StreamableHTTPServerTransport> {
    if (Object.keys(this.transports).length >= this.options.maxConcurrentSessions!) {
      throw new TransportError(ErrorCode.SESSION_LIMIT_EXCEEDED, "Max concurrent sessions reached")
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sid) => {
        this.transports[sid] = transport
        this.setupSessionTimeout(sid)
        this.emit("session-created", sid)
      },
    })

    transport.onclose = () => {
      if (transport.sessionId) {
        this.cleanupSession(transport.sessionId)
      }
    }

    // Create and connect a new MCP server instance for this session
    const server = this.createConfiguredServer()
    await server.connect(transport)

    return transport
  }

  public getTransport(sessionId: string): StreamableHTTPServerTransport | undefined {
    return this.transports[sessionId]
  }

  public cleanupSession(sessionId: string): void {
    const transport = this.transports[sessionId]
    if (transport) {
      transport.close()
      delete this.transports[sessionId]
      const timeout = this.sessionTimeouts.get(sessionId)
      if (timeout) {
        clearTimeout(timeout)
        this.sessionTimeouts.delete(sessionId)
      }
      this.emit("session-ended", sessionId)
    }
  }

  private setupSessionTimeout(sessionId: string): void {
    const timeout = setTimeout(() => {
      this.cleanupSession(sessionId)
    }, this.options.sessionTimeoutMs)
    this.sessionTimeouts.set(sessionId, timeout)
  }

  public refreshSessionTimeout(sessionId: string): void {
    const timeout = this.sessionTimeouts.get(sessionId)
    if (timeout) {
      timeout.refresh()
    }
  }

  public getActiveSessions() {
    return Object.keys(this.transports)
  }

  public getMaxSessions() {
    return this.options.maxConcurrentSessions
  }
}
