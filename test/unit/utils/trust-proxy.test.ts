import { describe, it, expect } from "vitest"
import { isValidTrustProxy, parseTrustProxy } from "../../../src/utils/trust-proxy.js"

describe("parseTrustProxy", () => {
  it("should leave trust proxy unset when the value is missing or blank", () => {
    expect(parseTrustProxy(undefined)).toBeUndefined()
    expect(parseTrustProxy("")).toBeUndefined()
    expect(parseTrustProxy("   ")).toBeUndefined()
  })

  it("should parse booleans case-insensitively", () => {
    expect(parseTrustProxy("true")).toBe(true)
    expect(parseTrustProxy("TRUE")).toBe(true)
    expect(parseTrustProxy("false")).toBe(false)
  })

  it("should parse hop counts as numbers", () => {
    expect(parseTrustProxy("0")).toBe(0)
    expect(parseTrustProxy("1")).toBe(1)
    expect(parseTrustProxy(" 2 ")).toBe(2)
  })

  it("should pass address and subnet lists through", () => {
    expect(parseTrustProxy("loopback")).toBe("loopback")
    expect(parseTrustProxy("loopback, 10.0.0.0/8")).toBe("loopback, 10.0.0.0/8")
  })
})

describe("isValidTrustProxy", () => {
  it("should accept settings Express can compile", () => {
    for (const value of [undefined, true, false, 0, 2, "loopback", "loopback, 10.0.0.0/8"]) {
      expect(isValidTrustProxy(value)).toBe(true)
    }
  })

  it("should reject values Express would throw on at startup", () => {
    for (const value of ["yes", "-1", "1.5", "loopback 10.0.0.0/8"]) {
      expect(isValidTrustProxy(parseTrustProxy(value))).toBe(false)
    }
  })
})
