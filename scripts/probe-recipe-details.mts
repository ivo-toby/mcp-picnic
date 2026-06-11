// Live verification for picnic_get_recipe_details against the user's real
// Picnic account. Uses the real tool handler so the extractor logic is
// covered end-to-end. Run: npx tsx scripts/probe-recipe-details.mts <recipeId>
import { toolRegistry } from "../src/tools/registry.js"
import "../src/tools/picnic-tools.js"
import { initializePicnicClient } from "../src/utils/picnic-client.js"

const recipeId = process.argv[2] || "69a6d2ab92f7b13019c86579"

await initializePicnicClient()
const result = await toolRegistry.executeTool("picnic_get_recipe_details", { recipeId })
const payload = JSON.parse(result.content[0].text!)

console.log(`name:        ${payload.name}`)
console.log(`tagline:     ${payload.tagline}`)
console.log(`description: ${payload.description}`)
console.log(`time:        ${payload.cooking_time}`)
console.log(`portions:    ${payload.portions}`)
console.log(`image_id:    ${payload.image_id}`)

const showSection = (label: string, arr: Array<Record<string, unknown>>) => {
  console.log(`\n${label} (${arr.length}):`)
  for (const i of arr) console.log(" -", JSON.stringify(i))
}
showSection("ingredients", payload.ingredients)
showSection("likely_in_stock", payload.likely_in_stock)
showSection("pantry", payload.pantry)
showSection("complementary", payload.complementary)

console.log(`\nsteps (${payload.steps.length}):`)
for (let i = 0; i < payload.steps.length; i++) {
  const s = payload.steps[i]
  console.log(` ${i + 1}.`, s.length > 100 ? s.slice(0, 100) + "..." : s)
}
console.log(`\ntip: ${payload.tip}`)
