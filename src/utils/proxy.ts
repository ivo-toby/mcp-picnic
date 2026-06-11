// Optional outbound HTTP(S) proxy support.
//
// picnic-api uses Node's built-in fetch (undici), which ignores the HTTP_PROXY /
// HTTPS_PROXY / NO_PROXY environment variables by default. When HTTP_PROXY or
// HTTPS_PROXY is set, wrap globalThis.fetch with undici's EnvHttpProxyAgent so
// every request the server makes (login, store API, recipes) is routed through
// the proxy and honours NO_PROXY. This is useful behind egress-restricted networks
// where outbound traffic must go through a forward proxy.
//
// Best-effort: if undici is unavailable the server continues with direct egress.
// All logging goes to stderr — stdout is reserved for the stdio MCP transport.
export async function installFetchProxy(): Promise<void> {
  const proxyUrl =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy
  if (!proxyUrl) {
    return
  }

  try {
    const { fetch: undiciFetch, EnvHttpProxyAgent } = await import("undici")
    const dispatcher = new EnvHttpProxyAgent()
    globalThis.fetch = ((
      input: Parameters<typeof undiciFetch>[0],
      init?: Parameters<typeof undiciFetch>[1],
    ) => undiciFetch(input, { ...init, dispatcher })) as unknown as typeof fetch
    console.error(`[mcp-picnic] outbound fetch routed through proxy (${proxyUrl})`)
  } catch (error) {
    console.error(
      "[mcp-picnic] proxy env var is set but proxy setup failed; continuing with direct egress:",
      error,
    )
  }
}
