import { describe, it, expect, beforeEach, vi } from "vitest"
import fs from "fs/promises"

// Mock fs/promises
vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
  },
}))

// Mutable config mock so each test can vary the relevant fields. Declared via
// vi.hoisted so it is available inside the hoisted vi.mock factory below.
const mockConfig = vi.hoisted(
  () =>
    ({
      PICNIC_DEVICE_ID: undefined,
      PICNIC_DEVICE_FILE: "picnic-device.json",
    }) as { PICNIC_DEVICE_ID?: string; PICNIC_DEVICE_FILE: string },
)
vi.mock("../../../src/config.js", () => ({ config: mockConfig }))

import { resolveDeviceId } from "../../../src/utils/device-id.js"

describe("resolveDeviceId", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConfig.PICNIC_DEVICE_ID = undefined
    mockConfig.PICNIC_DEVICE_FILE = "picnic-device.json"
  })

  it("returns the explicit PICNIC_DEVICE_ID without touching the filesystem", async () => {
    mockConfig.PICNIC_DEVICE_ID = "3C417201548B2E3B"

    const id = await resolveDeviceId()

    expect(id).toBe("3C417201548B2E3B")
    expect(fs.readFile).not.toHaveBeenCalled()
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it("returns a persisted id from PICNIC_DEVICE_FILE when present", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ deviceId: "PERSISTED12345AB" }))

    const id = await resolveDeviceId()

    expect(id).toBe("PERSISTED12345AB")
    expect(fs.readFile).toHaveBeenCalledWith("picnic-device.json", "utf-8")
    expect(fs.writeFile).not.toHaveBeenCalled()
  })

  it("generates and persists a new id when no file exists", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"))
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)

    const id = await resolveDeviceId()

    // 8 random bytes -> 16 uppercase hex characters.
    expect(id).toMatch(/^[0-9A-F]{16}$/)
    expect(fs.writeFile).toHaveBeenCalledTimes(1)
    const [file, payload] = vi.mocked(fs.writeFile).mock.calls[0]
    expect(file).toBe("picnic-device.json")
    expect(JSON.parse(payload as string)).toEqual({ deviceId: id })
  })

  it("falls through to generation when the persisted file has no deviceId", async () => {
    vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ somethingElse: true }))
    vi.mocked(fs.writeFile).mockResolvedValue(undefined)

    const id = await resolveDeviceId()

    expect(id).toMatch(/^[0-9A-F]{16}$/)
    expect(fs.writeFile).toHaveBeenCalledWith(
      "picnic-device.json",
      expect.stringContaining("deviceId"),
    )
  })

  it("still returns a usable id when persistence fails", async () => {
    vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"))
    vi.mocked(fs.writeFile).mockRejectedValue(new Error("EACCES"))

    const id = await resolveDeviceId()

    expect(id).toMatch(/^[0-9A-F]{16}$/)
    expect(fs.writeFile).toHaveBeenCalled()
  })
})
