# K2GPX

Transforme le lien de partage d'une sortie Komoot en fichier GPX, à importer dans Garmin Connect, Strava, OsmAnd ou n'importe quel GPS.

**https://k2gpx.victor-domejean.workers.dev/**

## Utilisation

1. Dans Komoot, ouvrez la sortie, touchez **Partager** puis **Copier le lien**.
2. Collez le lien dans la page et appuyez sur **Récupérer la trace**.
3. Appuyez sur **Télécharger le GPX**. Sur téléphone, le fichier peut ensuite être ouvert directement avec l'appli de votre choix.

Le lien doit être le lien de partage complet : il contient la clé `share_token`, sans laquelle Komoot refuse de donner la trace.

## Fonctionnement

La page et un petit relais tournent sur Cloudflare Workers. Le relais (`worker/komoot-proxy.js`) récupère le nom et les points de la sortie auprès de Komoot ; le fichier GPX est fabriqué dans le navigateur. Aucun compte, rien n'est stocké.

Chaque push sur `main` redéploie automatiquement le site sur Cloudflare (configuration dans `wrangler.jsonc`).

Outil indépendant, sans lien avec Komoot.

## Licence

MIT
