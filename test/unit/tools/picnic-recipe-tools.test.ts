import { beforeEach, describe, expect, it, vi } from "vitest"
import type { ToolResult } from "../../../src/tools/registry.js"

const mocks = vi.hoisted(() => ({
  initializePicnicClient: vi.fn(),
  sendRequest: vi.fn(),
  verifyPicnic2FACode: vi.fn(),
}))

vi.mock("../../../src/utils/picnic-client.js", () => ({
  getPicnicClient: () => ({
    url: "https://storefront-prod.nl.picnicinternational.com/api/15",
    sendRequest: mocks.sendRequest,
  }),
  initializePicnicClient: mocks.initializePicnicClient,
  saveSession: vi.fn(),
  verifyPicnic2FACode: mocks.verifyPicnic2FACode,
}))

const RECIPE_A = "0123456789abcdef01234567"
const RECIPE_B = "fedcba9876543210fedcba98"

function parseToolResult(result: ToolResult) {
  return JSON.parse(result.content[0].text ?? "")
}

function richText(markdown: string) {
  return { type: "RICH_TEXT", markdown }
}

function recipeTile(recipeId: string, name: string, segmentType = "NEW_RECIPES") {
  return {
    type: "PML",
    analytics: {
      contexts: [
        {
          data: { type: "recipe_tile", template_id: "cookbook-recipe-tile" },
          schema: "iglu:x/pml_component/1",
        },
        {
          data: { segment_name: segmentType, segment_type: segmentType },
          schema: "iglu:x/segment/1",
        },
      ],
    },
    pml: {
      component: {
        type: "TOUCHABLE",
        onPress: {
          type: "EXPRESSION",
          expression: `onPMLAction({ actionType: "OPEN", target: "app.picnic://store/page;id=selling-group-details-page,selling_group_id=${recipeId}" })`,
        },
        child: {
          type: "STACK",
          children: [
            { type: "IMAGE", source: { id: `image-${recipeId}`, namespace: "recipes" } },
            richText(name),
          ],
        },
      },
    },
  }
}

function categoryLink(pageId: string) {
  return {
    type: "TOUCHABLE",
    onPress: {
      actionType: "OPEN",
      target: `nl.picnic-supermarkt://store/page;id=${pageId}`,
    },
  }
}

function recipeListPage(children: unknown[]) {
  return {
    id: "cookbook-page-content",
    body: {
      type: "STATE_BOUNDARY",
      child: {
        type: "BLOCK",
        children,
      },
    },
  }
}

async function loadTools() {
  vi.resetModules()
  const { toolRegistry } = await import("../../../src/tools/registry.js")
  await import("../../../src/tools/picnic-tools.js")
  return toolRegistry
}

describe("recipe tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("surfaces recipe category page IDs from the cookbook root", async () => {
    mocks.sendRequest.mockResolvedValue(
      recipeListPage([
        recipeTile(RECIPE_A, "Quick chicken"),
        categoryLink("recipe_cattree_20minuten"),
        categoryLink("recipe-cattree-jamie-oliver"),
      ]),
    )

    const toolRegistry = await loadTools()
    const result = await toolRegistry.executeTool("picnic_browse_recipes", {})
    const payload = parseToolResult(result)

    expect(mocks.sendRequest).toHaveBeenCalledWith(
      "GET",
      "/pages/cookbook-page-content",
      null,
      true,
    )
    expect(payload.categories).toEqual(["recipe_cattree_20minuten", "recipe-cattree-jamie-oliver"])
  })

  it("falls back to the dash-form page ID when a bare category's underscore page is missing", async () => {
    mocks.sendRequest.mockImplementation((method: string, path: string) => {
      if (path === "/pages/recipe_cattree_jamie-oliver") {
        throw new Error("page-template not found")
      }
      if (path === "/pages/recipe-cattree-jamie-oliver") {
        return recipeListPage([recipeTile(RECIPE_A, "Jamie chicken")])
      }
      throw new Error(`Unexpected request: ${method} ${path}`)
    })

    const toolRegistry = await loadTools()
    const result = await toolRegistry.executeTool("picnic_browse_recipes", {
      category: "jamie-oliver",
    })
    const payload = parseToolResult(result)

    expect(mocks.sendRequest).toHaveBeenNthCalledWith(
      1,
      "GET",
      "/pages/recipe_cattree_jamie-oliver",
      null,
      true,
    )
    expect(mocks.sendRequest).toHaveBeenNthCalledWith(
      2,
      "GET",
      "/pages/recipe-cattree-jamie-oliver",
      null,
      true,
    )
    expect(payload.pageId).toBe("recipe-cattree-jamie-oliver")
    expect(payload.recipes[0].recipeId).toBe(RECIPE_A)
  })

  it("passes full category page IDs through unchanged", async () => {
    mocks.sendRequest.mockResolvedValue(recipeListPage([recipeTile(RECIPE_B, "Theme recipe")]))

    const toolRegistry = await loadTools()
    await toolRegistry.executeTool("picnic_browse_recipes", {
      category: "recipe-cattree-jamie-oliver",
    })

    expect(mocks.sendRequest).toHaveBeenCalledWith(
      "GET",
      "/pages/recipe-cattree-jamie-oliver",
      null,
      true,
    )
  })

  it("rejects category input that could alter the authenticated page path", async () => {
    const toolRegistry = await loadTools()

    for (const category of ["../cart", "recipe_cattree_../cart", "vega?x=1", "a/b", "a#b", "."]) {
      await expect(toolRegistry.executeTool("picnic_browse_recipes", { category })).rejects.toThrow(
        /Invalid input/,
      )
    }

    expect(mocks.sendRequest).not.toHaveBeenCalled()
  })

  it("rejects empty recipe references before save or unsave calls Picnic", async () => {
    const toolRegistry = await loadTools()

    await expect(
      toolRegistry.executeTool("picnic_save_recipe", { recipe_url_or_id: "" }),
    ).rejects.toThrow(/Invalid input/)
    await expect(
      toolRegistry.executeTool("picnic_unsave_recipe", { recipe_url_or_id: "" }),
    ).rejects.toThrow(/Invalid input/)

    expect(mocks.sendRequest).not.toHaveBeenCalled()
  })
})
