# Developer probes

Manual scripts for exploring the live Picnic API during development — not
part of the build. They authenticate the same way the MCP server does, which
validates its config at startup: `PICNIC_USERNAME` and `PICNIC_PASSWORD` must
be set (e.g. in `.env`) even when a saved `picnic-session.json` exists, since
the env vars are parsed before the session file is consulted. With a valid
saved session the credentials aren't actually used for a fresh login.

| Script                     | Purpose                                                                          |
| -------------------------- | -------------------------------------------------------------------------------- |
| `probe-recipes.mts`        | Run the real `picnic_browse_recipes` handler against the cookbook or a category. |
| `probe-recipe-details.mts` | Run the real `picnic_get_recipe` handler for one recipe.                         |

Run with [tsx](https://github.com/privatenumber/tsx):

```sh
npx tsx scripts/probe-recipes.mts            # cookbook highlights + categories
npx tsx scripts/probe-recipes.mts 20minuten  # one category
npx tsx scripts/probe-recipe-details.mts <recipeId>
```

The Picnic Fusion pages are rendered UI trees, not a data API; when a layout
change breaks the extractors in `src/tools/picnic-tools.ts`, these probes are
the quickest way to inspect the live structure and adjust the heuristics.
