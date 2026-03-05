import PicnicClient from "picnic-api"
import fs from "fs/promises"
import { config } from "../config.js"

// Singleton instance for caching
let picnicClientInstance: InstanceType<typeof PicnicClient> | null = null

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
  const authKey = (picnicClientInstance as any).authKey
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
      await client.getShoppingCart()
      picnicClientInstance = client
      console.error("Successfully reused saved session.")
      return
    } catch (error) {
      console.error("Saved session invalid, performing fresh login...")
      client.authKey = null // Clear invalid key before login
    }
  }

  await client.login(loginUsername, loginPassword)
  picnicClientInstance = client
  await saveSession()
  console.error("Picnic client initialized successfully.")
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
