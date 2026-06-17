import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock the picnic-client utility before importing the tools module so that
// the registered tool handlers resolve our fake client instead of trying
// to authenticate against the real Picnic API.
const mockClient = {
  app: { getPage: vi.fn() },
  recipe: {
    saveRecipe: vi.fn(),
    unsaveRecipe: vi.fn(),
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

  it("falls back to the dash-form page id when a bare category's underscore page is missing", async () => {
    mockClient.app.getPage
      .mockRejectedValueOnce(new Error("page-template not found"))
      .mockResolvedValueOnce(pageWithRecipes([]))

    const result = await toolRegistry.executeTool("picnic_get_recipes", {
      category: "jamie-oliver",
    })
    const payload = JSON.parse(result.content[0].text!)

    expect(mockClient.app.getPage).toHaveBeenNthCalledWith(1, "recipe_cattree_jamie-oliver")
    expect(mockClient.app.getPage).toHaveBeenNthCalledWith(2, "recipe-cattree-jamie-oliver")
    expect(payload.pageId).toBe("recipe-cattree-jamie-oliver")
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

  it("rejects a category containing path or query characters", async () => {
    // `category` ends up in the request path unencoded downstream, so the
    // schema must reject anything that could redirect the call to another
    // authenticated endpoint (e.g. '../cart' resolving to /api/15/cart).
    for (const category of ["../cart", "recipe_cattree_../cart", "vega?x=1", "a/b", "a#b", "."]) {
      await expect(toolRegistry.executeTool("picnic_get_recipes", { category })).rejects.toThrow(
        /Invalid input/,
      )
    }
    expect(mockClient.app.getPage).not.toHaveBeenCalled()
  })

  it("keeps title and tagline apart when the tagline is longer than the title", async () => {
    mockClient.app.getPage.mockResolvedValueOnce(
      pageWithRecipes([
        cookbookRecipeBlock({
          recipeId: "rec-long",
          tagline: "Een veel langere marketingtagline dan de titel zelf",
          title: "Spaghetti",
          cookingTime: "15 min",
        }),
      ]),
    )

    const result = await toolRegistry.executeTool("picnic_get_recipes", {})
    const payload = JSON.parse(result.content[0].text!)

    expect(payload.recipes[0].title).toBe("Spaghetti")
    expect(payload.recipes[0].tagline).toBe("Een veel langere marketingtagline dan de titel zelf")
  })

  it("strips bold markup from listing titles", async () => {
    // Picnic uses **bold** in RICH_TEXT; it must not leak into list titles
    // (the detail path already strips it) and a bold-only title must still be
    // treated as the unwrapped title, not as a color-wrapped tagline.
    const block = {
      type: "PML",
      analytics: { contexts: [{ data: { recipe_id: "rec-bold" } }] },
      pml: {
        component: {
          type: "STACK",
          children: [
            { type: "RICH_TEXT", markdown: "**Spaghetti bolognese**" },
            { type: "RICH_TEXT", markdown: "#(#333333)20 min#(#333333)" },
          ],
        },
      },
    }
    mockClient.app.getPage.mockResolvedValueOnce(pageWithRecipes([block]))

    const result = await toolRegistry.executeTool("picnic_get_recipes", {})
    const payload = JSON.parse(result.content[0].text!)

    expect(payload.recipes[0]).toEqual({
      recipe_id: "rec-bold",
      title: "Spaghetti bolognese",
      cooking_time: "20 min",
    })
  })

  it("rejects fractional limit and offset", async () => {
    for (const args of [{ limit: 2.5 }, { offset: 1.5 }]) {
      await expect(toolRegistry.executeTool("picnic_get_recipes", args)).rejects.toThrow(
        /Invalid input/,
      )
    }
    expect(mockClient.app.getPage).not.toHaveBeenCalled()
  })

  it("extracts compound cooking times without corrupting the title", async () => {
    // Newer cookbook tiles carry "15 min bereiden | 30 min totaal" instead
    // of a bare "30 min". The compound string is longer than many titles,
    // so it must neither win the title slot nor leak into the tagline.
    mockClient.app.getPage.mockResolvedValueOnce(
      pageWithRecipes([
        cookbookRecipeBlock({
          recipeId: "rec-compound",
          tagline: "Familiefavoriet vol groenten",
          title: "Enchilada's met gehakt en kaas",
          cookingTime: "15 min bereiden | 30 min totaal",
        }),
      ]),
    )

    const result = await toolRegistry.executeTool("picnic_get_recipes", {})
    const payload = JSON.parse(result.content[0].text!)

    expect(payload.recipes[0]).toEqual({
      recipe_id: "rec-compound",
      title: "Enchilada's met gehakt en kaas",
      cooking_time: "15 min bereiden | 30 min totaal",
      tagline: "Familiefavoriet vol groenten",
    })
  })

  it("ignores DE UI labels and parses DE cooking times", async () => {
    // Same cookbook structure, German chrome: button/badge labels must not
    // win the title slot and "20 Min." must be recognized as cooking time.
    const block = {
      type: "PML",
      analytics: { contexts: [{ data: { recipe_id: "rec-de" } }] },
      pml: {
        component: {
          type: "STACK",
          children: [
            { type: "RICH_TEXT", markdown: "Hinzufügen" },
            { type: "RICH_TEXT", markdown: "Nicht alles auf Lager" },
            { type: "RICH_TEXT", markdown: "#(#295813)Cremig und schnell#(#295813)" },
            { type: "RICH_TEXT", markdown: "Nudeln mit Pilzrahmsoße" },
            { type: "RICH_TEXT", markdown: "#(#333333)20 Min.#(#333333)" },
          ],
        },
      },
    }
    mockClient.app.getPage.mockResolvedValueOnce(pageWithRecipes([block]))

    const result = await toolRegistry.executeTool("picnic_get_recipes", {})
    const payload = JSON.parse(result.content[0].text!)

    expect(payload.recipes).toEqual([
      {
        recipe_id: "rec-de",
        title: "Nudeln mit Pilzrahmsoße",
        cooking_time: "20 Min.",
        tagline: "Cremig und schnell",
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

  it("returns full category page IDs that round-trip back unchanged", async () => {
    // Picnic emits both 'recipe_cattree_' and 'recipe-cattree-' separators and
    // the server is strict about which one resolves, so the surfaced category
    // ID must keep its original prefix (not be reduced to a bare slug) and be
    // forwarded verbatim when passed back in.
    const cookbookPage = pageWithRecipes([])
    const children = (cookbookPage.body.child as { children: unknown[] }).children
    children.push({
      type: "TOUCHABLE",
      onPress: {
        actionType: "OPEN",
        target: "nl.picnic-supermarkt://store/page;id=recipe-cattree-jamie-oliver",
      },
    })
    mockClient.app.getPage.mockResolvedValueOnce(cookbookPage)

    const listResult = await toolRegistry.executeTool("picnic_get_recipes", {})
    const categories = JSON.parse(listResult.content[0].text!).categories
    expect(categories).toEqual(["recipe-cattree-jamie-oliver"])

    // Feeding the surfaced ID back must request that exact page id (the dash
    // form), not a re-prefixed 'recipe_cattree_jamie-oliver' that would 404.
    mockClient.app.getPage.mockResolvedValueOnce(pageWithRecipes([]))
    await toolRegistry.executeTool("picnic_get_recipes", { category: categories[0] })
    expect(mockClient.app.getPage).toHaveBeenLastCalledWith("recipe-cattree-jamie-oliver")
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
    const children = (cookbookPage.body.child as { children: unknown[] }).children
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
      expect.arrayContaining(["recipe_cattree_20minuten", "recipe-cattree-jamie-oliver"]),
    )
  })

  it("omits categories when a specific category was requested", async () => {
    mockClient.app.getPage.mockResolvedValueOnce(
      pageWithRecipes([
        cookbookRecipeBlock({ recipeId: "r1", tagline: "x", title: "T", cookingTime: "20 min" }),
      ]),
    )

    const result = await toolRegistry.executeTool("picnic_get_recipes", {
      category: "vega",
    })
    const payload = JSON.parse(result.content[0].text!)

    expect(payload).not.toHaveProperty("categories")
  })

  it("surfaces sub-categories when a theme category has no recipes of its own", async () => {
    // recipe_cattree_thema-kids resolves but holds only sub-category links;
    // those must be surfaced so drilling into a theme isn't a dead end.
    const themePage = pageWithRecipes([])
    const children = (themePage.body.child as { children: unknown[] }).children
    children.push({
      type: "TOUCHABLE",
      onPress: {
        actionType: "OPEN",
        target: "nl.picnic-supermarkt://store/page;id=recipe_cattree_kids",
      },
    })
    mockClient.app.getPage.mockResolvedValueOnce(themePage)

    const result = await toolRegistry.executeTool("picnic_get_recipes", {
      category: "thema-kids",
    })
    const payload = JSON.parse(result.content[0].text!)

    expect(payload.recipes).toEqual([])
    expect(payload.categories).toEqual(["recipe_cattree_kids"])
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
    mockClient.app.getPage.mockReset()
  })

  /**
   * Build a minimal `selling-group-details-page` fixture matching the
   * structural anchors the extractor relies on: a metadata container with
   * `selling_units`, header & image blocks, four ingredient list blocks
   * keyed by category, and an instructions PML node with steps + tip.
   */
  function recipeDetailsFixture(opts: {
    recipeId?: string
    name?: string
    tagline?: string
    description?: string
    cookingTime?: string
    portions?: number
    imageId?: string
    ingredients?: Array<{
      ingredient_id: string
      selling_unit_id: string
      name: string
      brand?: string
      price?: string
      unit_quantity?: string
      needed?: string
      quantity?: number
      checked?: boolean
    }>
    pantry?: Array<{ ingredient_id: string; selling_unit_id: string; name: string; brand?: string }>
    likelyInStock?: Array<{ ingredient_id: string; selling_unit_id: string; name: string }>
    complementary?: Array<{ ingredient_id: string; selling_unit_id: string; name: string }>
    steps?: string[]
    tip?: string
    /** Localized step-header prefix, e.g. "Schritt" (default "Stap"). */
    stepHeaderPrefix?: string
    /** Localized tip header, e.g. "Tipp" (default "Tip"). */
    tipHeader?: string
  }) {
    const recipeId = opts.recipeId ?? "rec-1"
    const allIngredients = [
      ...(opts.ingredients ?? []),
      ...(opts.likelyInStock ?? []),
      ...(opts.pantry ?? []),
      ...(opts.complementary ?? []),
    ]

    const tile = (i: {
      ingredient_id: string
      name: string
      brand?: string
      price?: string
      unit_quantity?: string
      needed?: string
    }) => ({
      type: "PML",
      id: `core-wide-selling-unit-tile-${i.ingredient_id}`,
      pml: {
        component: {
          type: "STACK",
          children: [
            { type: "RICH_TEXT", markdown: i.name },
            { type: "RICH_TEXT", markdown: ">" },
            ...(i.brand ? [{ type: "RICH_TEXT", markdown: i.brand }] : []),
            ...(i.price ? [{ type: "RICH_TEXT", markdown: i.price }] : []),
            ...(i.unit_quantity ? [{ type: "RICH_TEXT", markdown: i.unit_quantity }] : []),
            ...(i.needed ? [{ type: "RICH_TEXT", markdown: `(${i.needed} nodig)` }] : []),
          ],
        },
      },
    })

    const listBlock = (id: string, items: typeof opts.ingredients) => ({
      type: "BLOCK",
      id,
      layout: { type: "FLOW", axis: "vertical" },
      size: {},
      children: (items ?? []).map(tile),
    })

    const stepsTexts: Array<{ type: string; markdown: string }> = []
    for (let i = 0; i < (opts.steps ?? []).length; i++) {
      stepsTexts.push({
        type: "RICH_TEXT",
        markdown: `${opts.stepHeaderPrefix ?? "Stap"} ${i + 1}`,
      })
      stepsTexts.push({ type: "RICH_TEXT", markdown: opts.steps![i] })
    }
    if (opts.tip) {
      stepsTexts.push({ type: "RICH_TEXT", markdown: opts.tipHeader ?? "Tip" })
      stepsTexts.push({ type: "RICH_TEXT", markdown: opts.tip })
    }

    return {
      id: "selling-group-details-page",
      presentation: { type: "FULL_SCREEN", style: { backgroundColor: "#fff" } },
      header: null,
      body: {
        type: "STATE_BOUNDARY",
        id: "GlobalState",
        state: {},
        child: {
          type: "BLOCK",
          id: "selling-group-details-root",
          layout: { type: "FLOW", axis: "vertical" },
          size: {},
          children: [
            // Metadata container — what findRecipeMetaContainer matches.
            {
              type: "DATA",
              recipe_id: recipeId,
              recipe_name: opts.name,
              portions: opts.portions ?? 1,
              image_type: "CUSTOM",
              selling_units: allIngredients.map((i) => ({
                checked: i.checked ?? false,
                ingredient_id: i.ingredient_id,
                quantity: i.quantity ?? 1,
                selling_unit_id: i.selling_unit_id,
                status: "ACTIVE",
                swap_type: null,
              })),
            },
            // Header block: tagline, name, description.
            {
              type: "BLOCK",
              id: "sellable-header-container",
              layout: {},
              size: {},
              children: [
                ...(opts.tagline ? [{ type: "RICH_TEXT", markdown: opts.tagline }] : []),
                ...(opts.name ? [{ type: "RICH_TEXT", markdown: opts.name }] : []),
                ...(opts.description ? [{ type: "RICH_TEXT", markdown: opts.description }] : []),
              ],
            },
            // Image block.
            {
              type: "BLOCK",
              id: "selling-group-details-image-wrapper",
              layout: {},
              size: {},
              children: opts.imageId
                ? [{ type: "IMAGE", source: { id: opts.imageId }, width: 100, height: 100 }]
                : [],
            },
            // Cooking time floats free in the page; put it in a sibling block.
            ...(opts.cookingTime
              ? [
                  {
                    type: "BLOCK",
                    id: "selling-group-content",
                    layout: {},
                    size: {},
                    children: [{ type: "RICH_TEXT", markdown: opts.cookingTime }],
                  },
                ]
              : []),
            listBlock("sellable-components-CORE-list", opts.ingredients),
            listBlock("sellable-components-CORE_STOCKABLE-list", opts.likelyInStock),
            listBlock("sellable-components-CUPBOARD-list", opts.pantry),
            listBlock("sellable-components-COMPLEMENTARY-list", opts.complementary),
            // Instructions — instructions-section is a PML, not a BLOCK.
            {
              type: "BLOCK",
              id: "instructions-block",
              layout: {},
              size: {},
              children: [
                {
                  type: "PML",
                  id: "instructions-section",
                  pml: {
                    component: {
                      type: "STACK",
                      children: stepsTexts,
                    },
                  },
                },
              ],
            },
          ],
        },
      },
    }
  }

  it("extracts the full kip-kormaballetjes-style projection", async () => {
    mockClient.app.getPage.mockResolvedValueOnce(
      recipeDetailsFixture({
        recipeId: "rec-1",
        name: "Kip-kormaballetjes met mangosalsa",
        tagline: "Tropische verrassing",
        description: "Zoet en hartig in één gerecht.",
        cookingTime: "20 min",
        portions: 1,
        imageId: "recipes/abc",
        ingredients: [
          {
            ingredient_id: "ing-1",
            selling_unit_id: "s1015074",
            name: "Kipgehakt",
            brand: "'t Slagershuys",
            price: "3.99",
            unit_quantity: "300 gram",
            needed: "75 g",
            checked: true,
          },
          {
            ingredient_id: "ing-2",
            selling_unit_id: "s1002492",
            name: "Kormasaus",
            brand: "Patak's",
            price: "3.79",
            unit_quantity: "450 gram",
            needed: "0.25 potten",
            checked: true,
          },
        ],
        likelyInStock: [
          {
            ingredient_id: "ing-3",
            selling_unit_id: "s1015456",
            name: "Bio knoflook",
          },
        ],
        pantry: [
          {
            ingredient_id: "ing-4",
            selling_unit_id: "s1006367",
            name: "Zeezout",
            brand: "Verstegen",
          },
        ],
        complementary: [
          {
            ingredient_id: "ing-5",
            selling_unit_id: "s1015360",
            name: "Jalapeno groene pepers",
          },
        ],
        steps: ["Bereid de rijst.", "Maak de gehaktballetjes.", "Snijd de paprika."],
        tip: "Hou je van pittig? Voeg jalapeño toe.",
      }),
    )

    const result = await toolRegistry.executeTool("picnic_get_recipe_details", {
      recipeId: "rec-1",
    })
    const payload = JSON.parse(result.content[0].text!)

    expect(mockClient.app.getPage).toHaveBeenCalledWith(
      "selling-group-details-page?selling_group_id=rec-1",
    )
    expect(payload.recipe_id).toBe("rec-1")
    expect(payload.name).toBe("Kip-kormaballetjes met mangosalsa")
    expect(payload.tagline).toBe("Tropische verrassing")
    expect(payload.description).toBe("Zoet en hartig in één gerecht.")
    expect(payload.cooking_time).toBe("20 min")
    expect(payload.portions).toBe(1)
    expect(payload.image_id).toBe("recipes/abc")

    expect(payload.ingredients).toHaveLength(2)
    expect(payload.ingredients[0]).toMatchObject({
      selling_unit_id: "s1015074",
      ingredient_id: "ing-1",
      name: "Kipgehakt",
      brand: "'t Slagershuys",
      price: 399,
      unit_quantity: "300 gram",
      needed: "75 g",
      quantity: 1,
      checked: true,
    })

    expect(payload.likely_in_stock).toHaveLength(1)
    expect(payload.likely_in_stock[0].name).toBe("Bio knoflook")

    expect(payload.pantry).toHaveLength(1)
    expect(payload.pantry[0].name).toBe("Zeezout")
    expect(payload.pantry[0].brand).toBe("Verstegen")

    expect(payload.complementary).toHaveLength(1)
    expect(payload.complementary[0].name).toBe("Jalapeno groene pepers")

    expect(payload.steps).toEqual([
      "Bereid de rijst.",
      "Maak de gehaktballetjes.",
      "Snijd de paprika.",
    ])
    expect(payload.tip).toBe("Hou je van pittig? Voeg jalapeño toe.")
  })

  it("parses localized step and tip headers (DE and FR)", async () => {
    mockClient.app.getPage.mockResolvedValueOnce(
      recipeDetailsFixture({
        recipeId: "rec-de",
        name: "Nudeln",
        steps: ["Nudeln kochen.", "Soße zubereiten."],
        tip: "Mit Parmesan servieren.",
        stepHeaderPrefix: "Schritt",
        tipHeader: "Tipp",
      }),
    )

    let result = await toolRegistry.executeTool("picnic_get_recipe_details", {
      recipeId: "rec-de",
    })
    let payload = JSON.parse(result.content[0].text!)
    expect(payload.steps).toEqual(["Nudeln kochen.", "Soße zubereiten."])
    expect(payload.tip).toBe("Mit Parmesan servieren.")

    mockClient.app.getPage.mockResolvedValueOnce(
      recipeDetailsFixture({
        recipeId: "rec-fr",
        name: "Ratatouille",
        steps: ["Coupez les légumes."],
        tip: "Servez avec du riz.",
        stepHeaderPrefix: "Étape",
        tipHeader: "Astuce",
      }),
    )

    result = await toolRegistry.executeTool("picnic_get_recipe_details", {
      recipeId: "rec-fr",
    })
    payload = JSON.parse(result.content[0].text!)
    expect(payload.steps).toEqual(["Coupez les légumes."])
    expect(payload.tip).toBe("Servez avec du riz.")
  })

  it("does not let an extra header chip shift name, tagline or description", async () => {
    // If Picnic inserts a badge or duration chip between the name and the
    // description, the fields must stay grounded on the canonical name
    // rather than silently shifting by slot index.
    const fixture = recipeDetailsFixture({
      recipeId: "rec-chip",
      name: "Spaghetti",
      tagline: "Klassieker",
      description: "Een snelle doordeweekse pasta.",
    })
    type HeaderBlock = { id?: string; children?: Array<{ type: string; markdown: string }> }
    const findHeader = (n: unknown): HeaderBlock | null => {
      if (!n || typeof n !== "object") return null
      const obj = n as HeaderBlock & Record<string, unknown>
      if (obj.id === "sellable-header-container") return obj
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) {
          for (const c of v) {
            const r = findHeader(c)
            if (r) return r
          }
        } else if (v && typeof v === "object") {
          const r = findHeader(v)
          if (r) return r
        }
      }
      return null
    }
    const header = findHeader(fixture)
    // [tagline, name, "Nieuw", description]
    header!.children!.splice(2, 0, { type: "RICH_TEXT", markdown: "Nieuw" })
    mockClient.app.getPage.mockResolvedValueOnce(fixture)

    const result = await toolRegistry.executeTool("picnic_get_recipe_details", {
      recipeId: "rec-chip",
    })
    const payload = JSON.parse(result.content[0].text!)
    expect(payload.name).toBe("Spaghetti")
    expect(payload.tagline).toBe("Klassieker")
    expect(payload.description).toBe("Een snelle doordeweekse pasta.")
  })

  it("URL-encodes the recipe id when fetching", async () => {
    mockClient.app.getPage.mockResolvedValueOnce(recipeDetailsFixture({ recipeId: "weird/id" }))

    await toolRegistry.executeTool("picnic_get_recipe_details", { recipeId: "weird/id" })

    expect(mockClient.app.getPage).toHaveBeenCalledWith(
      "selling-group-details-page?selling_group_id=weird%2Fid",
    )
  })

  it("strips Picnic's color markers and bold markdown from text fields", async () => {
    // Picnic wraps colored text as `#(#hexcolor)text#(#hexcolor)` and uses
    // `**bold**` for emphasis; both must be stripped from extracted strings.
    mockClient.app.getPage.mockResolvedValueOnce(
      recipeDetailsFixture({
        recipeId: "rec-2",
        name: "Recipe",
        cookingTime: "#(#333333)20 min#(#333333)",
        ingredients: [
          {
            ingredient_id: "i1",
            selling_unit_id: "s1",
            name: "**Bio** sjalotten",
            price: "1.39",
            unit_quantity: "250 gram",
          },
        ],
      }),
    )

    const result = await toolRegistry.executeTool("picnic_get_recipe_details", {
      recipeId: "rec-2",
    })
    const payload = JSON.parse(result.content[0].text!)

    expect(payload.cooking_time).toBe("20 min")
    expect(payload.ingredients[0].name).toBe("Bio sjalotten")
  })

  it("parses prices in DE-locale (comma decimal)", async () => {
    // Picnic uses '.' for decimals in NL but ',' in DE — both should
    // resolve to the same cent value.
    mockClient.app.getPage.mockResolvedValueOnce(
      recipeDetailsFixture({
        recipeId: "rec-de",
        name: "Recipe",
        ingredients: [
          {
            ingredient_id: "i1",
            selling_unit_id: "s1",
            name: "Mehl",
            price: "1,39",
            unit_quantity: "1 kg",
          },
        ],
      }),
    )

    const result = await toolRegistry.executeTool("picnic_get_recipe_details", {
      recipeId: "rec-de",
    })
    const payload = JSON.parse(result.content[0].text!)
    expect(payload.ingredients[0].price).toBe(139)
  })

  it("parses comma-decimal and spelled-out unit quantities", async () => {
    mockClient.app.getPage.mockResolvedValueOnce(
      recipeDetailsFixture({
        recipeId: "rec-units",
        name: "Recipe",
        ingredients: [
          { ingredient_id: "i1", selling_unit_id: "s1", name: "Melk", unit_quantity: "1,5 l" },
          { ingredient_id: "i2", selling_unit_id: "s2", name: "Sap", unit_quantity: "1 liter" },
        ],
      }),
    )

    const result = await toolRegistry.executeTool("picnic_get_recipe_details", {
      recipeId: "rec-units",
    })
    const payload = JSON.parse(result.content[0].text!)
    expect(payload.ingredients[0].unit_quantity).toBe("1,5 l")
    expect(payload.ingredients[1].unit_quantity).toBe("1 liter")
  })

  it("keeps product names that start with a digit", async () => {
    // Names like "100% pindakaas" / "30+ kaas" begin with a digit but are not
    // quantities/prices and must not be filtered out of the name slot.
    mockClient.app.getPage.mockResolvedValueOnce(
      recipeDetailsFixture({
        recipeId: "rec-digit",
        name: "Recipe",
        ingredients: [
          {
            ingredient_id: "i1",
            selling_unit_id: "s1",
            name: "100% pindakaas",
            brand: "Calvé",
            price: "3.49",
            unit_quantity: "350 gram",
          },
        ],
      }),
    )

    const result = await toolRegistry.executeTool("picnic_get_recipe_details", {
      recipeId: "rec-digit",
    })
    const payload = JSON.parse(result.content[0].text!)
    expect(payload.ingredients[0].name).toBe("100% pindakaas")
    expect(payload.ingredients[0].brand).toBe("Calvé")
  })

  it("does not let a price/promo label become the ingredient name", async () => {
    // A "nu €2.29" promo label can precede the real name in the tile; it must
    // not win the name slot and push the real name into `brand`.
    const fixture = recipeDetailsFixture({
      recipeId: "rec-promo",
      name: "Recipe",
      ingredients: [
        {
          ingredient_id: "i1",
          selling_unit_id: "s1",
          name: "Mexicaanse roerbak",
          price: "2.29",
          unit_quantity: "400 gram",
        },
      ],
    })
    type Tile = { id?: string; pml?: { component?: { children?: unknown[] } } }
    const findTile = (n: unknown): Tile | null => {
      if (!n || typeof n !== "object") return null
      const obj = n as Tile & Record<string, unknown>
      if (obj.id === "core-wide-selling-unit-tile-i1") return obj
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) {
          for (const c of v) {
            const r = findTile(c)
            if (r) return r
          }
        } else if (v && typeof v === "object") {
          const r = findTile(v)
          if (r) return r
        }
      }
      return null
    }
    // Prepend the promo label before the name, the way Picnic orders it.
    findTile(fixture)!.pml!.component!.children!.unshift({
      type: "RICH_TEXT",
      markdown: "nu €2.29",
    })
    mockClient.app.getPage.mockResolvedValueOnce(fixture)

    const result = await toolRegistry.executeTool("picnic_get_recipe_details", {
      recipeId: "rec-promo",
    })
    const payload = JSON.parse(result.content[0].text!)
    expect(payload.ingredients[0].name).toBe("Mexicaanse roerbak")
    expect(payload.ingredients[0].brand).toBeUndefined()
  })

  it("parses NFD-encoded localized step headers", async () => {
    // A FR response may deliver "Étape" in NFD form (E + combining acute);
    // matching must not depend on the Unicode normal form.
    const nfd = "Étape".normalize("NFD")
    expect(nfd).not.toBe("Étape") // sanity: fixture really is decomposed
    mockClient.app.getPage.mockResolvedValueOnce(
      recipeDetailsFixture({
        recipeId: "rec-nfd",
        name: "Ratatouille",
        steps: ["Coupez les légumes."],
        stepHeaderPrefix: nfd,
        tipHeader: "Astuce",
        tip: "Servez chaud.",
      }),
    )

    const result = await toolRegistry.executeTool("picnic_get_recipe_details", {
      recipeId: "rec-nfd",
    })
    const payload = JSON.parse(result.content[0].text!)
    expect(payload.steps).toEqual(["Coupez les légumes."])
    expect(payload.tip).toBe("Servez chaud.")
  })

  it("does not bleed trailing prose into the brand field", async () => {
    // Picnic occasionally embeds an allergen / promo sentence after the
    // brand. The brand slot should stay empty (or hold a real short label),
    // not capture an entire sentence.
    const fixture = recipeDetailsFixture({
      recipeId: "rec-noisy",
      name: "Recipe",
      ingredients: [
        {
          ingredient_id: "i1",
          selling_unit_id: "s1",
          name: "Komkommer",
          price: "0.85",
          unit_quantity: "1 stuk",
        },
      ],
    })
    // Inject a long sentence into the tile, right after the name. We locate
    // the tile by id rather than by index so the test is robust to fixture
    // re-ordering.
    type Tile = {
      id?: string
      pml?: { component?: { children?: Array<{ type: string; markdown: string }> } }
    }
    const findTile = (n: unknown): Tile | null => {
      if (!n || typeof n !== "object") return null
      const obj = n as Tile & Record<string, unknown>
      if (obj.id === "core-wide-selling-unit-tile-i1") return obj
      for (const v of Object.values(obj)) {
        if (Array.isArray(v)) {
          for (const c of v) {
            const r = findTile(c)
            if (r) return r
          }
        } else if (v && typeof v === "object") {
          const r = findTile(v)
          if (r) return r
        }
      }
      return null
    }
    const tile = findTile(fixture)
    tile!.pml!.component!.children!.splice(1, 0, {
      type: "RICH_TEXT",
      markdown: "Bevat geen allergenen. Geschikt voor vegetariërs!",
    })
    mockClient.app.getPage.mockResolvedValueOnce(fixture)

    const result = await toolRegistry.executeTool("picnic_get_recipe_details", {
      recipeId: "rec-noisy",
    })
    const payload = JSON.parse(result.content[0].text!)
    expect(payload.ingredients[0].name).toBe("Komkommer")
    expect(payload.ingredients[0].brand).toBeUndefined()
  })

  it("rejects an empty recipeId", async () => {
    await expect(
      toolRegistry.executeTool("picnic_get_recipe_details", { recipeId: "" }),
    ).rejects.toThrow(/Invalid input/)
    expect(mockClient.app.getPage).not.toHaveBeenCalled()
  })

  it("returns the raw FusionPage when full=true", async () => {
    const fixture = recipeDetailsFixture({ recipeId: "rec-3", name: "X" })
    mockClient.app.getPage.mockResolvedValueOnce(fixture)

    const result = await toolRegistry.executeTool("picnic_get_recipe_details", {
      recipeId: "rec-3",
      full: true,
    })
    const payload = JSON.parse(result.content[0].text!)

    expect(payload.id).toBe("selling-group-details-page")
    expect(payload.body).toBeDefined()
    expect(payload.ingredients).toBeUndefined()
  })

  it("returns empty arrays when sections are missing", async () => {
    // No ingredients/steps at all — extractor should not throw.
    mockClient.app.getPage.mockResolvedValueOnce(recipeDetailsFixture({ recipeId: "rec-4" }))

    const result = await toolRegistry.executeTool("picnic_get_recipe_details", {
      recipeId: "rec-4",
    })
    const payload = JSON.parse(result.content[0].text!)

    expect(payload.ingredients).toEqual([])
    expect(payload.likely_in_stock).toEqual([])
    expect(payload.pantry).toEqual([])
    expect(payload.complementary).toEqual([])
    expect(payload.steps).toEqual([])
    expect(payload.tip).toBeUndefined()
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

  it("rejects empty recipe IDs before save or unsave calls Picnic", async () => {
    await expect(toolRegistry.executeTool("picnic_save_recipe", { recipeId: "" })).rejects.toThrow(
      /Invalid input/,
    )
    await expect(
      toolRegistry.executeTool("picnic_unsave_recipe", { recipeId: "" }),
    ).rejects.toThrow(/Invalid input/)

    expect(mockClient.recipe.saveRecipe).not.toHaveBeenCalled()
    expect(mockClient.recipe.unsaveRecipe).not.toHaveBeenCalled()
  })
})
