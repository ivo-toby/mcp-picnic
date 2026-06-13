import { describe, it, expect, beforeEach, vi } from "vitest"
import fs from "fs/promises"

// Mock fs/promises
vi.mock("fs/promises", () => ({
  default: {
    readFile: vi.fn(),
    writeFile: vi.fn(),
    unlink: vi.fn(),
  },
}))

// Mock picnic-api (v4 domain-based structure)
const mockLogin = vi.fn()
const mockGetCart = vi.fn()
vi.mock("picnic-api", () => {
  return {
    default: vi.fn().mockImplementation((opts: any) => ({
      auth: { login: mockLogin },
      cart: { getCart: mockGetCart },
      authKey: opts?.authKey ?? "fresh-auth-key",
    })),
  }
})

// Mock config
vi.mock("../../../src/config.js", () => ({
  config: {
    PICNIC_USERNAME: "test-user",
    PICNIC_PASSWORD: "test-pass",
    PICNIC_COUNTRY_CODE: "NL",
    PICNIC_SESSION_FILE: "picnic-session.json",
  },
}))

describe("picnic-client session persistence", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Reset the module to clear the singleton between tests
    vi.resetModules()
  })

  async function importClient() {
    // Re-import to get a fresh singleton state
    return await import("../../../src/utils/picnic-client.js")
  }

  describe("initializePicnicClient", () => {
    it("should load and reuse a valid saved session", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ authKey: "saved-key" }))
      mockGetCart.mockResolvedValue({ user: "info" })

      const { initializePicnicClient } = await importClient()
      await initializePicnicClient()

      expect(fs.readFile).toHaveBeenCalledWith("picnic-session.json", "utf-8")
      expect(mockGetCart).toHaveBeenCalled()
      expect(mockLogin).not.toHaveBeenCalled()
    })

    it("should fall back to login when saved session is invalid", async () => {
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify({ authKey: "expired-key" }))
      mockGetCart.mockRejectedValue(new Error("Unauthorized"))
      mockLogin.mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)

      const { initializePicnicClient } = await importClient()
      await initializePicnicClient()

      expect(mockGetCart).toHaveBeenCalled()
      expect(mockLogin).toHaveBeenCalledWith("test-user", "test-pass")
    })

    it("should login fresh when no session file exists", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"))
      mockLogin.mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)

      const { initializePicnicClient } = await importClient()
      await initializePicnicClient()

      expect(mockLogin).toHaveBeenCalledWith("test-user", "test-pass")
      expect(mockGetCart).not.toHaveBeenCalled()
    })

    it("should save session after fresh login", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"))
      mockLogin.mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)

      const { initializePicnicClient } = await importClient()
      await initializePicnicClient()

      expect(fs.writeFile).toHaveBeenCalledWith(
        "picnic-session.json",
        expect.stringContaining("authKey"),
      )
    })

    it("should keep running when login throws a 2FA/MFA challenge error", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"))
      mockLogin.mockRejectedValue(new Error("MFA is required for this account"))

      const { initializePicnicClient, getPicnicClient } = await importClient()

      await expect(initializePicnicClient()).resolves.toBeUndefined()
      expect(() => getPicnicClient()).not.toThrow()
      expect(fs.writeFile).not.toHaveBeenCalled()
    })

    it("should keep running when login throws a TOTP wording variant", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"))
      mockLogin.mockRejectedValue(new Error("TOTP verification required"))

      const { initializePicnicClient, getPicnicClient } = await importClient()

      await expect(initializePicnicClient()).resolves.toBeUndefined()
      expect(() => getPicnicClient()).not.toThrow()
      expect(fs.writeFile).not.toHaveBeenCalled()
    })

    it("should keep running when login throws a structured 2FA error", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"))
      mockLogin.mockRejectedValue({ second_factor_authentication_required: true })

      const { initializePicnicClient, getPicnicClient } = await importClient()

      await expect(initializePicnicClient()).resolves.toBeUndefined()
      expect(() => getPicnicClient()).not.toThrow()
      expect(fs.writeFile).not.toHaveBeenCalled()
    })

    it("should not re-initialize if already initialized", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"))
      mockLogin.mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)

      const { initializePicnicClient } = await importClient()
      await initializePicnicClient()
      await initializePicnicClient()

      expect(mockLogin).toHaveBeenCalledTimes(1)
    })
  })

  describe("saveSession", () => {
    it("should not write if client is not initialized", async () => {
      const { saveSession } = await importClient()
      await saveSession()

      expect(fs.writeFile).not.toHaveBeenCalled()
    })
  })

  describe("getPicnicClient", () => {
    it("should throw if client is not initialized", async () => {
      const { getPicnicClient } = await importClient()

      expect(() => getPicnicClient()).toThrow("Picnic client has not been initialized")
    })

    it("should return the client after initialization", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"))
      mockLogin.mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)

      const { initializePicnicClient, getPicnicClient } = await importClient()
      await initializePicnicClient()

      const client = getPicnicClient()
      expect(client).toBeDefined()
      expect(client.auth.login).toBeDefined()
    })
  })

  describe("resetPicnicClient", () => {
    it("should clear the singleton and delete session file", async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error("ENOENT"))
      mockLogin.mockResolvedValue(undefined)
      vi.mocked(fs.writeFile).mockResolvedValue(undefined)
      vi.mocked(fs.unlink).mockResolvedValue(undefined)

      const { initializePicnicClient, getPicnicClient, resetPicnicClient } = await importClient()
      await initializePicnicClient()

      expect(() => getPicnicClient()).not.toThrow()

      await resetPicnicClient()

      expect(fs.unlink).toHaveBeenCalledWith("picnic-session.json")
      expect(() => getPicnicClient()).toThrow()
    })

    it("should not throw if session file does not exist", async () => {
      vi.mocked(fs.unlink).mockRejectedValue(new Error("ENOENT"))

      const { resetPicnicClient } = await importClient()
      await expect(resetPicnicClient()).resolves.not.toThrow()
    })
  })
})
