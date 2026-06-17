import { describe, it, expect, beforeEach, vi } from "vitest"

// Mock the picnic client wrapper so no real API calls are made
const mockGenerate2FACode = vi.fn()
const mockVerifyPicnic2FACode = vi.fn()
const mockSaveSession = vi.fn()

vi.mock("../../../src/utils/picnic-client.js", () => ({
  getPicnicClient: () => ({
    auth: {
      generate2FACode: mockGenerate2FACode,
    },
  }),
  initializePicnicClient: vi.fn(),
  saveSession: () => mockSaveSession(),
  verifyPicnic2FACode: (code: string) => mockVerifyPicnic2FACode(code),
}))

async function getRegistry() {
  // Importing the tools module registers the tools in the shared registry
  const { toolRegistry } = await import("../../../src/tools/registry.js")
  await import("../../../src/tools/picnic-tools.js")
  return toolRegistry
}

describe("picnic 2FA tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("picnic_generate_2fa_code", () => {
    it("should send a 2FA code over the requested channel", async () => {
      mockGenerate2FACode.mockResolvedValue(null)

      const registry = await getRegistry()
      const result = await registry.executeTool("picnic_generate_2fa_code", { channel: "SMS" })

      expect(mockGenerate2FACode).toHaveBeenCalledWith("SMS")
      expect(result.content[0].text).toContain("2FA code generated and sent")
    })

    it("should default the channel to SMS", async () => {
      mockGenerate2FACode.mockResolvedValue(null)

      const registry = await getRegistry()
      await registry.executeTool("picnic_generate_2fa_code", {})

      expect(mockGenerate2FACode).toHaveBeenCalledWith("SMS")
    })

    it("should treat an empty JSON response body as success", async () => {
      mockGenerate2FACode.mockRejectedValue(new SyntaxError("Unexpected end of JSON input"))

      const registry = await getRegistry()
      const result = await registry.executeTool("picnic_generate_2fa_code", {})

      expect(result.content[0].text).toContain("2FA code generated and sent")
    })
  })

  describe("picnic_verify_2fa_code", () => {
    it("should verify the code and persist the refreshed session", async () => {
      mockVerifyPicnic2FACode.mockResolvedValue({ authKey: "refreshed-auth-key" })

      const registry = await getRegistry()
      const result = await registry.executeTool("picnic_verify_2fa_code", { code: "123456" })

      expect(mockVerifyPicnic2FACode).toHaveBeenCalledWith("123456")
      expect(mockSaveSession).toHaveBeenCalled()
      expect(result.content[0].text).toContain("2FA code verified")
    })

    it("should propagate verification failures without saving the session", async () => {
      mockVerifyPicnic2FACode.mockRejectedValue(new Error("2FA verification failed: invalid code"))

      const registry = await getRegistry()
      await expect(registry.executeTool("picnic_verify_2fa_code", { code: "000000" })).rejects.toThrow(
        "2FA verification failed",
      )
      expect(mockSaveSession).not.toHaveBeenCalled()
    })
  })
})
