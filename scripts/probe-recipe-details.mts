// Live verification for picnic_get_recipe against the user's real
// Picnic account. Uses the real tool handler so the extractor logic is
// covered end-to-end. Run: npx tsx scripts/probe-recipe-details.mts <recipeId-or-url>
import { toolRegistry } from "../src/tools/registry.js"
import "../src/tools/picnic-tools.js"
import { initializePicnicClient } from "../src/utils/picnic-client.js"

const recipeUrlOrId = process.argv[2] || "69a6d2ab92f7b13019c86579"

await initializePicnicClient()
const result = await toolRegistry.executeTool("picnic_get_recipe", {
  recipe_url_or_id: recipeUrlOrId,
})
const payload = JSON.parse(result.content[0].text!)

console.log(`recipeId:    ${payload.recipeId}`)
console.log(`sourceUrl:   ${payload.sourceUrl}`)
console.log(`name:        ${payload.name}`)
console.log(`qualityCue:  ${payload.qualityCue}`)
console.log(`description: ${payload.description}`)
console.log(`prepTime:    ${payload.prepTime}`)
console.log(`totalTime:   ${payload.totalTime}`)
console.log(`servings:    ${payload.servings}`)
console.log(`imageUrl:    ${payload.imageUrl}`)
console.log(`isSaved:     ${payload.isSaved}`)

const showSection = (label: string, arr: string[]) => {
  console.log(`\n${label} (${arr.length}):`)
  for (const i of arr) console.log(" -", i)
}
showSection("ingredients", payload.ingredients)
showSection("pantryIngredients", payload.pantryIngredients)
showSection("tools", payload.tools)
showSection("tips", payload.tips)

console.log(`\ninstructions (${payload.instructions.length}):`)
for (let i = 0; i < payload.instructions.length; i++) {
  const s = payload.instructions[i]
  console.log(` ${i + 1}.`, s.length > 100 ? s.slice(0, 100) + "..." : s)
}
