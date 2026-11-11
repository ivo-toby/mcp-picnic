import { describe, it, expect } from "vitest"
import { parseTrustProxy } from "../../../src/utils/trust-proxy.js"

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
    expect(parseTrustProxy("1")).toBe(1)
    expect(parseTrustProxy(" 2 ")).toBe(2)
  })

  it("should pass address and subnet lists through", () => {
    expect(parseTrustProxy("loopback")).toBe("loopback")
    expect(parseTrustProxy("loopback, 10.0.0.0/8")).toBe("loopback, 10.0.0.0/8")
  })
})
