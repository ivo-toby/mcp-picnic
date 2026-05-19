import { describe, expect, it } from "vitest"
import { filterCartData, filterProductDetails } from "../../../src/tools/picnic-transformers.js"

describe("picnic transformers", () => {
  describe("filterCartData", () => {
    it("should expose bundle prices and total savings", () => {
      const result = filterCartData({
        type: "CART",
        id: "cart-1",
        total_count: 2,
        total_price: 500,
        checkout_total_price: 450,
        total_savings: 50,
        items: [
          {
            id: "line-1",
            display_price: 450,
            items: [
              {
                id: "s100",
                name: "Apples",
                unit_quantity: "1kg",
                price: 250,
                price_ranges: [{ from_quantity: 2, price: 225 }],
                image_ids: ["image-1", "image-2"],
              },
            ],
          },
        ],
      })

      expect(result).toEqual({
        type: "CART",
        id: "cart-1",
        items: [
          {
            order_line_id: "line-1",
            price: 450,
            articles: [
              {
                product_id: "s100",
                name: "Apples",
                unit: "1kg",
                price: 250,
                bundle_prices: [{ from_quantity: 2, price: 225 }],
                image_id: "image-1",
              },
            ],
          },
        ],
        total_count: 2,
        total_price: 500,
        checkout_total_price: 450,
        total_savings: 50,
      })
    })

    it("should keep compact decorators and remove large decorators", () => {
      const result = filterCartData({
        items: [
          {
            id: "line-1",
            price: 100,
            decorators: [
              { type: "LABEL", text: "Organic" },
              {
                type: "PROMO",
                text: "BundleBonus",
                background_color: "#fff000",
                text_color: "#111111",
              },
              { type: "PRICE", display_price: 100 },
              { type: "BASE_PRICE", base_price_text: "1.00 / kg" },
              { type: "FRESH_LABEL", period: "today" },
              { type: "QUANTITY", quantity: 2 },
              { type: "UNIT_QUANTITY", unit_quantity_text: "500g" },
              { type: "PRODUCT_SIZE", text: "small" },
              { type: "VALIDITY_LABEL", valid_until: "2026-05-20" },
              { type: "BACKGROUND_IMAGE", image_ids: ["large-image"], height_percent: 100 },
              { type: "BANNERS", banners: [{ image_id: "banner-image" }] },
              { type: "MORE_BUTTON", images: ["button-image"], sellable_item_count: 12 },
              { type: "UNAVAILABLE", replacements: [{ id: "replacement" }] },
              { type: "ARTICLE_DELIVERY_FAILURES", failures: { s100: ["PRODUCT_ABSENT"] } },
              { type: "PRODUCT_CHARACTERISTICS", characteristics: [{ type: "FROZEN" }] },
              { type: "BUNDLES_BUTTON", deeplink: "picnic://bundle" },
              { type: "ORDERED_QUANTITY", image_id: "quantity-image", quantity: "1" },
              { type: "TITLE_STYLE", styles: [{ color: "#fff" }] },
              { type: "IMMUTABLE" },
            ],
            items: [],
          },
        ],
      })

      expect(result).toMatchObject({
        items: [
          {
            decorators: [
              { type: "LABEL", text: "Organic" },
              {
                type: "PROMO",
                text: "BundleBonus",
                background_color: "#fff000",
                text_color: "#111111",
              },
              { type: "PRICE", display_price: 100 },
              { type: "BASE_PRICE", base_price_text: "1.00 / kg" },
              { type: "FRESH_LABEL", period: "today" },
              { type: "QUANTITY", quantity: 2 },
              { type: "UNIT_QUANTITY", unit_quantity_text: "500g" },
              { type: "PRODUCT_SIZE", text: "small" },
              { type: "VALIDITY_LABEL", valid_until: "2026-05-20" },
            ],
          },
        ],
      })
    })

    it("should omit decorators when all decorators are filtered out", () => {
      const result = filterCartData({
        items: [
          {
            id: "line-1",
            price: 100,
            decorators: [{ type: "BACKGROUND_IMAGE", image_ids: ["large-image"] }],
            items: [],
          },
        ],
      })

      expect(result).toEqual({
        type: undefined,
        id: undefined,
        items: [
          {
            order_line_id: "line-1",
            price: 100,
            articles: [],
          },
        ],
        total_count: undefined,
        total_price: undefined,
        checkout_total_price: undefined,
        total_savings: undefined,
      })
    })
  })

  describe("filterProductDetails", () => {
    it("should expose bundle prices and the first image ID", () => {
      expect(
        filterProductDetails({
          id: "s100",
          name: "Apples",
          brand: "Picnic",
          displayPrice: 250,
          unitQuantity: "1kg",
          priceRanges: [{ from_quantity: 2, price: 225 }],
          imageIds: ["image-1", "image-2"],
        }),
      ).toEqual({
        id: "s100",
        name: "Apples",
        brand: "Picnic",
        price: 250,
        unit: "1kg",
        bundle_prices: [{ from_quantity: 2, price: 225 }],
        image_id: "image-1",
      })
    })
  })
})
