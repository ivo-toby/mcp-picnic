---
id: "003"
title: Keep raw fetch bypass for 2FA verification
status: accepted
date: 2026-03-06
context: picnic-api-v4-upgrade
---

# Keep raw fetch bypass for 2FA verification

## Context

`picnic_verify_2fa_code` bypasses `client.verify2FACode()` with a raw
`fetch()` call to capture the `x-picnic-auth` response header. The
upstream `sendRequest` does not expose response headers.

## Decision

Keep the raw fetch bypass. Create a GitHub issue to revisit this after
the upgrade (either upstream fix or local improvement).

## Rationale

Safe upgrade path — changing the 2FA flow during a dependency upgrade
adds unnecessary risk. The bypass works and is well-documented in code.
