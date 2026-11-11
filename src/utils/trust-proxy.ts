/**
 * Value accepted by Express's `trust proxy` setting: a boolean, a hop count, or a
 * comma-separated list of addresses, subnets and names such as `loopback`.
 */
export type TrustProxySetting = boolean | number | string

/**
 * Parse the `HTTP_TRUST_PROXY` environment value into an Express `trust proxy` setting.
 *
 * - unset or empty → `undefined` (leave Express's default: trust nothing)
 * - `true` / `false` → boolean
 * - a non-negative integer → number of proxy hops to trust
 * - anything else → passed through as an address/subnet list (e.g. `loopback`, `10.0.0.0/8`)
 */
export function parseTrustProxy(value: string | undefined): TrustProxySetting | undefined {
  const trimmed = value?.trim()
  if (!trimmed) {
    return undefined
  }

  const lower = trimmed.toLowerCase()
  if (lower === "true") {
    return true
  }
  if (lower === "false") {
    return false
  }
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed)
  }

  return trimmed
}
