# Developer probes

Manual scripts for exploring the live Picnic API during development — not
part of the build. They authenticate the same way the MCP server does, so a
valid login (or a saved `picnic-session.json`) must be configured.

| Script                     | Purpose                                                                       |
| -------------------------- | ----------------------------------------------------------------------------- |
| `probe-recipes.mts`        | Run the real `picnic_get_recipes` handler against the cookbook or a category. |
| `probe-recipe-details.mts` | Run the real `picnic_get_recipe_details` handler for one recipe.              |

Run with [tsx](https://github.com/privatenumber/tsx):

```sh
npx tsx scripts/probe-recipes.mts            # cookbook highlights + categories
npx tsx scripts/probe-recipes.mts 20minuten  # one category
npx tsx scripts/probe-recipe-details.mts <recipeId>
```

The Picnic Fusion pages are rendered UI trees, not a data API; when a layout
change breaks the extractors in `src/tools/picnic-tools.ts`, these probes are
the quickest way to inspect the live structure and adjust the heuristics.
