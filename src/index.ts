#!/usr/bin/env node

import { StdioServer } from "./transports/stdio.js"
import { StreamableHttpServer } from "./transports/streamable-http.js"
import { config } from "./config.js"
import { initializePicnicClient } from "./utils/picnic-client.js"

// Create and start the appropriate server
async function runServer() {
  try {
    await initializePicnicClient()
  } catch (error) {
    console.error(
      "Picnic client pre-initialization failed. Server will continue running; authentication can be completed via tools.",
      error,
    )
  }

  if (config.ENABLE_HTTP_SERVER) {
    // Start HTTP server
    const server = new StreamableHttpServer({
      port: config.HTTP_PORT,
      host: config.HTTP_HOST,
      authToken: config.HTTP_AUTH_TOKEN,
    })

    // Handle graceful shutdown for HTTP server
    const shutdown = async () => {
      console.error("Shutting down HTTP server...")
      try {
        await server.stop()
        console.error("HTTP server stopped")
        process.exit(0)
      } catch (error) {
        console.error("Error stopping server:", error)
        process.exit(1)
      }
    }

    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)

    await server.start()
    console.error("MCP HTTP Server started successfully")
  } else {
    // Start stdio server
    const server = new StdioServer()
    await server.start()
  }
}

runServer().catch((error) => {
  console.error("Fatal error running server:", error)
  process.exit(1)
})
