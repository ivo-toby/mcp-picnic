import { describe, it, expect, vi, afterEach } from "vitest"
import {
  resolveRecipeId,
  parseSellingGroupRecipe,
  parseRecipeList,
  buildRecipeSourceUrl,
} from "../../../src/utils/recipe-parser.js"

const RECIPE_ID = "0123456789abcdef01234567"
// User-defined recipe ids are 32 hex chars (catalog recipe ids are 24).
const OWN_ID = "fedcba9876543210fedcba9876543210"
const NEW_ID = "aaaaaaaaaaaaaaaaaaaaaaaa"
const IMAGE_BASE = "https://cdn.example/static/images"

function richText(markdown: string) {
  return { type: "RICH_TEXT", markdown }
}

function suspense(parameters: Record<string, unknown>) {
  return { type: "SUSPENSE", suspenseId: "s", pageConfig: { id: "selling-group-x", parameters } }
}

function detailPage(lines: string[], structured: Record<string, unknown>[]) {
  return {
    id: "selling-group-details-page-root",
    body: {
      type: "STATE_BOUNDARY",
      child: {
        type: "BLOCK",
        children: [
          ...structured.map(suspense),
          { type: "PML", pml: { component: { type: "STACK", children: lines.map(richText) } } },
        ],
      },
    },
  }
}

describe("resolveRecipeId", () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("returns a bare recipe id unchanged (24- or 32-char)", async () => {
    await expect(resolveRecipeId(`  ${RECIPE_ID}  `)).resolves.toBe(RECIPE_ID)
    await expect(resolveRecipeId(OWN_ID)).resolves.toBe(OWN_ID)
    await expect(resolveRecipeId(`https://picnic.app/de/rezepte/${OWN_ID}/own`)).resolves.toBe(OWN_ID)
  })

  it("extracts the id from full recipe URLs across markets and deep links", async () => {
    await expect(resolveRecipeId(`https://picnic.app/de/rezepte/${RECIPE_ID}/gyros`)).resolves.toBe(RECIPE_ID)
    await expect(resolveRecipeId(`https://picnic.app/nl/recepten/${RECIPE_ID}/x`)).resolves.toBe(RECIPE_ID)
    await expect(resolveRecipeId(`https://picnic.app/fr/recettes/${RECIPE_ID}?u=1`)).resolves.toBe(RECIPE_ID)
    await expect(
      resolveRecipeId(`app.picnic://store/page;id=selling-group-details-page,selling_group_id=${RECIPE_ID}`),
    ).resolves.toBe(RECIPE_ID)
  })

  it("follows a short share link redirect on picnic.app", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ url: `https://picnic.app/de/rezepte/${RECIPE_ID}?path=selling_group_id%3D${RECIPE_ID}` }),
    )
    await expect(resolveRecipeId("https://picnic.app/de/go/abc123")).resolves.toBe(RECIPE_ID)
  })

  it("refuses to request a non-picnic host (SSRF guard)", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await expect(resolveRecipeId("https://10.0.0.5/")).rejects.toThrow(/picnic\.app/)
    await expect(resolveRecipeId("http://169.254.169.254/")).rejects.toThrow()
    await expect(resolveRecipeId("http://picnic.app/de/go/x")).rejects.toThrow(/non-https/)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses when a picnic.app link redirects off-domain", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ url: "https://evil.example/internal" }))
    await expect(resolveRecipeId("https://picnic.app/de/go/xxx")).rejects.toThrow(/redirected off/)
  })

  it("throws when no id can be extracted", async () => {
    await expect(resolveRecipeId("not-a-recipe")).rejects.toThrow(/Cannot extract/)
  })
})

describe("parseSellingGroupRecipe", () => {
  it("parses a recipe robustly despite a stray product-card 'Zubereitung'", () => {
    const page = detailPage(
      [
        "Gyros-Reispfanne mit Feta",
        "One-Pot-Favorit",
        "20 min",
        "Gesamt",
        "Zubereitung", // stray product-card tab — must NOT hijack instructions
        "Paprika Mix",
        "2.24",
        "(1 Stk. benötigt)",
        "1 Portion des Originalrezepts enthält ungefähr:", // nutrition header — must NOT become servings
        "Zutaten",
        "**Paprika** 1 Stk.",
        "**Basmatireis** 100 g",
        "**Gyros** 250 g",
        "**Eigene Zutaten:** 0.5 Stk. Knoblauch, Olivenöl, Salz und Pfeffer",
        "**Du benötigst:** Bratpfanne",
        "So wird's gemacht",
        "2 Portionen",
        "Schritt 1",
        "Paprika waschen und würfeln.",
        "Schritt 2",
        "Gyros anbraten. [Zurück zum Original](action://open-undo)",
        "Tipp",
        "Dazu passt ein Salat.",
      ],
      [
        {
          selling_group_title_section_data: {
            name: "Gyros-Reispfanne mit Feta",
            description: "Eine schnelle One-Pot-Reispfanne.",
            quality_cue: "One-Pot-Favorit",
          },
        },
        { selling_group_image_data: { images: { images: [{ id: "img1", namespace: "recipes", primary: true }] } } },
        { selling_group_header_data: { is_saved: true, default_portions: 4 } },
        { portions: 2 },
      ],
    )

    const r = parseSellingGroupRecipe(page, { imageBaseUrl: IMAGE_BASE })
    expect(r.name).toBe("Gyros-Reispfanne mit Feta")
    expect(r.qualityCue).toBe("One-Pot-Favorit")
    expect(r.totalTime).toBe("20 min")
    expect(r.servings).toBe("2 Portionen")
    expect(r.isSaved).toBe(true)
    expect(r.imageUrl).toBe(`${IMAGE_BASE}/recipes/img1/large.png`)
    expect(r.ingredients).toEqual(["Paprika 1 Stk.", "Basmatireis 100 g", "Gyros 250 g"])
    expect(r.pantryIngredients).toEqual(["0.5 Stk. Knoblauch", "Olivenöl", "Salz und Pfeffer"])
    expect(r.tools).toEqual(["Bratpfanne"])
    expect(r.instructions).toEqual([
      "Paprika waschen und würfeln.",
      "Gyros anbraten. Zurück zum Original", // action link stripped to its label
    ])
    expect(r.tips).toEqual(["Dazu passt ein Salat."])
  })

  it("parses Dutch and French recipes via localized headers and step labels", () => {
    const nl = detailPage(
      ["Ingrediënten", "**Rijst** 200 g", "Bereiding", "4 porties", "Stap 1", "Kook de rijst."],
      [{ selling_group_title_section_data: { name: "Rijstschotel", description: null } }],
    )
    const rnl = parseSellingGroupRecipe(nl)
    expect(rnl.name).toBe("Rijstschotel")
    expect(rnl.servings).toBe("4 porties")
    expect(rnl.ingredients).toEqual(["Rijst 200 g"])
    expect(rnl.instructions).toEqual(["Kook de rijst."])

    const fr = detailPage(
      ["Ingrédients", "**Riz** 200 g", "Préparation", "4 personnes", "Étape 1", "Cuire le riz."],
      [{ selling_group_title_section_data: { name: "Poêlée de riz", description: null } }],
    )
    const rfr = parseSellingGroupRecipe(fr)
    expect(rfr.instructions).toEqual(["Cuire le riz."])
    expect(rfr.ingredients).toEqual(["Riz 200 g"])
  })

  it("returns metadata for a recipe with no rendered ingredient/step sections (user-defined recipe)", () => {
    // User-defined recipes carry structured metadata but no Zutaten/Schritt
    // RICH_TEXT sections — name must be set and ingredients/steps stay empty.
    const page = detailPage(
      ["My Recipe"],
      [
        { selling_group_title_section_data: { name: "My Recipe", description: null } },
        { selling_group_header_data: { is_saved: false, default_portions: 4 } },
      ],
    )
    const r = parseSellingGroupRecipe(page)
    expect(r.name).toBe("My Recipe")
    expect(r.isSaved).toBe(false)
    expect(r.ingredients).toEqual([])
    expect(r.instructions).toEqual([])
    expect(r.pantryIngredients).toEqual([])
  })

  it("returns an empty result for unrecognized input without throwing", () => {
    const empty = {
      name: null,
      description: null,
      qualityCue: null,
      prepTime: null,
      totalTime: null,
      servings: null,
      imageUrl: null,
      isSaved: null,
      ingredients: [],
      pantryIngredients: [],
      tools: [],
      tips: [],
      instructions: [],
    }
    expect(parseSellingGroupRecipe(null)).toEqual(empty)
    expect(parseSellingGroupRecipe({})).toEqual(empty)
  })
})

describe("parseRecipeList", () => {
  function cookbookTile(id: string, name: string, segmentType: string, imageId: string) {
    return {
      type: "PML",
      id: `tile-${id}`,
      analytics: {
        contexts: [
          { data: { type: "recipe_tile", template_id: "cookbook-recipe-tile" }, schema: "iglu:x/pml_component/1" },
          { data: { segment_name: segmentType, segment_type: segmentType }, schema: "iglu:x/segment/1" },
        ],
      },
      pml: {
        component: {
          type: "TOUCHABLE",
          onPress: {
            type: "EXPRESSION",
            expression: `onPMLAction({ actionType: "OPEN", target: "app.picnic://store/page;id=selling-group-details-page,selling_group_id=${id}" })`,
          },
          child: {
            type: "STACK",
            children: [{ type: "IMAGE", source: { id: imageId, namespace: "recipes" } }, richText(name)],
          },
        },
      },
    }
  }

  // A user-defined-recipe tile: recipe_tile_mini, name only in the analytics
  // `recipe` context (inside an EXPRESSION), no rendered RICH_TEXT name.
  function udrTile(id: string, name: string) {
    return {
      type: "CONTAINER",
      analytics: {
        contexts: [
          { data: { type: "recipe_tile_mini", template_id: "core-uds-recipe-tile" }, schema: "iglu:x/pml_component/1" },
          { data: { recipe_id: id, recipe_image_type: "GALLERY", recipe_name: name }, schema: "iglu:x/recipe/1" },
          { data: { segment_name: "Eigene Rezepte", segment_type: "USER_DEFINED_RECIPES" }, schema: "iglu:x/segment/1" },
        ],
      },
      child: {
        type: "TOUCHABLE",
        onPress: {
          type: "EXPRESSION",
          expression: `onPMLAction({ actionType: "OPEN", target: "app.picnic://store/page;id=selling-group-details-page,selling_group_id=${id}" })`,
        },
      },
    }
  }

  function cookbook(children: unknown[]) {
    return { id: "cookbook", body: { type: "STATE_BOUNDARY", child: { type: "BLOCK", children } } }
  }

  it("groups recipes by segment, with names/images from tiles", () => {
    const page = cookbook([
      cookbookTile(RECIPE_ID, "Gyros-Reispfanne mit Feta", "SAVED_RECIPES", "abc"),
      udrTile(OWN_ID, "My Recipe"),
      cookbookTile(NEW_ID, "Neues Rezept", "NEW_RECIPES", "ghi"),
    ])
    const list = parseRecipeList(page, { imageBaseUrl: IMAGE_BASE })
    expect(list).toHaveLength(3)

    const saved = list.filter((r) => r.segments.includes("SAVED_RECIPES"))
    expect(saved).toEqual([
      {
        recipeId: RECIPE_ID,
        name: "Gyros-Reispfanne mit Feta",
        imageUrl: `${IMAGE_BASE}/recipes/abc/large.png`,
        segments: ["SAVED_RECIPES"],
      },
    ])

    const own = list.filter((r) => r.segments.includes("USER_DEFINED_RECIPES"))
    expect(own.map((r) => [r.recipeId, r.name])).toEqual([[OWN_ID, "My Recipe"]])
  })

  it("returns an empty list for a page with no recipe tiles", () => {
    expect(parseRecipeList(cookbook([richText("Hello")]))).toEqual([])
  })
})

describe("buildRecipeSourceUrl", () => {
  it("uses the localized path segment per country, with a neutral fallback", () => {
    expect(buildRecipeSourceUrl("DE", RECIPE_ID)).toBe(`https://picnic.app/de/rezepte/${RECIPE_ID}`)
    expect(buildRecipeSourceUrl("NL", RECIPE_ID)).toBe(`https://picnic.app/nl/recepten/${RECIPE_ID}`)
    expect(buildRecipeSourceUrl("FR", RECIPE_ID)).toBe(`https://picnic.app/fr/recettes/${RECIPE_ID}`)
    expect(buildRecipeSourceUrl("XX", RECIPE_ID)).toBe(`https://picnic.app/xx/recipes/${RECIPE_ID}`)
  })
})
