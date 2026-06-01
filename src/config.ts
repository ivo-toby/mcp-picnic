import { z } from "zod"
import path from "path"
import os from "os"
import dotenv from "dotenv"

dotenv.config()

const defaultSessionFile = path.join(os.homedir(), ".picnic-session.json")

const configSchema = z.object({
  PICNIC_USERNAME: z.string(),
  PICNIC_PASSWORD: z.string(),
  PICNIC_COUNTRY_CODE: z.enum(["NL", "DE", "FR"]).default("NL"),
  ENABLE_HTTP_SERVER: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
  HTTP_PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default("3000"),
  HTTP_HOST: z.string().default("localhost"),
  PICNIC_SESSION_FILE: z.string().default(defaultSessionFile),
  PICNIC_DEVICE_ID: z.string().optional(),
  PICNIC_DEVICE_FILE: z.string().default(path.join(os.homedir(), ".picnic-device.json")),
  PICNIC_AGENT: z.string().optional(),
})

export const config = configSchema.parse(process.env)
