import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ToolResult } from "../../../src/tools/registry.js"

const mocks = vi.hoisted(() => ({
  initializePicnicClient: vi.fn(),
  sendRequest: vi.fn(),
  verifyPicnic2FACode: vi.fn(),
}))

vi.mock("../../../src/utils/picnic-client.js", () => ({
  getPicnicClient: () => ({
    sendRequest: mocks.sendRequest,
  }),
  initializePicnicClient: mocks.initializePicnicClient,
  saveSession: vi.fn(),
  verifyPicnic2FACode: mocks.verifyPicnic2FACode,
}))

function parseToolResult(result: ToolResult) {
  return JSON.parse(result.content[0].text ?? "")
}

function promoTile({
  productId,
  promotionId,
  name,
  label,
  price,
  originalPrice,
}: {
  productId: string
  promotionId: string
  name: string
  label: string
  price: number
  originalPrice?: number
}) {
  return {
    type: "PML",
    id: `selling-unit-${productId}-tile`,
    analytics: {
      contexts: [
        {
          data: { product_id: productId },
          schema: "iglu:tech.picnic.snowplow.analytics/product/jsonschema/1-0-0",
        },
        {
          data: {
            promotion_id: promotionId,
            promotion_label: label,
            price,
            ...(originalPrice !== undefined && {
              strikethrough_price: originalPrice,
              show_strikethrough_price: true,
            }),
          },
          schema: "iglu:tech.picnic.snowplow.analytics/promotion/jsonschema/1-1-0",
        },
      ],
    },
    content: {
      type: "SELLING_UNIT_TILE",
      sellingUnit: {
        id: productId,
        display_price: price,
        image_id: `image-${productId}`,
        max_count: 12,
        name,
        unit_quantity: "1 stuk",
      },
    },
  }
}

function regularTile() {
  return {
    type: "PML",
    id: "selling-unit-s999-tile",
    analytics: { contexts: [{ data: { product_id: "s999" } }] },
    content: {
      type: "SELLING_UNIT_TILE",
      sellingUnit: {
        id: "s999",
        display_price: 399,
        name: "Regular product",
        unit_quantity: "1 stuk",
      },
    },
  }
}

async function loadTools() {
  vi.resetModules()
  const { toolRegistry } = await import("../../../src/tools/registry.js")
  await import("../../../src/tools/picnic-tools.js")
  return toolRegistry
}

describe("promotions tools", () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it("fetches weekly Picnic promotions from the all-promos page", async () => {
    const firstTile = promoTile({
      productId: "s100",
      promotionId: "promo-1",
      name: "Discount tomatoes",
      label: "nu €1.99",
      price: 199,
      originalPrice: 249,
    })
    mocks.sendRequest.mockResolvedValue({
      layout: {
        body: {
          children: [
            firstTile,
            regularTile(),
            [
              promoTile({
                productId: "s200",
                promotionId: "promo-2",
                name: "Bonus pasta",
                label: "1+1 gratis",
                price: 239,
              }),
              firstTile,
            ],
          ],
        },
      },
    })

    const toolRegistry = await loadTools()
    const result = await toolRegistry.executeTool("picnic_get_promotions", {})
    const payload = parseToolResult(result)

    expect(mocks.sendRequest).toHaveBeenCalledWith(
      "GET",
      "/pages/promo-page-all-promos-redirect",
      null,
      true,
    )
    expect(payload.promotions).toEqual([
      {
        product_id: "s100",
        promotion_id: "promo-1",
        name: "Discount tomatoes",
        price: 199,
        unit: "1 stuk",
        promotion_label: "nu €1.99",
        original_price: 249,
        image_id: "image-s100",
        max_count: 12,
      },
      {
        product_id: "s200",
        promotion_id: "promo-2",
        name: "Bonus pasta",
        price: 239,
        unit: "1 stuk",
        promotion_label: "1+1 gratis",
        image_id: "image-s200",
        max_count: 12,
      },
    ])
    expect(payload.pagination).toEqual({
      offset: 0,
      limit: 25,
      returned: 2,
      total: 2,
      hasMore: false,
    })
  })

  it("paginates promotions after deduplicating repeated tiles", async () => {
    mocks.sendRequest.mockResolvedValue({
      layout: {
        body: [
          promoTile({
            productId: "s100",
            promotionId: "promo-1",
            name: "Discount tomatoes",
            label: "nu €1.99",
            price: 199,
          }),
          promoTile({
            productId: "s200",
            promotionId: "promo-2",
            name: "Bonus pasta",
            label: "1+1 gratis",
            price: 239,
          }),
          promoTile({
            productId: "s300",
            promotionId: "promo-3",
            name: "Deal soap",
            label: "2 voor €5",
            price: 279,
          }),
        ],
      },
    })

    const toolRegistry = await loadTools()
    const result = await toolRegistry.executeTool("picnic_get_promotions", {
      offset: 1,
      limit: 1,
    })
    const payload = parseToolResult(result)

    expect(payload.promotions).toEqual([
      expect.objectContaining({
        product_id: "s200",
        promotion_id: "promo-2",
      }),
    ])
    expect(payload.pagination).toEqual({
      offset: 1,
      limit: 1,
      returned: 1,
      total: 3,
      hasMore: true,
    })
  })

  it("falls back to the promotions root when the legacy redirect is missing", async () => {
    const tile = promoTile({
      productId: "s100",
      promotionId: "promo-1",
      name: "Bio Mozzarella",
      label: "25% Rabatt",
      price: 111,
      originalPrice: 149,
    })
    mocks.sendRequest
      .mockRejectedValueOnce(
        new Error("page with id 'promo-page-all-promos-redirect' was not found"),
      )
      .mockResolvedValueOnce({ body: [tile, tile, regularTile()] })
    const registry = await loadTools()
    const payload = parseToolResult(
      await registry.executeTool("picnic_get_promotions", { limit: 1 }),
    )
    expect(mocks.sendRequest).toHaveBeenNthCalledWith(
      2,
      "GET",
      "/pages/promo-page-root",
      null,
      true,
    )
    expect(payload.source).toEqual({
      pageId: "promo-page-root",
      endpoint: "/pages/promo-page-root",
    })
    expect(payload.promotions).toEqual([
      expect.objectContaining({ product_id: "s100", price: 111, original_price: 149 }),
    ])
    expect(payload.pagination).toEqual({
      offset: 0,
      limit: 1,
      returned: 1,
      total: 1,
      hasMore: false,
    })
    expect(mocks.sendRequest).toHaveBeenCalledTimes(2)
  })

  it.each(["Unauthorized", "fetch failed", "Internal Server Error", "Not Found"])(
    "does not hide unrelated failures: %s",
    async (message) => {
      mocks.sendRequest.mockRejectedValue(new Error(message))
      const registry = await loadTools()
      await expect(registry.executeTool("picnic_get_promotions", {})).rejects.toThrow(message)
      expect(mocks.sendRequest).toHaveBeenCalledTimes(1)
    },
  )

  it("propagates a failure from the fallback page", async () => {
    mocks.sendRequest
      .mockRejectedValueOnce(
        new Error("page with id 'promo-page-all-promos-redirect' was not found"),
      )
      .mockRejectedValueOnce(new Error("page with id 'promo-page-root' was not found"))
    const registry = await loadTools()
    await expect(registry.executeTool("picnic_get_promotions", {})).rejects.toThrow(
      "page with id 'promo-page-root' was not found",
    )
    expect(mocks.sendRequest).toHaveBeenCalledTimes(2)
  })

  it("does not fall back for an empty but valid legacy page", async () => {
    mocks.sendRequest.mockResolvedValue({ body: [] })
    const registry = await loadTools()
    const payload = parseToolResult(await registry.executeTool("picnic_get_promotions", {}))
    expect(payload.promotions).toEqual([])
    expect(payload.source.pageId).toBe("promo-page-all-promos-redirect")
    expect(mocks.sendRequest).toHaveBeenCalledTimes(1)
  })
})
