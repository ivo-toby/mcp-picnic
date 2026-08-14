import { z } from "zod"
import { zodToJsonSchema } from "zod-to-json-schema"
import { ToolError, ErrorCode, ErrorUtils } from "../types/errors.js"

/**
 * MCP tool annotations. Hints for the calling model about a tool's side effects —
 * most importantly whether it is safe to retry after an ambiguous failure.
 */
export interface ToolAnnotations {
  title?: string
  readOnlyHint?: boolean
  destructiveHint?: boolean
  idempotentHint?: boolean
  openWorldHint?: boolean
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string
  description: string
  inputSchema: z.ZodSchema<TInput>
  outputSchema?: z.ZodSchema<TOutput>
  handler: (args: TInput) => Promise<TOutput>
  prompts?: string[]
  annotations?: ToolAnnotations
}

export interface ToolResult {
  content: Array<{
    type: "text" | "image" | "resource"
    text?: string
    data?: string
    mimeType?: string
  }>
  isError?: boolean
}

// Type-erased version for storage
interface StoredToolDefinition {
  name: string
  description: string
  inputSchema: z.ZodSchema<unknown>
  outputSchema?: z.ZodSchema<unknown>
  handler: (args: unknown) => Promise<unknown>
  prompts?: string[]
  annotations?: ToolAnnotations
}

class ToolRegistry {
  private tools = new Map<string, StoredToolDefinition>()

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>) {
    this.tools.set(tool.name, tool as StoredToolDefinition)
  }

  getToolDefinitions() {
    const definitions: Record<string, unknown> = {}
    for (const [name, tool] of this.tools) {
      definitions[name.toUpperCase()] = {
        name: tool.name,
        description: tool.description,
        inputSchema: zodToJsonSchema(tool.inputSchema),
        ...(tool.annotations && { annotations: tool.annotations }),
      }
    }
    return definitions
  }

  getToolsList() {
    return Array.from(this.tools.values()).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.inputSchema),
      ...(tool.annotations && { annotations: tool.annotations }),
    }))
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<ToolResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      throw new ToolError(ErrorCode.TOOL_NOT_FOUND, `Tool '${name}' not found`, {
        toolName: name,
        availableTools: Array.from(this.tools.keys()),
      })
    }

    try {
      // Validate input with Zod schema
      let validatedArgs: unknown
      try {
        validatedArgs = tool.inputSchema.parse(args)
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new ToolError(
            ErrorCode.TOOL_VALIDATION_FAILED,
            `Invalid input for tool '${name}': ${error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`,
            {
              toolName: name,
              validationErrors: error.errors,
              providedArgs: args,
            },
          )
        }
        throw error
      }

      // Execute the handler with error wrapping
      let result: unknown
      try {
        result = await tool.handler(validatedArgs)
      } catch (error) {
        // Re-throw MCP errors as-is
        if (ErrorUtils.isMCPError(error)) {
          throw error
        }

        ErrorUtils.logError(error, `Tool ${name}`)
        throw new ToolError(
          ErrorCode.TOOL_EXECUTION_FAILED,
          `Tool '${name}' execution failed: ${ErrorUtils.getErrorMessage(error)}`,
          {
            toolName: name,
            originalError: ErrorUtils.getErrorMessage(error),
            args: validatedArgs,
          },
        )
      }

      // Validate output if schema is provided
      if (tool.outputSchema) {
        try {
          tool.outputSchema.parse(result)
        } catch (error) {
          if (error instanceof z.ZodError) {
            ErrorUtils.logError(error, `Tool ${name} output validation`)
            throw new ToolError(
              ErrorCode.TOOL_EXECUTION_FAILED,
              `Tool '${name}' returned invalid output: ${error.errors.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ")}`,
              {
                toolName: name,
                validationErrors: error.errors,
                actualOutput: result,
              },
            )
          }
          throw error
        }
      }

      // Format result for MCP
      if (typeof result === "string") {
        return {
          content: [{ type: "text", text: result }],
        }
      }

      if (typeof result === "object" && result !== null) {
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        }
      }

      return {
        content: [{ type: "text", text: String(result) }],
      }
    } catch (error) {
      // Re-throw MCP errors as-is
      if (ErrorUtils.isMCPError(error)) {
        throw error
      }

      // Wrap unexpected errors
      throw new ToolError(
        ErrorCode.TOOL_EXECUTION_FAILED,
        `Unexpected error in tool '${name}': ${ErrorUtils.getErrorMessage(error)}`,
        {
          toolName: name,
          originalError: ErrorUtils.getErrorMessage(error),
        },
      )
    }
  }
}

export const toolRegistry = new ToolRegistry()
