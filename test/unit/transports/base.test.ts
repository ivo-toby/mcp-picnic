import { describe, it, expect, beforeEach, vi, Mock } from "vitest"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { BaseTransportServer } from "../../../src/transports/base.js"
import { toolRegistry } from "../../../src/tools/index.js"
import { promptRegistry } from "../../../src/prompts/index.js"
import { resourceRegistry } from "../../../src/resources/index.js"
import { ToolError, PromptError, ResourceError, ErrorCode } from "../../../src/types/errors.js"
import { createMCPServer } from "../../../src/utils/server-factory.js"

// Mock the SDK types
vi.mock("@modelcontextprotocol/sdk/types.js", () => ({
  ListToolsRequestSchema: { properties: { method: { const: "tools/list" } } },
  ListPromptsRequestSchema: { properties: { method: { const: "prompts/list" } } },
  GetPromptRequestSchema: { properties: { method: { const: "prompts/get" } } },
  CallToolRequestSchema: { properties: { method: { const: "tools/call" } } },
  ListResourcesRequestSchema: { properties: { method: { const: "resources/list" } } },
  ReadResourceRequestSchema: { properties: { method: { const: "resources/read" } } },
}))

// Mock the registries
vi.mock("../../../src/tools/index.js", () => ({
  toolRegistry: {
    getToolsList: vi.fn(),
    executeTool: vi.fn(),
  },
}))

vi.mock("../../../src/prompts/index.js", () => ({
  promptRegistry: {
    getPromptsList: vi.fn(),
    executePrompt: vi.fn(),
  },
}))

vi.mock("../../../src/resources/index.js", () => ({
  resourceRegistry: {
    getResourcesList: vi.fn(),
    readResource: vi.fn(),
  },
}))

vi.mock("../../../src/utils/server-factory.js", () => ({
  createMCPServer: vi.fn(() => {
    const handlers = new Map()
    const mockServer = {
      setRequestHandler: vi.fn((schema: any, handler: any) => {
        const key = schema.properties.method.const
        handlers.set(key, handler)
      }),
      getHandler: (key: string) => handlers.get(key),
      connect: vi.fn(),
    }
    return {
      server: mockServer,
      connect: vi.fn(),
    }
  }),
}))

// Create a concrete implementation for testing
class TestTransportServer extends BaseTransportServer {
  public server: any
  public isStarted = false

  constructor() {
    super()
    this.server = this.createConfiguredServer()
  }

  async start(): Promise<void> {
    this.isStarted = true
  }

  async stop(): Promise<void> {
    this.isStarted = false
  }

  // Expose protected method for testing
  public testSetupServerHandlers(mcpServer: McpServer) {
    this.setupServerHandlers(mcpServer)
  }
}

describe("BaseTransportServer", () => {
  let testServer: TestTransportServer
  let mockServer: any

  beforeEach(() => {
    vi.clearAllMocks()
    testServer = new TestTransportServer()
    mockServer = createMCPServer()
  })

  describe("createConfiguredServer", () => {
    it("should create a server with handlers configured", () => {
      expect(testServer.server).toBeDefined()
      expect(testServer.server.server.setRequestHandler).toHaveBeenCalledTimes(6)
    })
  })

  describe("setupServerHandlers", () => {
    beforeEach(() => {
      testServer.testSetupServerHandlers(mockServer)
    })

    it("should set up all required request handlers", () => {
      expect(mockServer.server.setRequestHandler).toHaveBeenCalledTimes(6)
    })

    describe("List Tools Handler", () => {
      it("should return tools list successfully", async () => {
        const mockTools = [
          { name: "tool1", description: "First tool", inputSchema: {} },
          { name: "tool2", description: "Second tool", inputSchema: {} },
        ]
        ;(toolRegistry.getToolsList as Mock).mockReturnValue(mockTools)

        const handler = mockServer.server.getHandler("tools/list")
        const result = await handler()
        expect(result).toEqual({ tools: mockTools })
      })

      it("should handle errors in tools list", async () => {
        ;(toolRegistry.getToolsList as Mock).mockImplementation(() => {
          throw new Error("Tools list error")
        })

        const handler = mockServer.server.getHandler("tools/list")
        await expect(handler()).rejects.toThrow(ToolError)
      })
    })

    describe("List Prompts Handler", () => {
      it("should return prompts list successfully", async () => {
        const mockPrompts = [
          { name: "prompt1", description: "First prompt", arguments: [] },
          { name: "prompt2", description: "Second prompt", arguments: [] },
        ]
        ;(promptRegistry.getPromptsList as Mock).mockReturnValue(mockPrompts)

        const handler = mockServer.server.getHandler("prompts/list")
        const result = await handler()
        expect(result).toEqual({ prompts: mockPrompts })
      })

      it("should handle errors in prompts list", async () => {
        ;(promptRegistry.getPromptsList as Mock).mockImplementation(() => {
          throw new Error("Prompts list error")
        })

        const handler = mockServer.server.getHandler("prompts/list")
        await expect(handler()).rejects.toThrow(PromptError)
      })
    })

    describe("Get Prompt Handler", () => {
      it("should execute prompt successfully", async () => {
        const mockResult = {
          messages: [
            {
              role: "user" as const,
              content: { type: "text" as const, text: "Hello" },
            },
          ],
          tools: [],
        }
        ;(promptRegistry.executePrompt as Mock).mockResolvedValue(mockResult)

        const handler = mockServer.server.getHandler("prompts/get")
        const request = {
          params: { name: "test-prompt", arguments: { input: "test" } },
        }

        const result = await handler(request)
        expect(result).toEqual({
          messages: mockResult.messages,
          tools: mockResult.tools,
        })
        expect(promptRegistry.executePrompt).toHaveBeenCalledWith("test-prompt", { input: "test" })
      })

      it("should handle missing prompt name", async () => {
        const handler = mockServer.server.getHandler("prompts/get")
        const request = { params: {} }

        await expect(handler(request)).rejects.toThrow(PromptError)
      })

      it("should handle prompt execution errors", async () => {
        ;(promptRegistry.executePrompt as Mock).mockRejectedValue(new Error("Execution failed"))

        const handler = mockServer.server.getHandler("prompts/get")
        const request = { params: { name: "test-prompt" } }

        await expect(handler(request)).rejects.toThrow(PromptError)
      })

      it("should preserve MCP errors", async () => {
        const mcpError = new PromptError(ErrorCode.PROMPT_NOT_FOUND, "Prompt not found")
        ;(promptRegistry.executePrompt as Mock).mockRejectedValue(mcpError)

        const handler = mockServer.server.getHandler("prompts/get")
        const request = { params: { name: "test-prompt" } }

        await expect(handler(request)).rejects.toBe(mcpError)
      })
    })

    describe("Call Tool Handler", () => {
      it("should execute tool successfully", async () => {
        const mockResult = {
          content: [{ type: "text" as const, text: "Success" }],
          isError: false,
        }
        ;(toolRegistry.executeTool as Mock).mockResolvedValue(mockResult)

        const handler = mockServer.server.getHandler("tools/call")
        const request = {
          params: { name: "test-tool", arguments: { input: "test" } },
        }

        const result = await handler(request)
        expect(result).toEqual({
          content: mockResult.content,
          isError: mockResult.isError,
        })
        expect(toolRegistry.executeTool).toHaveBeenCalledWith("test-tool", { input: "test" })
      })

      it("should handle missing tool name", async () => {
        const handler = mockServer.server.getHandler("tools/call")
        const request = { params: {} }
        const result = await handler(request)
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain("Tool name is required")
      })

      it("should handle tool execution errors", async () => {
        ;(toolRegistry.executeTool as Mock).mockRejectedValue(new Error("Tool execution failed"))

        const handler = mockServer.server.getHandler("tools/call")
        const request = { params: { name: "test-tool" } }
        const result = await handler(request)
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toContain("Tool execution failed")
      })

      it("should handle error responses with isError flag", async () => {
        const errorResponse = {
          content: [{ type: "text" as const, text: "Formatted error" }],
          isError: true,
        }
        ;(toolRegistry.executeTool as Mock).mockRejectedValue(errorResponse)

        const handler = mockServer.server.getHandler("tools/call")
        const request = { params: { name: "test-tool" } }
        const result = await handler(request)
        expect(result).toBe(errorResponse)
      })

      it("should handle MCP errors", async () => {
        const mcpError = new ToolError(ErrorCode.TOOL_NOT_FOUND, "Tool not found")
        ;(toolRegistry.executeTool as Mock).mockRejectedValue(mcpError)

        const handler = mockServer.server.getHandler("tools/call")
        const request = { params: { name: "test-tool" } }
        const result = await handler(request)
        expect(result.isError).toBe(true)
        expect(result.content[0].text).toBe("Tool not found")
      })
    })

    describe("List Resources Handler", () => {
      it("should return resources list successfully", async () => {
        const mockResources = [
          { name: "resource1", description: "First resource" },
          { name: "resource2", description: "Second resource" },
        ]
        ;(resourceRegistry.getResourcesList as Mock).mockReturnValue(mockResources)

        const handler = mockServer.server.getHandler("resources/list")
        const result = await handler()
        expect(result).toEqual({ resources: mockResources })
      })

      it("should handle errors in resources list", async () => {
        ;(resourceRegistry.getResourcesList as Mock).mockImplementation(() => {
          throw new Error("Resources list error")
        })

        const handler = mockServer.server.getHandler("resources/list")
        await expect(handler()).rejects.toThrow(ResourceError)
      })
    })

    describe("Read Resource Handler", () => {
      it("should read resource successfully", async () => {
        const mockContent = { contents: "resource content" }
        ;(resourceRegistry.readResource as Mock).mockResolvedValue(mockContent)

        const handler = mockServer.server.getHandler("resources/read")
        const request = { params: { uri: "test://resource" } }

        const result = await handler(request)
        expect(result).toEqual({ contents: mockContent.contents })
        expect(resourceRegistry.readResource).toHaveBeenCalledWith("test://resource")
      })

      it("should handle missing resource URI", async () => {
        const handler = mockServer.server.getHandler("resources/read")
        const request = { params: {} }

        await expect(handler(request)).rejects.toThrow(ResourceError)
      })

      it("should handle resource read errors", async () => {
        ;(resourceRegistry.readResource as Mock).mockRejectedValue(new Error("Read failed"))

        const handler = mockServer.server.getHandler("resources/read")
        const request = { params: { uri: "test://resource" } }

        await expect(handler(request)).rejects.toThrow(ResourceError)
      })

      it("should preserve MCP errors", async () => {
        const mcpError = new ResourceError(ErrorCode.RESOURCE_NOT_FOUND, "Resource not found")
        ;(resourceRegistry.readResource as Mock).mockRejectedValue(mcpError)

        const handler = mockServer.server.getHandler("resources/read")
        const request = { params: { uri: "test://resource" } }

        await expect(handler(request)).rejects.toBe(mcpError)
      })
    })
  })

  describe("abstract methods", () => {
    it("should implement start method", async () => {
      expect(testServer.isStarted).toBe(false)
      await testServer.start()
      expect(testServer.isStarted).toBe(true)
    })

    it("should implement stop method", async () => {
      await testServer.start()
      expect(testServer.isStarted).toBe(true)
      await testServer.stop()
      expect(testServer.isStarted).toBe(false)
    })
  })
})
