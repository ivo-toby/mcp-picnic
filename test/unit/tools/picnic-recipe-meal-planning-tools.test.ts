import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ToolResult } from "../../../src/tools/registry.js"

const mocks = vi.hoisted(() => ({
  initializePicnicClient: vi.fn(),
  sendRequest: vi.fn(),
}))

vi.mock("../../../src/utils/picnic-client.js", () => ({
  getPicnicClient: () => ({ sendRequest: mocks.sendRequest }),
  initializePicnicClient: mocks.initializePicnicClient,
  saveSession: vi.fn(),
}))

const RECIPE_A = "0123456789abcdef01234567"
const RECIPE_B = "fedcba9876543210fedcba98"

function parseToolResult(result: ToolResult) {
  return JSON.parse(result.content[0].text ?? "")
}

function recipePage(recipeId: string, recipeName: string) {
  return {
    body: [
      {
        type: "PML",
        analytics: {
          contexts: [
            {
              data: {
                recipe_id: recipeId,
                recipe_name: recipeName,
                portions: 2,
                selling_units: [
                  {
                    ingredient_id: `ingredient-${recipeId}`,
                    selling_unit_id: `s-${recipeId}`,
                    quantity: 2,
                    checked: true,
                  },
                ],
              },
            },
          ],
        },
      },
      {
        type: "PML",
        analytics: {
          contexts: [
            {
              schema: "iglu:com.picnic/product/1-0-0",
              data: { product_id: `ingredient-${recipeId}` },
            },
          ],
        },
        pml: {
          component: {
            type: "STACK",
            children: [
              { type: "RICH_TEXT", markdown: `${recipeName} ingredient` },
              { type: "RICH_TEXT", markdown: "500 g" },
              { type: "RICH_TEXT", markdown: "€1,25" },
            ],
          },
        },
      },
    ],
  }
}

async function loadTools() {
  vi.resetModules()
  const { toolRegistry } = await import("../../../src/tools/registry.js")
  const registerSpy = vi.spyOn(toolRegistry, "register")
  await import("../../../src/tools/picnic-tools.js")
  return { registerSpy, toolRegistry }
}

describe("recipe meal-planning tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("fetches structured recipe ingredients by URL and requests the encoded selling-group page", async () => {
    mocks.sendRequest.mockResolvedValue(recipePage(RECIPE_A, "Recipe A"))

    const { toolRegistry } = await loadTools()
    const result = await toolRegistry.executeTool("picnic_get_recipe_ingredients", {
      recipe_url_or_id: `https://picnic.app/de/rezepte/${RECIPE_A}/recipe-a`,
    })

    expect(mocks.sendRequest).toHaveBeenCalledWith(
      "GET",
      `/pages/selling-group-details-page?selling_group_id=${encodeURIComponent(RECIPE_A)}`,
      null,
      true,
    )
    expect(parseToolResult(result)).toEqual({
      recipeId: RECIPE_A,
      recipeName: "Recipe A",
      portions: 2,
      ingredients: [
        {
          ingredientId: `ingredient-${RECIPE_A}`,
          sellingUnitId: `s-${RECIPE_A}`,
          name: "Recipe A ingredient",
          packageInfo: "500 g",
          priceCents: 125,
          quantity: 2,
          isPantryItem: false,
        },
      ],
    })
  })

  it("returns successes and per-input errors when fetching multiple recipe ingredients", async () => {
    mocks.sendRequest.mockImplementation((method: string, path: string) => {
      if (path.includes(RECIPE_B)) throw new Error("Recipe unavailable")
      return recipePage(RECIPE_A, "Recipe A")
    })

    const { toolRegistry } = await loadTools()
    const result = await toolRegistry.executeTool("picnic_get_multiple_recipe_ingredients", {
      recipe_urls_or_ids: [RECIPE_A, RECIPE_B],
    })

    expect(parseToolResult(result)).toEqual({
      recipes: [
        {
          recipeId: RECIPE_A,
          recipeName: "Recipe A",
          portions: 2,
          ingredients: [
            {
              ingredientId: `ingredient-${RECIPE_A}`,
              sellingUnitId: `s-${RECIPE_A}`,
              name: "Recipe A ingredient",
              packageInfo: "500 g",
              priceCents: 125,
              quantity: 2,
              isPantryItem: false,
            },
          ],
        },
      ],
      errors: [{ input: RECIPE_B, error: "Recipe unavailable" }],
    })
  })

  it("registers the existing recipe cart tool only once", async () => {
    const { registerSpy } = await loadTools()

    const recipeCartRegistrations = registerSpy.mock.calls.filter(
      ([tool]) => tool.name === "picnic_add_recipe_to_cart",
    )

    expect(recipeCartRegistrations).toHaveLength(1)
  })
})
