# Picnic met Docker en OpenAI Secure MCP Tunnel

[English](docker-openai-tunnel.en.md) · [Nederlands](docker-openai-tunnel.nl.md)
[Français](docker-openai-tunnel.fr.md) · [Deutsch](docker-openai-tunnel.de.md)

Dit Compose-bestand start de officiële OpenAI-tunnelclient en de gebouwde
Picnic-MCP-server samen in één container. De client start Picnic als STDIO-
subproces. De verbinding vereist uitgaand HTTPS-verkeer naar OpenAI en Picnic.
Voor een zelfstandige HTTP-server zonder tunnel, zie `docker-compose.yml` en de
transportkeuzes in de README.

## Configureren

Maak het lokale `.env`-bestand aan:

```bash
cp .env.example .env
chmod 600 .env
```

Vul de volgende waarden in `.env` in:

| Variabele | Betekenis |
| --- | --- |
| `PICNIC_USERNAME` | E-mailadres van je Picnic-account |
| `PICNIC_PASSWORD` | Wachtwoord van je Picnic-account |
| `PICNIC_COUNTRY_CODE` | Land van je account: `DE`, `NL` of `FR`; standaard `DE` |
| `CONTROL_PLANE_TUNNEL_ID` | Eigen OpenAI-tunnel-ID voor Picnic (`tunnel_…`) |
| `CONTROL_PLANE_API_KEY` | Runtime-API-sleutel met Tunnels **Read + Use** |

Laat de enkele aanhalingstekens rond je Picnic-inloggegevens staan, zodat
tekens zoals `$` en `#` ongewijzigd blijven. Een enkel aanhalingsteken in de
waarde schrijf je als `\'`. Voorbeeld met fictieve gegevens:
`PICNIC_PASSWORD='Voorbeeld$#met\'tekens'`.

Maak de Picnic-tunnel aan via de
[OpenAI Platform-tunnelinstellingen](https://platform.openai.com/settings/organization/tunnels).
Daarvoor heb je Tunnels **Read + Manage** nodig. Koppel de tunnel aan de
ChatGPT-werkruimte die je wilt gebruiken. Gebruik een aparte tunnel-ID voor
Picnic; per tunnel-ID kan maar één client tegelijk draaien.

Git en de Docker-build sluiten `.env` uit. Inloggegevens worden niet naar de
image gekopieerd.

## Starten

Voer dit uit in de projectmap:

```bash
docker compose -f docker-compose.tunnel.yml up -d --build
docker compose -f docker-compose.tunnel.yml ps
docker compose -f docker-compose.tunnel.yml logs --tail=100 -f mcp-picnic
```

De lokale tunnelstatuspagina staat op
[http://localhost:8091/ui](http://localhost:8091/ui). De poort is alleen
gebonden aan `127.0.0.1`. Pas `TUNNEL_UI_PORT` in `.env` aan om de poort te
wijzigen. Voor toegang vanaf een andere computer kun je SSH-port forwarding
gebruiken:

```bash
ssh -L 8091:127.0.0.1:8091 GEBRUIKER@JOUW_DOCKER_HOST
```

De container draait als niet-geprivilegieerde gebruiker, met een alleen-lezen
bestandssysteem en een schrijfbaar datavolume. Docker start hem automatisch
opnieuw. De healthcheck controleert `/readyz`; controleer daarna de Picnic-
toegang via de MCP-tools.

Maak de container opnieuw aan nadat je `.env` hebt gewijzigd:

```bash
docker compose -f docker-compose.tunnel.yml up -d --force-recreate
```

## ChatGPT verbinden en 2FA afronden

1. Schakel de ontwikkelaarsmodus in ChatGPT in, als je werkruimte dit toestaat.
2. Maak in [ChatGPT Plugins](https://chatgpt.com/plugins) een developer-app met
   de naam “Picnic”.
3. Kies **Connection → Tunnel** en selecteer de Picnic-tunnel of voer de ID in.
4. Verbind de app. Er zouden **38 tools** gevonden moeten worden.
5. Vraagt Picnic om tweestapsverificatie? Vraag dan in de chat: “Stuur me een
   Picnic-verificatiecode.” De tool `picnic_generate_2fa_code` vraagt de code
   aan; voer de ontvangen code daarna in via `picnic_verify_2fa_code`.
6. Controleer de toegang met: “Toon mijn Picnic-winkelwagen.”

De Picnic-sessie en apparaat-ID worden opgeslagen in het volume `picnic-data`
onder `/app/data`. Na een herstart gebruikt de server deze gegevens opnieuw.
Bij een verlopen sessie moet je mogelijk opnieuw aanmelden en 2FA doorlopen.

## Problemen oplossen en stoppen

```bash
docker compose -f docker-compose.tunnel.yml exec mcp-picnic tunnel-client doctor --explain
docker compose -f docker-compose.tunnel.yml down
```

Met `docker compose -f docker-compose.tunnel.yml down` blijft de opgeslagen
sessie behouden. De optie `-v` verwijdert het datavolume; gebruik die alleen als
je alle opgeslagen gegevens wilt wissen.

Als een verplichte waarde ontbreekt, toont de entrypoint de naam van de
variabele. Wordt de tunnel niet gereed, controleer dan de tunnel-ID, de rechten
van de runtime-sleutel, de koppeling met de werkruimte en de uitgaande HTTPS-
verbinding. Aanmeldfouten bij Picnic staan in de containerlogs.

## Lokaal controleren zonder accountgegevens

De image bevat de server die vanuit deze checkout is gebouwd en de officiële
tunnelclient `v0.0.15`. De image-digest staat vastgelegd in `Dockerfile.tunnel`.
Bekijk de [officiële releases](https://github.com/openai/tunnel-client/releases/latest)
voor updates.

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

De smoke-test gebruikt fictieve inloggegevens, een gesimuleerde Picnic-API en
een lokale OpenAI-controlplane. Hij controleert de gebouwde MCP-server en
tunnelclient, alle 38 tools, de 2FA-stroom, sessieopslag, hergebruik van de
apparaat-ID, bestandsrechten, readiness-endpoints en netjes afsluiten. Echte
accountgegevens en OpenAI-tunnelrechten moeten apart worden gecontroleerd met
je eigen configuratie.

Meer informatie: [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
en [Picnic-upstream](https://github.com/ivo-toby/mcp-picnic).
