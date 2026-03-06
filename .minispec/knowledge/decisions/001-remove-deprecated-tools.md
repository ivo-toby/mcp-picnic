---
id: "001"
title: Remove tools with no v4 backing API
status: accepted
date: 2026-03-06
context: picnic-api-v4-upgrade
---

# Remove tools with no v4 backing API

## Context

picnic-api v4.0.0 removes `getCategories()`, `getLists()`, `getList()`,
and `getMgmDetails()`. These were replaced by Fusion page endpoints which
are a different paradigm.

## Decision

Remove the corresponding MCP tools:
- `picnic_get_categories`
- `picnic_get_category_details`
- `picnic_get_lists`
- `picnic_get_list`
- `picnic_get_mgm_details`

## Rationale

Adding Fusion-based replacements would constitute new features, which is
out of scope for this upgrade. Clean removal avoids stale code.

## Alternatives considered

Replace with Fusion equivalents — rejected because scope is upgrade only.
