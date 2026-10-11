# K2GPX — Komoot vers GPX

Petite page web qui transforme le lien d'une sortie Komoot en fichier GPX, à importer dans Garmin Connect, Strava, OsmAnd, Wahoo ou n'importe quel GPS.

HTML, CSS et JavaScript, sans dépendance ni étape de compilation. Tout se passe dans le navigateur : aucun compte, rien n'est stocké.

## Utilisation

1. Copiez le lien d'une sortie Komoot (bouton « Partager » dans l'appli ou sur le site).
2. Collez-le dans la page et appuyez sur **Récupérer la trace**.
3. **Ouvrir le GPX** : sur téléphone, ouvre le menu de partage pour envoyer le fichier vers Garmin Connect, Strava, etc. Sur ordinateur, affiche le fichier dans un nouvel onglet.
4. **Télécharger le GPX** : enregistre le fichier.

La sortie doit être **publique**, ou partagée avec un lien complet contenant `share_token`. Les sorties privées ne sont pas accessibles.

Raccourci : `https://victordomejean.github.io/K2GPX/?url=<lien-komoot>` lance directement la récupération.

## Mise en ligne sur GitHub Pages

Le déploiement est automatique : à chaque push sur `main`, le workflow `.github/workflows/pages.yml` vérifie le JavaScript puis publie la page.

Réglage à faire une seule fois : dans le dépôt, **Settings → Pages → Build and deployment → Source**, choisir **GitHub Actions**.

La page est ensuite disponible à `https://victordomejean.github.io/K2GPX/`. On peut aussi relancer un déploiement à la main depuis l'onglet **Actions**.

## Fonctionnement

- Le numéro de la sortie et le `share_token` sont lus dans le lien.
- La page interroge `https://www.komoot.com/api/v007/tours/<id>` puis `…/coordinates`, l'interface que le site Komoot utilise lui-même.
- Le fichier GPX (trace avec altitudes) est généré localement.

Komoot n'autorise pas les appels venant d'autres sites (règles CORS) : la page passe donc par un relais. Elle essaie dans l'ordre le relais Cloudflare du dossier `worker/`, l'appel direct, puis des relais publics gratuits (`allorigins`, `codetabs`, `corsproxy`). Le détail de chaque tentative s'affiche dans la console du navigateur.

## Relais Cloudflare

Les relais publics tombent régulièrement en panne. Le dossier `worker/` contient un relais à vous, hébergé gratuitement sur Cloudflare Workers. Le même Worker sert aussi le site : la page fonctionne donc à deux adresses.

- `https://k2gpx.victor-domejean.workers.dev/` : le site et son relais sur la même adresse (le plus fiable).
- `https://victordomejean.github.io/K2GPX/` : la page GitHub Pages, qui appelle le relais ci-dessus.

Déploiement : dans Cloudflare, **Workers & Pages → Create → Import a repository**, choisir ce dépôt. Le fichier `wrangler.jsonc` indique quoi publier ; chaque push sur `main` redéploie le Worker.

Le relais (`/api?url=…`) n'accepte que les adresses de l'API des sorties Komoot. Les sites autorisés à l'appeler depuis une autre adresse sont listés dans `ALLOWED_ORIGINS`, en haut de `worker/komoot-proxy.js`.

## Limites

- Komoot peut modifier son interface à tout moment, ce qui casserait l'outil.
- Les relais publics sont des services tiers, gratuits et sans garantie.
- Outil indépendant, sans lien avec Komoot. Respectez les conditions d'utilisation de Komoot et le travail des auteurs des sorties.

## Licence

MIT
