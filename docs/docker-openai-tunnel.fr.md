# Picnic avec Docker et OpenAI Secure MCP Tunnel

[English](docker-openai-tunnel.en.md) · [Nederlands](docker-openai-tunnel.nl.md)
[Français](docker-openai-tunnel.fr.md) · [Deutsch](docker-openai-tunnel.de.md)

Ce fichier Compose lance dans un même conteneur le client officiel OpenAI pour
les tunnels et le serveur MCP Picnic compilé. Le client démarre Picnic comme
sous-processus STDIO. La connexion nécessite un accès HTTPS sortant à OpenAI et
Picnic. Pour un serveur HTTP autonome sans tunnel, consultez
`docker-compose.yml` et les choix de transport dans le README.

## Configuration

Créez le fichier `.env` local :

```bash
cp .env.example .env
chmod 600 .env
```

Renseignez les valeurs suivantes dans `.env` :

| Variable | Signification |
| --- | --- |
| `PICNIC_USERNAME` | Adresse e-mail de votre compte Picnic |
| `PICNIC_PASSWORD` | Mot de passe de votre compte Picnic |
| `PICNIC_COUNTRY_CODE` | Pays du compte : `DE`, `NL` ou `FR` ; `DE` par défaut |
| `CONTROL_PLANE_TUNNEL_ID` | Identifiant de tunnel OpenAI dédié à Picnic (`tunnel_…`) |
| `CONTROL_PLANE_API_KEY` | Clé d’exécution avec les droits Tunnels **Read + Use** |

Gardez les apostrophes simples autour de vos identifiants Picnic pour préserver
les caractères tels que `$` et `#`. Pour inclure une apostrophe dans une valeur,
écrivez `\'`. Exemple fictif : `PICNIC_PASSWORD='Exemple$#avec\'apostrophe'`.

Créez le tunnel Picnic dans les
[paramètres des tunnels OpenAI Platform](https://platform.openai.com/settings/organization/tunnels).
Les droits Tunnels **Read + Manage** sont nécessaires pour le créer. Associez-le
à l’espace de travail ChatGPT souhaité. Réservez un identifiant de tunnel à
Picnic ; une seule instance cliente peut fonctionner à la fois pour un même
identifiant.

Git et la construction Docker excluent `.env`. Les identifiants ne sont pas
copiés dans l’image.

## Démarrage

Depuis le répertoire du projet :

```bash
docker compose -f docker-compose.tunnel.yml up -d --build
docker compose -f docker-compose.tunnel.yml ps
docker compose -f docker-compose.tunnel.yml logs --tail=100 -f mcp-picnic
```

La page locale d’état du tunnel est accessible à
[http://localhost:8091/ui](http://localhost:8091/ui). Le port est lié à
`127.0.0.1`. Modifiez `TUNNEL_UI_PORT` dans `.env` pour changer de port. Pour
accéder à la page depuis un autre ordinateur, vous pouvez utiliser une
redirection de port SSH :

```bash
ssh -L 8091:127.0.0.1:8091 UTILISATEUR@VOTRE_HOTE_DOCKER
```

Le conteneur fonctionne avec un utilisateur non privilégié, un système de
fichiers en lecture seule et un volume de données accessible en écriture. Docker
le redémarre automatiquement. Le contrôle d’état vérifie `/readyz` ; vérifiez
ensuite l’accès à Picnic avec les outils MCP.

Après toute modification de `.env`, recréez le conteneur :

```bash
docker compose -f docker-compose.tunnel.yml up -d --force-recreate
```

## Connexion à ChatGPT et validation 2FA

1. Activez le mode développeur dans ChatGPT, si votre espace de travail
   l’autorise.
2. Dans [ChatGPT Plugins](https://chatgpt.com/plugins), créez une application
   développeur nommée « Picnic ».
3. Choisissez **Connection → Tunnel**, puis sélectionnez le tunnel Picnic ou
   saisissez son identifiant.
4. Connectez l’application. Elle devrait détecter **38 outils**.
5. Si Picnic demande une vérification en deux étapes, demandez dans la
   conversation : « Envoie-moi un code de vérification Picnic. » L’outil
   `picnic_generate_2fa_code` le demande ; saisissez ensuite le code reçu avec
   `picnic_verify_2fa_code`.
6. Vérifiez l’accès en demandant : « Affiche mon panier Picnic. »

La session Picnic et l’identifiant de l’appareil sont enregistrés dans le
volume `picnic-data`, sous `/app/data`. Le serveur les réutilise après un
redémarrage. Une session expirée peut nécessiter une nouvelle connexion et une
nouvelle validation 2FA.

## Diagnostic et arrêt

```bash
docker compose -f docker-compose.tunnel.yml exec mcp-picnic tunnel-client doctor --explain
docker compose -f docker-compose.tunnel.yml down
```

La commande `docker compose -f docker-compose.tunnel.yml down` conserve la
session enregistrée. L’option `-v` supprime le volume de données ; utilisez-la
uniquement si vous souhaitez réinitialiser toutes les données enregistrées.

Si une valeur obligatoire manque, le script de démarrage indique son nom. Si le
tunnel n’est pas prêt, vérifiez son identifiant, les droits de la clé
d’exécution, l’association avec l’espace de travail et l’accès HTTPS sortant.
Les erreurs de connexion Picnic apparaissent dans les journaux du conteneur.

## Vérifications locales sans identifiants de compte

L’image contient le serveur compilé depuis cette copie du dépôt et le client de
tunnel officiel `v0.0.15`. Le condensat de l’image est fixé dans
`Dockerfile.tunnel`. Consultez les
[versions officielles](https://github.com/openai/tunnel-client/releases/latest)
pour les mises à jour.

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

Le test de fumée utilise des identifiants fictifs, une API Picnic simulée et un
plan de contrôle OpenAI local. Il vérifie le serveur MCP compilé et le client de
tunnel, les 38 outils, le parcours 2FA, l’enregistrement de session, la
réutilisation de l’identifiant de l’appareil, les permissions des fichiers,
les points de terminaison d’état et l’arrêt propre. Les identifiants réels et
les autorisations de tunnel OpenAI doivent être vérifiés séparément avec votre
propre configuration.

Pour en savoir plus : [OpenAI Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels)
et [le dépôt Picnic](https://github.com/ivo-toby/mcp-picnic).
