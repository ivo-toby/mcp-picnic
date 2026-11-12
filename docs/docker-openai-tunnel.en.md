# Picnic with Docker and OpenAI Secure MCP Tunnel

[English](docker-openai-tunnel.en.md) · [Nederlands](docker-openai-tunnel.nl.md)
[Français](docker-openai-tunnel.fr.md) · [Deutsch](docker-openai-tunnel.de.md)

This Compose file runs the official OpenAI tunnel client and the built Picnic
MCP server together in one container. The client starts Picnic as a STDIO
subprocess. The connection needs outbound HTTPS access to OpenAI and Picnic. For
a standalone HTTP server without a tunnel, see `docker-compose.yml` and the
transport choices in the README.

## Configure

Create your local `.env` file:

```bash
cp .env.example .env
chmod 600 .env
```

Add the following values to `.env`:

| Variable | Meaning |
| --- | --- |
| `PICNIC_USERNAME` | Email address for your Picnic account |
| `PICNIC_PASSWORD` | Password for your Picnic account |
| `PICNIC_COUNTRY_CODE` | Account country: `DE`, `NL`, or `FR`; defaults to `DE` |
| `CONTROL_PLANE_TUNNEL_ID` | Dedicated OpenAI tunnel ID for Picnic (`tunnel_…`) |
| `CONTROL_PLANE_API_KEY` | Runtime API key with Tunnels **Read + Use** permissions |

Keep the single quotes around your Picnic credentials so characters such as `$`
and `#` remain unchanged. Escape a single quote in a value as `\'`. Example
using a fictional value: `PICNIC_PASSWORD='Example$#with\'quotes'`.

Create the Picnic tunnel in
[OpenAI Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels).
You need Tunnels **Read + Manage** permissions to create it. Associate the
tunnel with the ChatGPT workspace you want to use. Use a dedicated tunnel ID for
Picnic; only one client instance can run for a tunnel ID at a time.

Git and the Docker build exclude `.env`. Credentials are not copied into the
image.

## Start

From the project directory:

```bash
docker compose -f docker-compose.tunnel.yml up -d --build
docker compose -f docker-compose.tunnel.yml ps
docker compose -f docker-compose.tunnel.yml logs --tail=100 -f mcp-picnic
```

The local tunnel status page is available at
[http://localhost:8091/ui](http://localhost:8091/ui). The port is bound to
`127.0.0.1`; set `TUNNEL_UI_PORT` in `.env` to change it. To access the page
from another computer, you can use SSH port forwarding:

```bash
ssh -L 8091:127.0.0.1:8091 USER@YOUR_DOCKER_HOST
```

The container runs as an unprivileged user with a read-only filesystem and a
writable data volume. Docker restarts it automatically. The health check tests
`/readyz`; verify Picnic access afterwards through the MCP tools.

After changing `.env`, recreate the container:

```bash
docker compose -f docker-compose.tunnel.yml up -d --force-recreate
```

## Connect ChatGPT and complete 2FA

1. Enable developer mode in ChatGPT, if your workspace allows it.
2. In [ChatGPT Plugins](https://chatgpt.com/plugins), create a developer app
   named “Picnic”.
3. Choose **Connection → Tunnel**, then select the Picnic tunnel or enter its ID.
4. Connect the app. It should discover **38 tools**.
5. If Picnic asks for two-factor verification, ask in the chat: “Send me a
   Picnic verification code.” The `picnic_generate_2fa_code` tool requests it;
   then use `picnic_verify_2fa_code` with the code you receive.
6. Confirm access by asking: “Show my Picnic cart.”

The Picnic session and device ID are stored in the `picnic-data` volume under
`/app/data`. The server reuses them after a restart. An expired session may
require signing in and completing 2FA again.

## Troubleshoot and stop

```bash
docker compose -f docker-compose.tunnel.yml exec mcp-picnic tunnel-client doctor --explain
docker compose -f docker-compose.tunnel.yml down
```

Running `docker compose -f docker-compose.tunnel.yml down` keeps the saved
session. Adding `-v` deletes the data volume; use it only when you intend to
reset all saved data.

If a required value is missing, the entrypoint reports its variable name. If
the tunnel does not become ready, check the tunnel ID, runtime key permissions,
workspace association, and outbound HTTPS access. Picnic sign-in errors appear
in the container logs.

## Local checks without account credentials

The image contains the server built from this checkout and the official tunnel
client `v0.0.15`. Its image digest is pinned in `Dockerfile.tunnel`. Check the
[official releases](https://github.com/openai/tunnel-client/releases/latest)
for updates.

```bash
npm ci --ignore-scripts
npm test
npm run typecheck
npm run lint
npm run build
docker compose -f docker-compose.tunnel.yml build
docker run --rm -i --network none --read-only \
  --tmpfs /tmp:mode=1777 --tmpfs /app/data:uid=1000,gid=1000,mode=700 \
  --cap-drop ALL --security-opt no-new-privileges:true \
  --entrypoint node mcp-picnic:tunnel < docker/smoke-test.cjs
```

The smoke test uses fictional credentials, a simulated Picnic API, and a local
OpenAI control plane. It checks the built MCP server and tunnel client, all 38
tools, the 2FA flow, session storage, device ID reuse, file permissions,
readiness endpoints, and graceful shutdown. Real account credentials and
OpenAI tunnel permissions require a separate check with your own configuration.

More information: [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
and [Picnic upstream](https://github.com/ivo-toby/mcp-picnic).
