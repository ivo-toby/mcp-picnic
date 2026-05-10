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

// Recipe tools
//
// The Picnic recipe endpoints return a `FusionPage` — a deeply nested PML
// (Picnic Markup Language) tree that describes the rendered UI rather than
// a clean data model. The raw payload is large (a single category page
// returns 700+ recipes embedded in the layout tree) and not directly useful
// for LLM consumption, so for the listing endpoints we walk the tree and
// project a small per-recipe summary. The detail endpoint returns the raw
// page since its content (ingredients, steps) has no stable subset yet.
//
// The picnic-api `recipe.getRecipesPage()` method targets `meals-page-root`,
// which is only the navigation shell with three SUSPENSE tabs. The actual
// recipe content lives one level deeper:
//   - `cookbook-page-content`        → 30 highlighted recipes + category links
//   - `recipe_cattree_<category>`    → all recipes in a single category
// We hit those directly via `client.app.getPage(pageId)`.

/**
 * A single recipe extracted from a Picnic Fusion page.
 *
 * Fields are best-effort: `recipe_id` is reliable (it comes from the
 * Snowplow analytics context Picnic attaches to every recipe block);
 * `title`, `cooking_time`, `tagline`, and `image_id` are derived from
 * heuristics on the surrounding PML and may be absent if the layout
 * changes.
 */
interface RecipeSummary {
  recipe_id: string
  title?: string
  cooking_time?: string
  tagline?: string
  image_id?: string
}

/** Strip Picnic's inline color markers like `#(#295813)Tropisch#(#295813)`. */
function stripColorMarkers(s: string): string {
  return s.replace(/#\(#[0-9a-fA-F]{3,8}\)/g, "").trim()
}

/**
 * Walks a FusionPage tree and returns one summary per recipe block.
 *
 * Picnic tags every recipe with an analytics context whose `data.recipe_id`
 * is the stable recipe ID. We find each such block, then collect every
 * RICH_TEXT and IMAGE descendant within it to derive a human-readable
 * title, cooking time, optional tagline, and lead image.
 *
 * Title heuristic: longest plain markdown string in the block (works for
 * both the cookbook layout — `[tagline, title, time]` — and the category
 * layout — `[title, time, "Nieuw"]`). Cooking time: a string matching
 * `<digits> min[uten]`.
 */
function extractRecipesFromPage(page: unknown): RecipeSummary[] {
  const out: RecipeSummary[] = []
  const seen = new Set<string>()

  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return
    const obj = node as Record<string, unknown>

    const analytics = obj.analytics as { contexts?: Array<{ data?: Record<string, unknown> }> } | undefined
    const recipeContext = analytics?.contexts?.find(
      (c) => typeof c?.data?.recipe_id === "string",
    )

    if (recipeContext) {
      const recipeId = recipeContext.data!.recipe_id as string
      if (!seen.has(recipeId)) {
        seen.add(recipeId)
        const texts: string[] = []
        const images: string[] = []
        const gather = (n: unknown): void => {
          if (!n || typeof n !== "object") return
          const m = n as Record<string, unknown>
          if (m.type === "RICH_TEXT" && typeof m.markdown === "string") {
            texts.push(stripColorMarkers(m.markdown))
          }
          if (m.type === "IMAGE") {
            const src = m.source as { id?: string } | undefined
            if (src?.id) images.push(src.id)
          }
          for (const v of Object.values(m)) {
            if (Array.isArray(v)) v.forEach(gather)
            else if (v && typeof v === "object") gather(v)
          }
        }
        gather(node)

        const cookingTime = texts.find((t) => /^\d+\s*min(uten)?$/i.test(t))
        const candidates = texts.filter(
          (t) => t && t !== cookingTime && t !== "Toevoegen" && t !== "Nieuw" && t !== "Niet alles op voorraad",
        )
        // Longest remaining candidate is the title; the next-longest (if any)
        // is the tagline (only the cookbook layout supplies one).
        const sorted = [...candidates].sort((a, b) => b.length - a.length)
        const title = sorted[0]
        const tagline = sorted[1]

        const summary: RecipeSummary = { recipe_id: recipeId }
        if (title) summary.title = title
        if (cookingTime) summary.cooking_time = cookingTime
        if (tagline && tagline !== title) summary.tagline = tagline
        if (images[0]) summary.image_id = images[0]
        out.push(summary)
      }
      // Don't descend into a recipe block — its inner items are duplicate
      // analytics contexts for the same recipe.
      return
    }

    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v === "object") visit(v)
    }
  }

  visit(page)
  return out
}

/**
 * Returns the list of recipe-category page IDs linked from a Fusion page.
 * Picnic embeds them as deeplinks like
 * `nl.picnic-supermarkt://store/page;id=recipe_cattree_20minuten`.
 * The returned IDs strip the `recipe_cattree_` / `recipe-cattree-` prefix
 * so callers can pass them straight back into `picnic_get_recipes`.
 */
function extractRecipeCategoryIds(page: unknown): string[] {
  const found = new Set<string>()
  const visit = (node: unknown): void => {
    if (!node || typeof node !== "object") return
    const obj = node as Record<string, unknown>
    if (obj.actionType === "OPEN" && typeof obj.target === "string") {
      const match = obj.target.match(/id=recipe[_-]cattree[_-]([a-z0-9_-]+)/i)
      if (match) found.add(match[1])
    }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v === "object") visit(v)
    }
  }
  visit(page)
  return [...found]
}

// Get recipes tool
const getRecipesInputSchema = z.object({
  category: z
    .string()
    .optional()
    .describe(
      "Optional recipe category ID (e.g. '20minuten', 'vega', 'eenpans'). " +
        "When omitted, returns the cookbook highlights (~30 recipes) along with " +
        "the list of available categories. When provided, returns the recipes " +
        "in that category. Pass either the bare ID or a full 'recipe_cattree_xyz' / " +
        "'recipe-cattree-xyz' page ID.",
    ),
  limit: z
    .number()
    .min(1)
    .max(100)
    .default(20)
    .describe("Maximum number of recipes to return (1-100, default: 20)"),
  offset: z
    .number()
    .min(0)
    .default(0)
    .describe("Number of recipes to skip for pagination (default: 0)"),
  full: z
    .boolean()
    .default(false)
    .describe(
      "When false (default), returns a filtered list of {recipe_id, title, " +
        "cooking_time, tagline?, image_id?}. When true, returns the raw FusionPage.",
    ),
})

toolRegistry.register({
  name: "picnic_get_recipes",
  description:
    "Browse recipes from the Picnic cookbook. Without a category, returns " +
    "highlighted recipes plus the list of available categories. With a " +
    "category, returns the recipes in that category (a single category can " +
    "contain hundreds of recipes; use limit/offset to page through). Use " +
    "`picnic_get_recipe_details` afterwards to get ingredients and steps for a " +
    "specific recipe.",
  inputSchema: getRecipesInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()

    // Accept either a bare category id or a full page id; normalise to the
    // page id Picnic expects. Picnic's IDs use both '_' and '-' as separators
    // so we don't try to canonicalise — we pass through what the caller sent
    // when it already contains the prefix.
    let pageId: string
    if (args.category) {
      pageId = /^recipe[_-]cattree[_-]/i.test(args.category)
        ? args.category
        : `recipe_cattree_${args.category}`
    } else {
      pageId = "cookbook-page-content"
    }

    const page = await client.app.getPage(pageId)

    if (args.full) {
      return page
    }

    const allRecipes = extractRecipesFromPage(page)
    const startIndex = args.offset ?? 0
    const limit = args.limit ?? 20
    const paginated = allRecipes.slice(startIndex, startIndex + limit)

    const result: Record<string, unknown> = {
      pageId,
      recipes: paginated,
      pagination: {
        offset: startIndex,
        limit,
        returned: paginated.length,
        total: allRecipes.length,
        hasMore: startIndex + limit < allRecipes.length,
      },
    }

    // Only the cookbook root carries category navigation; surface it so the
    // LLM knows what to drill into next.
    if (!args.category) {
      result.categories = extractRecipeCategoryIds(page)
    }

    return result
  },
})

// Get recipe details tool
//
// `client.recipe.getRecipeDetailsPage()` in picnic-api targets the
// `recipe-details-page-root` page id, which Picnic has retired and now
// returns "page-template not found". The live page is served at
// `selling-group-details-page?selling_group_id=<recipe_id>`, so we go
// directly through `client.app.getPage()` instead.
//
// The response is a 1.7MB Fusion page; the projection below pulls out
// the four ingredient sections (CORE / CORE_STOCKABLE / CUPBOARD /
// COMPLEMENTARY), cooking steps, the variation tip, and recipe metadata.
// Pass `full: true` to bypass the projection and get the raw FusionPage.

interface RecipeIngredient {
  selling_unit_id?: string
  ingredient_id?: string
  name?: string
  brand?: string
  /** Display price in cents (e.g. 399 for €3.99). */
  price?: number
  unit_quantity?: string
  /** How much of the product the recipe needs, e.g. "75 g". */
  needed?: string
  /** Default per-portion count Picnic ships with the recipe. */
  quantity?: number
  /** Whether Picnic pre-checks this item — pantry items are typically false. */
  checked?: boolean
}

interface RecipeDetails {
  recipe_id: string
  name?: string
  tagline?: string
  description?: string
  cooking_time?: string
  portions?: number
  image_id?: string
  /** Items in the "Ingrediënten" tab — the core shopping list. */
  ingredients: RecipeIngredient[]
  /** Items under "Waarschijnlijk nog in huis" — likely already in your pantry. */
  likely_in_stock: RecipeIngredient[]
  /** Items under "Uit eigen keuken" — pantry staples (salt, pepper, oil). */
  pantry: RecipeIngredient[]
  /** Items under "Combineer met" — suggested complementary products. */
  complementary: RecipeIngredient[]
  /** Numbered cooking steps in order. */
  steps: string[]
  /** The variation tip from the "Tip" section, if present. */
  tip?: string
}

/** Picnic uses `#(#hexcolor)text#(#hexcolor)` markers around colored text. */
function stripMd(s: string): string {
  return s
    .replace(/#\(#[0-9a-fA-F]{3,8}\)/g, "")
    .replace(/\*\*/g, "")
    .trim()
}

/**
 * Walk the tree and find the first node with the given `id`. Picnic uses
 * stable ids on both BLOCK and PML nodes (e.g. `sellable-components-CORE-list`
 * is a BLOCK, while `instructions-section` is a PML inside `instructions-block`),
 * so we don't constrain on `type`.
 */
function findNodeById(node: unknown, id: string): unknown {
  if (!node || typeof node !== "object") return null
  const obj = node as Record<string, unknown>
  if (obj.id === id) return obj
  for (const v of Object.values(obj)) {
    if (Array.isArray(v)) {
      for (const c of v) {
        const r = findNodeById(c, id)
        if (r) return r
      }
    } else if (v && typeof v === "object") {
      const r = findNodeById(v, id)
      if (r) return r
    }
  }
  return null
}

/** Walk the tree and collect every `selling_units` array we encounter. */
function collectSellingUnitsArrays(node: unknown): Array<Record<string, unknown>[]> {
  const out: Array<Record<string, unknown>[]> = []
  const visit = (n: unknown): void => {
    if (!n || typeof n !== "object") return
    const obj = n as Record<string, unknown>
    if (Array.isArray(obj.selling_units) && obj.selling_units.length > 0) {
      out.push(obj.selling_units as Record<string, unknown>[])
    }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v === "object") visit(v)
    }
  }
  visit(node)
  return out
}

/**
 * Build a lookup table mapping `ingredient_id` to the structured
 * `selling_units` entry, deduping across the multiple containers Picnic
 * embeds in the page tree.
 */
function buildIngredientLookup(page: unknown): Map<string, Record<string, unknown>> {
  const lookup = new Map<string, Record<string, unknown>>()
  for (const arr of collectSellingUnitsArrays(page)) {
    for (const entry of arr) {
      const id = entry.ingredient_id
      if (typeof id === "string" && !lookup.has(id)) {
        lookup.set(id, entry)
      }
    }
  }
  return lookup
}

/**
 * Extract the recipe metadata container — the only `selling_units`-bearing
 * object that also carries `recipe_name` and `portions`. Picnic embeds
 * several copies; we take the first.
 */
function findRecipeMetaContainer(page: unknown): Record<string, unknown> | null {
  let result: Record<string, unknown> | null = null
  const visit = (n: unknown): void => {
    if (result || !n || typeof n !== "object") return
    const obj = n as Record<string, unknown>
    if (
      Array.isArray(obj.selling_units) &&
      typeof obj.recipe_name === "string" &&
      typeof obj.portions === "number"
    ) {
      result = obj
      return
    }
    for (const v of Object.values(obj)) {
      if (Array.isArray(v)) v.forEach(visit)
      else if (v && typeof v === "object") visit(v)
    }
  }
  visit(page)
  return result
}

/**
 * Extract the per-tile ingredient summary from a leaf list block (e.g.
 * `sellable-components-CORE-list`). Each direct child is a PML "tile"
 * whose id encodes the `ingredient_id` and whose RICH_TEXT descendants
 * carry name, brand, price, unit_quantity, and the "(N g nodig)" needed
 * label.
 */
function extractIngredientsFromList(
  listBlock: unknown,
  lookup: Map<string, Record<string, unknown>>,
): RecipeIngredient[] {
  if (!listBlock || typeof listBlock !== "object") return []
  const block = listBlock as Record<string, unknown>
  const children = Array.isArray(block.children) ? block.children : []
  const items: RecipeIngredient[] = []

  for (const child of children) {
    if (!child || typeof child !== "object") continue
    const tile = child as Record<string, unknown>
    const tileId = typeof tile.id === "string" ? tile.id : ""
    const ingredientMatch = tileId.match(/core-wide-selling-unit-tile-(.+)$/)
    const ingredientId = ingredientMatch ? ingredientMatch[1] : undefined

    const texts: string[] = []
    const gather = (n: unknown): void => {
      if (!n || typeof n !== "object") return
      const m = n as Record<string, unknown>
      if (m.type === "RICH_TEXT" && typeof m.markdown === "string") {
        texts.push(stripMd(m.markdown))
      }
      for (const v of Object.values(m)) {
        if (Array.isArray(v)) v.forEach(gather)
        else if (v && typeof v === "object") gather(v)
      }
    }
    gather(child)

    // Filter out chevrons and empty strings; the order Picnic uses is
    // [name, brand?, price, unit_quantity, "(N <unit> nodig)"?, promo?].
    const cleaned = texts.filter((t) => t && t !== ">")
    const needed = cleaned
      .map((t) => t.match(/^\(([^)]+)\s*nodig\)$/i)?.[1]?.trim())
      .find((t): t is string => Boolean(t))
    // Picnic uses `.` as decimal separator in NL and `,` in DE.
    const priceStr = cleaned.find((t) => /^\d+[.,]\d{2}$/.test(t))
    const priceCents = priceStr
      ? Math.round(parseFloat(priceStr.replace(",", ".")) * 100)
      : undefined
    const unitQuantity = cleaned.find((t) => /^\d+(\.\d+)?\s*(g|gram|ml|l|kg|stuk|stuks)\b/i.test(t))

    // Name is the first non-special text. Brand (if present) is the next
    // non-numeric, non-promo, non-needed text after the name. Brands on
    // Picnic are short labels (no full sentences); guard against trailing
    // prose (e.g. allergen notes) bleeding into the brand slot.
    const specials = new Set<string>(
      [needed, priceStr, unitQuantity, "Voeg ingrediënt toe"].filter(
        (s): s is string => Boolean(s),
      ),
    )
    const promoRe = /^\d+\s+voor\s+€/i
    const looksLikeNumberOrPromo = (t: string) =>
      promoRe.test(t) || /^\(.*nodig\)$/i.test(t) || /^\d/.test(t)
    const looksLikeBrand = (t: string) => t.length <= 40 && !/[.!?]/.test(t)
    const nonSpecial = cleaned.filter((t) => !specials.has(t) && !looksLikeNumberOrPromo(t))
    const name = nonSpecial[0]
    const brand = nonSpecial[1] && looksLikeBrand(nonSpecial[1]) ? nonSpecial[1] : undefined

    const lookupEntry = ingredientId ? lookup.get(ingredientId) : undefined
    const sellingUnitId =
      typeof lookupEntry?.selling_unit_id === "string" ? lookupEntry.selling_unit_id : undefined
    const quantity = typeof lookupEntry?.quantity === "number" ? lookupEntry.quantity : undefined
    const checked = typeof lookupEntry?.checked === "boolean" ? lookupEntry.checked : undefined

    const item: RecipeIngredient = {}
    if (sellingUnitId) item.selling_unit_id = sellingUnitId
    if (ingredientId) item.ingredient_id = ingredientId
    if (name) item.name = name
    if (brand) item.brand = brand
    if (priceCents !== undefined) item.price = priceCents
    if (unitQuantity) item.unit_quantity = unitQuantity
    if (needed) item.needed = needed
    if (quantity !== undefined) item.quantity = quantity
    if (checked !== undefined) item.checked = checked

    if (item.name || item.selling_unit_id) items.push(item)
  }

  return items
}

/**
 * Parse the `instructions-section` block, which contains an alternating
 * sequence of `Stap N` headers / step text, optionally followed by a
 * `Tip` header / tip text.
 */
function extractStepsAndTip(page: unknown): { steps: string[]; tip?: string } {
  const block = findNodeById(page, "instructions-section")
  if (!block) return { steps: [] }

  const texts: string[] = []
  const gather = (n: unknown): void => {
    if (!n || typeof n !== "object") return
    const m = n as Record<string, unknown>
    if (m.type === "RICH_TEXT" && typeof m.markdown === "string") {
      texts.push(stripMd(m.markdown))
    }
    for (const v of Object.values(m)) {
      if (Array.isArray(v)) v.forEach(gather)
      else if (v && typeof v === "object") gather(v)
    }
  }
  gather(block)

  const steps: string[] = []
  let tip: string | undefined
  for (let i = 0; i < texts.length; i++) {
    if (/^Stap\s+\d+$/i.test(texts[i]) && texts[i + 1]) {
      steps.push(texts[i + 1])
      i += 1
    } else if (/^Tip$/i.test(texts[i]) && texts[i + 1]) {
      tip = texts[i + 1]
      i += 1
    }
  }
  return { steps, tip }
}

/**
 * Project a `selling-group-details-page` Fusion response into a clean
 * recipe summary. Designed to be resilient to missing sections — any
 * sub-extractor returning empty just yields an empty array / undefined.
 */
function extractRecipeDetails(page: unknown, recipeId: string): RecipeDetails {
  const meta = findRecipeMetaContainer(page)
  const headerBlock = findNodeById(page, "sellable-header-container")
  const imageBlock = findNodeById(page, "selling-group-details-image-wrapper")

  // Header texts come in [tagline, name, description] order.
  const headerTexts: string[] = []
  const gatherText = (n: unknown): void => {
    if (!n || typeof n !== "object") return
    const m = n as Record<string, unknown>
    if (m.type === "RICH_TEXT" && typeof m.markdown === "string") {
      headerTexts.push(stripMd(m.markdown))
    }
    for (const v of Object.values(m)) {
      if (Array.isArray(v)) v.forEach(gatherText)
      else if (v && typeof v === "object") gatherText(v)
    }
  }
  gatherText(headerBlock)

  // Image block — first IMAGE node carries the recipe hero.
  let imageId: string | undefined
  const gatherImage = (n: unknown): void => {
    if (imageId || !n || typeof n !== "object") return
    const m = n as Record<string, unknown>
    if (m.type === "IMAGE") {
      const src = m.source as { id?: string } | undefined
      if (src?.id) {
        imageId = src.id
        return
      }
    }
    for (const v of Object.values(m)) {
      if (Array.isArray(v)) v.forEach(gatherImage)
      else if (v && typeof v === "object") gatherImage(v)
    }
  }
  gatherImage(imageBlock)

  // Cooking time: first RICH_TEXT in the page that matches `<digits> min[uten]`.
  let cookingTime: string | undefined
  const visitForTime = (n: unknown): void => {
    if (cookingTime || !n || typeof n !== "object") return
    const m = n as Record<string, unknown>
    if (m.type === "RICH_TEXT" && typeof m.markdown === "string") {
      const t = stripMd(m.markdown)
      if (/^\d+\s*min(uten)?$/i.test(t)) {
        cookingTime = t
        return
      }
    }
    for (const v of Object.values(m)) {
      if (Array.isArray(v)) v.forEach(visitForTime)
      else if (v && typeof v === "object") visitForTime(v)
    }
  }
  visitForTime(page)

  const lookup = buildIngredientLookup(page)
  const ingredients = extractIngredientsFromList(
    findNodeById(page, "sellable-components-CORE-list"),
    lookup,
  )
  const likelyInStock = extractIngredientsFromList(
    findNodeById(page, "sellable-components-CORE_STOCKABLE-list"),
    lookup,
  )
  const pantry = extractIngredientsFromList(
    findNodeById(page, "sellable-components-CUPBOARD-list"),
    lookup,
  )
  const complementary = extractIngredientsFromList(
    findNodeById(page, "sellable-components-COMPLEMENTARY-list"),
    lookup,
  )
  const { steps, tip } = extractStepsAndTip(page)

  const result: RecipeDetails = {
    recipe_id: recipeId,
    ingredients,
    likely_in_stock: likelyInStock,
    pantry,
    complementary,
    steps,
  }
  if (meta && typeof meta.recipe_name === "string") result.name = meta.recipe_name
  else if (headerTexts[1]) result.name = headerTexts[1]
  if (headerTexts[0] && headerTexts[0] !== result.name) result.tagline = headerTexts[0]
  if (headerTexts[2] && headerTexts[2] !== result.tagline) result.description = headerTexts[2]
  if (cookingTime) result.cooking_time = cookingTime
  if (meta && typeof meta.portions === "number") result.portions = meta.portions
  if (imageId) result.image_id = imageId
  if (tip) result.tip = tip
  return result
}

const recipeDetailsInputSchema = z.object({
  recipeId: z.string().min(1).describe("The ID of the recipe to get details for"),
  full: z
    .boolean()
    .default(false)
    .describe(
      "When false (default), returns a filtered projection with ingredients, " +
        "pantry items, cooking steps, and the variation tip. When true, returns " +
        "the raw FusionPage (~1.7MB).",
    ),
})

toolRegistry.register({
  name: "picnic_get_recipe_details",
  description:
    "Get the detail page for a single Picnic recipe by ID. Returns the recipe " +
    "name, cooking time, default portions, image, and four ingredient sections " +
    "(core ingredients, items likely already in stock, pantry staples 'uit eigen " +
    "keuken', and complementary suggestions), plus the numbered cooking steps " +
    "and the variation tip if present. Each ingredient includes its " +
    "selling_unit_id (usable with cart tools), name, brand, price (cents), " +
    "unit_quantity, and the amount needed for the recipe. Set `full: true` to " +
    "get the raw 1.7MB FusionPage instead.",
  inputSchema: recipeDetailsInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()

    // Fetch the live page directly: picnic-api's `recipe.getRecipeDetailsPage`
    // hardcodes a retired page-template id and 404s. The actual live page is
    // served as `selling-group-details-page` keyed by `selling_group_id`,
    // which is the same identifier as the recipe id.
    const page = await client.app.getPage(
      `selling-group-details-page?selling_group_id=${encodeURIComponent(args.recipeId)}`,
    )

    if (args.full) {
      return page
    }

    return extractRecipeDetails(page, args.recipeId)
  },
})

// Save recipe tool
const saveRecipeInputSchema = z.object({
  recipeId: z.string().describe("The ID of the recipe to save"),
})

toolRegistry.register({
  name: "picnic_save_recipe",
  description: "Save a recipe to the user's saved recipes list",
  inputSchema: saveRecipeInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    await client.recipe.saveRecipe(args.recipeId)
    return {
      message: "Recipe saved",
      recipeId: args.recipeId,
    }
  },
})

// Unsave recipe tool
const unsaveRecipeInputSchema = z.object({
  recipeId: z.string().describe("The ID of the recipe to unsave"),
})

toolRegistry.register({
  name: "picnic_unsave_recipe",
  description: "Remove a recipe from the user's saved recipes list",
  inputSchema: unsaveRecipeInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    await client.recipe.unsaveRecipe(args.recipeId)
    return {
      message: "Recipe unsaved",
      recipeId: args.recipeId,
    }
  },
})

// Note: recipe-context cart mutations (add/remove product with recipe context)
// were intentionally left out. The selling_unit_id returned from
// `picnic_get_recipe_details` is the same id used by `picnic_add_to_cart` and
// `picnic_remove_from_cart`, so callers can mutate the cart directly without
// the extra recipe-stepper analytics context that the dedicated endpoints
// would attach.

