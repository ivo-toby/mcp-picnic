import crypto from "crypto"
import fs from "fs/promises"
import { config } from "../config.js"

export async function resolveDeviceId(): Promise<string> {
  if (config.PICNIC_DEVICE_ID) {
    return config.PICNIC_DEVICE_ID
  }

  try {
    const data = await fs.readFile(config.PICNIC_DEVICE_FILE, "utf-8")
    const { deviceId } = JSON.parse(data)
    if (deviceId) return deviceId
  } catch {
    // no file yet
  }

  const deviceId = crypto.randomBytes(8).toString("hex").toUpperCase()
  try {
    await fs.writeFile(config.PICNIC_DEVICE_FILE, JSON.stringify({ deviceId }))
  } catch {
    // if we cannot persist, still use it for this run
  }
  return deviceId
}
