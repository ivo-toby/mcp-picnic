/**
 * Picnic recipe parsing.
 *
 * Picnic models recipes as "selling groups" — a recipe id IS a
 * `selling_group_id`. The mobile API serves a recipe as a Fusion (PML) page at
 * `GET /pages/selling-group-details-page?selling_group_id=<id>`, and the
 * recipe/cookbook overview at `GET /pages/cookbook-page-content`. (The older
 * `recipe-details-page-root` / `recipe_id` route returns 404.)
 *
 * Extraction is structured-first and therefore language-agnostic: name,
 * description, hero image, portions and saved-state come from typed
 * `selling_group_*_data` fields embedded in the page's SUSPENSE `parameters`.
 * Ingredient lines and preparation steps are read from the rendered RICH_TEXT
 * stream, delimited by the localized "Zutaten/Ingrediënten/Ingrédients"
 * (ingredients) and "Zubereitung/Bereiding/Préparation/So wird's gemacht"
 * (instructions) section headers, with steps anchored on the per-step
 * "Schritt/Stap/Étape N" labels so unrelated product cards never leak in.
 *
 * Cookbook tiles carry a typed `segment_type` (SAVED_RECIPES,
 * USER_DEFINED_RECIPES, NEW_RECIPES, …) used to group recipes by tab.
 */

/** Structured recipe data extracted from a Picnic selling-group recipe page. */
export interface ParsedRecipe {
  name: string | null
  description: string | null
  /** Short marketing tag, e.g. "Schnell und einfach". */
  qualityCue: string | null
  prepTime: string | null
  /** e.g. "20 min" (total). */
  totalTime: string | null
  /** e.g. "2 Portionen". */
  servings: string | null
  imageUrl: string | null
  /** Whether the recipe is saved to the user's cookbook (when known). */
  isSaved: boolean | null
  /** Recipe ingredient lines, e.g. ["Paprika 1 Stk.", "Basmatireis 100 g"]. */
  ingredients: string[]
  /** "Bring your own" pantry items (the "Eigene Zutaten" line). */
  pantryIngredients: string[]
  /** Equipment needed (the "Du benötigst" line), e.g. ["Bratpfanne"]. */
  tools: string[]
  /** Editorial tips (the "Tipp" section), not cooking steps. */
  tips: string[]
  /** Preparation step texts in order. */
  instructions: string[]
}

/** {@link ParsedRecipe} plus the identifiers needed to ingest it elsewhere. */
export interface PicnicRecipeResult extends ParsedRecipe {
  /** 24-char hex recipe id (a selling_group_id). */
  recipeId: string
  /** Canonical picnic.app recipe URL. */
  sourceUrl: string
}

/** A single recipe entry from the cookbook / recipe overview. */
export interface RecipeListItem {
  recipeId: string
  name: string | null
  imageUrl: string | null
  /** Cookbook segments the recipe belongs to (e.g. ["SAVED_RECIPES"]). */
  segments: string[]
}

// ── Recipe ID resolution ─────────────────────────────────────────────────────

// A recipe id (selling_group_id) is 24 hex chars for catalog recipes and 32 for
// the user's own (user-defined) recipes.
const RECIPE_ID_RE = /^[a-f0-9]{24,32}$/
// A recipe id as a URL path segment (DE rezepte / NL recepten / FR recettes).
const RECIPE_ID_IN_URL_RE = /\/([a-f0-9]{24,32})(?:[/?#]|$)/
// `selling_group_id=<id>` (or the legacy `recipe_id=<id>`) in a deep link.
const ID_PARAM_RE = /(?:selling_group_id|recipe_id)=([a-f0-9]{24,32})/
// Any recipe id reference, used when grouping cookbook tiles by segment.
const ANY_ID_REF_RE = /(?:selling_group_id|recipe_id|recipeIds)=([a-f0-9]{24,32})/g

const RECIPE_PATH_BY_COUNTRY: Record<string, string> = {
  NL: "recepten",
  DE: "rezepte",
  FR: "recettes",
}

/**
 * Build the canonical picnic.app recipe URL for a given country and recipe ID.
 * Falls back to a neutral `recipes` path segment for unknown country codes.
 */
export function buildRecipeSourceUrl(countryCode: string, recipeId: string): string {
  const segment = RECIPE_PATH_BY_COUNTRY[countryCode.toUpperCase()] ?? "recipes"
  return `https://picnic.app/${countryCode.toLowerCase()}/${segment}/${recipeId}`
}

const ALLOWED_SHARE_HOSTS = new Set(["picnic.app"])

function isAllowedShareHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  return ALLOWED_SHARE_HOSTS.has(host) || host.endsWith(".picnic.app")
}

function assertAllowedShareUrl(raw: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new Error(`Not a valid recipe URL: ${raw}`)
  }
  if (url.protocol !== "https:") {
    throw new Error(`Refusing to resolve a non-https recipe URL: ${raw}`)
  }
  if (!isAllowedShareHost(url.hostname)) {
    throw new Error(`Refusing to resolve a recipe URL outside picnic.app: ${url.hostname}`)
  }
  return url
}

/**
 * Resolve a Picnic recipe URL (any format) or bare recipe id to a 24-char hex
 * recipe id (a selling_group_id). The redirect-following request for short
 * share links is restricted to `picnic.app` hosts over HTTPS (host re-checked
 * after redirects) so it cannot be steered at arbitrary/internal hosts.
 */
export async function resolveRecipeId(input: string): Promise<string> {
  const trimmed = input.trim()

  if (RECIPE_ID_RE.test(trimmed)) return trimmed

  const longMatch = trimmed.match(RECIPE_ID_IN_URL_RE)
  if (longMatch) return longMatch[1]

  const paramMatch = trimmed.match(ID_PARAM_RE)
  if (paramMatch) return paramMatch[1]

  if (/^https?:\/\//i.test(trimmed)) {
    const startUrl = assertAllowedShareUrl(trimmed)
    const res = await fetch(startUrl.href, { method: "HEAD", redirect: "follow" })
    const finalUrl = new URL(res.url || startUrl.href)
    if (!isAllowedShareHost(finalUrl.hostname)) {
      throw new Error(
        `Recipe share link redirected off picnic.app to ${finalUrl.hostname}; refusing to follow`,
      )
    }
    const resolvedMatch = finalUrl.href.match(RECIPE_ID_IN_URL_RE) ?? finalUrl.href.match(ID_PARAM_RE)
    if (resolvedMatch) return resolvedMatch[1]
  }

  throw new Error(`Cannot extract a Picnic recipe id from: ${input}`)
}

// ── Shared helpers ───────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** Object keys carrying actions/analytics/fallback UI rather than content. */
const SKIP_KEYS = new Set([
  "analytics",
  "tracking_attributes",
  "loadingConfig",
  "errorConfig",
  "placeholder",
  "fallbackSource",
  "presets",
  "viewabilityListeners",
])

/** Strip Picnic colour markup, markdown action links and emphasis from a line. */
function cleanLine(line: string): string {
  return line
    .replace(/#\(#[0-9a-fA-F]{6}\)/g, "")
    .replace(/\[([^\]]+)\]\((?:action|app|https?):\/\/[^)]*\)/g, "$1")
    .replace(/^\s*#{1,6}\s+/, "")
    .replace(/^\s*[-*+]\s+/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

// ── Localized section / label matchers ───────────────────────────────────────

const INGREDIENT_HEADER_RE = /^(zutaten|ingredi[eë]nten|ingr[eé]dients?)$/i
const INSTRUCTION_HEADER_RE =
  /^(zubereitung(sschritte)?|anleitung|so wird.?s gemacht|bereiding(swijze)?|zo maak je het|pr[eé]paration|instructions?)$/i
const STEP_LABEL_RE = /^(schritt|stap|[ée]tape|step)\s*\d+$/i
const TIP_HEADER_RE = /^(tipps?|tips?|astuces?)$/i
const TIME_RE = /\b\d+\s*min\b/i
const TOTAL_TIME_RE = /\b(gesamt|insgesamt|total|totaal)\b/i
const SERVINGS_RE = /\b(portion(en|s)?|porties|personen|personnes?)\b|\b\d+\s*pers\b/i
// A clean servings *value* — a leading count plus a unit. Used to set the
// servings field, so a nutrition header like "1 Portion des Originalrezepts
// enthält ungefähr:" (which contains "Portion") is not mistaken for it.
const SERVINGS_VALUE_RE = /^\d+\s*(portion(en|s)?|porties|personen|personnes?|pers\.?)$/i
const NUMBER_ONLY_RE = /^\d+[.)]?$/
const PANTRY_LINE_RE = /^(eigene zutaten|eigen recept|own ingredients|propres ingr[ée]dients?)\s*:\s*(.+)$/i
const TOOLS_LINE_RE = /^(du ben[öo]tigst|je hebt nodig|you.?ll need|tu auras besoin)\s*:\s*(.+)$/i
const BUTTON_WORDS = new Set([
  "ansehen",
  "hinzufügen",
  "view",
  "add",
  "bekijken",
  "toevoegen",
  "voir",
  "ajouter",
])

function splitMetaLine(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
}

// ── Structured (language-agnostic) extraction ────────────────────────────────

interface StructuredRecipe {
  name: string | null
  description: string | null
  qualityCue: string | null
  imageId: string | null
  imageNamespace: string | null
  portions: number | null
  isSaved: boolean | null
}

function collectStructured(page: unknown): StructuredRecipe {
  const out: StructuredRecipe = {
    name: null,
    description: null,
    qualityCue: null,
    imageId: null,
    imageNamespace: null,
    portions: null,
    isSaved: null,
  }
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const x of n) visit(x)
      return
    }
    if (!isRecord(n)) return

    const title = n.selling_group_title_section_data
    if (isRecord(title)) {
      if (typeof title.name === "string") out.name = out.name ?? title.name
      if (typeof title.description === "string")
        out.description = out.description ?? title.description
      if (typeof title.quality_cue === "string")
        out.qualityCue = out.qualityCue ?? title.quality_cue
    }

    const header = n.selling_group_header_data
    if (isRecord(header)) {
      if (typeof header.is_saved === "boolean") out.isSaved = out.isSaved ?? header.is_saved
      if (typeof header.sellable_name === "string") out.name = out.name ?? header.sellable_name
      if (out.portions === null && typeof header.default_portions === "number")
        out.portions = header.default_portions
    }

    const image = n.selling_group_image_data
    if (isRecord(image)) {
      const imgs = isRecord(image.images) ? image.images.images : undefined
      if (Array.isArray(imgs)) {
        const primary = imgs.find((x) => isRecord(x) && x.primary) ?? imgs[0]
        if (isRecord(primary)) {
          if (typeof primary.id === "string") out.imageId = out.imageId ?? primary.id
          if (typeof primary.namespace === "string")
            out.imageNamespace = out.imageNamespace ?? primary.namespace
        }
      }
    }

    if (typeof n.portions === "number") out.portions = n.portions

    for (const v of Object.values(n)) visit(v)
  }
  visit(page)
  return out
}

/** Collect cleaned RICH_TEXT lines in document order (skipping metadata keys). */
function collectTextTokens(page: unknown): string[] {
  const tokens: string[] = []
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const x of n) visit(x)
      return
    }
    if (!isRecord(n)) return
    if (n.type === "RICH_TEXT" && typeof n.markdown === "string") {
      for (const raw of n.markdown.split("\n")) {
        const value = cleanLine(raw)
        if (value) tokens.push(value)
      }
    }
    for (const [key, v] of Object.entries(n)) {
      if (SKIP_KEYS.has(key)) continue
      if (isRecord(v) || Array.isArray(v)) visit(v)
    }
  }
  visit(page)
  return tokens
}

function buildImageUrl(
  imageId: string | null,
  namespace: string | null,
  imageBaseUrl?: string,
): string | null {
  if (!imageId || !imageBaseUrl) return null
  const path = namespace && !imageId.includes("/") ? `${namespace}/${imageId}` : imageId
  return `${imageBaseUrl.replace(/\/$/, "")}/${path}/large.png`
}

export interface ParseRecipeOptions {
  /** Base for recipe image URLs, e.g. `https://storefront-prod.de…/static/images`. */
  imageBaseUrl?: string
}

/**
 * Parse a Picnic selling-group recipe page into structured recipe data. Returns
 * an all-null/empty {@link ParsedRecipe} for unrecognized input rather than
 * throwing. Robust to personalized/scaled recipes, whose pages interleave
 * product cards, nutrition and allergen blocks with the recipe content.
 */
export function parseSellingGroupRecipe(page: unknown, opts: ParseRecipeOptions = {}): ParsedRecipe {
  const struct = collectStructured(page)
  const result: ParsedRecipe = {
    name: struct.name,
    description: struct.description,
    qualityCue: struct.qualityCue,
    prepTime: null,
    totalTime: null,
    servings: struct.portions !== null ? String(struct.portions) : null,
    imageUrl: buildImageUrl(struct.imageId, struct.imageNamespace, opts.imageBaseUrl),
    isSaved: struct.isSaved,
    ingredients: [],
    pantryIngredients: [],
    tools: [],
    tips: [],
    instructions: [],
  }

  const tokens = collectTextTokens(page)

  // Section anchors. The instruction header must come AFTER the ingredient
  // header, so a stray product-card "Zubereitung" tab does not hijack it.
  let ingredientStart = -1
  let tipStart = -1
  const stepIdx: number[] = []
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (ingredientStart < 0 && INGREDIENT_HEADER_RE.test(t)) ingredientStart = i
    if (STEP_LABEL_RE.test(t)) stepIdx.push(i)
    if (tipStart < 0 && TIP_HEADER_RE.test(t)) tipStart = i
  }
  let instructionStart = -1
  for (let i = 0; i < tokens.length; i++) {
    if (INSTRUCTION_HEADER_RE.test(tokens[i]) && (ingredientStart < 0 || i > ingredientStart)) {
      instructionStart = i
      break
    }
  }

  // Timing: only in the meta region (before the instructions/steps), so a step
  // that mentions a duration isn't mistaken for the recipe time.
  const metaEnd =
    instructionStart >= 0 ? instructionStart : stepIdx.length > 0 ? stepIdx[0] : tokens.length
  for (let i = 0; i < metaEnd; i++) {
    const t = tokens[i]
    if (!TIME_RE.test(t)) continue
    const next = tokens[i + 1] ?? ""
    if (TOTAL_TIME_RE.test(t) || TOTAL_TIME_RE.test(next)) result.totalTime = result.totalTime ?? t
    else result.prepTime = result.prepTime ?? t
  }

  // Servings: a clean "N Portionen" value anywhere (the structured portion
  // count from collectStructured is the fallback).
  for (const t of tokens) {
    if (SERVINGS_VALUE_RE.test(t)) {
      result.servings = t
      break
    }
  }

  // Ingredients: between the ingredient header and the instruction header,
  // splitting out the "Eigene Zutaten" (pantry) and "Du benötigst" (tools) lines.
  const ingEnd = instructionStart >= 0 ? instructionStart : tokens.length
  if (ingredientStart >= 0) {
    for (let i = ingredientStart + 1; i < ingEnd; i++) {
      const t = tokens[i]
      if (NUMBER_ONLY_RE.test(t) || t.length < 2 || BUTTON_WORDS.has(t.toLowerCase())) continue
      const pantry = PANTRY_LINE_RE.exec(t)
      if (pantry) {
        result.pantryIngredients.push(...splitMetaLine(pantry[2]))
        continue
      }
      const tools = TOOLS_LINE_RE.exec(t)
      if (tools) {
        result.tools.push(...splitMetaLine(tools[2]))
        continue
      }
      if (SERVINGS_RE.test(t)) continue
      result.ingredients.push(t)
    }
  }

  // Instructions: anchored on the "Schritt N" labels (robust); otherwise fall
  // back to the text after the instruction header, stopping at the tips block.
  if (stepIdx.length > 0) {
    const bounds = [...stepIdx, tipStart >= 0 ? tipStart : tokens.length, tokens.length]
    for (const si of stepIdx) {
      const next = Math.min(...bounds.filter((b) => b > si))
      const body: string[] = []
      for (let k = si + 1; k < next; k++) {
        const t = tokens[k]
        if (
          STEP_LABEL_RE.test(t) ||
          SERVINGS_RE.test(t) ||
          NUMBER_ONLY_RE.test(t) ||
          t.length < 2 ||
          BUTTON_WORDS.has(t.toLowerCase())
        )
          continue
        body.push(t)
      }
      if (body.length > 0) result.instructions.push(body.join(" "))
    }
  } else if (instructionStart >= 0) {
    for (let k = instructionStart + 1; k < tokens.length; k++) {
      const t = tokens[k]
      if (TIP_HEADER_RE.test(t)) break
      if (
        SERVINGS_RE.test(t) ||
        NUMBER_ONLY_RE.test(t) ||
        STEP_LABEL_RE.test(t) ||
        t.length < 2 ||
        BUTTON_WORDS.has(t.toLowerCase())
      )
        continue
      result.instructions.push(t)
    }
  }

  // Tips: editorial notes after the "Tipp" header.
  if (tipStart >= 0) {
    for (let k = tipStart + 1; k < tokens.length; k++) {
      const t = tokens[k]
      if (t.length >= 2 && !BUTTON_WORDS.has(t.toLowerCase())) result.tips.push(t)
    }
  }

  return result
}

// ── Cookbook list parsing (grouped by segment) ───────────────────────────────

function findSegmentType(analytics: unknown): string | null {
  const match = JSON.stringify(analytics).match(/"segment_type"\s*:\s*"([^"]+)"/)
  return match ? match[1] : null
}

/**
 * Map every recipe id in a cookbook page to the set of segment types it belongs
 * to (SAVED_RECIPES, USER_DEFINED_RECIPES, NEW_RECIPES, …). Segment membership
 * lives in the `segment_type` analytics on each tile/shelf, alongside the
 * recipe's `selling_group_id` (single tiles) or `recipeIds` list (see-more).
 */
function collectSegmentsById(page: unknown): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  const add = (id: string, seg: string): void => {
    const existing = map.get(id)
    if (existing) existing.add(seg)
    else map.set(id, new Set([seg]))
  }
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const x of n) visit(x)
      return
    }
    if (!isRecord(n)) return
    if (n.analytics !== undefined) {
      const seg = findSegmentType(n.analytics)
      if (seg) {
        for (const m of JSON.stringify(n).matchAll(ANY_ID_REF_RE)) add(m[1], seg)
        return
      }
    }
    for (const [key, v] of Object.entries(n)) {
      if (key === "analytics" || SKIP_KEYS.has(key)) continue
      if (isRecord(v) || Array.isArray(v)) visit(v)
    }
  }
  visit(page)
  return map
}

function findLinkedRecipeId(node: unknown, depth: number): string | null {
  if (depth > 8 || node === null || node === undefined) return null
  if (typeof node === "string") {
    const m = node.match(ID_PARAM_RE)
    return m ? m[1] : null
  }
  if (Array.isArray(node)) {
    for (const child of node) {
      const id = findLinkedRecipeId(child, depth + 1)
      if (id) return id
    }
    return null
  }
  if (!isRecord(node)) return null
  for (const v of Object.values(node)) {
    const id = findLinkedRecipeId(v, depth + 1)
    if (id) return id
  }
  return null
}

/** Longest free-text RICH_TEXT line under a node (the recipe name, not a tag). */
function firstRecipeNameIn(node: unknown): string | null {
  const labels = new Set(["hinzufügen", "nicht alles vorrätig", "add", "toevoegen", "ajouter"])
  let best: string | null = null
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const x of n) visit(x)
      return
    }
    if (!isRecord(n)) return
    if (n.type === "RICH_TEXT" && typeof n.markdown === "string") {
      for (const raw of n.markdown.split("\n")) {
        const v = cleanLine(raw)
        if (
          v.length > 6 &&
          v.length <= 90 &&
          !labels.has(v.toLowerCase()) &&
          !TIME_RE.test(v) &&
          !SERVINGS_RE.test(v) &&
          (best === null || v.length > best.length)
        ) {
          best = v
        }
      }
    }
    for (const [key, v] of Object.entries(n)) {
      if (key === "onPress" || SKIP_KEYS.has(key)) continue
      if (isRecord(v) || Array.isArray(v)) visit(v)
    }
  }
  visit(node)
  return best
}

function firstImageIn(node: unknown): { id: string; namespace: string | null } | null {
  let found: { id: string; namespace: string | null } | null = null
  const visit = (n: unknown): void => {
    if (found) return
    if (Array.isArray(n)) {
      for (const x of n) visit(x)
      return
    }
    if (!isRecord(n)) return
    if (n.type === "IMAGE" && isRecord(n.source) && typeof n.source.id === "string") {
      const ns = typeof n.source.namespace === "string" ? n.source.namespace : null
      found = { id: n.source.id, namespace: ns }
      return
    }
    for (const [key, v] of Object.entries(n)) {
      if (key === "onPress" || SKIP_KEYS.has(key)) continue
      if (isRecord(v) || Array.isArray(v)) visit(v)
    }
  }
  visit(node)
  return found
}

function hasRecipeTileAnalytics(node: unknown): boolean {
  if (Array.isArray(node)) return node.some(hasRecipeTileAnalytics)
  if (!isRecord(node)) return false
  // `recipe_tile` is a catalog tile; `recipe_tile_mini` is a user-defined-recipe tile.
  if (node.type === "recipe_tile" || node.type === "recipe_tile_mini") return true
  return Object.values(node).some(hasRecipeTileAnalytics)
}

// Recipe names are also carried in `recipe` analytics contexts
// ({recipe_id, recipe_name}) — the reliable source for user-defined recipes,
// whose name is only present there (often inside an EXPRESSION string), not as
// a rendered RICH_TEXT tile.
const RECIPE_NAME_CONTEXT_RE =
  /"recipe_id"\s*:\s*"([a-f0-9]{24,32})"[\s\S]{0,160}?"recipe_name"\s*:\s*"([^"]+)"/g

function collectRecipeNames(page: unknown): Map<string, string> {
  const map = new Map<string, string>()
  const visit = (n: unknown): void => {
    if (typeof n === "string") {
      for (const m of n.matchAll(RECIPE_NAME_CONTEXT_RE)) if (!map.has(m[1])) map.set(m[1], m[2])
      return
    }
    if (Array.isArray(n)) {
      for (const x of n) visit(x)
      return
    }
    if (!isRecord(n)) return
    if (
      typeof n.recipe_id === "string" &&
      typeof n.recipe_name === "string" &&
      !map.has(n.recipe_id)
    ) {
      map.set(n.recipe_id, n.recipe_name)
    }
    for (const v of Object.values(n)) visit(v)
  }
  visit(page)
  return map
}

/** Collect rendered recipe tiles → name/image by recipe id. */
function collectTileInfo(
  page: unknown,
  opts: ParseRecipeOptions,
): Map<string, { name: string | null; imageUrl: string | null }> {
  const info = new Map<string, { name: string | null; imageUrl: string | null }>()
  const visit = (n: unknown): void => {
    if (Array.isArray(n)) {
      for (const x of n) visit(x)
      return
    }
    if (!isRecord(n)) return
    if (n.analytics !== undefined && hasRecipeTileAnalytics(n.analytics)) {
      const recipeId = findLinkedRecipeId(n, 0)
      if (recipeId && !info.has(recipeId)) {
        const img = firstImageIn(n)
        info.set(recipeId, {
          name: firstRecipeNameIn(n),
          imageUrl: img ? buildImageUrl(img.id, img.namespace, opts.imageBaseUrl) : null,
        })
      }
      return
    }
    for (const [key, v] of Object.entries(n)) {
      if (SKIP_KEYS.has(key)) continue
      if (isRecord(v) || Array.isArray(v)) visit(v)
    }
  }
  visit(page)
  return info
}

/**
 * Parse a cookbook / recipe-overview page into a flat list of recipe entries,
 * each tagged with the cookbook segments it belongs to. Names and images come
 * from the rendered tiles; recipes that exist only in a segment list (e.g.
 * saved/own recipes not currently rendered) are still included, without a name.
 */
export function parseRecipeList(page: unknown, opts: ParseRecipeOptions = {}): RecipeListItem[] {
  const segById = collectSegmentsById(page)
  const tileInfo = collectTileInfo(page, opts)
  const names = collectRecipeNames(page)
  const out: RecipeListItem[] = []
  const seen = new Set<string>()

  for (const [id, segs] of segById) {
    seen.add(id)
    const info = tileInfo.get(id)
    out.push({
      recipeId: id,
      name: info?.name ?? names.get(id) ?? null,
      imageUrl: info?.imageUrl ?? null,
      segments: [...segs],
    })
  }
  for (const [id, info] of tileInfo) {
    if (seen.has(id)) continue
    out.push({ recipeId: id, name: info.name ?? names.get(id) ?? null, imageUrl: info.imageUrl, segments: [] })
  }
  return out
}
