import { z } from "zod"
import { toolRegistry } from "./registry.js"
import {
  getPicnicClient,
  initializePicnicClient,
  saveSession,
  verifyPicnic2FACode,
} from "../utils/picnic-client.js"
import {
  resolveRecipeId,
  parseSellingGroupRecipe,
  parseRecipeList,
  buildRecipeSourceUrl,
} from "../utils/recipe-parser.js"
import {
  buildShoppingList,
  findMealCombinations,
  parseRecipeIngredients,
} from "../utils/recipe-meal-planning.js"
import { config } from "../config.js"

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
  } catch {
    // Client not initialized, initialize it now
    await initializePicnicClient()
  }
}

/**
 * Runs a cart mutation, converting failures into an explicitly ambiguous error.
 *
 * Picnic applies the mutation and renders the updated cart in the same request, so a
 * non-2xx response does not mean the write was rejected — it may already have landed and
 * only the render failed. A caller that reads such an error as "nothing happened" will
 * retry, and each retry applies the change again. Say so instead of reporting a clean
 * failure, and point the caller at a read rather than a retry.
 */
async function mutateCart<T>(action: string, mutation: () => Promise<T>): Promise<T> {
  try {
    return await mutation()
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    throw new Error(
      `${action} failed: ${message}. The cart may still have been modified — ` +
        `call picnic_get_cart to check the current contents before retrying, ` +
        `because retrying can apply the change a second time.`,
    )
  }
}

// Annotations shared by every tool that mutates cart contents. Tells the calling model the
// operation is not safe to blindly retry (see mutateCart above).
const CART_MUTATION_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
} as const

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
      decorators?: Array<{ type?: string; text?: string; id?: string }>
      items?: Array<{
        id?: string
        name?: string
        unit_quantity?: string
        price?: number
        image_ids?: string[]
        max_count?: number
        decorators?: Array<{ type?: string; quantity?: number }>
      }>
    }>
    total_count?: number
    total_price?: number
    checkout_total_price?: number
    total_savings?: number
  }

  const filteredItems = cartObj.items?.map((orderLine) => {
    const decorator = (type: string) => orderLine.decorators?.find((d) => d.type === type)
    // The label for this line's own discount ("15% Rabatt"). Note the line `price` below is
    // the price BEFORE this promotion: Picnic deducts promotions at cart level, so the line
    // prices sum to more than `total_price`, and the difference is `total_savings`. Several
    // lines can carry different promotions at once, so `total_savings` is the total across
    // all of them and must not be attributed to any single label.
    const promotion = decorator("PROMO")?.text
    // BASKET_GROUP holds the selling-group id, i.e. the recipe this line came from — the same
    // id picnic_add_recipe_to_cart takes. Without it there is no way to tell which lines a
    // recipe contributed, and so no way to undo one with picnic_remove_recipe_from_cart.
    const recipeId = decorator("BASKET_GROUP")?.id

    return {
      order_line_id: orderLine.id,
      price: orderLine.display_price || orderLine.price,
      ...(promotion && { promotion }),
      ...(recipeId && { recipe_id: recipeId }),
      articles: orderLine.items?.map((article) => ({
        product_id: article.id,
        name: article.name,
        unit: article.unit_quantity,
        price: article.price,
        // How many of this article are in the cart. Picnic carries it in a QUANTITY decorator
        // rather than a plain field; without it a caller cannot tell one unit from three, so it
        // cannot check whether an ambiguous add actually landed (see mutateCart).
        quantity: article.decorators?.find((d) => d.type === "QUANTITY")?.quantity ?? 1,
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

type UnknownRecord = Record<string, unknown>

interface PicnicPromotionProduct {
  product_id: string
  promotion_id: string
  name: string
  price: number
  unit?: string
  promotion_label?: string
  original_price?: number
  image_id?: string
  max_count?: number
}

function isRecord(value: unknown): value is UnknownRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value))
}

function getRecordProperty(record: UnknownRecord, key: string): UnknownRecord | null {
  const value = record[key]
  return isRecord(value) ? value : null
}

function getPromotionContext(tile: UnknownRecord): UnknownRecord | null {
  const analytics = getRecordProperty(tile, "analytics")
  const contexts = analytics?.contexts
  if (!Array.isArray(contexts)) return null

  for (const context of contexts) {
    if (!isRecord(context)) continue
    const data = getRecordProperty(context, "data")
    if (typeof data?.promotion_id === "string") return data
  }

  return null
}

function toPromotionProduct(tile: UnknownRecord): PicnicPromotionProduct | null {
  const content = getRecordProperty(tile, "content")
  const sellingUnit = content ? getRecordProperty(content, "sellingUnit") : null
  const promotion = getPromotionContext(tile)

  if (!sellingUnit || !promotion) return null
  if (typeof sellingUnit.id !== "string" || typeof sellingUnit.name !== "string") return null
  if (typeof promotion.promotion_id !== "string") return null

  const price =
    typeof promotion.price === "number"
      ? promotion.price
      : typeof sellingUnit.display_price === "number"
        ? sellingUnit.display_price
        : null
  if (price === null) return null

  return {
    product_id: sellingUnit.id,
    promotion_id: promotion.promotion_id,
    name: sellingUnit.name,
    price,
    ...(typeof sellingUnit.unit_quantity === "string" && { unit: sellingUnit.unit_quantity }),
    ...(typeof promotion.promotion_label === "string" && {
      promotion_label: promotion.promotion_label,
    }),
    ...(typeof promotion.strikethrough_price === "number" &&
      promotion.show_strikethrough_price !== false && {
        original_price: promotion.strikethrough_price,
      }),
    ...(typeof sellingUnit.image_id === "string" && { image_id: sellingUnit.image_id }),
    ...(typeof sellingUnit.max_count === "number" && { max_count: sellingUnit.max_count }),
  }
}

function extractPromotionsFromPage(page: unknown): PicnicPromotionProduct[] {
  const promotions: PicnicPromotionProduct[] = []
  const seen = new Set<string>()

  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }

    if (!isRecord(node)) return

    const promotion = toPromotionProduct(node)
    if (promotion) {
      const key = `${promotion.product_id}:${promotion.promotion_id}`
      if (!seen.has(key)) {
        seen.add(key)
        promotions.push(promotion)
      }
    }

    for (const value of Object.values(node)) visit(value)
  }

  visit(page)
  return promotions
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

// Weekly promotions/deals tool
const promotionsInputSchema = z.object({
  limit: z
    .number()
    .min(1)
    .max(100)
    .default(25)
    .describe("Maximum number of promotions to return (1-100, default: 25)"),
  offset: z
    .number()
    .min(0)
    .default(0)
    .describe("Number of promotions to skip for pagination (default: 0)"),
})

toolRegistry.register({
  name: "picnic_get_promotions",
  description:
    "Get Picnic's current weekly promotions/deals from the app's 'Alle acties' page. " +
    "Returns promoted products with current price, promotion label, original price when shown, " +
    "and pagination.",
  inputSchema: promotionsInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const page = await client.sendRequest(
      "GET",
      "/pages/promo-page-all-promos-redirect",
      null,
      true,
    )
    const allPromotions = extractPromotionsFromPage(page)

    const startIndex = args.offset ?? 0
    const limit = args.limit ?? 25
    const promotions = allPromotions.slice(startIndex, startIndex + limit)

    return {
      source: {
        pageId: "promo-page-all-promos-redirect",
        endpoint: "/pages/promo-page-all-promos-redirect",
      },
      promotions,
      pagination: {
        offset: startIndex,
        limit,
        returned: promotions.length,
        total: allPromotions.length,
        hasMore: startIndex + limit < allPromotions.length,
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

// Recipe tools
//
// Picnic recipes are "selling groups". Recipe detail comes from
// /pages/selling-group-details-page?selling_group_id=<id>, and the cookbook /
// recipe overview from /pages/cookbook-page-content. These page routes are
// called directly via sendRequest because the picnic-api recipe.* page methods
// target outdated ids (recipe-details-page-root) that the API answers with 404.

// Base URL for recipe/product image derivatives, derived from the API URL, e.g.
// https://storefront-prod.de.picnicinternational.com/static/images
function recipeImageBaseUrl(client: ReturnType<typeof getPicnicClient>): string {
  return client.url.replace(/\/api\/.*$/, "/static/images")
}

const RECIPE_CATEGORY_INPUT_RE = /^(?:recipe[_-]cattree[_-])?[a-z0-9]+(?:[a-z0-9_-]*[a-z0-9])?$/i
const RECIPE_CATEGORY_PAGE_ID_RE = /recipe[_-]cattree[_-][a-z0-9]+(?:[a-z0-9_-]*[a-z0-9])?/gi
const RECIPE_CATEGORY_PREFIX_RE = /^recipe[_-]cattree[_-]/i

async function fetchRecipePage(client: ReturnType<typeof getPicnicClient>, pageId: string) {
  const page = await client.sendRequest("GET", `/pages/${pageId}`, null, true)
  return { pageId, page }
}

async function fetchRecipeListPage(client: ReturnType<typeof getPicnicClient>, category?: string) {
  if (!category) return fetchRecipePage(client, "cookbook-page-content")

  if (RECIPE_CATEGORY_PREFIX_RE.test(category)) {
    return fetchRecipePage(client, category)
  }

  const underscorePageId = `recipe_cattree_${category}`
  try {
    return await fetchRecipePage(client, underscorePageId)
  } catch (error) {
    const dashPageId = `recipe-cattree-${category}`
    try {
      return await fetchRecipePage(client, dashPageId)
    } catch {
      throw error
    }
  }
}

function extractRecipeCategoryIds(page: unknown): string[] {
  const ids = new Set<string>()

  const visit = (node: unknown): void => {
    if (typeof node === "string") {
      for (const match of node.matchAll(RECIPE_CATEGORY_PAGE_ID_RE)) ids.add(match[0])
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (!node || typeof node !== "object") return
    for (const value of Object.values(node as Record<string, unknown>)) visit(value)
  }

  visit(page)
  return [...ids]
}

async function fetchCookbookRecipes(client: ReturnType<typeof getPicnicClient>) {
  const { page } = await fetchRecipeListPage(client)
  return parseRecipeList(page, { imageBaseUrl: recipeImageBaseUrl(client) })
}

function paginateRecipes(all: ReturnType<typeof parseRecipeList>, offset: number, limit: number) {
  const startIndex = offset || 0
  const recipes = all.slice(startIndex, startIndex + limit).map((recipe) => ({
    ...recipe,
    sourceUrl: buildRecipeSourceUrl(config.PICNIC_COUNTRY_CODE, recipe.recipeId),
  }))
  return {
    recipes,
    pagination: {
      offset: startIndex,
      limit,
      returned: recipes.length,
      total: all.length,
      hasMore: startIndex + limit < all.length,
    },
  }
}

// Get recipe tool
const getRecipeInputSchema = z.object({
  recipe_url_or_id: z
    .string()
    .min(1)
    .describe(
      "A Picnic recipe URL (any format) or a 24-character hex recipe ID. " +
        "Examples: 'https://picnic.app/de/go/abc123', " +
        "'https://picnic.app/de/rezepte/0123456789abcdef01234567/example-recipe', " +
        "'0123456789abcdef01234567'",
    ),
})

toolRegistry.register({
  name: "picnic_get_recipe",
  description:
    "Fetch a Picnic recipe by URL or recipe ID. Returns structured recipe data: name, " +
    "description, ingredients, preparation steps, timing, servings, image URL, saved state, " +
    "and the canonical source URL. Accepts short share links (picnic.app/de/go/xxx), full " +
    "recipe URLs, or bare recipe IDs.",
  inputSchema: getRecipeInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const recipeId = await resolveRecipeId(args.recipe_url_or_id)
    const page = await client.sendRequest(
      "GET",
      `/pages/selling-group-details-page?selling_group_id=${encodeURIComponent(recipeId)}`,
      null,
      true,
    )
    const parsed = parseSellingGroupRecipe(page, { imageBaseUrl: recipeImageBaseUrl(client) })
    const sourceUrl = buildRecipeSourceUrl(config.PICNIC_COUNTRY_CODE, recipeId)
    return { recipeId, sourceUrl, ...parsed }
  },
})

// Browse / saved recipes
const recipeListInputSchema = z.object({
  category: z
    .string()
    .regex(
      RECIPE_CATEGORY_INPUT_RE,
      "Use a bare recipe category ID or a full recipe_cattree/recipe-cattree page ID.",
    )
    .optional()
    .describe(
      "Recipe category ID, such as '20minuten', or full page ID, such as 'recipe-cattree-jamie-oliver'.",
    ),
  limit: z
    .number()
    .min(1)
    .max(100)
    .default(25)
    .describe("Maximum number of recipes to return (1-100, default: 25)"),
  offset: z
    .number()
    .min(0)
    .default(0)
    .describe("Number of recipes to skip for pagination (default: 0)"),
})

toolRegistry.register({
  name: "picnic_browse_recipes",
  description:
    "Browse Picnic's recipe/cookbook overview or a specific recipe category. Returns a " +
    "paginated list of recipes (id, name, image URL, cookbook section, source URL) and " +
    "category page IDs when available. Use the recipeId with picnic_get_recipe for full details.",
  inputSchema: recipeListInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const { pageId, page } = await fetchRecipeListPage(client, args.category)
    const all = parseRecipeList(page, { imageBaseUrl: recipeImageBaseUrl(client) })
    const result = { pageId, ...paginateRecipes(all, args.offset ?? 0, args.limit ?? 25) }
    const categories = extractRecipeCategoryIds(page)
    if ((!args.category || all.length === 0) && categories.length > 0) {
      return { ...result, categories }
    }
    return result
  },
})

toolRegistry.register({
  name: "picnic_get_saved_recipes",
  description:
    "List the recipes the user has saved/favourited in their Picnic cookbook (the " +
    "'Gespeichert' tab), distinct from the public discovery feed. Returns id, name, image URL " +
    "and source URL — useful for importing saved recipes elsewhere.",
  inputSchema: recipeListInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const all = await fetchCookbookRecipes(client)
    const saved = all.filter((recipe) => recipe.segments.includes("SAVED_RECIPES"))
    return paginateRecipes(saved, args.offset ?? 0, args.limit ?? 25)
  },
})

toolRegistry.register({
  name: "picnic_get_own_recipes",
  description:
    "List the user's own recipes (the cookbook 'Eigene Rezepte' tab — user-created recipes). " +
    "Returns id, name, image URL and source URL.",
  inputSchema: recipeListInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const all = await fetchCookbookRecipes(client)
    const own = all.filter((recipe) => recipe.segments.includes("USER_DEFINED_RECIPES"))
    return paginateRecipes(own, args.offset ?? 0, args.limit ?? 25)
  },
})

// Save / unsave recipe
const recipeRefInputSchema = z.object({
  recipe_url_or_id: z
    .string()
    .min(1)
    .describe("A Picnic recipe URL (any format) or a 24-character hex recipe ID."),
})

toolRegistry.register({
  name: "picnic_save_recipe",
  description: "Save a recipe to the user's Picnic cookbook, by URL or recipe ID.",
  inputSchema: recipeRefInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const recipeId = await resolveRecipeId(args.recipe_url_or_id)
    await client.sendRequest(
      "POST",
      "/pages/task/recipe-saving",
      { payload: { recipe_id: recipeId, saved_at: new Date().toISOString() } },
      true,
    )
    return { message: "Recipe saved", recipeId }
  },
})

toolRegistry.register({
  name: "picnic_unsave_recipe",
  description: "Remove a recipe from the user's Picnic cookbook, by URL or recipe ID.",
  inputSchema: recipeRefInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const recipeId = await resolveRecipeId(args.recipe_url_or_id)
    await client.sendRequest(
      "POST",
      "/pages/task/recipe-saving",
      { payload: { recipe_id: recipeId, saved_at: null } },
      true,
    )
    return { message: "Recipe removed from cookbook", recipeId }
  },
})

// Add a recipe's ingredients to the basket by assigning the selling group.
const addRecipeToCartInputSchema = z.object({
  recipe_url_or_id: z
    .string()
    .min(1)
    .describe("A Picnic recipe URL (any format) or a 24-character hex recipe ID."),
  portions: z
    .number()
    .min(1)
    .optional()
    .describe("Number of portions to add (defaults to the recipe's default portions)."),
})

toolRegistry.register({
  name: "picnic_add_recipe_to_cart",
  description:
    "Add a recipe's ingredients to the shopping cart by assigning the recipe (selling group) " +
    "to the basket. Optionally set the number of portions. If this fails, call picnic_get_cart " +
    "to check whether the ingredients landed before retrying.",
  inputSchema: addRecipeToCartInputSchema,
  annotations: CART_MUTATION_ANNOTATIONS,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const recipeId = await resolveRecipeId(args.recipe_url_or_id)
    const payload: { selling_group_id: string; portions?: number } = { selling_group_id: recipeId }
    if (args.portions !== undefined) payload.portions = args.portions
    await mutateCart("Adding the recipe to the cart", () =>
      client.sendRequest("POST", "/pages/task/assign-selling-group-to-basket", { payload }, true),
    )
    return {
      message: "Recipe added to cart",
      recipeId,
      ...(args.portions !== undefined && { portions: args.portions }),
    }
  },
})

// Remove a recipe's ingredients from the basket (inverse of add_recipe_to_cart).
toolRegistry.register({
  name: "picnic_remove_recipe_from_cart",
  description:
    "Remove a recipe (selling group) from the basket, undoing picnic_add_recipe_to_cart. " +
    "Removes only that recipe's ingredients, leaving the rest of the cart untouched.",
  inputSchema: recipeRefInputSchema,
  annotations: CART_MUTATION_ANNOTATIONS,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const recipeId = await resolveRecipeId(args.recipe_url_or_id)
    await mutateCart("Removing the recipe from the cart", () =>
      client.sendRequest(
        "POST",
        "/pages/task/remove-selling-group-from-basket",
        { payload: { selling_group_id: recipeId } },
        true,
      ),
    )
    return { message: "Recipe removed from cart", recipeId }
  },
})

// Recipe meal-planning tools
const recipeIngredientsInputSchema = z.object({
  recipe_url_or_id: z
    .string()
    .min(1)
    .describe("A Picnic recipe URL (any format) or a 24- or 32-character hex recipe ID."),
})

async function fetchRecipeIngredientsByRef(
  client: ReturnType<typeof getPicnicClient>,
  recipeUrlOrId: string,
) {
  const recipeId = await resolveRecipeId(recipeUrlOrId)
  const page = await client.sendRequest(
    "GET",
    `/pages/selling-group-details-page?selling_group_id=${encodeURIComponent(recipeId)}`,
    null,
    true,
  )
  const parsed = parseRecipeIngredients(page)
  if (!parsed) throw new Error(`Could not find recipe ingredient data for ${recipeId}`)
  return parsed
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

toolRegistry.register({
  name: "picnic_get_recipe_ingredients",
  description:
    "Fetch structured Picnic recipe ingredients by recipe URL or ID. Returns selling-unit IDs, " +
    "quantities, pantry flags, package display text, and prices for meal planning.",
  inputSchema: recipeIngredientsInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    return fetchRecipeIngredientsByRef(getPicnicClient(), args.recipe_url_or_id)
  },
})

toolRegistry.register({
  name: "picnic_get_multiple_recipe_ingredients",
  description:
    "Fetch structured ingredient lists for multiple Picnic recipes. Returns successful recipes " +
    "and per-input errors so one unavailable recipe does not discard the whole batch.",
  inputSchema: z.object({
    recipe_urls_or_ids: z
      .array(z.string().min(1))
      .min(1)
      .max(20)
      .describe("Picnic recipe URLs or 24-/32-character recipe IDs, up to 20."),
  }),
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const results = await Promise.allSettled(
      args.recipe_urls_or_ids.map((input) => fetchRecipeIngredientsByRef(client, input)),
    )

    return {
      recipes: results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : [])),
      errors: results.flatMap((result, index) =>
        result.status === "rejected"
          ? [{ input: args.recipe_urls_or_ids[index], error: getErrorMessage(result.reason) }]
          : [],
      ),
    }
  },
})

const recipeIngredientSchema = z.object({
  ingredientId: z.string(),
  sellingUnitId: z.string(),
  name: z.string(),
  packageInfo: z.string(),
  priceCents: z.number().nullable(),
  quantity: z.number(),
  isPantryItem: z.boolean(),
})

const structuredRecipeIngredientsSchema = z.object({
  recipeId: z.string(),
  recipeName: z.string(),
  portions: z.number(),
  ingredients: z.array(recipeIngredientSchema),
})

toolRegistry.register({
  name: "picnic_build_shopping_list",
  description:
    "Consolidate structured recipe ingredients into a shopping list. Skips pantry items, " +
    "deduplicates products per recipe, and totals priceCents times quantity.",
  inputSchema: z.object({
    recipes: z.array(structuredRecipeIngredientsSchema).min(1).max(20),
  }),
  handler: async (args) => buildShoppingList(args.recipes),
})

toolRegistry.register({
  name: "picnic_find_meal_combinations",
  description:
    "Rank combinations of structured Picnic recipes by shared non-pantry ingredients, " +
    "using the same conservative cost calculation as picnic_build_shopping_list.",
  inputSchema: z.object({
    recipes: z.array(structuredRecipeIngredientsSchema).min(2).max(50),
    count: z.number().int().min(2).describe("Number of recipes per combination."),
    topK: z
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5)
      .describe("Maximum number of combinations to return."),
    maxTotalBudgetCents: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Exclude combinations whose conservative shopping-list cost exceeds this."),
  }),
  handler: async (args) => findMealCombinations(args),
})

// Get shopping cart tool
toolRegistry.register({
  name: "picnic_get_cart",
  description:
    "Get the current shopping cart contents. Prices are in cents. An order line's `price` is " +
    "the amount BEFORE that line's own promotion, so the line prices sum to more than the " +
    "cart's `total_price`; the difference is `total_savings`. A line's `promotion` label " +
    "(e.g. '15% Rabatt') applies to that line alone — several lines can carry different " +
    "promotions, so never describe one line's percentage as applying to the cart, and never " +
    "attribute all of `total_savings` to a single promotion.",
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
  description:
    "Add a product to the shopping cart. Not idempotent: each call adds another `count` " +
    "items. If this fails, call picnic_get_cart to check whether the add landed before retrying.",
  inputSchema: addToCartInputSchema,
  annotations: CART_MUTATION_ANNOTATIONS,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const cart = await mutateCart(`Adding ${args.count} item(s) to cart`, () =>
      client.cart.addProductToCart(args.productId, args.count),
    )
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
  description:
    "Remove a product from the shopping cart. Not idempotent: each call removes another " +
    "`count` items. If this fails, call picnic_get_cart to check whether the removal landed " +
    "before retrying.",
  inputSchema: removeFromCartInputSchema,
  annotations: CART_MUTATION_ANNOTATIONS,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const cart = await mutateCart(`Removing ${args.count} item(s) from cart`, () =>
      client.cart.removeProductFromCart(args.productId, args.count),
    )
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
  annotations: CART_MUTATION_ANNOTATIONS,
  handler: async () => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const cart = await mutateCart("Clearing the cart", () => client.cart.clearCart())
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
    await verifyPicnic2FACode(args.code)
    await saveSession()

    return {
      message: "2FA code verified",
      code: args.code,
    }
  },
})
