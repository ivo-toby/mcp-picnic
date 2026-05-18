# Listing All MCP Interfaces

The following two methods can be used to list all MCP interfaces.

---

## 1. stdio

To run mcp-picnic as stdio server with `./bin/start.sh` via port 3000:

First of all, you need to fill up the required information in ./.env with the same pattern in ./.env.example

**Note:** In `picnic_authkey.json` you need to specify your picnic 2fa auth key like `{"authKey":"your picnic authKey"}`

```bash
./start.sh --enable-http --http-port 3000

```

---

## 2. HTTP + curl

Communicate with the local running picnic mcp server on port 3000:

```bash
curl -i http://localhost:3000/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{
    "jsonrpc":"2.0",
    "id":1,
    "method":"initialize",
    "params":{
      "protocolVersion":"2025-06-18",
      "capabilities":{},
      "clientInfo":{
        "name":"curl",
        "version":"1.0"
      }
    }
  }'
```

