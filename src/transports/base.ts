import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { toolRegistry } from "../tools/index.js"
import { promptRegistry } from "../prompts/index.js"
import { resourceRegistry } from "../resources/index.js"
import { createMCPServer } from "../utils/server-factory.js"
import { ErrorUtils, ToolError, PromptError, ResourceError, ErrorCode } from "../types/errors.js"
import { EventEmitter } from "events"

/**
 * Abstract base class for MCP transport servers
 * Provides common request handler setup and server configuration
 */
export abstract class BaseTransportServer extends EventEmitter {
  /**
   * Creates a server instance with all handlers configured
   */
  protected createConfiguredServer(): ReturnType<typeof createMCPServer> {
    const server = createMCPServer()
    this.setupServerHandlers(server)
    return server
  }

  /**
   * Sets up all MCP request handlers on the given server
   */
  protected setupServerHandlers(server: Server): void {
    // List tools handler
    server.setRequestHandler(ListToolsRequestSchema, async () => {
      try {
        return {
          tools: toolRegistry.getToolsList(),
        }
      } catch (error) {
        ErrorUtils.logError(error, "List Tools")
        throw new ToolError(ErrorCode.INTERNAL_ERROR, "Failed to list tools", {
          originalError: ErrorUtils.getErrorMessage(error),
        })
      }
    })

    // List prompts handler
    server.setRequestHandler(ListPromptsRequestSchema, async () => {
      try {
        return {
          prompts: promptRegistry.getPromptsList(),
        }
      } catch (error) {
        ErrorUtils.logError(error, "List Prompts")
        throw new PromptError(ErrorCode.INTERNAL_ERROR, "Failed to list prompts", {
          originalError: ErrorUtils.getErrorMessage(error),
        })
      }
    })

    // Get prompt handler
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server.setRequestHandler(GetPromptRequestSchema as any, async (request: any) => {
      try {
        const { name, arguments: args } = request.params

        if (!name || typeof name !== "string") {
          throw new PromptError(
            ErrorCode.PROMPT_VALIDATION_FAILED,
            "Prompt name is required and must be a string",
            { providedName: name },
          )
        }

        const result = await ErrorUtils.withTimeout(
          promptRegistry.executePrompt(name, args),
          30000, // 30 second timeout for prompt execution
          `Prompt '${name}' execution timed out`,
        )

        return {
          messages: result.messages,
          tools: result.tools || [],
        }
      } catch (error) {
        ErrorUtils.logError(error, "Get Prompt")

        if (ErrorUtils.isMCPError(error)) {
          throw error
        }

        throw new PromptError(
          ErrorCode.PROMPT_EXECUTION_FAILED,
          `Failed to execute prompt: ${ErrorUtils.getErrorMessage(error)}`,
          {
            promptName: request.params.name,
            originalError: ErrorUtils.getErrorMessage(error),
          },
        )
      }
    })

    // Call tool handler
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server.setRequestHandler(CallToolRequestSchema as any, async (request: any) => {
      try {
        const { name, arguments: args } = request.params

        if (!name || typeof name !== "string") {
          throw new ToolError(
            ErrorCode.TOOL_VALIDATION_FAILED,
            "Tool name is required and must be a string",
            { providedName: name },
          )
        }

        const result = await ErrorUtils.withTimeout(
          toolRegistry.executeTool(name, args || {}),
          60000, // 60 second timeout for tool execution
          `Tool '${name}' execution timed out`,
        )

        return {
          content: result.content,
          isError: result.isError,
        }
      } catch (error) {
        ErrorUtils.logError(error, "Call Tool")

        // If it's already a properly formatted tool result with isError, return it
        if (error && typeof error === "object" && "content" in error && "isError" in error) {
          return error as any
        }

        // Convert to proper error response
        const errorMessage = ErrorUtils.isMCPError(error)
          ? error.message
          : `Tool execution failed: ${ErrorUtils.getErrorMessage(error)}`

        return {
          content: [
            {
              type: "text" as const,
              text: errorMessage,
            },
          ],
          isError: true,
        }
      }
    })

    // List resources handler
    server.setRequestHandler(ListResourcesRequestSchema, async () => {
      try {
        return {
          resources: resourceRegistry.getResourcesList(),
        }
      } catch (error) {
        ErrorUtils.logError(error, "List Resources")
        throw new ResourceError(ErrorCode.INTERNAL_ERROR, "Failed to list resources", {
          originalError: ErrorUtils.getErrorMessage(error),
        })
      }
    })

    // Read resource handler
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    server.setRequestHandler(ReadResourceRequestSchema as any, async (request: any) => {
      try {
        const { uri } = request.params

        if (!uri || typeof uri !== "string") {
          throw new ResourceError(
            ErrorCode.RESOURCE_NOT_FOUND,
            "Resource URI is required and must be a string",
            { providedUri: uri },
          )
        }

        const result = await ErrorUtils.withTimeout(
          resourceRegistry.readResource(uri),
          30000, // 30 second timeout for resource reading
          `Resource '${uri}' read timed out`,
        )

        return {
          contents: result.contents,
        }
      } catch (error) {
        ErrorUtils.logError(error, "Read Resource")

        if (ErrorUtils.isMCPError(error)) {
          throw error
        }

        throw new ResourceError(
          ErrorCode.RESOURCE_UNAVAILABLE,
          `Failed to read resource: ${ErrorUtils.getErrorMessage(error)}`,
          {
            resourceUri: request.params.uri,
            originalError: ErrorUtils.getErrorMessage(error),
          },
        )
      }
    })
  }

  /**
   * Start the transport server
   */
  abstract start(): Promise<void>

  /**
   * Stop the transport server
   */
  abstract stop(): Promise<void>
}
