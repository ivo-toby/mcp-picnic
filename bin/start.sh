#!/bin/bash
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -f "$(dirname "$0")/../.env" ] && source "$(dirname "$0")/../.env"
exec node "$(dirname "$0")/mcp-server.js" "$@"
