import PicnicClient from "picnic-api"
import fs from "fs/promises"
import { config } from "../config.js"

// Singleton instance for caching
let picnicClientInstance: InstanceType<typeof PicnicClient> | null = null

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
  } catch (error) {
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

export async function initializePicnicClient(
  username?: string,
  password?: string,
  countryCode?: "NL" | "DE",
  apiVersion: string = "15",
): Promise<void> {
  if (picnicClientInstance) {
    return
  }

  console.error("Initializing Picnic client...")
  const loginUsername = username || config.PICNIC_USERNAME
  const loginPassword = password || config.PICNIC_PASSWORD
  const loginCountryCode = countryCode || config.PICNIC_COUNTRY_CODE

  const savedAuthKey = await loadSession()

  const client = new PicnicClient({
    countryCode: loginCountryCode,
    apiVersion,
    authKey: savedAuthKey ?? undefined,
  })

  if (savedAuthKey) {
    try {
      console.error("Testing saved auth key...")
      await client.cart.getCart()
      picnicClientInstance = client
      console.error("Successfully reused saved session.")
      return
    } catch (error) {
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
