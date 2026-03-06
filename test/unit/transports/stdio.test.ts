import { describe, it, expect, beforeEach, afterEach, vi, Mock } from "vitest"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { StdioServer } from "../../../src/transports/stdio.js"

// Mock the dependencies
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => ({
  StdioServerTransport: vi.fn().mockImplementation(() => ({
    close: vi.fn().mockResolvedValue(undefined),
  })),
}))

// Create a mock underlying server
const mockUnderlyingServer = {
  setRequestHandler: vi.fn(),
  connect: vi.fn().mockResolvedValue(undefined),
}

// Create a mock McpServer that wraps the underlying server
const mockServer = {
  server: mockUnderlyingServer,
  connect: vi.fn().mockResolvedValue(undefined),
}

vi.mock("../../../src/utils/server-factory.js", () => ({
  createMCPServer: vi.fn(() => mockServer),
}))

// Mock console.error to avoid noise in tests
const originalConsoleError = console.error
beforeEach(() => {
  console.error = vi.fn()
})

afterEach(() => {
  console.error = originalConsoleError
})

describe("StdioServer", () => {
  let stdioServer: StdioServer
  let mockTransport: any

  beforeEach(() => {
    vi.clearAllMocks()

    // Reset the mock server to default state
    mockServer.connect.mockResolvedValue(undefined)

    mockTransport = {
      close: vi.fn().mockResolvedValue(undefined),
    }

    // Mock the StdioServerTransport constructor
    ;(StdioServerTransport as any).mockImplementation(() => mockTransport)

    stdioServer = new StdioServer()
  })

  describe("constructor", () => {
    it("should create a new stdio server instance", () => {
      expect(stdioServer).toBeInstanceOf(StdioServer)
    })

    it("should create a configured server", () => {
      expect(stdioServer["mcpServer"]).toBeDefined()
      expect(stdioServer["mcpServer"].server.setRequestHandler).toBeDefined()
    })

    it("should not have transport initially", () => {
      expect(stdioServer["transport"]).toBeUndefined()
    })
  })

  describe("start", () => {
    it("should start the stdio server successfully", async () => {
      await stdioServer.start()

      expect(StdioServerTransport).toHaveBeenCalledTimes(1)
      expect(mockServer.connect).toHaveBeenCalledWith(mockTransport)
      expect(console.error).toHaveBeenCalledWith("MCP Server Template running on stdio")
      expect(stdioServer["transport"]).toBe(mockTransport)
    })

    it("should handle server connection errors", async () => {
      const connectionError = new Error("Connection failed")
      mockServer.connect.mockRejectedValue(connectionError)

      await expect(stdioServer.start()).rejects.toThrow("Connection failed")
      expect(StdioServerTransport).toHaveBeenCalledTimes(1)
      expect(mockServer.connect).toHaveBeenCalledWith(mockTransport)
    })

    it("should create new transport on each start", async () => {
      await stdioServer.start()
      const firstTransport = stdioServer["transport"]

      // Reset mocks and create new transport
      vi.clearAllMocks()
      const newMockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
      }
      ;(StdioServerTransport as any).mockImplementation(() => newMockTransport)

      await stdioServer.start()
      const secondTransport = stdioServer["transport"]

      expect(firstTransport).not.toBe(secondTransport)
      expect(secondTransport).toBe(newMockTransport)
    })
  })

  describe("stop", () => {
    it("should stop the stdio server successfully", async () => {
      await stdioServer.start()
      await stdioServer.stop()

      expect(mockTransport.close).toHaveBeenCalledTimes(1)
    })

    it("should handle stop when no transport exists", async () => {
      // Don't start the server, just try to stop it
      await expect(stdioServer.stop()).resolves.toBeUndefined()
      expect(mockTransport.close).not.toHaveBeenCalled()
    })

    it("should handle transport close errors", async () => {
      const closeError = new Error("Close failed")
      mockTransport.close.mockRejectedValue(closeError)

      await stdioServer.start()
      await expect(stdioServer.stop()).rejects.toThrow("Close failed")
      expect(mockTransport.close).toHaveBeenCalledTimes(1)
    })

    it("should be safe to call stop multiple times", async () => {
      await stdioServer.start()
      await stdioServer.stop()
      await stdioServer.stop()

      expect(mockTransport.close).toHaveBeenCalledTimes(1)
    })
  })

  describe("lifecycle", () => {
    it("should support start-stop-start cycle", async () => {
      // First cycle
      await stdioServer.start()
      expect(stdioServer["transport"]).toBe(mockTransport)

      await stdioServer.stop()
      expect(mockTransport.close).toHaveBeenCalledTimes(1)

      // Reset mocks for second cycle
      vi.clearAllMocks()
      const newMockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
      }
      ;(StdioServerTransport as any).mockImplementation(() => newMockTransport)

      // Second cycle
      await stdioServer.start()
      expect(stdioServer["transport"]).toBe(newMockTransport)
      expect(StdioServerTransport).toHaveBeenCalledTimes(1)
      expect(mockServer.connect).toHaveBeenCalledWith(newMockTransport)
    })

    it("should handle multiple starts without stops", async () => {
      await stdioServer.start()
      const firstTransport = stdioServer["transport"]

      // Start again without stopping
      const newMockTransport = {
        close: vi.fn().mockResolvedValue(undefined),
      }
      ;(StdioServerTransport as any).mockImplementation(() => newMockTransport)

      await stdioServer.start()
      const secondTransport = stdioServer["transport"]

      expect(firstTransport).not.toBe(secondTransport)
      expect(secondTransport).toBe(newMockTransport)
    })
  })

  describe("error handling", () => {
    it("should handle StdioServerTransport constructor errors", async () => {
      const constructorError = new Error("Transport creation failed")
      ;(StdioServerTransport as any).mockImplementation(() => {
        throw constructorError
      })

      await expect(stdioServer.start()).rejects.toThrow("Transport creation failed")
    })

    it("should handle server connect timeout", async () => {
      const timeoutError = new Error("Connection timeout")
      mockServer.connect.mockRejectedValue(timeoutError)

      await expect(stdioServer.start()).rejects.toThrow("Connection timeout")
    })

    it("should handle transport close timeout", async () => {
      const timeoutError = new Error("Close timeout")
      mockTransport.close.mockRejectedValue(timeoutError)

      await stdioServer.start()
      await expect(stdioServer.stop()).rejects.toThrow("Close timeout")
    })
  })

  describe("integration", () => {
    it("should properly integrate with base transport server", () => {
      expect(stdioServer["mcpServer"]).toBeDefined()
      expect(typeof stdioServer.start).toBe("function")
      expect(typeof stdioServer.stop).toBe("function")
    })

    it("should inherit from BaseTransportServer", () => {
      expect(stdioServer).toHaveProperty("createConfiguredServer")
      expect(typeof stdioServer["createConfiguredServer"]).toBe("function")
    })
  })

  describe("console output", () => {
    it("should log startup message", async () => {
      await stdioServer.start()
      expect(console.error).toHaveBeenCalledWith("MCP Server Template running on stdio")
    })

    it("should only log startup message once per start", async () => {
      await stdioServer.start()
      expect(console.error).toHaveBeenCalledTimes(1)
      expect(console.error).toHaveBeenCalledWith("MCP Server Template running on stdio")
    })
  })
})
