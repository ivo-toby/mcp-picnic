import { describe, it, expect, beforeEach, beforeAll, vi } from "vitest"

// Mock the picnic-client utility before importing the tools module so that
// the registered tool handlers resolve our fake client instead of trying
// to authenticate against the real Picnic API.
const mockGetRecipesPage = vi.fn()
const mockGetRecipeDetailsPage = vi.fn()
const mockSaveRecipe = vi.fn()
const mockUnsaveRecipe = vi.fn()
const mockAddProductToRecipe = vi.fn()
const mockRemoveProductFromRecipe = vi.fn()

const mockClient = {
  recipe: {
    getRecipesPage: mockGetRecipesPage,
    getRecipeDetailsPage: mockGetRecipeDetailsPage,
    saveRecipe: mockSaveRecipe,
    unsaveRecipe: mockUnsaveRecipe,
    addProductToRecipe: mockAddProductToRecipe,
    removeProductFromRecipe: mockRemoveProductFromRecipe,
  },
}

vi.mock("../../../src/utils/picnic-client.js", () => ({
  getPicnicClient: () => mockClient,
  initializePicnicClient: vi.fn().mockResolvedValue(undefined),
  saveSession: vi.fn().mockResolvedValue(undefined),
}))

import { toolRegistry } from "../../../src/tools/registry.js"

describe("recipe tools", () => {
  beforeAll(async () => {
    // Importing the module registers all picnic tools (including the recipe
    // tools) on the shared toolRegistry. We import after the mock is set up.
    await import("../../../src/tools/picnic-tools.js")
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  function parseToolResult(result: { content: Array<{ type: string; text?: string }> }) {
    expect(result.content).toHaveLength(1)
    expect(result.content[0].type).toBe("text")
    const text = result.content[0].text!
    try {
      return JSON.parse(text)
    } catch {
      return text
    }
  }

  describe("picnic_get_recipes", () => {
    it("returns the recipes overview page from the client", async () => {
      const fakePage = { id: "recipes", presentation: { type: "FULL_SCREEN" } }
      mockGetRecipesPage.mockResolvedValue(fakePage)

      const result = await toolRegistry.executeTool("picnic_get_recipes", {})

      expect(mockGetRecipesPage).toHaveBeenCalledOnce()
      expect(parseToolResult(result)).toEqual(fakePage)
    })
  })

  describe("picnic_get_recipe_details", () => {
    it("forwards the recipeId to the client and returns the page", async () => {
      const fakePage = { id: "recipe-detail", body: {} }
      mockGetRecipeDetailsPage.mockResolvedValue(fakePage)

      const result = await toolRegistry.executeTool("picnic_get_recipe_details", {
        recipeId: "r-123",
      })

      expect(mockGetRecipeDetailsPage).toHaveBeenCalledWith("r-123")
      expect(parseToolResult(result)).toEqual(fakePage)
    })

    it("rejects when recipeId is missing", async () => {
      await expect(toolRegistry.executeTool("picnic_get_recipe_details", {})).rejects.toThrow(
        /Invalid input/,
      )
    })
  })

  describe("picnic_save_recipe", () => {
    it("calls saveRecipe and returns a confirmation", async () => {
      mockSaveRecipe.mockResolvedValue({})

      const result = await toolRegistry.executeTool("picnic_save_recipe", {
        recipeId: "r-42",
      })

      expect(mockSaveRecipe).toHaveBeenCalledWith("r-42")
      expect(parseToolResult(result)).toEqual({
        message: "Recipe saved",
        recipeId: "r-42",
      })
    })
  })

  describe("picnic_unsave_recipe", () => {
    it("calls unsaveRecipe and returns a confirmation", async () => {
      mockUnsaveRecipe.mockResolvedValue({})

      const result = await toolRegistry.executeTool("picnic_unsave_recipe", {
        recipeId: "r-42",
      })

      expect(mockUnsaveRecipe).toHaveBeenCalledWith("r-42")
      expect(parseToolResult(result)).toEqual({
        message: "Recipe unsaved",
        recipeId: "r-42",
      })
    })
  })

  describe("picnic_add_product_to_recipe", () => {
    it("forwards all fields and returns the filtered cart", async () => {
      mockAddProductToRecipe.mockResolvedValue({
        type: "ORDER",
        id: "cart-1",
        items: [],
        total_count: 0,
        total_price: 0,
        checkout_total_price: 0,
        total_savings: 0,
      })

      const result = await toolRegistry.executeTool("picnic_add_product_to_recipe", {
        productId: "s1001",
        recipeId: "r-7",
        sectionId: "section-1",
        count: 2,
      })

      expect(mockAddProductToRecipe).toHaveBeenCalledWith("s1001", "r-7", "section-1", 2)
      const parsed = parseToolResult(result)
      expect(parsed).toMatchObject({
        message: "Added 2 item(s) to cart from recipe",
        recipeId: "r-7",
        cart: { id: "cart-1", type: "ORDER" },
      })
    })

    it("defaults count to 1 and allows omitting sectionId", async () => {
      mockAddProductToRecipe.mockResolvedValue({
        type: "ORDER",
        id: "cart-1",
        items: [],
      })

      await toolRegistry.executeTool("picnic_add_product_to_recipe", {
        productId: "s1001",
        recipeId: "r-7",
      })

      expect(mockAddProductToRecipe).toHaveBeenCalledWith("s1001", "r-7", undefined, 1)
    })
  })

  describe("picnic_remove_product_from_recipe", () => {
    it("forwards all fields and returns the filtered cart", async () => {
      mockRemoveProductFromRecipe.mockResolvedValue({
        type: "ORDER",
        id: "cart-2",
        items: [],
      })

      const result = await toolRegistry.executeTool("picnic_remove_product_from_recipe", {
        productId: "s2002",
        recipeId: "r-9",
        sectionId: "section-2",
        count: 3,
      })

      expect(mockRemoveProductFromRecipe).toHaveBeenCalledWith("s2002", "r-9", "section-2", 3)
      const parsed = parseToolResult(result)
      expect(parsed).toMatchObject({
        message: "Removed 3 item(s) from cart in recipe",
        recipeId: "r-9",
        cart: { id: "cart-2", type: "ORDER" },
      })
    })

    it("rejects count below 1", async () => {
      await expect(
        toolRegistry.executeTool("picnic_remove_product_from_recipe", {
          productId: "s2002",
          recipeId: "r-9",
          count: 0,
        }),
      ).rejects.toThrow(/Invalid input/)
    })
  })

  describe("registration", () => {
    it("registers all six recipe tools", () => {
      const names = toolRegistry.getToolsList().map((t) => t.name)
      expect(names).toEqual(
        expect.arrayContaining([
          "picnic_get_recipes",
          "picnic_get_recipe_details",
          "picnic_save_recipe",
          "picnic_unsave_recipe",
          "picnic_add_product_to_recipe",
          "picnic_remove_product_from_recipe",
        ]),
      )
    })
  })
})
