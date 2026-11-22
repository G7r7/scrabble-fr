# Scrabble FR

Scrabble en français, à jouer dans le navigateur contre l'ordinateur.

**Jouer : https://g7r7.github.io/scrabble-fr/**

- Règles francophones : 102 jetons, 2 jokers, valeurs françaises, scrabble à +50.
- Ordinateur en trois niveaux (facile, moyen, difficile). Il cherche ses coups avec l'algorithme d'Appel–Jacobson sur un graphe de mots (DAWG), calculé dans un Web Worker.
- Glisser-déposer à la souris ou au doigt, ou bien toucher une lettre puis une case. Un aperçu affiche les mots formés et le score avant de jouer.
- La partie en cours est sauvegardée dans le navigateur.
- **Jeu en ligne** à deux : « Jouer en ligne », puis envoyez le lien (ou le code à 6 caractères) à votre adversaire.
  La partie est gardée sur le serveur : chacun peut fermer l'appli et revenir plus tard, et jouer
  même quand l'adversaire est hors ligne.
  - **Mes parties en cours** : l'appli retient vos parties en ligne ; un bandeau les rappelle à l'ouverture
    (« à vous ! ») et « Jouer en ligne » les liste, avec l'état à jour donné par le serveur. On reprend d'un toucher.
  - **Continuer sur un autre appareil** (Options, pendant une partie en ligne) : un lien et un QR code qui
    contiennent votre place ; l'appareil précédent est déconnecté. « Quitter » abandonne la partie pour de bon.
- **Un seul bouton « Nouvelle partie »** : on y choisit l'adversaire (l'ordinateur et son niveau, ou quelqu'un en ligne),
  le mode, la liste de mots et le thème ; les réglages sont retenus pour la fois suivante.
- **Quatre modes de jeu** :
  - **Normal** : les mots sont vérifiés avant d'être joués ;
  - **Challenge** : aucune vérification avant de jouer. L'adversaire accepte le coup ou le conteste
    (« CHALLENGE ! ») : si le mot est refusé, le coup est annulé et son auteur perd son tour ;
    sinon le coup compte et c'est celui qui a contesté qui perd son tour ;
  - **Hardcore** : chaque coup est contrôlé d'office ; un mot refusé coûte 10 points, les lettres reviennent
    sur le chevalet et le tour est perdu.
  - **Compétition** : règles de tournoi du [règlement international du Scrabble classique](https://fisf.net/documents/R%C3%A8glement_international_du%20Scrabble_classique.pdf)
    (FISF/FFSc) : pendule de 15, 20, 25 ou 30 minutes par joueur ; on conteste un ou plusieurs mots du coup adverse —
    mot refusé : l'auteur reprend ses lettres et passe ; mot admis : 5 points de pénalité par mot contesté à tort ;
    le contestataire joue ensuite dans les deux cas.
  - En fin de partie Challenge ou Compétition, les **mots maléfiques** (non valables, mais passés sans contestation)
    sont démasqués sur le plateau, avec les points qu'ils ont rapportés ; non contestés, ils restent acquis. Temps épuisé : le joueur passe systématiquement et son adversaire
    ne peut plus changer de lettres ; les deux épuisés : fin de partie. Refus de jeu après 3 « je passe » de chacun.
- Animations (pose des lettres, décompte mot par mot, compteur de points) et sons synthétisés, volume général réglable.
- **Musique de fond** : le bouton musique passe de « coupée » à **jazz** (swing léger), puis à **classique**, et sa couleur
  change avec le choix. La musique classique (`src/ui/cathedral.ts`) est composée à la volée pour accompagner la
  réflexion : orgue, cordes, chœur, cloches, harpe et hautbois dans une réverbération de cathédrale, modes anciens,
  plans d'environ 17 minutes tirés au hasard l'un après l'autre : elle ne se répète jamais.
- **Notifications** (icône cloche) : le navigateur vous prévient quand c'est à vous de jouer, quand la partie se termine
  ou quand l'adversaire arrive ou s'en va. Elles ne s'affichent que si la page est en arrière-plan.
- **Application installable** : dans Chrome ou Edge, « Installer l'appli » (Options) ou l'icône d'installation dans la barre d'adresse.
  L'appli s'ouvre dans sa propre fenêtre, affiche une pastille quand c'est votre tour et se lance hors ligne pour jouer contre l'ordinateur
  (`public/manifest.webmanifest`, `public/sw.js`).

## Listes de mots

Chaque partie se joue avec une liste au choix (fenêtre « Nouvelle partie »). Toutes sont libres :

| Liste | Mots | Source | Licence |
|---|---|---|---|
| Mots courants | ≈ 32 000 | [Lexique 3.83](http://www.lexique.org/) : formes d'au moins 1 occurrence par million | CC BY-SA 4.0 |
| Libre (par défaut) | ≈ 311 000 | [`an-array-of-french-words`](https://github.com/words/an-array-of-french-words) | MIT |
| Complète | ≈ 408 000 | Lexique des formes fléchies de [Grammalecte](https://grammalecte.net/) 7.7 | MPL 2.0 |
| Étendue | ≈ 644 000 | [Morphalou 3.1](https://www.ortolang.fr/market/lexicons/morphalou) (ATILF / CNRS) | LGPL-LR |

**Listes perso** (panneau Dictionnaire, « Voir les listes, créer ma liste perso… ») : on parcourt chaque liste
(recherche par début de mot, ou par motif avec `?` pour une lettre et `*` pour une suite, filtre par longueur), et on
crée sa propre liste à partir de l'une d'elles, en ajoutant ou retirant des mots. Seul le modèle et les différences
sont enregistrés, dans le navigateur (IndexedDB) ; une partie garde de même ce résumé, figé au départ, plutôt que la
liste entière. Le serveur arbitre ainsi les parties en ligne jouées avec une liste perso (2 000 changements au plus).

Les accents sont retirés ; noms propres, sigles, mots composés et locutions sont écartés. Les mots de deux lettres
suivent partout la liste usuelle du Scrabble francophone. Les listes dérivées (`public/dict/fr-*.txt`) restent
sous la licence de leur source.

La liste officielle de la Fédération (ODS) est protégée par le droit d'auteur et n'est **pas** incluse.
Si vous possédez l'ODS, vous pouvez **l'importer** depuis le panneau « Dictionnaire » (un mot par ligne) et la choisir
pour vos parties contre l'ordinateur. Le fichier est conservé dans IndexedDB, dans votre navigateur uniquement :
il n'est jamais envoyé ni publié, et ne sert donc pas en ligne.

## Développement

```sh
npm install
npm run dict     # régénère public/dict/fr-libre.txt
node scripts/build-dicts.mjs <Lexique383.tsv> <grammalecte.txt> <Morphalou3.1_CSV.csv>  # les trois autres listes (sources : voir le script)
npm run themes   # régénère les mots des thèmes fantasy
npm run dev
npm test
npm run build
```

Chaque push sur `main` déploie le site sur GitHub Pages (`.github/workflows/deploy.yml`).

## Jeu en ligne : le serveur de jeu (`server/`)

Le site reste statique. Pour le jeu en ligne, un serveur WebSocket (Node + `ws`) garde les parties et les arbitre :
il tient le sac, vérifie chaque coup avec la liste choisie à la création (`public/dict/fr-*.txt`, chargée à la demande) en réutilisant les règles
de `src/game/`, et n'envoie à chaque joueur que sa vue (ni le chevalet adverse, ni l'ordre du sac).
Les parties sont sauvegardées dans `data/games.json` et survivent à un redémarrage ; elles expirent après
2 jours sans adversaire, 3 jours une fois finies, 30 jours sans aucun coup.

- `server/games.ts` : les parties (sans réseau, testé dans `tests/server.test.ts`) ; `server/server.ts` : WebSocket et sauvegarde ;
  `src/net/protocol.ts` : les messages échangés.
- En local : `cd server && npm install`, puis `npm run server` à la racine (compile `server/dist/server.mjs`, port 8787), et `npm run dev`.
- En production, l'adresse du serveur est dans `.env.production` (`VITE_RELAY_URL`).

### Hébergement sur alwaysdata

1. Envoyer le serveur (accès SSH par clé) : `server/deploy.sh` — il le compile, le copie dans `~/scrabble-relay`
   avec le dictionnaire et installe `ws`. Redémarrer ensuite le site dans l'administration.
2. Dans l'administration alwaysdata, **Web › Sites › Ajouter un site** :
   - Adresses : `grullier.alwaysdata.net/scrabble-relay`
   - Type : **Node.js**
   - Commande : `node server.mjs`
   - Répertoire de travail : `scrabble-relay`
   - Version de Node.js : **24** (la version par défaut du compte est trop ancienne)
3. Vérifier : `https://grullier.alwaysdata.net/scrabble-relay` affiche « Serveur Scrabble FR ».

Le serveur écoute sur `$IP:$PORT` fournis par alwaysdata ; les WebSockets passent par le même site.

Journal en direct : `server/logs.sh` (Ctrl+C pour quitter). Il ne contient que des événements
et des codes de partie : ni noms, ni adresses IP, ni contenu des coups.
