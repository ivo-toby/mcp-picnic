type Scalar = string | number | boolean | null

type PriceRangeLike = {
  from_quantity?: number
  price?: number
}

type CartArticleLike = {
  id?: string
  name?: string
  unit_quantity?: string
  price?: number
  price_ranges?: PriceRangeLike[]
  image_ids?: string[]
}

type CartOrderLineLike = {
  id?: string
  display_price?: number
  price?: number
  decorators?: unknown[]
  items?: CartArticleLike[]
}

type CartLike = {
  type?: string
  id?: string
  items?: CartOrderLineLike[]
  total_count?: number
  total_price?: number
  checkout_total_price?: number
  total_savings?: number
}

export type ProductDetailsLike = {
  id?: string
  name?: string
  brand?: string
  displayPrice?: number
  unitQuantity?: string
  priceRanges?: PriceRangeLike[] | null
  imageIds?: string[] | null
}

export type FilteredProductDetails = {
  id?: string
  name?: string
  brand?: string
  price?: number
  unit?: string
  bundle_prices?: PriceRangeLike[]
  image_id?: string
}

export type CompactDecorator = {
  type: string
  [key: string]: Scalar | undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function scalar(value: unknown): Scalar | undefined {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value
  }

  return undefined
}

function compactDecorator(decorator: unknown): CompactDecorator | undefined {
  if (!isRecord(decorator) || typeof decorator.type !== "string") {
    return undefined
  }

  const type = decorator.type

  switch (type) {
    case "LABEL":
    case "PRODUCT_SIZE":
      return { type, text: scalar(decorator.text) }
    case "PROMO":
      return {
        type,
        text: scalar(decorator.text),
        background_color: scalar(decorator.background_color),
        text_color: scalar(decorator.text_color),
      }
    case "PRICE":
      return { type, display_price: scalar(decorator.display_price) }
    case "BASE_PRICE":
      return { type, base_price_text: scalar(decorator.base_price_text) }
    case "FRESH_LABEL":
      return { type, period: scalar(decorator.period) }
    case "QUANTITY":
      return { type, quantity: scalar(decorator.quantity) }
    case "UNIT_QUANTITY":
      return { type, unit_quantity_text: scalar(decorator.unit_quantity_text) }
    case "VALIDITY_LABEL":
      return { type, valid_until: scalar(decorator.valid_until) }
    default:
      return undefined
  }
}

function compactDecorators(decorators?: unknown[]) {
  const filtered = decorators?.map(compactDecorator).filter((decorator) => decorator !== undefined)

  return filtered?.length ? filtered : undefined
}

/**
 * Filters Picnic cart data down to the fields that are useful in MCP responses.
 */
export function filterCartData(cart: unknown) {
  if (!cart || typeof cart !== "object") return cart

  const cartObj = cart as CartLike

  const filteredItems = cartObj.items?.map((orderLine) => {
    const decorators = compactDecorators(orderLine.decorators)

    return {
      order_line_id: orderLine.id,
      price: orderLine.display_price ?? orderLine.price,
      ...(decorators && { decorators }),
      articles: orderLine.items?.map((article) => ({
        product_id: article.id,
        name: article.name,
        unit: article.unit_quantity,
        price: article.price,
        ...(article.price_ranges?.length && { bundle_prices: article.price_ranges }),
        ...(article.image_ids?.length && { image_id: article.image_ids[0] }),
      })),
    }
  })

  return {
    type: cartObj.type,
    id: cartObj.id,
    items: filteredItems,
    total_count: cartObj.total_count,
    total_price: cartObj.total_price,
    checkout_total_price: cartObj.checkout_total_price,
    total_savings: cartObj.total_savings,
  }
}

/**
 * Filters Picnic product details down to the default MCP response shape.
 */
export function filterProductDetails(details: ProductDetailsLike): FilteredProductDetails {
  return {
    id: details.id,
    name: details.name,
    brand: details.brand,
    price: details.displayPrice,
    unit: details.unitQuantity,
    ...(details.priceRanges?.length && { bundle_prices: details.priceRanges }),
    ...(details.imageIds?.length && { image_id: details.imageIds[0] }),
  }
}
