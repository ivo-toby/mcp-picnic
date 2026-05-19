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

#### `picnic_get_product_details`

Look up product details by selling unit ID.

**Parameters:**

- `productId` (string): The selling unit ID to inspect
- `full` (boolean, optional): Return full product details including description, allergens, ingredients, similar products, and bundle discount pricing when available

#### `picnic_get_image`

Get image data for a product using the image ID and size.

**Parameters:**

- `imageId` (string): The image ID to retrieve
- `size` (string): One of `tiny`, `small`, `medium`, `large`, `extra-large`

### Shopping Cart Management

#### `picnic_get_cart`

Get the current shopping cart contents.

**Notes:**

- Includes `total_savings` when Picnic returns bundle discount savings
- Articles may include `bundle_prices` when lower per-unit prices apply at higher quantities

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

#### `picnic_send_delivery_invoice_email`

Send or resend the invoice email for a completed delivery.

**Parameters:**

- `deliveryId` (string): The ID of the delivery to send the invoice email for

#### `picnic_get_order_status`

Get the status of a specific order.

**Parameters:**

- `orderId` (string): The ID of the order to inspect

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
