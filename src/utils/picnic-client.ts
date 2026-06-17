import PicnicClient from "picnic-api"
import fs from "fs/promises"
import { config } from "../config.js"
import { resolveDeviceId } from "./device-id.js"

// Singleton instance for caching
let picnicClientInstance: InstanceType<typeof PicnicClient> | null = null
const DEFAULT_PICNIC_AGENT = "30100;1.15.232-15154"

type PicnicCountryCode = "NL" | "DE" | "FR"
type PicnicClientOptions = NonNullable<ConstructorParameters<typeof PicnicClient>[0]> &
  Record<string, unknown>

function buildPicnicHeaders(authKey: string | null, deviceId: string): HeadersInit {
  return {
    "User-Agent": "okhttp/3.12.2",
    "Content-Type": "application/json; charset=UTF-8",
    ...(authKey && { "x-picnic-auth": authKey }),
    "x-picnic-agent": config.PICNIC_AGENT ?? DEFAULT_PICNIC_AGENT,
    "x-picnic-did": deviceId,
  }
}

function isTwoFactorAuthenticationError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false
  }

  const maybeError = error as {
    code?: unknown
    type?: unknown
    second_factor_authentication_required?: unknown
    message?: unknown
  }

  if (maybeError.second_factor_authentication_required === true) {
    return true
  }

  if (typeof maybeError.code === "string" && /2fa|mfa|second[_ ]factor/i.test(maybeError.code)) {
    return true
  }

  if (typeof maybeError.type === "string" && /2fa|mfa|second[_ ]factor/i.test(maybeError.type)) {
    return true
  }

  if (typeof maybeError.message !== "string") {
    return false
  }

  // NOTE: picnic-api does not currently expose a stable 2FA error shape in all failure paths.
  // Keep this message fallback to tolerate known wording variants from upstream.
  const normalizedMessage = maybeError.message.toLowerCase()
  return (
    normalizedMessage.includes("2fa") ||
    normalizedMessage.includes("mfa") ||
    normalizedMessage.includes("second_factor") ||
    normalizedMessage.includes("second factor") ||
    normalizedMessage.includes("totp")
  )
}

async function loadSession(): Promise<string | null> {
  try {
    const data = await fs.readFile(config.PICNIC_SESSION_FILE, "utf-8")
    const session = JSON.parse(data)
    return session.authKey || null
  } catch {
    return null
  }
}

export async function saveSession(): Promise<void> {
  if (!picnicClientInstance) return
  const authKey = picnicClientInstance.authKey
  if (authKey) {
    await fs.writeFile(config.PICNIC_SESSION_FILE, JSON.stringify({ authKey }))
  }
}

export async function verifyPicnic2FACode(
  code: string,
  timeoutMs: number = 30000,
): Promise<{ authKey: string }> {
  const client = getPicnicClient()
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  const deviceId = await resolveDeviceId()

  try {
    const response = await fetch(`${client.url}/user/2fa/verify`, {
      method: "POST",
      headers: new Headers(buildPicnicHeaders(client.authKey, deviceId)),
      body: JSON.stringify({ otp: code }),
      signal: controller.signal,
    })

    if (!response.ok) {
      const body = await response.text()
      try {
        const errorData = JSON.parse(body)
        const message = errorData.error?.message || response.statusText
        throw new Error(`2FA verification failed: ${message}`)
      } catch (error) {
        if (error instanceof Error && !(error instanceof SyntaxError)) {
          throw error
        }
        throw new Error(`2FA verification failed: ${response.status} ${response.statusText}`)
      }
    }

    const authKey = response.headers.get("x-picnic-auth")
    if (!authKey) {
      throw new Error("2FA verification failed: No auth key received.")
    }

    client.authKey = authKey
    return { authKey }
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`2FA verification timed out after ${timeoutMs}ms`)
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export async function initializePicnicClient(
  username?: string,
  password?: string,
  countryCode?: PicnicCountryCode,
  apiVersion?: string,
): Promise<void> {
  if (picnicClientInstance) {
    return
  }

  console.error("Initializing Picnic client...")
  const loginUsername = username || config.PICNIC_USERNAME
  const loginPassword = password || config.PICNIC_PASSWORD
  const loginCountryCode = countryCode || config.PICNIC_COUNTRY_CODE

  const savedAuthKey = await loadSession()
  const deviceId = await resolveDeviceId()

  const clientOptions: PicnicClientOptions = {
    countryCode: loginCountryCode as PicnicClientOptions["countryCode"],
    apiVersion: apiVersion || config.PICNIC_API_VERSION,
    authKey: savedAuthKey ?? undefined,
    deviceId,
    agent: config.PICNIC_AGENT,
  }
  const client = new PicnicClient(clientOptions)

  if (savedAuthKey) {
    try {
      console.error("Testing saved auth key...")
      await client.cart.getCart()
      picnicClientInstance = client
      console.error("Successfully reused saved session.")
      return
    } catch {
      console.error("Saved session invalid, performing fresh login...")
      client.authKey = null // Clear invalid key before login
    }
  }

  try {
    const loginResult = await client.auth.login(loginUsername, loginPassword)
    picnicClientInstance = client

    if (loginResult?.second_factor_authentication_required) {
      console.error(
        "Picnic client logged in, but 2FA is required. Use the 2FA tools to complete authentication.",
      )
      return
    }

    await saveSession()
    console.error("Picnic client initialized successfully.")
  } catch (error) {
    if (isTwoFactorAuthenticationError(error)) {
      // Keep the partially authenticated client in memory so 2FA tools can be called.
      picnicClientInstance = client
      console.error(
        "2FA/MFA challenge detected during login. Server will stay running so you can call picnic_generate_2fa_code and picnic_verify_2fa_code.",
      )
      return
    }

    throw error
  }
}

export function getPicnicClient(): InstanceType<typeof PicnicClient> {
  if (!picnicClientInstance) {
    throw new Error("Picnic client has not been initialized. Call initializePicnicClient() first.")
  }
  return picnicClientInstance
}

export async function resetPicnicClient(): Promise<void> {
  picnicClientInstance = null
  try {
    await fs.unlink(config.PICNIC_SESSION_FILE)
  } catch {
    // Session file may not exist, ignore
  }
}
