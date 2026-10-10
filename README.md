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
- La page interroge `https://www.komoot.com/api/v007/tours/<id>?_embedded=coordinates`, l'interface que le site Komoot utilise lui-même.
- Le fichier GPX (trace avec altitudes) est généré localement.

Si le navigateur bloque l'appel direct vers Komoot (règles CORS), la page passe par un relais public (`corsproxy.io`, puis `api.allorigins.win`). La liste est en haut de `app.js` (`RELAYS`) : vous pouvez la modifier, ou la remplacer par votre propre relais (par exemple un Cloudflare Worker).

## Limites

- Komoot peut modifier son interface à tout moment, ce qui casserait l'outil.
- Les relais publics sont des services tiers, gratuits et sans garantie.
- Outil indépendant, sans lien avec Komoot. Respectez les conditions d'utilisation de Komoot et le travail des auteurs des sorties.

## Licence

MIT
