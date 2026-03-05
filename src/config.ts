import { z } from "zod"
import dotenv from "dotenv"

dotenv.config()

const configSchema = z.object({
  PICNIC_USERNAME: z.string(),
  PICNIC_PASSWORD: z.string(),
  PICNIC_COUNTRY_CODE: z.enum(["NL", "DE"]).default("NL"),
  ENABLE_HTTP_SERVER: z
    .string()
    .transform((val) => val === "true")
    .default("false"),
  HTTP_PORT: z
    .string()
    .transform((val) => parseInt(val, 10))
    .default("3000"),
  HTTP_HOST: z.string().default("localhost"),
  PICNIC_SESSION_FILE: z.string().default("picnic-session.json"),
})

export const config = configSchema.parse(process.env)
