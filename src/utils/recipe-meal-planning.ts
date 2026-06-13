export interface RecipeIngredient {
  ingredientId: string
  sellingUnitId: string
  name: string
  packageInfo: string
  priceCents: number | null
  quantity: number
  isPantryItem: boolean
}

export interface StructuredRecipeIngredients {
  recipeId: string
  recipeName: string
  portions: number
  ingredients: RecipeIngredient[]
}

export interface RecipeSummary {
  recipeId: string
  recipeName: string
}

export interface ShoppingListItem {
  sellingUnitId: string
  name: string
  packageInfo: string
  priceCents: number | null
  quantity: number
  usedInRecipes: RecipeSummary[]
}

export interface ShoppingListResult {
  shoppingList: ShoppingListItem[]
  sharedItems: ShoppingListItem[]
  totalPriceCents: number
  recipesSummary: Array<RecipeSummary & { portions: number }>
}

export interface MealCombination {
  recipes: RecipeSummary[]
  sharedItems: Array<{
    sellingUnitId: string
    name: string
    packageInfo: string
    usedInRecipes: RecipeSummary[]
  }>
  totalPriceCents: number
  score: number
  algorithm: "exhaustive" | "greedy"
}

export interface FindMealCombinationsInput {
  recipes: StructuredRecipeIngredients[]
  count: number
  topK?: number
  maxTotalBudgetCents?: number
}

interface SellingUnitContext {
  ingredientId: string
  sellingUnitId: string
  quantity: number
  checked: boolean
}

interface RecipeContext {
  recipeId: string
  recipeName: string
  portions: number
  sellingUnits: SellingUnitContext[]
}

interface IngredientTile {
  ingredientId: string
  name: string
  packageInfo: string
  priceCents: number | null
}

const EXHAUSTIVE_LIMIT = 30_000
const BUTTON_WORDS = new Set([
  "add",
  "ajouter",
  "ansehen",
  "bekijken",
  "hinzufügen",
  "toevoegen",
  "view",
  "voir",
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function cleanLine(line: string): string {
  return line
    .replace(/#\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\((?:action|app|https?):\/\/[^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function collectMarkdowns(value: unknown, acc: string[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectMarkdowns(item, acc)
    return
  }
  if (!isRecord(value)) return
  if (typeof value.markdown === "string") {
    for (const line of value.markdown.split("\n")) {
      const cleaned = cleanLine(line)
      if (cleaned) acc.push(cleaned)
    }
  }
  for (const child of Object.values(value)) collectMarkdowns(child, acc)
}

function parsePriceCents(value: string): number | null {
  const normalized = value.replace(/\u00a0/g, " ").trim()
  const match = normalized.match(/(?:€\s*)?(\d+)[,.](\d{2})(?:\s*€)?/)
  if (!match) return null
  return Number.parseInt(match[1], 10) * 100 + Number.parseInt(match[2], 10)
}

function isDisplayNoise(value: string): boolean {
  const lower = value.toLowerCase()
  return (
    BUTTON_WORDS.has(lower) ||
    /^[-+]?\d+%$/.test(value) ||
    /^[><%]/.test(value) ||
    /^\d+[.)]?$/.test(value)
  )
}

function extractProductDisplay(
  ingredientId: string,
  node: Record<string, unknown>,
): IngredientTile {
  const markdowns: string[] = []
  collectMarkdowns(node.pml ?? node, markdowns)

  const priceIndex = markdowns.findIndex((value) => parsePriceCents(value) !== null)
  const priceCents = priceIndex >= 0 ? parsePriceCents(markdowns[priceIndex]) : null
  const nameIndex = markdowns.findIndex(
    (value, index) => index !== priceIndex && !isDisplayNoise(value),
  )
  const packageIndex = markdowns.findIndex(
    (value, index) => index !== priceIndex && index !== nameIndex && !isDisplayNoise(value),
  )

  return {
    ingredientId,
    name: nameIndex >= 0 ? markdowns[nameIndex] : "",
    packageInfo: packageIndex >= 0 ? markdowns[packageIndex] : "",
    priceCents,
  }
}

function collectIngredientTiles(pageData: unknown): Map<string, IngredientTile> {
  const tiles = new Map<string, IngredientTile>()

  function walk(value: unknown, depth: number): void {
    if (depth > 80 || !isRecord(value)) {
      if (Array.isArray(value)) {
        for (const item of value) walk(item, depth + 1)
      }
      return
    }

    const contexts =
      isRecord(value.analytics) && Array.isArray(value.analytics.contexts)
        ? value.analytics.contexts
        : []
    for (const context of contexts) {
      if (!isRecord(context) || !isRecord(context.data)) continue
      if (typeof context.data.product_id !== "string") continue
      const ingredientId = context.data.product_id
      if (!tiles.has(ingredientId)) {
        tiles.set(ingredientId, extractProductDisplay(ingredientId, value))
      }
    }

    for (const child of Object.values(value)) walk(child, depth + 1)
  }

  walk(pageData, 0)
  return tiles
}

function parseSellingUnit(value: unknown): SellingUnitContext | null {
  if (!isRecord(value)) return null
  if (
    typeof value.ingredient_id !== "string" ||
    typeof value.selling_unit_id !== "string" ||
    typeof value.quantity !== "number" ||
    typeof value.checked !== "boolean"
  ) {
    return null
  }

  return {
    ingredientId: value.ingredient_id,
    sellingUnitId: value.selling_unit_id,
    quantity: value.quantity,
    checked: value.checked,
  }
}

function parseRecipeContextData(value: unknown): RecipeContext | null {
  if (!isRecord(value)) return null
  if (
    typeof value.recipe_id !== "string" ||
    typeof value.recipe_name !== "string" ||
    typeof value.portions !== "number" ||
    !Array.isArray(value.selling_units)
  ) {
    return null
  }

  const sellingUnits = value.selling_units
    .map(parseSellingUnit)
    .filter((unit): unit is SellingUnitContext => unit !== null)

  if (sellingUnits.length === 0) return null
  return {
    recipeId: value.recipe_id,
    recipeName: value.recipe_name,
    portions: value.portions,
    sellingUnits,
  }
}

function extractRecipeContext(pageData: unknown): RecipeContext | null {
  function walk(value: unknown, depth: number): RecipeContext | null {
    if (depth > 80) return null
    if (Array.isArray(value)) {
      for (const item of value) {
        const result = walk(item, depth + 1)
        if (result) return result
      }
      return null
    }
    if (!isRecord(value)) return null

    const direct = parseRecipeContextData(value)
    if (direct) return direct

    const contexts =
      isRecord(value.analytics) && Array.isArray(value.analytics.contexts)
        ? value.analytics.contexts
        : []
    for (const context of contexts) {
      if (!isRecord(context)) continue
      const result = parseRecipeContextData(context.data)
      if (result) return result
    }

    for (const child of Object.values(value)) {
      const result = walk(child, depth + 1)
      if (result) return result
    }
    return null
  }

  return walk(pageData, 0)
}

export function parseRecipeIngredients(pageData: unknown): StructuredRecipeIngredients | null {
  const context = extractRecipeContext(pageData)
  if (!context) return null

  const tiles = collectIngredientTiles(pageData)
  return {
    recipeId: context.recipeId,
    recipeName: context.recipeName,
    portions: context.portions,
    ingredients: context.sellingUnits.map((unit) => {
      const tile = tiles.get(unit.ingredientId)
      return {
        ingredientId: unit.ingredientId,
        sellingUnitId: unit.sellingUnitId,
        name: tile?.name ?? "",
        packageInfo: tile?.packageInfo ?? "",
        priceCents: tile?.priceCents ?? null,
        quantity: unit.quantity,
        isPantryItem: !unit.checked,
      }
    }),
  }
}

function lineTotal(item: Pick<ShoppingListItem, "priceCents" | "quantity">): number {
  return (item.priceCents ?? 0) * item.quantity
}

export function buildShoppingList(recipes: StructuredRecipeIngredients[]): ShoppingListResult {
  const items = new Map<string, ShoppingListItem>()

  for (const recipe of recipes) {
    const seenInRecipe = new Set<string>()
    for (const ingredient of recipe.ingredients) {
      if (ingredient.isPantryItem || seenInRecipe.has(ingredient.sellingUnitId)) continue
      seenInRecipe.add(ingredient.sellingUnitId)

      const existing = items.get(ingredient.sellingUnitId)
      const recipeSummary = { recipeId: recipe.recipeId, recipeName: recipe.recipeName }
      if (existing) {
        existing.quantity += ingredient.quantity
        existing.usedInRecipes.push(recipeSummary)
        if (existing.priceCents === null && ingredient.priceCents !== null) {
          existing.priceCents = ingredient.priceCents
        }
        continue
      }

      items.set(ingredient.sellingUnitId, {
        sellingUnitId: ingredient.sellingUnitId,
        name: ingredient.name,
        packageInfo: ingredient.packageInfo,
        priceCents: ingredient.priceCents,
        quantity: ingredient.quantity,
        usedInRecipes: [recipeSummary],
      })
    }
  }

  const shoppingList = Array.from(items.values()).sort(
    (a, b) =>
      lineTotal(b) - lineTotal(a) ||
      a.name.localeCompare(b.name) ||
      a.sellingUnitId.localeCompare(b.sellingUnitId),
  )
  const sharedItems = shoppingList.filter((item) => item.usedInRecipes.length > 1)

  return {
    shoppingList,
    sharedItems,
    totalPriceCents: shoppingList.reduce((sum, item) => sum + lineTotal(item), 0),
    recipesSummary: recipes.map((recipe) => ({
      recipeId: recipe.recipeId,
      recipeName: recipe.recipeName,
      portions: recipe.portions,
    })),
  }
}

function nChooseK(n: number, k: number): number {
  if (k > n) return 0
  if (k === 0 || k === n) return 1
  const limitedK = Math.min(k, n - k)
  let result = 1
  for (let index = 1; index <= limitedK; index++) {
    result = (result * (n - limitedK + index)) / index
    if (result > EXHAUSTIVE_LIMIT) return result
  }
  return Math.round(result)
}

function scoreCombination(
  recipes: StructuredRecipeIngredients[],
  algorithm: "exhaustive" | "greedy",
): MealCombination {
  const shoppingList = buildShoppingList(recipes)
  const sharedItems = shoppingList.sharedItems.map((item) => ({
    sellingUnitId: item.sellingUnitId,
    name: item.name,
    packageInfo: item.packageInfo,
    usedInRecipes: item.usedInRecipes,
  }))
  const score = sharedItems.reduce((sum, item) => sum + item.usedInRecipes.length - 1, 0)

  return {
    recipes: recipes.map((recipe) => ({
      recipeId: recipe.recipeId,
      recipeName: recipe.recipeName,
    })),
    sharedItems,
    totalPriceCents: shoppingList.totalPriceCents,
    score,
    algorithm,
  }
}

function recipeTieBreaker(recipes: RecipeSummary[]): string {
  return recipes
    .map((recipe) => recipe.recipeId)
    .sort()
    .join(",")
}

function compareCombinations(a: MealCombination, b: MealCombination): number {
  return (
    b.score - a.score ||
    a.totalPriceCents - b.totalPriceCents ||
    recipeTieBreaker(a.recipes).localeCompare(recipeTieBreaker(b.recipes))
  )
}

function addCombination(
  seen: Map<string, MealCombination>,
  recipes: StructuredRecipeIngredients[],
  algorithm: "exhaustive" | "greedy",
  maxTotalBudgetCents: number | undefined,
): void {
  const key = recipes
    .map((recipe) => recipe.recipeId)
    .sort()
    .join(",")
  if (seen.has(key)) return

  const result = scoreCombination(recipes, algorithm)
  if (maxTotalBudgetCents === undefined || result.totalPriceCents <= maxTotalBudgetCents) {
    seen.set(key, result)
  }
}

export function findMealCombinations(input: FindMealCombinationsInput): MealCombination[] {
  if (input.count < 2 || input.recipes.length < input.count) return []

  const topK = input.topK ?? 5
  const seen = new Map<string, MealCombination>()
  const useExhaustive = nChooseK(input.recipes.length, input.count) <= EXHAUSTIVE_LIMIT

  if (useExhaustive) {
    function combine(start: number, current: StructuredRecipeIngredients[]): void {
      if (current.length === input.count) {
        addCombination(seen, current, "exhaustive", input.maxTotalBudgetCents)
        return
      }
      for (
        let index = start;
        index <= input.recipes.length - (input.count - current.length);
        index++
      ) {
        combine(index + 1, [...current, input.recipes[index]])
      }
    }

    combine(0, [])
  } else {
    for (const start of input.recipes) {
      const selected = [start]
      const selectedIds = new Set([start.recipeId])

      while (selected.length < input.count) {
        let bestRecipe: StructuredRecipeIngredients | null = null
        let bestCombination: MealCombination | null = null

        for (const candidate of input.recipes) {
          if (selectedIds.has(candidate.recipeId)) continue
          const candidateCombination = scoreCombination([...selected, candidate], "greedy")
          if (!bestCombination || compareCombinations(candidateCombination, bestCombination) < 0) {
            bestRecipe = candidate
            bestCombination = candidateCombination
          }
        }

        if (!bestRecipe) break
        selected.push(bestRecipe)
        selectedIds.add(bestRecipe.recipeId)
      }

      if (selected.length === input.count) {
        addCombination(seen, selected, "greedy", input.maxTotalBudgetCents)
      }
    }
  }

  return Array.from(seen.values()).sort(compareCombinations).slice(0, topK)
}
