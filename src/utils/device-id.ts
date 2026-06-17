import crypto from "crypto"
import fs from "fs/promises"
import { config } from "../config.js"

/**
 * Resolve the device id used for the x-picnic-did header.
 *
 * Precedence:
 *   1. PICNIC_DEVICE_ID, when explicitly set.
 *   2. A previously persisted id read from PICNIC_DEVICE_FILE.
 *   3. A freshly generated id, persisted to PICNIC_DEVICE_FILE for reuse.
 *
 * This gives every installation a stable, per-install device fingerprint
 * without requiring any configuration, instead of falling back to picnic-api's
 * shared default device id.
 */
export async function resolveDeviceId(): Promise<string> {
  if (config.PICNIC_DEVICE_ID) {
    return config.PICNIC_DEVICE_ID
  }

  try {
    const data = await fs.readFile(config.PICNIC_DEVICE_FILE, "utf-8")
    const { deviceId } = JSON.parse(data)
    if (deviceId) return deviceId
  } catch {
    // No persisted id yet; fall through to generation.
  }

  const deviceId = crypto.randomBytes(8).toString("hex").toUpperCase()
  try {
    await fs.writeFile(config.PICNIC_DEVICE_FILE, JSON.stringify({ deviceId }))
  } catch {
    // If persistence fails, still use the generated id for this run.
  }
  return deviceId
}
