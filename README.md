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

Komoot n'autorise pas les appels venant d'autres sites (règles CORS) : la page passe donc par un relais. Elle essaie dans l'ordre votre relais perso s'il est configuré, l'appel direct, puis des relais publics gratuits (`allorigins`, `codetabs`, `corsproxy`). Le détail de chaque tentative s'affiche dans la console du navigateur.

## Relais perso (recommandé)

Les relais publics tombent régulièrement en panne ou limitent l'usage. Un relais à vous, sur Cloudflare Workers, est gratuit et prend cinq minutes :

1. Créez un compte sur [dash.cloudflare.com](https://dash.cloudflare.com), puis **Workers & Pages → Create → Create Worker**. Nommez-le par exemple `k2gpx`, puis **Deploy**.
2. **Edit code**, remplacez tout le contenu par celui de `worker/komoot-proxy.js`, puis **Deploy**.
3. Copiez l'adresse du worker (`https://k2gpx.<vous>.workers.dev`) dans `OWN_PROXY`, en haut de `app.js`, puis poussez sur `main`.

Le relais n'accepte que les adresses de l'API des sorties Komoot, et seulement depuis les origines listées dans `ALLOWED_ORIGINS`.

## Limites

- Komoot peut modifier son interface à tout moment, ce qui casserait l'outil.
- Les relais publics sont des services tiers, gratuits et sans garantie.
- Outil indépendant, sans lien avec Komoot. Respectez les conditions d'utilisation de Komoot et le travail des auteurs des sorties.

## Licence

MIT
