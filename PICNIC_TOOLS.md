# Picnic API MCP Tools

This MCP server provides tools to interact with the Picnic online supermarket API. The tools are based on the unofficial [picnic-api](https://github.com/MRVDH/picnic-api) Node.js package.

## Available Tools

### Authentication

**Note:** Authentication is handled automatically using environment variables (`PICNIC_USERNAME` and `PICNIC_PASSWORD`). No manual login is required.

#### `picnic_generate_2fa_code`

Generate a 2FA code for verification.

**Parameters:**

- `channel` (string, optional): Channel to send 2FA code (default: "SMS")

#### `picnic_verify_2fa_code`

Verify a 2FA code.

**Parameters:**

- `code` (string): The 2FA code to verify

### Product Search & Information

#### `picnic_search`

Search for products in Picnic.

**Parameters:**

- `query` (string): Search query for products

#### `picnic_get_suggestions`

Get product suggestions based on a query.

**Parameters:**

- `query` (string): Query for product suggestions

#### ~~`picnic_get_article`~~ (REMOVED)

**This tool has been removed** because the Picnic API deprecated product detail endpoints. See [GitHub issue #23](https://github.com/MRVDH/picnic-api/issues/23).

**Alternative:** Use `picnic_search` to get basic product information (id, name, price, unit).

#### `picnic_get_categories`

Get product categories from Picnic.

**Parameters:**

- `depth` (number, optional): Category depth to retrieve (0-5, default: 0)

### Shopping Cart Management

#### `picnic_get_cart`

Get the current shopping cart contents.

#### `picnic_add_to_cart`

Add a product to the shopping cart.

**Parameters:**

- `productId` (string): The ID of the product to add
- `count` (number, optional): Number of items to add (default: 1)

#### `picnic_remove_from_cart`

Remove a product from the shopping cart.

**Parameters:**

- `productId` (string): The ID of the product to remove
- `count` (number, optional): Number of items to remove (default: 1)

#### `picnic_clear_cart`

Clear all items from the shopping cart.

### Delivery Management

#### `picnic_get_delivery_slots`

Get available delivery time slots.

#### `picnic_set_delivery_slot`

Select a delivery time slot.

**Parameters:**

- `slotId` (string): The ID of the delivery slot to select

#### `picnic_get_deliveries`

Get past and current deliveries.

**Parameters:**

- `filter` (array of strings, optional): Filter deliveries by status

#### `picnic_get_delivery`

Get details of a specific delivery.

**Parameters:**

- `deliveryId` (string): The ID of the delivery to get details for

#### `picnic_get_delivery_position`

Get real-time position data for a delivery.

**Parameters:**

- `deliveryId` (string): The ID of the delivery to get position for

#### `picnic_get_delivery_scenario`

Get driver and route information for a delivery.

**Parameters:**

- `deliveryId` (string): The ID of the delivery to get scenario for

#### `picnic_cancel_delivery`

Cancel a delivery order.

**Parameters:**

- `deliveryId` (string): The ID of the delivery to cancel

#### `picnic_rate_delivery`

Rate a completed delivery.

**Parameters:**

- `deliveryId` (string): The ID of the delivery to rate
- `rating` (number): Rating from 0 to 10

### User Information

#### `picnic_get_user_details`

Get details of the current logged-in user.

#### `picnic_get_user_info`

Get user information including toggled features.

### Lists Management

#### `picnic_get_lists`

Get shopping lists and sublists.

**Parameters:**

- `depth` (number, optional): List depth to retrieve (0-5, default: 0)

#### `picnic_get_list`

Get a specific list or sublist with its items.

**Parameters:**

- `listId` (string): The ID of the list to get
- `subListId` (string, optional): The ID of the sub list to get
- `depth` (number, optional): List depth to retrieve (0-5, default: 0)

### Payment & Transactions

#### `picnic_get_payment_profile`

Get payment information and profile.

#### `picnic_get_wallet_transactions`

Get wallet transaction history.

**Parameters:**

- `pageNumber` (number, optional): Page number for transaction history (default: 1)

#### `picnic_get_wallet_transaction_details`

Get detailed information about a specific wallet transaction.

**Parameters:**

- `transactionId` (string): The ID of the transaction to get details for

### Recipes

Picnic's recipe endpoints return Fusion pages (a layout tree); the listing tool walks that tree and returns a small per-recipe summary by default. Pass `full: true` to get the raw response, or call `picnic_get_recipe_details` for ingredients and steps.

#### `picnic_get_recipes`

Browse recipes from the Picnic cookbook.

- Without a `category`: returns the cookbook highlights (~30 recipes) plus the list of available category IDs (e.g. `20minuten`, `vega`, `eenpans`).
- With a `category`: returns the recipes in that category. A single category can contain hundreds of recipes; use `limit`/`offset` to page through.

**Parameters:**

- `category` (string, optional): Category ID (e.g. `"20minuten"`) or full page ID (e.g. `"recipe_cattree_20minuten"`)
- `limit` (number, optional): Maximum number of recipes to return (1-100, default: 20)
- `offset` (number, optional): Number of recipes to skip for pagination (default: 0)
- `full` (boolean, optional): When `true`, returns the raw FusionPage instead of a filtered list (default: `false`)

**Filtered response shape:**

```json
{
  "pageId": "cookbook-page-content",
  "recipes": [
    {
      "recipe_id": "69a6d2ab92f7b13019c86579",
      "title": "Kip-kormaballetjes met mangosalsa",
      "cooking_time": "20 min",
      "tagline": "Tropische verrassing",
      "image_id": "recipes/28860cbeaf..."
    }
  ],
  "pagination": { "offset": 0, "limit": 20, "returned": 20, "total": 30, "hasMore": true },
  "categories": ["20minuten", "vega", "eenpans"]
}
```

The `categories` field is only present on the cookbook root (when `category` is omitted).

#### `picnic_get_recipe_details`

Get a structured projection of a single Picnic recipe — metadata, the four ingredient sections, numbered cooking steps, and the variation tip. Set `full: true` to get the raw 1.7MB FusionPage instead.

**Parameters:**

- `recipeId` (string): The recipe ID (as returned by `picnic_get_recipes`)
- `full` (boolean, optional): When `true`, returns the raw FusionPage (default: `false`)

**Filtered response shape:**

```json
{
  "recipe_id": "69a6d2ab92f7b13019c86579",
  "name": "Kip-kormaballetjes met mangosalsa",
  "tagline": "Tropische verrassing",
  "description": "Ook dit gerecht laat maar weer eens zien hoe goed zoet en hartig samengaan!",
  "cooking_time": "20 min",
  "portions": 1,
  "image_id": "recipes/28860cbeaf...",
  "ingredients": [
    {
      "selling_unit_id": "s1015074",
      "ingredient_id": "00abaaf6-...",
      "name": "Kipgehakt",
      "brand": "'t Slagershuys",
      "price": 399,
      "unit_quantity": "300 gram",
      "needed": "75 g",
      "quantity": 1,
      "checked": true
    }
  ],
  "likely_in_stock": [{ "name": "Bio knoflook", "...": "..." }],
  "pantry": [{ "name": "Zeezout", "brand": "Verstegen", "...": "..." }],
  "complementary": [{ "name": "Jalapeno groene pepers", "...": "..." }],
  "steps": ["Bereid de rijst...", "Doe het kipgehakt...", "..."],
  "tip": "Hou je van pittig? Voeg dan een paar ringetjes jalapeño peper toe!"
}
```

The four ingredient sections come from Picnic's own categorisation:

- **`ingredients`** — the core shopping list (Picnic's "Ingrediënten")
- **`likely_in_stock`** — items Picnic guesses you already have ("Waarschijnlijk nog in huis")
- **`pantry`** — staples like salt, pepper, oil ("Uit eigen keuken")
- **`complementary`** — suggested additions ("Combineer met")

`price` is in cents. `selling_unit_id` is usable directly with `picnic_add_to_cart` or `picnic_add_product_to_recipe`.

#### `picnic_save_recipe`

Save a recipe to the user's saved recipes list.

**Parameters:**

- `recipeId` (string): The ID of the recipe to save

#### `picnic_unsave_recipe`

Remove a recipe from the user's saved recipes list.

**Parameters:**

- `recipeId` (string): The ID of the recipe to unsave

#### `picnic_add_product_to_recipe`

Add a product to the shopping cart in the context of a recipe. Includes the recipe context so Picnic's recipe stepper UI and analytics know the addition originated from a recipe.

**Parameters:**

- `productId` (string): The selling-unit / article ID of the product to add
- `recipeId` (string): The ID of the recipe the product belongs to
- `sectionId` (string, optional): The section within the recipe
- `count` (number, optional): Number of items to add (default: 1)

#### `picnic_remove_product_from_recipe`

Remove a product from the shopping cart in the context of a recipe. Includes the recipe context for analytics and the recipe stepper UI.

**Parameters:**

- `productId` (string): The selling-unit / article ID of the product to remove
- `recipeId` (string): The ID of the recipe the product belongs to
- `sectionId` (string, optional): The section within the recipe
- `count` (number, optional): Number of items to remove (default: 1)

### Other

#### `picnic_get_mgm_details`

Get MGM (friends discount) details.

## Usage Example

**Note**: Authentication is handled automatically using environment variables. No manual login is required.

1. Search for products:

```json
{
  "tool": "picnic_search",
  "arguments": {
    "query": "milk"
  }
}
```

2. Add a product to cart:

```json
{
  "tool": "picnic_add_to_cart",
  "arguments": {
    "productId": "12345",
    "count": 2
  }
}
```

3. Get available delivery slots:

```json
{
  "tool": "picnic_get_delivery_slots",
  "arguments": {}
}
```

## Important Notes

- **Authentication**: Authentication is handled automatically using environment variables (`PICNIC_USERNAME` and `PICNIC_PASSWORD`)
- **Country Support**: Currently supports Netherlands (NL) and Germany (DE)
- **Rate Limiting**: Be mindful of API rate limits when making frequent requests
- **Security**: Credentials are read from environment variables and used to authenticate automatically when tools are called
- **Unofficial API**: This uses an unofficial API wrapper, so functionality may change if Picnic updates their API

## Error Handling

All tools include proper error handling and will throw descriptive errors if:

- Authentication is required but not provided
- Invalid parameters are passed
- API requests fail
- Network issues occur

## Dependencies

This implementation uses the [picnic-api](https://www.npmjs.com/package/picnic-api) npm package by MRVDH.
