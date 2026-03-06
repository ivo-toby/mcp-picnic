---
id: "002"
title: Remove picnic_analyze_response_size diagnostic tool
status: accepted
date: 2026-03-06
context: picnic-api-v4-upgrade
---

# Remove picnic_analyze_response_size diagnostic tool

## Context

The `picnic_analyze_response_size` tool references `getCategories` and
other methods in its enum and switch statement. It is a debug/diagnostic
tool, not core functionality.

## Decision

Remove the tool entirely rather than updating it.

## Rationale

Diagnostic tool that references removed APIs. Not worth maintaining for
this upgrade.
