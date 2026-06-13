import { describe, expect, it } from "vitest"
import {
  buildShoppingList,
  findMealCombinations,
  parseRecipeIngredients,
  type StructuredRecipeIngredients,
} from "../../../src/utils/recipe-meal-planning.js"

const RECIPE_ID = "0123456789abcdef01234567"

function recipeContext(
  overrides: Partial<{
    recipe_id: string
    recipe_name: string
    portions: number
    selling_units: Array<{
      ingredient_id: string
      selling_unit_id: string
      quantity: number
      checked: boolean
    }>
  }> = {},
) {
  return {
    type: "PML",
    analytics: {
      contexts: [
        {
          data: {
            recipe_id: RECIPE_ID,
            recipe_name: "Rice pan",
            portions: 2,
            selling_units: [
              {
                ingredient_id: "ingredient-de",
                selling_unit_id: "s-de",
                quantity: 2,
                checked: true,
              },
              {
                ingredient_id: "ingredient-nl",
                selling_unit_id: "s-nl",
                quantity: 1,
                checked: true,
              },
              {
                ingredient_id: "ingredient-fr",
                selling_unit_id: "s-fr",
                quantity: 1,
                checked: false,
              },
            ],
            ...overrides,
          },
        },
      ],
    },
  }
}

function productTile(ingredientId: string, markdowns: string[]) {
  return {
    type: "PML",
    analytics: {
      contexts: [{ schema: "iglu:com.picnic/product/1-0-0", data: { product_id: ingredientId } }],
    },
    pml: {
      component: {
        type: "STACK",
        children: markdowns.map((markdown) => ({ type: "RICH_TEXT", markdown })),
      },
    },
  }
}

function recipe(
  recipeId: string,
  recipeName: string,
  ingredients: StructuredRecipeIngredients["ingredients"],
): StructuredRecipeIngredients {
  return { recipeId, recipeName, portions: 2, ingredients }
}

function ingredient(
  sellingUnitId: string,
  name: string,
  priceCents: number,
  quantity = 1,
  isPantryItem = false,
) {
  return {
    ingredientId: `ingredient-${sellingUnitId}`,
    sellingUnitId,
    name,
    packageInfo: "1 pack",
    priceCents,
    quantity,
    isPantryItem,
  }
}

describe("parseRecipeIngredients", () => {
  it("extracts structured selling units and locale-neutral product display fields", () => {
    const parsed = parseRecipeIngredients({
      body: [
        recipeContext(),
        productTile("ingredient-de", ["Paprika Mix", "500 g", "€2,49"]),
        productTile("ingredient-nl", ["Tomaten", "1 stuk nodig", "1.19"]),
        productTile("ingredient-fr", ["Riz basmati", "1 paquet", "2,05 €"]),
      ],
    })

    expect(parsed).toEqual({
      recipeId: RECIPE_ID,
      recipeName: "Rice pan",
      portions: 2,
      ingredients: [
        {
          ingredientId: "ingredient-de",
          sellingUnitId: "s-de",
          name: "Paprika Mix",
          packageInfo: "500 g",
          priceCents: 249,
          quantity: 2,
          isPantryItem: false,
        },
        {
          ingredientId: "ingredient-nl",
          sellingUnitId: "s-nl",
          name: "Tomaten",
          packageInfo: "1 stuk nodig",
          priceCents: 119,
          quantity: 1,
          isPantryItem: false,
        },
        {
          ingredientId: "ingredient-fr",
          sellingUnitId: "s-fr",
          name: "Riz basmati",
          packageInfo: "1 paquet",
          priceCents: 205,
          quantity: 1,
          isPantryItem: true,
        },
      ],
    })
  })

  it("returns null when the page does not contain recipe selling-unit analytics", () => {
    expect(parseRecipeIngredients({ body: [productTile("ingredient", ["Tomatoes"])] })).toBeNull()
  })
})

describe("buildShoppingList", () => {
  it("deduplicates per recipe, skips pantry items, and totals price times quantity", () => {
    const shoppingList = buildShoppingList([
      recipe("a", "Pasta", [
        ingredient("shared", "Pasta", 150, 2),
        ingredient("shared", "Pasta duplicate", 150, 99),
        ingredient("pantry", "Salt", 40, 1, true),
      ]),
      recipe("b", "Soup", [
        ingredient("shared", "Pasta", 150, 1),
        ingredient("tomato", "Tomato", 80, 3),
      ]),
    ])

    expect(shoppingList.totalPriceCents).toBe(690)
    expect(shoppingList.shoppingList).toEqual([
      {
        sellingUnitId: "shared",
        name: "Pasta",
        packageInfo: "1 pack",
        priceCents: 150,
        quantity: 3,
        usedInRecipes: [
          { recipeId: "a", recipeName: "Pasta" },
          { recipeId: "b", recipeName: "Soup" },
        ],
      },
      {
        sellingUnitId: "tomato",
        name: "Tomato",
        packageInfo: "1 pack",
        priceCents: 80,
        quantity: 3,
        usedInRecipes: [{ recipeId: "b", recipeName: "Soup" }],
      },
    ])
    expect(shoppingList.sharedItems.map((item) => item.sellingUnitId)).toEqual(["shared"])
  })
})

describe("findMealCombinations", () => {
  it("uses exhaustive search over the full pool when the combination count is under the limit", () => {
    const combinations = findMealCombinations({
      recipes: [
        recipe("a", "A", [ingredient("x", "X", 100), ingredient("a-only", "A", 100)]),
        recipe("b", "B", [ingredient("x", "X", 100), ingredient("b-only", "B", 100)]),
        recipe("c", "C", [ingredient("y", "Y", 100), ingredient("z", "Z", 100)]),
        recipe("d", "D", [ingredient("y", "Y", 100), ingredient("z", "Z", 100)]),
      ],
      count: 2,
      topK: 1,
    })

    expect(combinations).toHaveLength(1)
    expect(combinations[0]).toMatchObject({
      algorithm: "exhaustive",
      score: 2,
      recipes: [
        { recipeId: "c", recipeName: "C" },
        { recipeId: "d", recipeName: "D" },
      ],
    })
  })

  it("uses greedy fallback over the full candidate pool when exhaustive search is too large", () => {
    const recipes = Array.from({ length: 302 }, (_, index) =>
      recipe(`recipe-${index}`, `Recipe ${index}`, [
        ingredient(`only-${index}`, `Only ${index}`, 100),
      ]),
    )
    recipes[300] = recipe("late-a", "Late A", [ingredient("late-shared", "Late shared", 100)])
    recipes[301] = recipe("late-b", "Late B", [ingredient("late-shared", "Late shared", 100)])

    const combinations = findMealCombinations({ recipes, count: 2, topK: 1 })

    expect(combinations[0]).toMatchObject({
      algorithm: "greedy",
      score: 1,
      recipes: [
        { recipeId: "late-a", recipeName: "Late A" },
        { recipeId: "late-b", recipeName: "Late B" },
      ],
    })
  })

  it("applies budget filtering using the shopping-list cost calculation", () => {
    const combinations = findMealCombinations({
      recipes: [
        recipe("expensive-a", "Expensive A", [ingredient("shared-expensive", "Expensive", 500, 2)]),
        recipe("expensive-b", "Expensive B", [ingredient("shared-expensive", "Expensive", 500, 1)]),
        recipe("cheap-a", "Cheap A", [ingredient("shared-cheap", "Cheap", 100, 1)]),
        recipe("cheap-b", "Cheap B", [ingredient("shared-cheap", "Cheap", 100, 1)]),
      ],
      count: 2,
      topK: 5,
      maxTotalBudgetCents: 250,
    })

    expect(combinations).toHaveLength(1)
    expect(combinations[0]).toMatchObject({
      totalPriceCents: 200,
      recipes: [
        { recipeId: "cheap-a", recipeName: "Cheap A" },
        { recipeId: "cheap-b", recipeName: "Cheap B" },
      ],
    })
  })
})
