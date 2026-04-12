import { describe, it, expect } from "vitest"
import { z } from "zod"

/**
 * Regression tests for issue #10: PICNIC_COUNTRY_CODE environment variable not being used
 *
 * Issue: The country code was hardcoded to "NL" in the codebase, causing authentication
 * failures for users from other countries (e.g., Germany with "DE").
 *
 * Fix: Added PICNIC_COUNTRY_CODE to config schema and updated all initializePicnicClient
 * calls to use the config value.
 */
describe("Config Schema - PICNIC_COUNTRY_CODE (Issue #10 regression)", () => {
  // Create a standalone config schema for testing (matches the actual implementation)
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
    HTTP_AUTH_TOKEN: z.string().optional(),
  })

  describe("PICNIC_COUNTRY_CODE validation", () => {
    it("should default to NL when PICNIC_COUNTRY_CODE is not set", () => {
      const result = configSchema.parse({
        PICNIC_USERNAME: "test-user",
        PICNIC_PASSWORD: "test-pass",
        // PICNIC_COUNTRY_CODE not provided
      })

      expect(result.PICNIC_COUNTRY_CODE).toBe("NL")
    })

    it("should accept NL as PICNIC_COUNTRY_CODE", () => {
      const result = configSchema.parse({
        PICNIC_USERNAME: "test-user",
        PICNIC_PASSWORD: "test-pass",
        PICNIC_COUNTRY_CODE: "NL",
      })

      expect(result.PICNIC_COUNTRY_CODE).toBe("NL")
    })

    it("should accept DE as PICNIC_COUNTRY_CODE", () => {
      const result = configSchema.parse({
        PICNIC_USERNAME: "test-user",
        PICNIC_PASSWORD: "test-pass",
        PICNIC_COUNTRY_CODE: "DE",
      })

      expect(result.PICNIC_COUNTRY_CODE).toBe("DE")
    })

    it("should reject invalid country codes", () => {
      expect(() => {
        configSchema.parse({
          PICNIC_USERNAME: "test-user",
          PICNIC_PASSWORD: "test-pass",
          PICNIC_COUNTRY_CODE: "FR", // Invalid country code
        })
      }).toThrow()
    })

    it("should reject empty string as PICNIC_COUNTRY_CODE", () => {
      expect(() => {
        configSchema.parse({
          PICNIC_USERNAME: "test-user",
          PICNIC_PASSWORD: "test-pass",
          PICNIC_COUNTRY_CODE: "",
        })
      }).toThrow()
    })

    it("should reject numeric values as PICNIC_COUNTRY_CODE", () => {
      expect(() => {
        configSchema.parse({
          PICNIC_USERNAME: "test-user",
          PICNIC_PASSWORD: "test-pass",
          PICNIC_COUNTRY_CODE: 123,
        })
      }).toThrow()
    })

    it("should reject null as PICNIC_COUNTRY_CODE", () => {
      expect(() => {
        configSchema.parse({
          PICNIC_USERNAME: "test-user",
          PICNIC_PASSWORD: "test-pass",
          PICNIC_COUNTRY_CODE: null,
        })
      }).toThrow()
    })

    it("should handle lowercase country codes by rejecting them", () => {
      // Country codes should be uppercase only
      expect(() => {
        configSchema.parse({
          PICNIC_USERNAME: "test-user",
          PICNIC_PASSWORD: "test-pass",
          PICNIC_COUNTRY_CODE: "nl",
        })
      }).toThrow()
    })
  })

  describe("Integration with actual config", () => {
    it("should have PICNIC_COUNTRY_CODE in the actual config object", async () => {
      // Import the actual config to verify it has the field
      const { config } = await import("../../src/config.js")

      // Verify that the config object has the PICNIC_COUNTRY_CODE property
      expect(config).toHaveProperty("PICNIC_COUNTRY_CODE")

      // Verify it's one of the valid values
      expect(["NL", "DE"]).toContain(config.PICNIC_COUNTRY_CODE)
    })
  })

  describe("Backward compatibility", () => {
    it("should maintain backward compatibility with NL default", () => {
      // When PICNIC_COUNTRY_CODE is not provided, it should default to NL
      // This ensures existing users without the env var continue to work
      const result = configSchema.parse({
        PICNIC_USERNAME: "test-user",
        PICNIC_PASSWORD: "test-pass",
      })

      expect(result.PICNIC_COUNTRY_CODE).toBe("NL")
    })
  })

  describe("Required fields validation", () => {
    it("should require PICNIC_USERNAME", () => {
      expect(() => {
        configSchema.parse({
          PICNIC_PASSWORD: "test-pass",
          PICNIC_COUNTRY_CODE: "NL",
        })
      }).toThrow()
    })

    it("should require PICNIC_PASSWORD", () => {
      expect(() => {
        configSchema.parse({
          PICNIC_USERNAME: "test-user",
          PICNIC_COUNTRY_CODE: "NL",
        })
      }).toThrow()
    })

    it("should not require PICNIC_COUNTRY_CODE due to default", () => {
      // Should not throw - PICNIC_COUNTRY_CODE has a default value
      expect(() => {
        configSchema.parse({
          PICNIC_USERNAME: "test-user",
          PICNIC_PASSWORD: "test-pass",
        })
      }).not.toThrow()
    })

    it("should not require HTTP_AUTH_TOKEN", () => {
      expect(() => {
        configSchema.parse({
          PICNIC_USERNAME: "test-user",
          PICNIC_PASSWORD: "test-pass",
        })
      }).not.toThrow()
    })
  })
})
