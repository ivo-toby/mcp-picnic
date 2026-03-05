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
    items?: unknown[]
    total_count?: number
    total_price?: number
    checkout_total_price?: number
    total_savings?: number
    delivery_slots?: unknown[]
    selected_slot?: unknown
    [key: string]: unknown
  }

  // Filter items to essential info only
  const filteredItems = cartObj.items?.map((item: unknown) => {
    const itemObj = item as {
      id?: string
      name?: string
      display_price?: number
      unit_quantity?: string
      count?: number
      price?: number
      [key: string]: unknown
    }

    return {
      id: itemObj.id,
      name: itemObj.name,
      price: itemObj.display_price || itemObj.price,
      unit: itemObj.unit_quantity,
      quantity: itemObj.count,
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
    const allResults = await client.search(args.query)

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
    const suggestions = await client.getSuggestions(args.query)
    return {
      query: args.query,
      suggestions,
    }
  },
})

// Note: picnic_get_article tool removed - endpoint deprecated (GitHub issue #23)
// Use picnic_search instead for basic product information

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
    const image = await client.getImage(args.imageId, args.size)
    return {
      imageId: args.imageId,
      size: args.size,
      image,
    }
  },
})

// Get categories tool
toolRegistry.register({
  name: "picnic_get_categories",
  description: "Get product categories with flexible filtering for different use cases",
  inputSchema: z.object({
    depth: z
      .number()
      .min(0)
      .max(3)
      .default(0)
      .describe("Category depth (0=top level, 1=with subcategories)"),
    limit: z.number().min(1).max(20).default(8).describe("Maximum categories to return"),
    includeImages: z.boolean().default(false).describe("Include image IDs"),
    useCase: z
      .enum(["browse", "search", "detailed"])
      .default("browse")
      .describe("Optimize for use case"),
  }),
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const categories = await client.getCategories(args.depth)

    const catalogArray = (categories as any).catalog || []

    // Adjust filtering based on use case
    const getFieldsForUseCase = (useCase: string) => {
      switch (useCase) {
        case "search":
          return ["id", "name", "type"] // Minimal for search filtering
        case "detailed":
          return ["id", "name", "type", "level", "items_count", "items"] // More context
        default: // browse
          return ["id", "name", "type", "items_count"] // Good balance
      }
    }

    const relevantFields = getFieldsForUseCase(args.useCase || "browse")

    const limitedCatalog = catalogArray.slice(0, args.limit || 8).map((category: any) => {
      const filtered: any = {}

      relevantFields.forEach((field) => {
        if (field === "items_count") {
          filtered.items_count = category.items ? category.items.length : 0
        } else if (field === "items" && category.items && (args.depth || 0) > 0) {
          filtered.items = category.items.slice(0, 3).map((item: any) => ({
            id: item.id,
            name: item.name,
            type: item.type,
          }))
        } else if (category[field] !== undefined) {
          filtered[field] = category[field]
        }
      })

      if (args.includeImages && category.image_id) {
        filtered.image_id = category.image_id
      }

      return filtered
    })

    return {
      type: categories.type,
      catalog: limitedCatalog,
      meta: {
        total_categories: catalogArray.length,
        returned: limitedCatalog.length,
        use_case: args.useCase,
        truncated: catalogArray.length > (args.limit || 8),
        next_page_hint:
          catalogArray.length > (args.limit || 8)
            ? `Use limit=${(args.limit || 8) * 2} to see more categories`
            : null,
      },
    }
  },
})

// Get category details tool
const categoryDetailsInputSchema = z.object({
  categoryId: z.string().describe("The ID of the category to get details for"),
  includeItems: z.boolean().default(true).describe("Include items/subcategories in this category"),
  itemsLimit: z.number().min(1).max(50).default(20).describe("Maximum items to return"),
  includeImages: z.boolean().default(false).describe("Include image IDs"),
  depth: z
    .number()
    .min(0)
    .max(3)
    .default(1)
    .describe("Category depth to fetch (0=top level, 1=with subcategories)"),
})

toolRegistry.register({
  name: "picnic_get_category_details",
  description: "Get detailed information about a specific category including its items",
  inputSchema: categoryDetailsInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()

    // Find the category by ID (search recursively)
    const findCategory = (categories: any[], targetId: string): any => {
      for (const cat of categories) {
        if (cat.id === targetId) {
          return cat
        }
        if (cat.items && cat.items.length > 0) {
          const found = findCategory(cat.items, targetId)
          if (found) return found
        }
      }
      return null
    }

    try {
      // Try to get categories with the requested depth, fall back to lower depths if needed
      let allCategories: any = null
      let usedDepth = args.depth

      for (let depth = args.depth ?? 1; depth >= 0; depth--) {
        try {
          allCategories = await client.getCategories(depth)
          usedDepth = depth
          break
        } catch (error) {
          if (depth === 0) {
            // If even depth=0 fails, re-throw the error
            throw error
          }
          // Continue to try lower depth
        }
      }

      const catalogArray = allCategories.catalog || []
      const categoryDetails = findCategory(catalogArray, args.categoryId)

      if (!categoryDetails) {
        return {
          error: `Category with ID '${args.categoryId}' not found`,
          categoryId: args.categoryId,
          usedDepth,
          suggestion: "Use picnic_get_categories to find valid category IDs.",
        }
      }

      // Filter and structure the response
      const filteredCategory: any = {
        id: categoryDetails.id,
        name: categoryDetails.name,
        type: categoryDetails.type,
        ...(categoryDetails.level && { level: categoryDetails.level }),
        ...(args.includeImages &&
          categoryDetails.image_id && { image_id: categoryDetails.image_id }),
      }

      // Handle items/subcategories
      if (args.includeItems && categoryDetails.items) {
        const items = categoryDetails.items.slice(0, args.itemsLimit).map((item: any) => {
          // Check if it's a subcategory or a product
          if (item.type === "CATEGORY") {
            return {
              id: item.id,
              name: item.name,
              type: item.type,
              items_count: item.items ? item.items.length : 0,
              ...(args.includeImages && item.image_id && { image_id: item.image_id }),
            }
          } else {
            // It's a product
            return {
              id: item.id,
              name: item.name,
              type: item.type,
              price: item.display_price,
              unit: item.unit_quantity,
              ...(args.includeImages && item.image_id && { image_id: item.image_id }),
            }
          }
        })

        filteredCategory.items = items
        filteredCategory.items_count = categoryDetails.items.length
        filteredCategory.items_returned = items.length
      }

      return {
        category: filteredCategory,
        meta: {
          categoryId: args.categoryId,
          includeItems: args.includeItems,
          itemsLimit: args.itemsLimit,
          usedDepth,
          requestedDepth: args.depth,
          truncated:
            args.includeItems &&
            categoryDetails.items &&
            categoryDetails.items.length > (args.itemsLimit || 20),
        },
      }
    } catch (error) {
      return {
        error: `Failed to get category details: ${error instanceof Error ? error.message : String(error)}`,
        categoryId: args.categoryId,
        suggestion:
          "Make sure the category ID is valid. Use picnic_get_categories to find valid IDs.",
      }
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
    const cart = await client.getShoppingCart()
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
    const cart = await client.addProductToShoppingCart(args.productId, args.count)
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
    const cart = await client.removeProductFromShoppingCart(args.productId, args.count)
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
    const cart = await client.clearShoppingCart()
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
    const slots = await client.getDeliverySlots()
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
    const result = await client.setDeliverySlot(args.slotId)
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
    const allDeliveries = await client.getDeliveries(args.filter as string[])

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
    const delivery = await client.getDelivery(args.deliveryId)
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
    const position = await client.getDeliveryPosition(args.deliveryId)
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
    const scenario = await client.getDeliveryScenario(args.deliveryId)
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
    const result = await client.cancelDelivery(args.deliveryId)
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
    const result = await client.setDeliveryRating(args.deliveryId, args.rating)
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
    const result = await client.sendDeliveryInvoiceEmail(args.deliveryId)
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
    const orderStatus = await client.getOrderStatus(args.orderId)
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
    const user = await client.getUserDetails()
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
    const userInfo = await client.getUserInfo()
    return userInfo
  },
})

// Get lists tool
const listsInputSchema = z.object({
  depth: z.number().min(0).max(5).default(0).describe("List depth to retrieve"),
})

toolRegistry.register({
  name: "picnic_get_lists",
  description: "Get shopping lists and sublists",
  inputSchema: listsInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const lists = await client.getLists(args.depth)
    return lists
  },
})

// Get specific list tool
const getListInputSchema = z.object({
  listId: z.string().describe("The ID of the list to get"),
  subListId: z.string().optional().describe("The ID of the sub list to get"),
  depth: z.number().min(0).max(5).default(0).describe("List depth to retrieve"),
})

toolRegistry.register({
  name: "picnic_get_list",
  description: "Get a specific list or sublist with its items",
  inputSchema: getListInputSchema,
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const list = await client.getList(args.listId, args.subListId || undefined, args.depth)
    return list
  },
})

// Get MGM details tool
toolRegistry.register({
  name: "picnic_get_mgm_details",
  description: "Get MGM (friends discount) details",
  inputSchema: z.object({}),
  handler: async () => {
    await ensureClientInitialized()
    const client = getPicnicClient()
    const mgmDetails = await client.getMgmDetails()
    return mgmDetails
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
    const paymentProfile = await client.getPaymentProfile()
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
    const transactions = await client.getWalletTransactions(pageNumber)
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
    const details = await client.getWalletTransactionDetails(args.transactionId as string)
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
      const result = await client.generate2FACode(channel)
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
    try {
      const result = await client.verify2FACode(args.code)
      await saveSession()
      return {
        message: "2FA code verified",
        code: args.code,
        result,
      }
    } catch (error: unknown) {
      // The Picnic API returns empty bodies for 2FA endpoints, which causes JSON parse errors
      // but the actual verification succeeds
      if (error instanceof SyntaxError && (error as Error).message.includes("JSON")) {
        await saveSession()
        return {
          message: "2FA code verified",
          code: args.code,
        }
      }
      throw error
    }
  },
})

// Replace the entire picnic_analyze_response_size tool with this:
toolRegistry.register({
  name: "picnic_analyze_response_size",
  description: "Analyze response size and structure for optimization",
  inputSchema: z.object({
    method: z
      .enum([
        "search",
        "getSuggestions",
        "getArticle",
        "getCategories",
        "getShoppingCart",
        "getDeliverySlots",
        "getDeliveries",
        "getUserDetails",
        "getLists",
        "getWalletTransactions",
      ])
      .describe("API method to analyze"),
    params: z.record(z.unknown()).optional().describe("Parameters for the API call"),
  }),
  handler: async (args) => {
    await ensureClientInitialized()
    const client = getPicnicClient()

    let response: any

    try {
      switch (args.method) {
        case "search":
          response = await client.search((args.params?.query as string) || "apple")
          break
        case "getCategories":
          response = await client.getCategories((args.params?.depth as number) || 0)
          break
        default:
          return { error: "Method not implemented yet" }
      }

      const jsonString = JSON.stringify(response)
      const sizeKB = Math.round((jsonString.length / 1024) * 100) / 100

      return {
        method: args.method,
        sizeKB,
        structure: Array.isArray(response)
          ? `Array with ${response.length} items`
          : typeof response,
        sample: jsonString.substring(0, 200) + "...",
      }
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : String(error),
      }
    }
  },
})

// Note: picnic_debug_search_article diagnostic tool removed - no longer needed
// since product detail endpoints are confirmed deprecated (GitHub issue #23)
