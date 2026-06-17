// Live verification for picnic_browse_recipes against the user's real Picnic
// account. Uses the real tool handler so the extractor logic is covered
// end-to-end. Run: npx tsx scripts/probe-recipes.mts [category]
import { toolRegistry } from "../src/tools/registry.js"
import "../src/tools/picnic-tools.js"
import { initializePicnicClient } from "../src/utils/picnic-client.js"

const category = process.argv[2]

await initializePicnicClient()
const result = await toolRegistry.executeTool("picnic_browse_recipes", {
  ...(category ? { category } : {}),
  limit: 100,
})
const payload = JSON.parse(result.content[0].text!)

console.log(`pageId: ${payload.pageId}`)
console.log(`total:  ${payload.pagination.total}`)
for (const r of payload.recipes) {
  console.log(
    ` - ${r.recipeId}  ${r.name ?? "<no name>"}  [${r.segments.join(", ") || "no segment"}]`,
  )
}
if (payload.categories) {
  console.log(`\ncategories (${payload.categories.length}):`)
  console.log(payload.categories.join(", "))
}
