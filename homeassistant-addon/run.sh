#!/bin/sh
set -e

CONFIG_PATH=/data/options.json

export PICNIC_USERNAME=$(jq -r '.picnic_username' "$CONFIG_PATH")
export PICNIC_PASSWORD=$(jq -r '.picnic_password' "$CONFIG_PATH")
export PICNIC_COUNTRY_CODE=$(jq -r '.picnic_country_code' "$CONFIG_PATH")
export HTTP_PORT=3000
export HTTP_HOST=0.0.0.0
export ENABLE_HTTP_SERVER=true

exec node /usr/local/lib/node_modules/mcp-picnic/bin/mcp-server.js
