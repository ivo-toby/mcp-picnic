# Picnic MCP Server Prompts

This document describes the useful prompts available in the Picnic MCP Server. These prompts are designed to help users accomplish common grocery shopping tasks using Picnic's online supermarket delivery service.

## Available Prompts

### 1. `picnic_meal_planner`

**Description**: Create a meal plan and generate a shopping list for Picnic

**Use Case**: Perfect for users who want to plan their meals for the week and automatically generate a shopping list with all necessary ingredients.

**Arguments**:

- `days` (optional): Number of days to plan meals for (default: 7)
- `people` (optional): Number of people to cook for (default: 2)
- `dietary_restrictions` (optional): Any dietary restrictions or preferences (default: none)

**What it does**: Creates a comprehensive meal plan and uses Picnic tools to search for ingredients and build a shopping cart.

---

### 2. `picnic_budget_shopping`

**Description**: Help create a budget-conscious shopping list with Picnic

**Use Case**: Ideal for users who want to maximize their grocery budget while maintaining nutritional quality.

**Arguments**:

- `budget` (required): Weekly grocery budget in euros
- `household_size` (optional): Number of people in the household (default: 2)

**What it does**: Finds budget-friendly staples and essentials while tracking costs and staying within the specified budget.

---

### 3. `picnic_quick_dinner`

**Description**: Find ingredients for quick and easy dinner solutions available on Picnic

**Use Case**: Perfect for busy people who need fast dinner solutions that can be prepared quickly.

**Arguments**:

- `time_limit` (optional): Maximum cooking time in minutes (default: 30)
- `dietary_preferences` (optional): Any dietary preferences or restrictions (default: none)

**What it does**: Suggests quick dinner options and finds ingredients or ready-made solutions available on Picnic.

---

### 4. `picnic_healthy_eating`

**Description**: Create a healthy eating plan with products available on Picnic

**Use Case**: Great for users who want to transition to healthier eating habits or achieve specific health goals.

**Arguments**:

- `health_goal` (optional): Specific health goal like weight loss, muscle gain, heart health (default: general wellness)
- `food_allergies` (optional): Any food allergies or intolerances (default: none)

**What it does**: Finds healthy alternatives and nutritious products, focusing on whole foods and balanced nutrition.

---

### 5. `picnic_special_occasion`

**Description**: Plan shopping for special occasions and gatherings using Picnic

**Use Case**: Perfect for planning parties, holiday meals, dinner parties, or any special event.

**Arguments**:

- `occasion` (required): Type of occasion (birthday party, dinner party, holiday meal, BBQ, etc.)
- `guest_count` (optional): Number of guests expected (default: 6-8)

**What it does**: Plans a complete menu and finds all necessary ingredients for appetizers, main courses, sides, and desserts.

---

### 6. `picnic_pantry_restock`

**Description**: Help restock pantry essentials and household items through Picnic

**Use Case**: Ideal for maintaining a well-stocked kitchen with all the essentials for efficient cooking.

**Arguments**:

- `household_type` (optional): Type of household like single person, couple, family with kids (default: small household)
- `cooking_frequency` (optional): How often you cook at home (default: regularly)

**What it does**: Finds essential pantry staples, household necessities, and versatile ingredients based on your cooking habits.

---

### 7. `picnic_order_management`

**Description**: Help manage Picnic orders, deliveries, and account settings

**Use Case**: Useful for managing your Picnic account, checking order status, and optimizing your delivery experience.

**Arguments**:

- `task` (optional): Specific task like check order status, manage delivery, review past orders (default: general order management)

**What it does**: Uses various Picnic account management tools to help with order tracking, delivery scheduling, and account information.

---

### 8. `picnic_recipe_recreation`

**Description**: Help recreate a specific recipe using ingredients available on Picnic

**Use Case**: Perfect when you want to make a specific dish and need to find all the ingredients on Picnic.

**Arguments**:

- `recipe_name` (required): Name of the recipe to recreate
- `recipe_description` (optional): Description or details about the recipe
- `servings` (optional): Number of servings needed (default: 4)

**What it does**: Finds all necessary ingredients for the recipe, suggests substitutions if needed, and provides cooking instructions.

---

### 9. `picnic_dietary_substitutions`

**Description**: Find dietary substitutions and alternatives available on Picnic

**Use Case**: Essential for people with dietary restrictions who need to find suitable alternatives for specific ingredients.

**Arguments**:

- `original_ingredient` (required): The ingredient that needs to be substituted
- `dietary_need` (required): Reason for substitution (vegan, gluten-free, low-sodium, etc.)
- `recipe_context` (optional): What the ingredient is being used for (default: general cooking)

**What it does**: Finds suitable alternatives available on Picnic and explains how to use them in recipes.

---

### 10. `picnic_delivery_optimization`

**Description**: Help optimize Picnic delivery scheduling and order timing

**Use Case**: Great for users who want to optimize their delivery schedule for maximum convenience and efficiency.

**Arguments**:

- `schedule_preference` (optional): Preferred delivery schedule like morning, afternoon, evening (default: flexible)
- `household_needs` (optional): Household consumption patterns and needs (default: standard household)

**What it does**: Analyzes delivery slots, reviews delivery history, and suggests the best ordering and delivery strategy.

---

## How to Use These Prompts

These prompts are designed to work with the Picnic MCP Server's tools. When you use a prompt, it will:

1. **Set up the right context**: Each prompt includes system instructions that tell the AI how to behave as an expert in that specific area
2. **Use Picnic tools automatically**: The prompts guide the AI to use the appropriate Picnic API tools like `picnic_search`, `picnic_add_to_cart`, `picnic_get_delivery_slots`, etc.
3. **Provide practical guidance**: Beyond just finding products, the prompts help with meal planning, cooking instructions, budget management, and more

## Integration with Picnic Tools

These prompts leverage the full range of Picnic API tools available in the MCP server:

- **Product Search**: `picnic_search`, `picnic_get_suggestions`
- **Cart Management**: `picnic_add_to_cart`, `picnic_remove_from_cart`, `picnic_get_cart`, `picnic_clear_cart`
- **Delivery Management**: `picnic_get_delivery_slots`, `picnic_set_delivery_slot`, `picnic_get_deliveries`
- **Account Management**: `picnic_get_user_details`, `picnic_get_user_info`
- **Order Tracking**: `picnic_get_order_status`, `picnic_get_delivery_position`

## Benefits for Users

1. **Time-saving**: Automates the process of meal planning and shopping list creation
2. **Budget-conscious**: Helps find the best value products while staying within budget
3. **Health-focused**: Makes it easier to maintain healthy eating habits
4. **Dietary-friendly**: Accommodates various dietary restrictions and preferences
5. **Convenience-oriented**: Optimizes delivery scheduling and order management
6. **Expert guidance**: Provides professional advice for cooking, nutrition, and meal planning

These prompts transform the Picnic MCP Server from a simple API interface into an intelligent grocery shopping assistant that can help with complex meal planning, budget management, and dietary needs.
