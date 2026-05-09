import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the picnic-client utility before importing the tools module so that
// the registered tool handlers resolve our fake client instead of trying
// to authenticate against the real Picnic API.
const mockClient = {
  app: { getPage: vi.fn() },
  recipe: {
    getRecipeDetailsPage: vi.fn(),
    saveRecipe: vi.fn(),
    unsaveRecipe: vi.fn(),
    addProductToRecipe: vi.fn(),
    removeProductFromRecipe: vi.fn(),
  },
}

vi.mock("../../../src/utils/picnic-client.js", () => ({
  getPicnicClient: () => mockClient,
  initializePicnicClient: vi.fn().mockResolvedValue(undefined),
  saveSession: vi.fn().mockResolvedValue(undefined),
}))

// Importing picnic-tools triggers tool registration as a side-effect.
import { toolRegistry } from "../../../src/tools/registry.js"
import "../../../src/tools/picnic-tools.js"

/**
 * Minimal fixture mimicking the PML structure of one recipe block on the
 * cookbook root: tagline, title, cooking time. Tracks Picnic's real
 * response: a node with `analytics.contexts[].data.recipe_id` and a tree
 * of RICH_TEXT / IMAGE descendants.
 */
function cookbookRecipeBlock(opts: {
  recipeId: string
  tagline: string
  title: string
  cookingTime: string
  imageId?: string
}) {
  const texts = [
    "Toevoegen", // button label that must be ignored
    "Niet alles op voorraad", // status text that must be ignored
    `#(#295813)${opts.tagline}#(#295813)`,
    opts.title,
    `#(#333333)${opts.cookingTime}#(#333333)`,
  ]
  return {
    type: "PML",
    analytics: {
      contexts: [
        {
          schema: "iglu:tech.picnic.snowplow.analytics/recipe/jsonschema/1-6-0",
          data: { recipe_id: opts.recipeId },
        },
      ],
    },
    pml: {
      component: {
        type: "STACK",
        children: [
          ...texts.map((markdown) => ({ type: "RICH_TEXT", markdown })),
          ...(opts.imageId
            ? [{ type: "IMAGE", source: { id: opts.imageId }, width: 100, height: 100 }]
            : []),
        ],
      },
    },
  }
}

/**
 * Category-page recipe block: title, time, optional "Nieuw" badge — a
 * different layout from the cookbook root.
 */
function categoryRecipeBlock(opts: {
  recipeId: string
  title: string
  cookingTime: string
  badge?: string
}) {
  return {
    type: "PML",
    analytics: {
      contexts: [{ data: { recipe_id: opts.recipeId } }],
    },
    pml: {
      component: {
        type: "STACK",
        children: [
          { type: "RICH_TEXT", markdown: opts.title },
          { type: "RICH_TEXT", markdown: opts.cookingTime },
          ...(opts.badge ? [{ type: "RICH_TEXT", markdown: opts.badge }] : []),
        ],
      },
    },
  }
}

function pageWithRecipes(recipes: unknown[], extras: Record<string, unknown> = {}) {
  return {
    id: "cookbook-page-content",
    presentation: { type: "FULL_SCREEN", style: { backgroundColor: "#fff" } },
    header: null,
    body: {
      type: "STATE_BOUNDARY",
      id: "root",
      state: {},
      child: {
        type: "BLOCK",
        id: "list",
        layout: { type: "FLOW", axis: "vertical" },
        size: {},
        children: recipes,
      },
    },
    ...extras,
  }
}

describe("picnic_get_recipes", () => {
  beforeEach(() => {
    mockClient.app.getPage.mockReset()
  })

  it("fetches the cookbook page when no category is given", async () => {
    mockClient.app.getPage.mockResolvedValueOnce(pageWithRecipes([]))

    await toolRegistry.executeTool("picnic_get_recipes", {})

    expect(mockClient.app.getPage).toHaveBeenCalledWith("cookbook-page-content")
  })

  it("normalises a bare category id to a recipe_cattree page id", async () => {
    mockClient.app.getPage.mockResolvedValueOnce(pageWithRecipes([]))

    await toolRegistry.executeTool("picnic_get_recipes", { category: "20minuten" })

    expect(mockClient.app.getPage).toHaveBeenCalledWith("recipe_cattree_20minuten")
  })

  it("passes a full recipe_cattree page id through unchanged", async () => {
    mockClient.app.getPage.mockResolvedValueOnce(pageWithRecipes([]))

    await toolRegistry.executeTool("picnic_get_recipes", {
      category: "recipe-cattree-jamie-oliver",
    })

    expect(mockClient.app.getPage).toHaveBeenCalledWith("recipe-cattree-jamie-oliver")
  })

  it("extracts cookbook recipes with title, time, tagline and image", async () => {
    mockClient.app.getPage.mockResolvedValueOnce(
      pageWithRecipes([
        cookbookRecipeBlock({
          recipeId: "rec1",
          tagline: "Tropische verrassing",
          title: "Kip-kormaballetjes met mangosalsa",
          cookingTime: "20 min",
          imageId: "recipes/abc123",
        }),
      ]),
    )

    const result = await toolRegistry.executeTool("picnic_get_recipes", {})
    const payload = JSON.parse(result.content[0].text!)

    expect(payload.recipes).toEqual([
      {
        recipe_id: "rec1",
        title: "Kip-kormaballetjes met mangosalsa",
        cooking_time: "20 min",
        tagline: "Tropische verrassing",
        image_id: "recipes/abc123",
      },
    ])
  })

  it("extracts category-page recipes (no tagline, badge ignored)", async () => {
    mockClient.app.getPage.mockResolvedValueOnce(
      pageWithRecipes([
        categoryRecipeBlock({
          recipeId: "rec2",
          title: "Mie met kip, paprika en cashewnoten",
          cookingTime: "20 minuten",
          badge: "Nieuw",
        }),
      ]),
    )

    const result = await toolRegistry.executeTool("picnic_get_recipes", {
      category: "20minuten",
    })
    const payload = JSON.parse(result.content[0].text!)

    expect(payload.recipes).toEqual([
      {
        recipe_id: "rec2",
        title: "Mie met kip, paprika en cashewnoten",
        cooking_time: "20 minuten",
      },
    ])
  })

  it("dedupes recipes that appear in multiple analytics contexts", async () => {
    const block = cookbookRecipeBlock({
      recipeId: "dup",
      tagline: "T",
      title: "Title",
      cookingTime: "10 min",
    })
    // Picnic often nests the same recipe in multiple wrappers, each
    // carrying the same analytics context.
    mockClient.app.getPage.mockResolvedValueOnce(pageWithRecipes([block, block, block]))

    const result = await toolRegistry.executeTool("picnic_get_recipes", {})
    const payload = JSON.parse(result.content[0].text!)

    expect(payload.recipes).toHaveLength(1)
    expect(payload.pagination.total).toBe(1)
  })

  it("paginates results and reports hasMore correctly", async () => {
    const recipes = Array.from({ length: 5 }, (_, i) =>
      cookbookRecipeBlock({
        recipeId: `r${i}`,
        tagline: "x",
        title: `Recipe ${i}`,
        cookingTime: "15 min",
      }),
    )
    mockClient.app.getPage.mockResolvedValueOnce(pageWithRecipes(recipes))

    const result = await toolRegistry.executeTool("picnic_get_recipes", {
      limit: 2,
      offset: 1,
    })
    const payload = JSON.parse(result.content[0].text!)

    expect(payload.recipes.map((r: { recipe_id: string }) => r.recipe_id)).toEqual(["r1", "r2"])
    expect(payload.pagination).toEqual({
      offset: 1,
      limit: 2,
      returned: 2,
      total: 5,
      hasMore: true,
    })
  })

  it("surfaces category IDs only on the cookbook root", async () => {
    const cookbookPage = pageWithRecipes([
      cookbookRecipeBlock({
        recipeId: "rec1",
        tagline: "x",
        title: "Title",
        cookingTime: "20 min",
      }),
    ])
    // Inject category deeplinks the way Picnic does. The body.child.children
    // array is part of our test fixture so this cast is safe.
    const children = (
      cookbookPage.body.child as { children: unknown[] }
    ).children
    children.push(
      {
        type: "TOUCHABLE",
        onPress: {
          actionType: "OPEN",
          target: "nl.picnic-supermarkt://store/page;id=recipe_cattree_20minuten",
        },
      },
      {
        type: "TOUCHABLE",
        onPress: {
          actionType: "OPEN",
          target: "nl.picnic-supermarkt://store/page;id=recipe-cattree-jamie-oliver",
        },
      },
    )
    mockClient.app.getPage.mockResolvedValueOnce(cookbookPage)

    const result = await toolRegistry.executeTool("picnic_get_recipes", {})
    const payload = JSON.parse(result.content[0].text!)

    expect(payload.categories).toEqual(
      expect.arrayContaining(["20minuten", "jamie-oliver"]),
    )
  })

  it("omits categories when a specific category was requested", async () => {
    mockClient.app.getPage.mockResolvedValueOnce(pageWithRecipes([]))

    const result = await toolRegistry.executeTool("picnic_get_recipes", {
      category: "vega",
    })
    const payload = JSON.parse(result.content[0].text!)

    expect(payload).not.toHaveProperty("categories")
  })

  it("returns the raw FusionPage when full=true", async () => {
    const raw = pageWithRecipes([
      cookbookRecipeBlock({
        recipeId: "raw1",
        tagline: "x",
        title: "Title",
        cookingTime: "20 min",
      }),
    ])
    mockClient.app.getPage.mockResolvedValueOnce(raw)

    const result = await toolRegistry.executeTool("picnic_get_recipes", { full: true })
    const payload = JSON.parse(result.content[0].text!)

    expect(payload.id).toBe("cookbook-page-content")
    expect(payload.body).toBeDefined()
    expect(payload.recipes).toBeUndefined()
  })
})

describe("picnic_get_recipe_details", () => {
  beforeEach(() => {
    mockClient.recipe.getRecipeDetailsPage.mockReset()
  })

  it("delegates to recipe.getRecipeDetailsPage and returns it raw", async () => {
    const page = { id: "recipe-details-page-root", body: {} }
    mockClient.recipe.getRecipeDetailsPage.mockResolvedValueOnce(page)

    const result = await toolRegistry.executeTool("picnic_get_recipe_details", {
      recipeId: "abc",
    })

    expect(mockClient.recipe.getRecipeDetailsPage).toHaveBeenCalledWith("abc")
    expect(JSON.parse(result.content[0].text!)).toEqual(page)
  })
})

describe("picnic_save_recipe / picnic_unsave_recipe", () => {
  beforeEach(() => {
    mockClient.recipe.saveRecipe.mockReset()
    mockClient.recipe.unsaveRecipe.mockReset()
  })

  it("saves a recipe by id", async () => {
    mockClient.recipe.saveRecipe.mockResolvedValueOnce({})

    const result = await toolRegistry.executeTool("picnic_save_recipe", {
      recipeId: "abc",
    })

    expect(mockClient.recipe.saveRecipe).toHaveBeenCalledWith("abc")
    expect(JSON.parse(result.content[0].text!)).toEqual({
      message: "Recipe saved",
      recipeId: "abc",
    })
  })

  it("unsaves a recipe by id", async () => {
    mockClient.recipe.unsaveRecipe.mockResolvedValueOnce({})

    const result = await toolRegistry.executeTool("picnic_unsave_recipe", {
      recipeId: "abc",
    })

    expect(mockClient.recipe.unsaveRecipe).toHaveBeenCalledWith("abc")
    expect(JSON.parse(result.content[0].text!)).toEqual({
      message: "Recipe unsaved",
      recipeId: "abc",
    })
  })
})

describe("picnic_add_product_to_recipe / picnic_remove_product_from_recipe", () => {
  beforeEach(() => {
    mockClient.recipe.addProductToRecipe.mockReset()
    mockClient.recipe.removeProductFromRecipe.mockReset()
  })

  const fakeCart = {
    type: "ORDER",
    id: "cart1",
    items: [],
    total_count: 0,
    total_price: 0,
    checkout_total_price: 0,
    total_savings: 0,
  }

  it("adds a product with optional sectionId and count defaults", async () => {
    mockClient.recipe.addProductToRecipe.mockResolvedValueOnce(fakeCart)

    const result = await toolRegistry.executeTool("picnic_add_product_to_recipe", {
      productId: "p1",
      recipeId: "r1",
    })

    expect(mockClient.recipe.addProductToRecipe).toHaveBeenCalledWith("p1", "r1", undefined, 1)
    const payload = JSON.parse(result.content[0].text!)
    expect(payload.message).toBe("Added 1 item(s) to cart from recipe")
    expect(payload.recipeId).toBe("r1")
    expect(payload.cart).toBeDefined()
  })

  it("forwards sectionId and count when provided", async () => {
    mockClient.recipe.addProductToRecipe.mockResolvedValueOnce(fakeCart)

    await toolRegistry.executeTool("picnic_add_product_to_recipe", {
      productId: "p1",
      recipeId: "r1",
      sectionId: "section-2",
      count: 3,
    })

    expect(mockClient.recipe.addProductToRecipe).toHaveBeenCalledWith("p1", "r1", "section-2", 3)
  })

  it("removes a product with the same context shape", async () => {
    mockClient.recipe.removeProductFromRecipe.mockResolvedValueOnce(fakeCart)

    const result = await toolRegistry.executeTool("picnic_remove_product_from_recipe", {
      productId: "p1",
      recipeId: "r1",
      count: 2,
    })

    expect(mockClient.recipe.removeProductFromRecipe).toHaveBeenCalledWith(
      "p1",
      "r1",
      undefined,
      2,
    )
    const payload = JSON.parse(result.content[0].text!)
    expect(payload.message).toBe("Removed 2 item(s) from cart in recipe")
  })
})
