import { z } from "zod"
import path from "path"
import os from "os"
import dotenv from "dotenv"

dotenv.config()

const defaultSessionFile = path.join(os.homedir(), ".picnic-session.json")
const defaultDeviceFile = path.join(os.homedir(), ".picnic-device.json")

const configSchema = z.object({
  PICNIC_USERNAME: z.string(),
  PICNIC_PASSWORD: z.string(),
  PICNIC_COUNTRY_CODE: z.enum(["NL", "DE", "FR"]).default("NL"),
  PICNIC_API_VERSION: z.string().default("15"),
  PICNIC_DEVICE_ID: z.string().optional(),
  PICNIC_DEVICE_FILE: z.string().default(defaultDeviceFile),
  PICNIC_AGENT: z.string().optional(),
  ENABLE_HTTP_SERVER: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
  HTTP_PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default("3000"),
  HTTP_HOST: z.string().default("localhost"),
  HTTP_AUTH_TOKEN: z.string().optional(),
  HTTP_AUTH_HEADER_NAME: z.string().default("x-mcp-token"),
  HTTP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(15 * 60 * 1000),
  HTTP_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().positive().default(100),
  HTTP_RATE_LIMIT_SKIP_PATHS: z
    .string()
    .default("/health")
    .transform((value) =>
      value
        .split(",")
        .map((path) => path.trim())
        .filter(Boolean),
    )
    .refine((paths) => paths.every((path) => path.startsWith("/")), {
      message: "HTTP_RATE_LIMIT_SKIP_PATHS entries must start with '/'.",
    }),
  PICNIC_SESSION_FILE: z.string().default(defaultSessionFile),
})

export const config = configSchema.parse(process.env)
