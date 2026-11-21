# Scrabble FR

Scrabble en français, à jouer dans le navigateur contre l'ordinateur.

**Jouer : https://g7r7.github.io/scrabble-fr/**

- Règles francophones : 102 jetons, 2 jokers, valeurs françaises, scrabble à +50.
- Ordinateur en trois niveaux (facile, moyen, difficile). Il cherche ses coups avec l'algorithme d'Appel–Jacobson sur un graphe de mots (DAWG), calculé dans un Web Worker.
- Glisser-déposer à la souris ou au doigt, ou bien toucher une lettre puis une case. Un aperçu affiche les mots formés et le score avant de jouer.
- La partie en cours est sauvegardée dans le navigateur.
- **Jeu en ligne** à deux : « Jouer en ligne », puis envoyez le lien (ou le code à 6 caractères) à votre adversaire.
  La partie est gardée sur le serveur : chacun peut fermer la page et revenir plus tard avec le lien, et jouer
  même quand l'adversaire est hors ligne.
- **Trois modes de jeu** (Options, ou à la création d'une partie en ligne) :
  - **Normal** : les mots sont vérifiés avant d'être joués ;
  - **Challenge** : aucune vérification avant de jouer. L'adversaire accepte le coup ou le conteste
    (« CHALLENGE ! ») : si le mot est refusé, le coup est annulé et son auteur perd son tour ;
    sinon le coup compte et c'est celui qui a contesté qui perd son tour ;
  - **Hardcore** : chaque coup est contrôlé d'office ; un mot refusé coûte 10 points, les lettres reviennent
    sur le chevalet et le tour est perdu.
- Animations (pose des lettres, décompte mot par mot, compteur de points) et sons synthétisés, avec une musique de fond facultative.
- **Notifications** (icône cloche) : le navigateur vous prévient quand c'est à vous de jouer, quand la partie se termine
  ou quand l'adversaire arrive ou s'en va. Elles ne s'affichent que si la page est en arrière-plan.
- **Application installable** : dans Chrome ou Edge, « Installer l'appli » (Options) ou l'icône d'installation dans la barre d'adresse.
  L'appli s'ouvre dans sa propre fenêtre, affiche une pastille quand c'est votre tour et se lance hors ligne pour jouer contre l'ordinateur
  (`public/manifest.webmanifest`, `public/sw.js`).

## Dictionnaire

La liste officielle de la Fédération (ODS) est protégée par le droit d'auteur et n'est **pas** incluse.

- Par défaut, le jeu utilise une **liste libre** (≈ 311 000 mots) tirée du paquet MIT
  [`an-array-of-french-words`](https://github.com/words/an-array-of-french-words).
  Les accents sont retirés et les mots composés écartés. Les mots de deux lettres suivent la liste usuelle du Scrabble francophone.
- Si vous possédez l'ODS, vous pouvez **l'importer** depuis le panneau « Dictionnaire » : fichier texte, un mot par ligne.
  Le fichier est conservé dans IndexedDB, dans votre navigateur uniquement. Il n'est jamais envoyé ni publié.

## Développement

```sh
npm install
npm run dict     # régénère public/dict/fr-libre.txt
npm run dev
npm test
npm run build
```

Chaque push sur `main` déploie le site sur GitHub Pages (`.github/workflows/deploy.yml`).

## Jeu en ligne : le serveur de jeu (`server/`)

Le site reste statique. Pour le jeu en ligne, un serveur WebSocket (Node + `ws`) garde les parties et les arbitre :
il tient le sac, vérifie chaque coup avec la liste libre (`public/dict/fr-libre.txt`) en réutilisant les règles
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
