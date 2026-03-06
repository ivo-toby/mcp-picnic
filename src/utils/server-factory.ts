import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { toolRegistry } from "../tools/index.js"
import { promptRegistry } from "../prompts/index.js"
import { resourceRegistry } from "../resources/index.js"
import packageJson from "../../package.json"

export interface ServerConfig {
  name?: string
  version?: string
  capabilities?: {
    tools?: Record<string, unknown>
    prompts?: Record<string, unknown>
    resources?: Record<string, unknown>
  }
}

export function createMCPServer(config: ServerConfig = {}): McpServer {
  const defaultConfig = {
    name: packageJson.name,
    version: packageJson.version,
    capabilities: {
      tools: toolRegistry.getToolDefinitions(),
      prompts: promptRegistry.getPromptDefinitions(),
      resources: resourceRegistry.getResourceDefinitions(),
    },
  }

  const finalConfig = {
    name: config.name || defaultConfig.name,
    version: config.version || defaultConfig.version,
    capabilities: {
      ...defaultConfig.capabilities,
      ...config.capabilities,
    },
  }

  return new McpServer(
    {
      name: finalConfig.name,
      version: finalConfig.version,
    },
    {
      capabilities: finalConfig.capabilities,
    },
  )
}
