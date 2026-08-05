import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({
  getImage: vi.fn(),
  search: vi.fn(),
  initializePicnicClient: vi.fn(),
}))

vi.mock("../../../src/utils/picnic-client.js", () => ({
  getPicnicClient: () => ({
    catalog: { getImage: mocks.getImage, search: mocks.search },
    sendRequest: vi.fn(),
  }),
  initializePicnicClient: mocks.initializePicnicClient,
  saveSession: vi.fn(),
  verifyPicnic2FACode: vi.fn(),
}))

// A one-pixel PNG, so the assertions run against a real binary payload rather than a string.
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
)

describe("picnic_get_image", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    await import("../../../src/tools/picnic-tools.js")
  })

  // The handler used to return the ArrayBuffer inside a plain object, which the registry
  // JSON-serialized — and an ArrayBuffer stringifies to `{}`, so the image never arrived.
  it("returns renderable image content rather than a JSON string", async () => {
    const { toolRegistry } = await import("../../../src/tools/registry.js")
    mocks.getImage.mockResolvedValue(
      PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
    )

    const result = await toolRegistry.executeTool("picnic_get_image", {
      imageId: "abc",
      size: "small",
    })

    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("image")
    expect(result.content[0].mimeType).toBe("image/png")
    expect(result.content[0].data).toBe(PNG.toString("base64"))
    expect(result.content[0].text).toBeUndefined()
  })

  it("round-trips the bytes unchanged", async () => {
    const { toolRegistry } = await import("../../../src/tools/registry.js")
    mocks.getImage.mockResolvedValue(
      PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.byteLength),
    )

    const result = await toolRegistry.executeTool("picnic_get_image", {
      imageId: "abc",
      size: "small",
    })

    expect(Buffer.from(result.content[0].data ?? "", "base64").equals(PNG)).toBe(true)
  })

  it("passes the requested id and size through", async () => {
    const { toolRegistry } = await import("../../../src/tools/registry.js")
    mocks.getImage.mockResolvedValue(new ArrayBuffer(8))

    await toolRegistry.executeTool("picnic_get_image", { imageId: "xyz", size: "large" })

    expect(mocks.getImage).toHaveBeenCalledWith("xyz", "large")
  })

  it("still serializes ordinary object results as text", async () => {
    const { toolRegistry } = await import("../../../src/tools/registry.js")
    mocks.search.mockResolvedValue([{ id: "s1", name: "Bananen", display_price: 169 }])

    const result = await toolRegistry.executeTool("picnic_search", { query: "x", limit: 1 })

    expect(result.content[0].type).toBe("text")
    expect(JSON.parse(result.content[0].text ?? "").results).toHaveLength(1)
  })
})
