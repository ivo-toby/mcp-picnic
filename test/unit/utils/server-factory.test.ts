import { describe, it, expect, vi, beforeEach } from "vitest"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { createMCPServer } from "../../../src/utils/server-factory"
import { toolRegistry } from "../../../src/tools/registry"
import { promptRegistry } from "../../../src/prompts/registry"
import { resourceRegistry } from "../../../src/resources/registry"
import packageJson from "../../../package.json"

// Mock the SDK McpServer
vi.mock("@modelcontextprotocol/sdk/server/mcp.js", () => {
  return {
    McpServer: vi.fn().mockImplementation((info, init) => {
      return {
        info,
        init,
      }
    }),
  }
})

// Mock the registries
vi.mock("../../../src/tools/registry")
vi.mock("../../../src/prompts/registry")
vi.mock("../../../src/resources/registry")

describe("createMCPServer", () => {
  const mockToolDefinitions = { MOCK_TOOL: {} }
  const mockPromptDefinitions = { MOCK_PROMPT: {} }
  const mockResourceDefinitions = { MOCK_RESOURCE: {} }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(toolRegistry.getToolDefinitions).mockReturnValue(mockToolDefinitions)
    vi.mocked(promptRegistry.getPromptDefinitions).mockReturnValue(mockPromptDefinitions)
    vi.mocked(resourceRegistry.getResourceDefinitions).mockReturnValue(mockResourceDefinitions)
  })

  it("should create a server with default configuration", () => {
    const server = createMCPServer()

    expect(McpServer).toHaveBeenCalledTimes(1)
    // @ts-expect-error - private property access
    expect(server.info).toEqual({
      name: packageJson.name,
      version: packageJson.version,
    })
    // @ts-expect-error - private property access
    expect(server.init.capabilities).toEqual({
      tools: mockToolDefinitions,
      prompts: mockPromptDefinitions,
      resources: mockResourceDefinitions,
    })
  })

  it("should create a server with custom configuration", () => {
    const customConfig = {
      name: "CustomServer",
      version: "2.0.0",
      capabilities: {
        tools: { CUSTOM_TOOL: {} },
      },
    }
    const server = createMCPServer(customConfig)

    expect(McpServer).toHaveBeenCalledTimes(1)
    // @ts-expect-error - private property access
    expect(server.info).toEqual({
      name: "CustomServer",
      version: "2.0.0",
    })
    // @ts-expect-error - private property access
    expect(server.init.capabilities).toEqual({
      tools: { CUSTOM_TOOL: {} },
      prompts: mockPromptDefinitions,
      resources: mockResourceDefinitions,
    })
  })

  it("should merge custom capabilities with default capabilities", () => {
    const customConfig = {
      capabilities: {
        prompts: { CUSTOM_PROMPT: {} },
        extra: "capability",
      },
    }
    const server = createMCPServer(customConfig)

    // @ts-expect-error - private property access
    expect(server.init.capabilities).toEqual({
      tools: mockToolDefinitions,
      prompts: { CUSTOM_PROMPT: {} },
      resources: mockResourceDefinitions,
      extra: "capability",
    })
  })
})
