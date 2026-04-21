---
id: "003"
title: Use upstream 2FA verification support
status: superseded
date: 2026-04-19
context: picnic-api-v4-upgrade
---

# Use upstream 2FA verification support

## Context

`picnic-api` 4.0.1 updated `client.auth.verify2FACode()` to capture the
refreshed `x-picnic-auth` token returned by Picnic after successful 2FA.
The MCP server no longer needs a raw `fetch()` bypass to complete 2FA.

## Decision

Replace the local raw `fetch()` bypass with `client.auth.verify2FACode()`
and persist the refreshed session after verification.

## Rationale

The upstream library now handles the auth token refresh correctly, so the
custom HTTP path is unnecessary duplication and a maintenance burden.
