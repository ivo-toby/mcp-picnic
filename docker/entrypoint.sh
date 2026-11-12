#!/bin/sh
set -eu

# Session credentials written by the server must only be readable by its user.
umask 077

# Help works before configuration is filled in.
for argument in "$@"; do
    case "$argument" in
        --help|-h)
            exec tunnel-client "$@"
            ;;
    esac
done

case "${1:-}" in
    run|doctor)
        : "${PICNIC_USERNAME:?PICNIC_USERNAME fehlt. Bitte in .env eintragen.}"
        : "${PICNIC_PASSWORD:?PICNIC_PASSWORD fehlt. Bitte in .env eintragen.}"
        : "${CONTROL_PLANE_TUNNEL_ID:?CONTROL_PLANE_TUNNEL_ID fehlt. Bitte in .env eintragen.}"
        : "${CONTROL_PLANE_API_KEY:?CONTROL_PLANE_API_KEY fehlt. Bitte in .env eintragen.}"
        case "${PICNIC_COUNTRY_CODE:-DE}" in
            DE|NL|FR) ;;
            *)
                echo 'PICNIC_COUNTRY_CODE muss DE, NL oder FR sein.' >&2
                exit 1
                ;;
        esac
        export PICNIC_COUNTRY_CODE="${PICNIC_COUNTRY_CODE:-DE}"
        # This deployment forwards the MCP server over STDIO.
        export ENABLE_HTTP_SERVER=false
        ;;
esac

exec tunnel-client "$@"
