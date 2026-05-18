import { z } from "zod"
import { toolRegistry } from "./registry.js"
import { getPicnicClient, initializePicnicClient, saveSession } from "../utils/picnic-client.js"

/**
 * Picnic API tools optimized for LLM consumption
 *
 * Optimizations applied:
 * - Search results are filtered to essential fields only (id, name, price, unit, image_id)
 * - Pagination added to search and deliveries tools to prevent context overflow
 * - Cart data is filtered to reduce verbosity while keeping essential information
 * - Default limits set to reasonable values (10 for search, 10 for deliveries)
 */

// Helper function to ensure client is initialized
async function ensureClientInitialized() {
  try {
    getPicnicClient()
  } catch (error) {
    // Client not initialized, initialize it now
    await initializePicnicClient()
  }
}

// Helper function to filter cart data for LLM consumption
function filterCartData(cart: unknown) {
  if (!cart || typeof cart !== "object") return cart

  const cartObj = cart as {
    type?: string
    id?: string
    items?: Array<{
      id?: string
      display_price?: number
      price?: number
      items?: Array<{
        id?: string
        name?: string
        unit_quantity?: string
        price?: number
        image_ids?: string[]
        max_count?: number
      }>
    }>
    total_count?: number
    total_price?: number
    checkout_total_price?: number
    total_savings?: number
  }

  const filteredItems = cartObj.items?.map((orderLine) => ({
    order_line_id: orderLine.id,
    price: orderLine.display_price || orderLine.price,
    articles: orderLine.items?.map((article) => ({
      product_id: article.id,
      name: article.name,
      unit: article.unit_quantity,
      price: article.price,
      ...(article.image_ids?.length && { image_id: article.image_ids[0] }),
    })),
  }))

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

// Search products tool
const searchInputSchema = z.object({
  query: z.string().describe("Search query for products"),
  limit: z
    .number()
    .min(1)
    .max(20)
    .default(5)
    .describe("Maximum number of results to return (1-20, default: 5)"),
  offset: z
    .number()
    .min(0)
    .default(0)
    .describe("Number of results to skip for pagination (default: 0)"),
})

toolRegistry.register({
  name: "picnic_search",
  description: "Search for products in Picnic with pagination and filtered results",
  inputSchema: searchInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const allResults = await client.catalog.search(args.query)

    // Apply pagination
    const startIndex = args.offset || 0
    const limit = args.limit || 5
    const paginatedResults = allResults.slice(startIndex, startIndex + limit)

    // Filter results to only include essential data for LLM
    const filteredResults = paginatedResults.map((product) => ({
      id: product.id,
      name: product.name,
      price: product.display_price,
      unit: product.unit_quantity,
      // Only include image_id if it exists, for potential image retrieval
      ...(product.image_id && { image_id: product.image_id }),
    }))

    return {
      query: args.query,
      results: filteredResults,
      pagination: {
        offset: startIndex,
        limit,
        returned: filteredResults.length,
        total: allResults.length,
        hasMore: startIndex + limit < allResults.length,
      },
    }
  },
})

// Get product suggestions tool
const suggestionsInputSchema = z.object({
  query: z.string().describe("Query for product suggestions"),
})

toolRegistry.register({
  name: "picnic_get_suggestions",
  description: "Get product suggestions based on a query",
  inputSchema: suggestionsInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const suggestions = await client.catalog.getSuggestions(args.query)
    return {
      query: args.query,
      suggestions,
    }
  },
})

// Note: picnic_get_article tool removed - endpoint deprecated (GitHub issue #23)
// Use picnic_search instead for basic product information

// Get product details tool
const productDetailsInputSchema = z.object({
  productId: z
    .string()
    .describe("The product selling unit ID (e.g. 's1001524'), as returned by search or cart"),
  full: z
    .boolean()
    .default(false)
    .describe(
      "When false (default), returns essential fields only (id, name, brand, price, unit, image). " +
        "When true, returns full details including description, allergens, nutritional info, promotions, and similar products.",
    ),
})

toolRegistry.register({
  name: "picnic_get_product_details",
  description:
    "Look up product details by ID. Returns essential info by default (name, brand, price, unit, image). " +
    "Set full=true for complete details including description, allergens, ingredients, and similar products. " +
    "Use this to resolve opaque product IDs from cart or order history.",
  inputSchema: productDetailsInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const details = await client.catalog.getProductDetails(args.productId)

    if (args.full) {
      return details
    }

    return {
      id: details.id,
      name: details.name,
      brand: details.brand,
      price: details.displayPrice,
      unit: details.unitQuantity,
      ...(details.imageIds.length > 0 && { image_id: details.imageIds[0] }),
    }
  },
})

// Get product image tool
const imageInputSchema = z.object({
  imageId: z.string().describe("The ID of the image to retrieve"),
  size: z
    .enum(["tiny", "small", "medium", "large", "extra-large"])
    .describe("The size of the image"),
})

toolRegistry.register({
  name: "picnic_get_image",
  description: "Get image data for a product using the image ID and size",
  inputSchema: imageInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const image = await client.catalog.getImage(args.imageId, args.size)
    return {
      imageId: args.imageId,
      size: args.size,
      image,
    }
  },
})

// Get shopping cart tool
toolRegistry.register({
  name: "picnic_get_cart",
  description: "Get the current shopping cart contents with filtered data",
  inputSchema: z.object({}),
  handler: async () => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const cart = await client.cart.getCart()
    return filterCartData(cart)
  },
})

// Add product to cart tool
const addToCartInputSchema = z.object({
  productId: z.string().describe("The ID of the product to add"),
  count: z.number().min(1).default(1).describe("Number of items to add"),
})

toolRegistry.register({
  name: "picnic_add_to_cart",
  description: "Add a product to the shopping cart",
  inputSchema: addToCartInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const cart = await client.cart.addProductToCart(args.productId, args.count)
    return {
      message: `Added ${args.count} item(s) to cart`,
      cart: filterCartData(cart),
    }
  },
})

// Remove product from cart tool
const removeFromCartInputSchema = z.object({
  productId: z.string().describe("The ID of the product to remove"),
  count: z.number().min(1).default(1).describe("Number of items to remove"),
})

toolRegistry.register({
  name: "picnic_remove_from_cart",
  description: "Remove a product from the shopping cart",
  inputSchema: removeFromCartInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const cart = await client.cart.removeProductFromCart(args.productId, args.count)
    return {
      message: `Removed ${args.count} item(s) from cart`,
      cart: filterCartData(cart),
    }
  },
})

// Clear cart tool
toolRegistry.register({
  name: "picnic_clear_cart",
  description: "Clear all items from the shopping cart",
  inputSchema: z.object({}),
  handler: async () => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const cart = await client.cart.clearCart()
    return {
      message: "Shopping cart cleared",
      cart: filterCartData(cart),
    }
  },
})

// Get delivery slots tool
toolRegistry.register({
  name: "picnic_get_delivery_slots",
  description: "Get available delivery time slots",
  inputSchema: z.object({}),
  handler: async () => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const slots = await client.cart.getDeliverySlots()
    return slots
  },
})

// Set delivery slot tool
const setDeliverySlotInputSchema = z.object({
  slotId: z.string().describe("The ID of the delivery slot to select"),
})

toolRegistry.register({
  name: "picnic_set_delivery_slot",
  description: "Select a delivery time slot",
  inputSchema: setDeliverySlotInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const result = await client.cart.setDeliverySlot(args.slotId)
    return {
      message: "Delivery slot selected",
      slotId: args.slotId,
      order: result,
    }
  },
})

// Get deliveries tool
const deliveriesInputSchema = z.object({
  filter: z.array(z.string()).default([]).describe("Filter deliveries by status"),
  limit: z
    .number()
    .min(1)
    .max(50)
    .default(10)
    .describe("Maximum number of deliveries to return (1-50, default: 10)"),
  offset: z
    .number()
    .min(0)
    .default(0)
    .describe("Number of deliveries to skip for pagination (default: 0)"),
})

toolRegistry.register({
  name: "picnic_get_deliveries",
  description: "Get past and current deliveries with pagination",
  inputSchema: deliveriesInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const allDeliveries = await client.delivery.getDeliveries(args.filter as string[])

    // Apply pagination
    const startIndex = args.offset || 0
    const limit = args.limit || 10
    const paginatedDeliveries = allDeliveries.slice(startIndex, startIndex + limit)

    return {
      deliveries: paginatedDeliveries,
      pagination: {
        offset: startIndex,
        limit,
        returned: paginatedDeliveries.length,
        total: allDeliveries.length,
        hasMore: startIndex + limit < allDeliveries.length,
      },
    }
  },
})

// Get specific delivery tool
const deliveryInputSchema = z.object({
  deliveryId: z.string().describe("The ID of the delivery to get details for"),
})

toolRegistry.register({
  name: "picnic_get_delivery",
  description: "Get details of a specific delivery",
  inputSchema: deliveryInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const delivery = await client.delivery.getDelivery(args.deliveryId)
    return delivery
  },
})

// Get delivery position tool
toolRegistry.register({
  name: "picnic_get_delivery_position",
  description: "Get real-time position data for a delivery",
  inputSchema: deliveryInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const position = await client.delivery.getDeliveryPosition(args.deliveryId)
    return position
  },
})

// Get delivery scenario tool
toolRegistry.register({
  name: "picnic_get_delivery_scenario",
  description: "Get driver and route information for a delivery",
  inputSchema: deliveryInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const scenario = await client.delivery.getDeliveryScenario(args.deliveryId)
    return scenario
  },
})

// Cancel delivery tool
toolRegistry.register({
  name: "picnic_cancel_delivery",
  description: "Cancel a delivery order",
  inputSchema: deliveryInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const result = await client.delivery.cancelDelivery(args.deliveryId)
    return {
      message: "Delivery cancelled",
      deliveryId: args.deliveryId,
      result,
    }
  },
})

// Rate delivery tool
const rateDeliveryInputSchema = z.object({
  deliveryId: z.string().describe("The ID of the delivery to rate"),
  rating: z.number().min(0).max(10).describe("Rating from 0 to 10"),
})

toolRegistry.register({
  name: "picnic_rate_delivery",
  description: "Rate a completed delivery",
  inputSchema: rateDeliveryInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const result = await client.delivery.setDeliveryRating(args.deliveryId, args.rating)
    return {
      message: `Delivery rated ${args.rating}/10`,
      deliveryId: args.deliveryId,
      result,
    }
  },
})

// Send delivery invoice email tool
const sendInvoiceEmailInputSchema = z.object({
  deliveryId: z.string().describe("The ID of the delivery to send the invoice email for"),
})

toolRegistry.register({
  name: "picnic_send_delivery_invoice_email",
  description: "Send or resend the invoice email for a completed delivery",
  inputSchema: sendInvoiceEmailInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const result = await client.delivery.sendDeliveryInvoiceEmail(args.deliveryId)
    return {
      message: "Delivery invoice email sent",
      deliveryId: args.deliveryId,
      result,
    }
  },
})

// Get order status tool
const orderStatusInputSchema = z.object({
  orderId: z.string().describe("The ID of the order to get the status for"),
})

toolRegistry.register({
  name: "picnic_get_order_status",
  description: "Get the status of a specific order",
  inputSchema: orderStatusInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const orderStatus = await client.cart.getOrderStatus(args.orderId)
    return orderStatus
  },
})

// Get user details tool
toolRegistry.register({
  name: "picnic_get_user_details",
  description: "Get details of the current logged-in user",
  inputSchema: z.object({}),
  handler: async () => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const user = await client.user.getUserDetails()
    return user
  },
})

// Get user info tool
toolRegistry.register({
  name: "picnic_get_user_info",
  description: "Get user information including toggled features",
  inputSchema: z.object({}),
  handler: async () => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const userInfo = await client.user.getUserInfo()
    return userInfo
  },
})

// Get payment profile tool
toolRegistry.register({
  name: "picnic_get_payment_profile",
  description: "Get payment information and profile",
  inputSchema: z.object({}),
  handler: async () => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const paymentProfile = await client.payment.getPaymentProfile()
    return paymentProfile
  },
})

// Get wallet transactions tool
const walletTransactionsInputSchema = z.object({
  pageNumber: z.number().min(1).default(1).describe("Page number for transaction history"),
})

toolRegistry.register({
  name: "picnic_get_wallet_transactions",
  description: "Get wallet transaction history",
  inputSchema: walletTransactionsInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const pageNumber = args.pageNumber ?? 1
    const transactions = await client.payment.getWalletTransactions(pageNumber)
    return {
      pageNumber,
      transactions,
    }
  },
})

// Get wallet transaction details tool
const walletTransactionDetailsInputSchema = z.object({
  transactionId: z.string().describe("The ID of the transaction to get details for"),
})

toolRegistry.register({
  name: "picnic_get_wallet_transaction_details",
  description: "Get detailed information about a specific wallet transaction",
  inputSchema: walletTransactionDetailsInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const details = await client.payment.getWalletTransactionDetails(args.transactionId as string)
    return details
  },
})

// 2FA tools
const generate2FAInputSchema = z.object({
  channel: z.string().default("SMS").describe("Channel to send 2FA code (SMS, etc.)"),
})

toolRegistry.register({
  name: "picnic_generate_2fa_code",
  description: "Generate a 2FA code for verification",
  inputSchema: generate2FAInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const channel = args.channel || "SMS"
    try {
      const result = await client.auth.generate2FACode(channel)
      return {
        message: "2FA code generated and sent",
        channel,
        result,
      }
    } catch (error: unknown) {
      // The Picnic API returns empty bodies for 2FA endpoints, which causes JSON parse errors
      // but the actual request succeeds
      if (error instanceof SyntaxError && (error as Error).message.includes("JSON")) {
        return {
          message: "2FA code generated and sent",
          channel,
        }
      }
      throw error
    }
  },
})

const verify2FAInputSchema = z.object({
  code: z.string().describe("The 2FA code to verify"),
})

// ─── Recipe tools ────────────────────────────────────────────────────────────

/**
 * Extracts a compact recipe list from a Fusion Page response.
 * Each PML tile contains the recipe_id in its analytics context and the
 * recipe name + cooking time in its markdown fields.
 */
function extractRecipeList(pageData: unknown): Array<{ recipe_id: string; name: string; cooking_time_minutes: number | null }> {
  const results: Array<{ recipe_id: string; name: string; cooking_time_minutes: number | null }> = []
  const seen = new Set<string>()

  function getMarkdowns(obj: unknown, acc: string[]): void {
    if (!obj || typeof obj !== "object") return
    if (Array.isArray(obj)) { obj.forEach(v => getMarkdowns(v, acc)); return }
    const o = obj as Record<string, unknown>
    if (typeof o.markdown === "string") acc.push(o.markdown)
    for (const v of Object.values(o)) getMarkdowns(v, acc)
  }

  function walk(obj: unknown): void {
    if (!obj || typeof obj !== "object") return
    if (Array.isArray(obj)) { obj.forEach(walk); return }
    const o = obj as Record<string, unknown>
    if (o.type === "PML" && o.pml && o.analytics) {
      const ctx = (o.analytics as { contexts?: Array<{ data?: { recipe_id?: string } }> }).contexts ?? []
      const recipeCtx = ctx.find(c => c.data?.recipe_id)
      if (recipeCtx?.data?.recipe_id) {
        const recipeId = recipeCtx.data.recipe_id
        if (!seen.has(recipeId)) {
          seen.add(recipeId)
          const markdowns: string[] = []
          getMarkdowns(o.pml, markdowns)
          const texts = markdowns.map(t => t.replace(/#\([^)]+\)/g, "").trim()).filter(Boolean)
          const UI_STRINGS = new Set(["Hinzufügen", "Nicht alles vorrätig"])
          const name = markdowns.find(t => !t.includes("#(") && !UI_STRINGS.has(t.trim()) && t.trim())?.trim() ?? ""
          const timeText = texts.find(t => /Minuten|Stunden|Min|Std/.test(t)) ?? ""
          const timeMatch = timeText.match(/(\d+)/)
          const mult = /Stunden|Std/.test(timeText) ? 60 : 1
          const cooking_time_minutes = timeMatch ? parseInt(timeMatch[1]) * mult : null
          results.push({ recipe_id: recipeId, name, cooking_time_minutes })
        }
      }
    }
    for (const v of Object.values(o)) walk(v)
  }

  walk(pageData)
  return results
}

toolRegistry.register({
  name: "picnic_get_cookbook",
  description: "Get recipes shown on the Picnic cookbook homepage (mix of this week's picks, new recipes, collaborations, and saved recipes). Returns a compact list with recipe_id, name, and cooking_time_minutes.",
  inputSchema: z.object({}),
  handler: async () => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const page = await client.app.getPage("cookbook-page-content?segment=ALL_RECIPES")
    return extractRecipeList(page)
  },
})

const recipesByCategoryInputSchema = z.object({
  categoryPageId: z.string().describe(
    "Category page ID. Available values: " +
    "recipe-cattree-25min (Blitzrezepte ~1000), recipe-cattree-onepot, " +
    "recipe-cattree-pasta (~248), recipe-cattree-stuffedpasta, recipe-cattree-lasagne, " +
    "recipe-cattree-gnocchi, recipe-cattree-noodles, recipe-cattree-schupfnudeln, " +
    "recipe-cattree-maultaschen, recipe-cattree-spaetzle, recipe-cattree-asia-reis, " +
    "recipe-cattree-risotto, recipe-cattree-couscous, recipe-cattree-bulgur, " +
    "recipe-cattree-knoedel, recipe-cattree-kartoffel, recipe-cattree-suppen (~78), " +
    "recipe-cattree-eintopf, recipe-cattree-curry2, recipe-cattree-l2-salad, " +
    "recipe-cattree-bowls, recipe-cattree-wraps, recipe-cattree-pita2, " +
    "recipe-cattree-l2-burger, recipe-cattree-quiche, recipe-cattree-traybake, " +
    "recipe-cattree-auflaufe, recipe-cattree-l2-pizza, " +
    "recipe-cattree-vegetarisch (~930), recipe-cattree-vegan (~132), " +
    "recipe-cattree-highinveg, recipe-cattree-brunch, recipe-cattree-aperitif, " +
    "recipe-cattree-dessert, recipe-cattree-abendbrot, recipe-cattree-bbq, " +
    "recipe-cattree-l2-party, recipe-cattree-basic, recipe-cattree-baking, " +
    "recipe-cattree-snacks, recipe-cattree-getraenke, recipe-cattree-airfryer, " +
    "recipe-cattree-budget (~628), recipe-cattree-jamieoliver, " +
    "recipe-cattree-season (~183), recipe-cattree-l2-kids"
  ),
})

toolRegistry.register({
  name: "picnic_get_recipes_by_category",
  description: "Get all recipes for a Picnic recipe category. Returns a compact list with recipe_id, name, and cooking_time_minutes. Categories contain hundreds of recipes each.",
  inputSchema: recipesByCategoryInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const page = await client.app.getPage(args.categoryPageId)
    return extractRecipeList(page)
  },
})

type SellingUnit = { ingredient_id: string; selling_unit_id: string; quantity: number; checked: boolean }
type RecipeContext = { recipe_id: string; recipe_name: string; portions: number; selling_units: SellingUnit[] }

function extractRecipeContext(pageData: unknown): RecipeContext | null {
  function walk(obj: unknown, depth: number): RecipeContext | null {
    if (depth > 20 || !obj || typeof obj !== "object") return null
    if (Array.isArray(obj)) {
      for (const v of obj) { const r = walk(v, depth + 1); if (r) return r }
      return null
    }
    const o = obj as Record<string, unknown>
    const ctxs = (o.analytics as { contexts?: Array<{ data?: unknown }> } | undefined)?.contexts ?? []
    for (const c of ctxs) {
      const d = c.data as Record<string, unknown> | undefined
      if (d?.selling_units && d?.portions && d?.recipe_name && d?.recipe_id) return d as unknown as RecipeContext
    }
    for (const v of Object.values(o)) { const r = walk(v, depth + 1); if (r) return r }
    return null
  }
  return walk(pageData, 0)
}

type IngredientTile = { ingredient_id: string; name: string; package_info: string; price_cents: number | null }

function extractIngredientTiles(pageData: unknown): IngredientTile[] {
  const results: IngredientTile[] = []

  function getMarkdowns(obj: unknown, acc: string[]): void {
    if (!obj || typeof obj !== "object") return
    if (Array.isArray(obj)) { obj.forEach(v => getMarkdowns(v, acc)); return }
    const o = obj as Record<string, unknown>
    if (typeof o.markdown === "string") acc.push(o.markdown)
    for (const v of Object.values(o)) getMarkdowns(v, acc)
  }

  function walk(obj: unknown, depth: number): void {
    if (depth > 60 || !obj || typeof obj !== "object") return
    if (Array.isArray(obj)) { obj.forEach(v => walk(v, depth + 1)); return }
    const o = obj as Record<string, unknown>
    if (o.type === "PML" && o.analytics && o.pml) {
      const ctxs = (o.analytics as { contexts?: Array<{ data?: Record<string, unknown>; schema?: string }> }).contexts ?? []
      const productCtx = ctxs.find(c => c.data?.product_id && c.schema?.includes("/product/"))
      if (productCtx) {
        const ingredient_id = productCtx.data!.product_id as string
        const markdowns: string[] = []
        getMarkdowns(o.pml, markdowns)
        const clean = markdowns
          .map(t => t.replace(/#\([^)]+\)/g, "").replace(/\xa0/g, " ").trim())
          .filter(Boolean)
        // Name: first string that isn't a price, arrow, percentage, or discount badge like "-20%"
        const name = clean.find(t => !/^[><%]/.test(t) && !/^-?\d+%/.test(t) && !/^\d+[.,]\d+$/.test(t) && !/€/.test(t) && !/jetzt/i.test(t)) ?? ""
        // Package info: string with g/ml/kg/Stk/· or parenthetical
        const package_info = clean.find(t => /g|ml|kg|Stk|·|\(/.test(t) && t !== name) ?? ""
        // Price: extract cents from "jetzt 4.49€" or "4.49"
        const priceStr = clean.find(t => /€|\d+[.,]\d{2}/.test(t)) ?? ""
        const priceMatch = priceStr.match(/(\d+)[.,](\d{2})/)
        const price_cents = priceMatch ? parseInt(priceMatch[1]) * 100 + parseInt(priceMatch[2]) : null
        results.push({ ingredient_id, name, package_info, price_cents })
        return
      }
    }
    for (const v of Object.values(o)) walk(v, depth + 1)
  }

  walk(pageData, 0)
  return results
}

const recipeDetailsInputSchema = z.object({
  recipeId: z.string().describe("The recipe ID (24-char hex string from picnic_get_cookbook or picnic_get_recipes_by_category)"),
})

toolRegistry.register({
  name: "picnic_get_recipe_ingredients",
  description: `Get structured ingredient list for a recipe. Returns each ingredient with:
- name: product name
- selling_unit_id: product ID for adding to cart
- quantity: number of packages to buy (for the default portion count)
- portions: default serving size this quantity is based on
- is_condiment: true for staples the user likely already has (salt, oil, spices etc) — skip these when adding to cart
- package_info: package size/description
- price_cents: price in cents

Use this to compare ingredients across recipes for meal planning and to build shopping lists.`,
  inputSchema: recipeDetailsInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const page = await client.app.getPage(`selling-group-details-page?selling_group_id=${args.recipeId}`)
    const ctx = extractRecipeContext(page)
    if (!ctx) throw new Error("Could not find recipe data in response")
    const tiles = extractIngredientTiles(page)
    const tilesByIngredientId = new Map(tiles.map(t => [t.ingredient_id, t]))
    return {
      recipe_id: ctx.recipe_id,
      recipe_name: ctx.recipe_name,
      portions: ctx.portions,
      ingredients: ctx.selling_units.map(u => {
        const tile = tilesByIngredientId.get(u.ingredient_id)
        return {
          name: tile?.name ?? "",
          selling_unit_id: u.selling_unit_id,
          quantity: u.quantity,
          is_condiment: !u.checked,
          package_info: tile?.package_info ?? "",
          price_cents: tile?.price_cents ?? null,
        }
      }),
    }
  },
})

toolRegistry.register({
  name: "picnic_get_multiple_recipe_ingredients",
  description: `Fetch structured ingredient lists for multiple recipes in parallel. Accepts up to 20 recipe IDs and returns all results at once.

Use this for meal planning: fetch ingredients for a set of candidate recipes, then compare across recipes to find combinations that share ingredients (minimizing leftover partial packages). Each result has the same shape as picnic_get_recipe_ingredients.

Note: ingredients with quantity values much larger than expected (e.g. 40 for spring onions) are measured in grams/pieces from a single package — treat quantity=1 as "buy one pack" for those.`,
  inputSchema: z.object({
    recipeIds: z.array(z.string()).min(1).max(20).describe("List of recipe IDs (up to 20)"),
  }),
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()

    const results = await Promise.allSettled(
      args.recipeIds.map(async (recipeId) => {
        const page = await client.app.getPage(`selling-group-details-page?selling_group_id=${recipeId}`)
        const ctx = extractRecipeContext(page)
        if (!ctx) throw new Error(`Could not find recipe data for ${recipeId}`)
        const tiles = extractIngredientTiles(page)
        const tilesByIngredientId = new Map(tiles.map(t => [t.ingredient_id, t]))
        return {
          recipe_id: ctx.recipe_id,
          recipe_name: ctx.recipe_name,
          portions: ctx.portions,
          ingredients: ctx.selling_units.map(u => {
            const tile = tilesByIngredientId.get(u.ingredient_id)
            return {
              name: tile?.name ?? "",
              selling_unit_id: u.selling_unit_id,
              quantity: u.quantity,
              is_condiment: !u.checked,
              package_info: tile?.package_info ?? "",
              price_cents: tile?.price_cents ?? null,
            }
          }),
        }
      })
    )

    return results.map((r, i) =>
      r.status === "fulfilled"
        ? r.value
        : { recipe_id: args.recipeIds[i], error: (r.reason as Error).message }
    )
  },
})

// Shared ingredient input schema (matches output of picnic_get_multiple_recipe_ingredients)
const recipeIngredientInput = z.object({
  recipe_id: z.string(),
  recipe_name: z.string(),
  portions: z.number(),
  ingredients: z.array(
    z.object({
      name: z.string(),
      selling_unit_id: z.string(),
      quantity: z.number(),
      is_condiment: z.boolean(),
      package_info: z.string(),
      price_cents: z.number().nullable(),
    })
  ),
})

toolRegistry.register({
  name: "picnic_build_shopping_list",
  description: `Given a list of recipes (output of picnic_get_multiple_recipe_ingredients), consolidates all non-condiment ingredients into a single shopping list.

Shared ingredients (same product needed by multiple recipes) are flagged with used_in_recipes and potentially_shareable=true when package_info suggests partial usage (e.g. "0.5 Stk. benötigt"). For those items, one package may cover both recipes — quantity is a conservative sum across all recipes, so the actual amount to buy may be less.

Returns:
- shopping_list: deduplicated items sorted by price descending; quantity is the sum across all recipes (conservative — for potentially_shareable items the real quantity may be lower)
- shared_items: subset of shopping_list used in 2+ recipes
- total_price_cents: sum of price_cents × quantity for all items (null prices counted as 0)
- recipes_summary: names and portions of included recipes`,
  inputSchema: z.object({
    recipes: z.array(recipeIngredientInput).min(1).max(20),
  }),
  handler: async (args) => {
    type ShoppingItem = {
      selling_unit_id: string
      name: string
      package_info: string
      price_cents: number | null
      quantity: number
      used_in_recipes: string[]
      potentially_shareable: boolean
    }

    const itemMap = new Map<string, ShoppingItem>()

    for (const recipe of args.recipes) {
      const seenInRecipe = new Set<string>()
      for (const ing of recipe.ingredients) {
        if (ing.is_condiment) continue
        if (seenInRecipe.has(ing.selling_unit_id)) continue
        seenInRecipe.add(ing.selling_unit_id)
        const isPartial = /benötigt|\d+[\.,]\d+\s*(Stk|Stück|St\.)/i.test(ing.package_info)
        const existing = itemMap.get(ing.selling_unit_id)
        if (existing) {
          existing.used_in_recipes.push(recipe.recipe_name)
          existing.quantity += ing.quantity
          if (isPartial) existing.potentially_shareable = true
        } else {
          itemMap.set(ing.selling_unit_id, {
            selling_unit_id: ing.selling_unit_id,
            name: ing.name,
            package_info: ing.package_info,
            price_cents: ing.price_cents,
            quantity: ing.quantity,
            used_in_recipes: [recipe.recipe_name],
            potentially_shareable: isPartial,
          })
        }
      }
    }

    const shopping_list = Array.from(itemMap.values()).sort(
      (a, b) => (b.price_cents ?? 0) - (a.price_cents ?? 0)
    )
    const shared_items = shopping_list.filter(i => i.used_in_recipes.length > 1)
    const total_price_cents = shopping_list.reduce((sum, i) => sum + (i.price_cents ?? 0) * i.quantity, 0)

    return {
      shopping_list,
      shared_items,
      total_price_cents,
      recipes_summary: args.recipes.map(r => ({ recipe_id: r.recipe_id, recipe_name: r.recipe_name, portions: r.portions })),
    }
  },
})

toolRegistry.register({
  name: "picnic_find_meal_combinations",
  description: `Given a pool of recipes with their ingredients, finds the best combinations of N recipes that maximizes shared ingredients (minimizing food waste from leftover partial packages).

Algorithm (chosen automatically):
- Exhaustive search when the combination space is manageable (≤ 30,000 combinations). The candidate pool is dynamically capped so C(candidates, count) stays within this limit — guarantees the optimal result.
- Greedy search when exhaustive would be too expensive: tries starting from every recipe in the pool, each time greedily picking the next recipe with the highest overlap score. Fast and finds good (not necessarily optimal) results.

Scoring: each shared non-condiment ingredient (same selling_unit_id in 2+ recipes) = +1 point; +2 bonus if package_info indicates partial usage (e.g. "0.5 Stk. benötigt") since those are the real waste-reduction wins.

Returns top_k combinations sorted by score descending, ties broken by lowest total cost.`,
  inputSchema: z.object({
    recipes: z.array(recipeIngredientInput).min(2).max(50),
    count: z.number().int().min(2).describe("Number of recipes per combination (days to plan)"),
    top_k: z.number().int().min(1).max(20).default(5).describe("How many top combinations to return"),
    maxCookingMinutes: z.number().optional().describe("Exclude recipes above this cooking time (requires cookingTimeByRecipe)"),
    maxTotalBudgetCents: z.number().optional().describe("Exclude combinations whose total cost exceeds this value"),
    cookingTimeByRecipe: z
      .array(z.object({ recipe_id: z.string(), cooking_time_minutes: z.number().nullable() }))
      .optional()
      .describe("Cooking times per recipe — from picnic_get_cookbook or picnic_get_recipes_by_category output"),
  }),
  handler: async (args) => {
    type RecipeData = (typeof args.recipes)[number]

    // Filter by cooking time
    let pool: RecipeData[] = args.recipes
    if (args.maxCookingMinutes != null) {
      if (!args.cookingTimeByRecipe) {
        return { error: "maxCookingMinutes requires cookingTimeByRecipe to be provided" }
      }
      const timeMap = new Map(args.cookingTimeByRecipe.map(r => [r.recipe_id, r.cooking_time_minutes]))
      pool = pool.filter(r => {
        const t = timeMap.get(r.recipe_id)
        return t == null || t <= args.maxCookingMinutes!
      })
    }

    if (pool.length < args.count) {
      return { error: `Not enough recipes after filtering (${pool.length} available, ${args.count} requested)` }
    }

    function nChooseK(n: number, k: number): number {
      if (k > n) return 0
      if (k === 0 || k === n) return 1
      let result = 1
      for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1)
      return Math.round(result)
    }

    type CombinationResult = {
      recipes: Array<{ recipe_id: string; recipe_name: string }>
      shared_items: Array<{ selling_unit_id: string; name: string; package_info: string; used_in_recipes: string[] }>
      total_price_cents: number
      score: number
      algorithm: "exhaustive" | "greedy"
    }

    function scoreCombination(combo: RecipeData[]) {
      const itemMap = new Map<string, { name: string; package_info: string; price_cents: number | null; recipes: string[] }>()
      for (const recipe of combo) {
        const seenInRecipe = new Set<string>()
        for (const ing of recipe.ingredients) {
          if (ing.is_condiment) continue
          if (seenInRecipe.has(ing.selling_unit_id)) continue
          seenInRecipe.add(ing.selling_unit_id)
          const existing = itemMap.get(ing.selling_unit_id)
          if (existing) {
            existing.recipes.push(recipe.recipe_name)
          } else {
            itemMap.set(ing.selling_unit_id, { name: ing.name, package_info: ing.package_info, price_cents: ing.price_cents, recipes: [recipe.recipe_name] })
          }
        }
      }
      const shared_items = Array.from(itemMap.entries())
        .filter(([, v]) => v.recipes.length > 1)
        .map(([id, v]) => ({ selling_unit_id: id, name: v.name, package_info: v.package_info, used_in_recipes: v.recipes }))
      const score = shared_items.reduce((s, item) => {
        const partial = /benötigt|\d+[\.,]\d+\s*(Stk|Stück|St\.)/i.test(item.package_info)
        return s + 1 + (partial ? 2 : 0)
      }, 0)
      const total_price_cents = Array.from(itemMap.values()).reduce((sum, v) => sum + (v.price_cents ?? 0), 0)
      return { shared_items, total_price_cents, score }
    }

    const EXHAUSTIVE_LIMIT = 30_000
    const n = args.count
    const topK = args.top_k
    const seen = new Map<string, CombinationResult>()

    function addResult(combo: RecipeData[], algorithm: "exhaustive" | "greedy") {
      const key = combo.map(r => r.recipe_id).sort().join(",")
      if (seen.has(key)) return
      const { shared_items, total_price_cents, score } = scoreCombination(combo)
      if (args.maxTotalBudgetCents == null || total_price_cents <= args.maxTotalBudgetCents) {
        seen.set(key, {
          recipes: combo.map(r => ({ recipe_id: r.recipe_id, recipe_name: r.recipe_name })),
          shared_items,
          total_price_cents,
          score,
          algorithm,
        })
      }
    }

    // Find the largest candidate pool that keeps C(pool, n) within the exhaustive limit
    let candidateCap = Math.min(pool.length, 50)
    while (candidateCap > n && nChooseK(candidateCap, n) > EXHAUSTIVE_LIMIT) {
      candidateCap--
    }

    const useExhaustive = nChooseK(candidateCap, n) <= EXHAUSTIVE_LIMIT
    const candidates = pool.slice(0, useExhaustive ? candidateCap : 50)

    if (useExhaustive) {
      function combine(start: number, current: RecipeData[]) {
        if (current.length === n) { addResult(current, "exhaustive"); return }
        for (let i = start; i <= candidates.length - (n - current.length); i++) {
          combine(i + 1, [...current, candidates[i]])
        }
      }
      combine(0, [])
    } else {
      // Greedy: start from each candidate, greedily pick highest-overlap addition each step
      for (const start of candidates) {
        const selected: RecipeData[] = [start]
        const selectedIds = new Set([start.recipe_id])
        while (selected.length < n) {
          let bestScore = -1
          let bestRecipe: RecipeData | null = null
          for (const candidate of candidates) {
            if (selectedIds.has(candidate.recipe_id)) continue
            const { score } = scoreCombination([...selected, candidate])
            if (score > bestScore) { bestScore = score; bestRecipe = candidate }
          }
          if (!bestRecipe) break
          selected.push(bestRecipe)
          selectedIds.add(bestRecipe.recipe_id)
        }
        if (selected.length === n) addResult(selected, "greedy")
      }
    }

    const results = Array.from(seen.values()).sort((a, b) => b.score - a.score || a.total_price_cents - b.total_price_cents)
    return results.slice(0, topK)
  },
})

toolRegistry.register({
  name: "picnic_add_recipe_to_cart",
  description: "Add a product to the cart in the context of a recipe (for analytics and recipe stepper UI). Uses SELLING_GROUP context so Picnic associates the item with the recipe.",
  inputSchema: z.object({
    productId: z.string().describe("The product selling unit ID"),
    recipeId: z.string().describe("The recipe ID this product belongs to"),
    count: z.number().min(1).default(1).describe("Number of units to add"),
  }),
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    // The picnic-api library incorrectly uses type "RECIPE" which is rejected by the API.
    // The correct type is "SELLING_GROUP" with selling_group_creator_type "PIM" for editorial recipes.
    // PicnicClient extends HttpClient directly, so sendRequest is on the client itself.
    return (client as unknown as { sendRequest: (method: string, path: string, body: unknown) => Promise<unknown> }).sendRequest("POST", "/cart/add_product", {
      product_id: args.productId,
      count: args.count,
      selling_unit_contexts: [{
        type: "SELLING_GROUP",
        selling_group_id: args.recipeId,
        selling_group_creator_type: "PIM",
      }],
    })
  },
})

// ─── 2FA ─────────────────────────────────────────────────────────────────────

toolRegistry.register({
  name: "picnic_verify_2fa_code",
  description: "Verify a 2FA code",
  inputSchema: verify2FAInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()

    // We bypass client.verify2FACode() because sendRequest doesn't capture response headers.
    // The Picnic API may return an updated authKey in x-picnic-auth after 2FA verification.
    const url = client.url
    const authKey = client.authKey
    const response = await fetch(`${url}/user/2fa/verify`, {
      method: "POST",
      headers: {
        "User-Agent": "okhttp/3.12.2",
        "Content-Type": "application/json; charset=UTF-8",
        ...(authKey && { "x-picnic-auth": authKey }),
        "x-picnic-agent": "30100;1.15.232-15154",
        "x-picnic-did": "3C417201548B2E3B",
      },
      body: JSON.stringify({ otp: args.code }),
    })

    if (!response.ok) {
      throw new Error(`2FA verification failed: ${response.status} ${response.statusText}`)
    }

    // Capture updated auth key if the API returns one
    const newAuthKey = response.headers.get("x-picnic-auth")
    if (newAuthKey) {
      client.authKey = newAuthKey
    }

    await saveSession()
    return {
      message: "2FA code verified",
      code: args.code,
    }
  },
})

