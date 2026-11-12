# Picnic mit Docker und OpenAI Secure MCP Tunnel

[English](docker-openai-tunnel.en.md) · [Nederlands](docker-openai-tunnel.nl.md)
[Français](docker-openai-tunnel.fr.md) · [Deutsch](docker-openai-tunnel.de.md)

Mit dieser Compose-Datei laufen der offizielle OpenAI-Tunnel-Client und der
gebaute Picnic-MCP-Server gemeinsam in einem Container. Der Client startet
Picnic als STDIO-Unterprozess. Die Verbindung benötigt ausgehenden HTTPS-Zugriff
auf OpenAI und Picnic. Für einen eigenständigen HTTP-Server ohne Tunnel siehe
`docker-compose.yml` und die Auswahl in der README.

## Konfiguration

Lege die lokale `.env` an:

```bash
cp .env.example .env
chmod 600 .env
```

Trage die Werte in `.env` ein:

| Variable | Bedeutung |
| --- | --- |
| `PICNIC_USERNAME` | E-Mail-Adresse deines Picnic-Kontos |
| `PICNIC_PASSWORD` | Passwort deines Picnic-Kontos |
| `PICNIC_COUNTRY_CODE` | Kontoland: `DE`, `NL` oder `FR`; voreingestellt ist `DE` |
| `CONTROL_PLANE_TUNNEL_ID` | Eigene OpenAI-Tunnel-ID für Picnic (`tunnel_…`) |
| `CONTROL_PLANE_API_KEY` | Runtime-Key mit Tunnels **Read + Use** |

Lasse die einfachen Anführungszeichen um die Zugangsdaten stehen, damit `$`
und `#` unverändert bleiben. Ein einfaches Anführungszeichen im Wert wird als
`\'` geschrieben. Beispiel mit einem erfundenen Wert:
`PICNIC_PASSWORD='Beispiel$#mit\'Zeichen'`.

Erstelle den Picnic-Tunnel in den
[OpenAI Platform Tunnel-Einstellungen](https://platform.openai.com/settings/organization/tunnels).
Dafür brauchst du Tunnels **Read + Manage**. Ordne den Tunnel dem gewünschten
ChatGPT-Workspace zu. Verwende eine eigene Tunnel-ID für Picnic; pro Tunnel-ID
darf nur eine aktive Client-Instanz laufen.

`.env` ist von Git und vom Docker-Build ausgeschlossen. Zugangsdaten werden
nicht in das Image kopiert.

## Starten

Im Projektverzeichnis:

```bash
docker compose -f docker-compose.tunnel.yml up -d --build
docker compose -f docker-compose.tunnel.yml ps
docker compose -f docker-compose.tunnel.yml logs --tail=100 -f mcp-picnic
```

Die lokale Tunnel-Statusseite ist unter
[http://localhost:8091/ui](http://localhost:8091/ui) erreichbar. Der Port ist
auf `127.0.0.1` beschränkt. `TUNNEL_UI_PORT` in `.env` ändert ihn. Bei Zugriff
von einem anderen Rechner kannst du eine SSH-Portweiterleitung verwenden:

```bash
ssh -L 8091:127.0.0.1:8091 BENUTZER@DEIN_DOCKER_HOST
```

Der Container läuft als unprivilegierter Benutzer, mit schreibgeschütztem
Dateisystem und einem beschreibbaren Datenvolume. Er startet automatisch mit
Docker neu. Der Healthcheck prüft `/readyz`; der vollständige Picnic-Zugriff
wird anschließend über die MCP-Tools geprüft.

Nach Änderungen an `.env`:

```bash
docker compose -f docker-compose.tunnel.yml up -d --force-recreate
```

## ChatGPT verbinden und 2FA abschließen

1. Aktiviere den Entwicklermodus in ChatGPT, soweit dein Workspace ihn erlaubt.
2. Erstelle unter [ChatGPT Plugins](https://chatgpt.com/plugins) eine
   Entwickler-App „Picnic“.
3. Wähle **Connection → Tunnel** und den Picnic-Tunnel beziehungsweise seine ID.
4. Verbinde die App; es sollten **38 Tools** erkannt werden.
5. Wenn Picnic eine Zwei-Faktor-Verifizierung verlangt, bitte im Chat:
   „Sende mir einen Picnic-Verifizierungscode.“ Das Tool
   `picnic_generate_2fa_code` fordert ihn an. Mit dem erhaltenen Code kann
   `picnic_verify_2fa_code` die Anmeldung abschließen.
6. Prüfe den Zugriff mit „Zeige meinen Picnic-Warenkorb.“

Picnic-Sitzung und Geräte-ID werden im Volume `picnic-data` unter `/app/data`
gespeichert. Nach einem Neustart verwendet der Server sie erneut; eine
abgelaufene Sitzung kann eine erneute Anmeldung und 2FA erfordern.

## Diagnose und Stoppen

```bash
docker compose -f docker-compose.tunnel.yml exec mcp-picnic tunnel-client doctor --explain
docker compose -f docker-compose.tunnel.yml down
```

`docker compose -f docker-compose.tunnel.yml down` erhält die gespeicherte
Sitzung. Die Option `-v` löscht das Datenvolume und sollte nur für einen
beabsichtigten vollständigen Reset verwendet werden.

Bei einem fehlenden Pflichtfeld bricht der Einstieg mit dem Variablennamen ab.
Wenn der Tunnel nicht bereit wird, prüfe die Tunnel-ID, Runtime-Key-Rechte,
Workspace-Zuordnung und den ausgehenden HTTPS-Zugriff. Picnic-Anmeldefehler
erscheinen in den Container-Logs.

## Lokale Prüfung ohne Zugangsdaten

Das Image enthält den aus diesem Checkout gebauten Server und den offiziellen
Tunnel-Client `v0.0.15`, dessen Image-Digest im `Dockerfile.tunnel` festgelegt
ist. Updates findest du unter den
[offiziellen Releases](https://github.com/openai/tunnel-client/releases/latest).

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

Der Smoke-Test verwendet erfundene Zugangsdaten, eine simulierte Picnic-API
und eine lokale OpenAI-Kontrollstelle. Er prüft den echten gebauten MCP-Server
und Tunnel-Client, die 38 Tools, den 2FA-Ablauf, Sitzungsspeicherung,
Geräte-ID-Wiederverwendung, Dateirechte, Statusendpunkte und sauberes Beenden.
Echte Kontozugänge und die OpenAI-Tunnelberechtigungen brauchen eine separate
Prüfung mit der ausgefüllten Konfiguration.

Weitere Informationen:
[OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
und [Picnic-Upstream](https://github.com/ivo-toby/mcp-picnic).
