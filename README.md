# Scrabble FR

Scrabble en français, à jouer dans le navigateur contre l'ordinateur.

**Jouer : https://g7r7.github.io/scrabble-fr/**

- Règles francophones : 102 jetons, 2 jokers, valeurs françaises, scrabble à +50.
- Ordinateur en trois niveaux (facile, moyen, difficile). Il cherche ses coups avec l'algorithme d'Appel–Jacobson sur un graphe de mots (DAWG), calculé dans un Web Worker.
- Glisser-déposer à la souris ou au doigt, ou bien toucher une lettre puis une case. Un aperçu affiche les mots formés et le score avant de jouer.
- La partie en cours est sauvegardée dans le navigateur.
- **Jeu en ligne** à deux : « Jouer en ligne », puis envoyez le lien (ou le code à 6 caractères) à votre adversaire.
  Chacun peut recharger la page ou perdre le réseau : la partie reprend toute seule.
- Animations (pose des lettres, décompte mot par mot, compteur de points) et sons synthétisés, avec une musique de fond facultative.

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

## Jeu en ligne : le relais (`server/`)

Le site reste statique. Pour le jeu en ligne, un petit relais WebSocket (`server/server.mjs`, Node + `ws`)
met en relation les deux joueurs et transmet leurs messages ; il ne connaît pas les règles.
C'est le navigateur de la personne qui crée la partie qui arbitre : il garde le sac, vérifie chaque coup
de l'invité avec son dictionnaire, et n'envoie à l'invité ni son chevalet ni l'ordre du sac.

- En local : `cd server && npm install && npm start` (port 8787), puis `npm run dev`.
- En production, l'adresse du relais est dans `.env.production` (`VITE_RELAY_URL`).

### Hébergement sur alwaysdata

1. Envoyer le relais (accès SSH par clé) : `server/deploy.sh` — il le copie dans `~/scrabble-relay` et installe `ws`.
2. Dans l'administration alwaysdata, **Web › Sites › Ajouter un site** :
   - Adresses : `grullier.alwaysdata.net/scrabble-relay`
   - Type : **Node.js**
   - Commande : `node server.mjs`
   - Répertoire de travail : `scrabble-relay`
   - Version de Node.js : **24** (la version par défaut du compte est trop ancienne)
3. Vérifier : `https://grullier.alwaysdata.net/scrabble-relay` affiche « Relais Scrabble FR ».

Le relais écoute sur `$IP:$PORT` fournis par alwaysdata ; les WebSockets passent par le même site.

Journal en direct : `server/logs.sh` (Ctrl+C pour quitter). Il ne contient que des événements
et des codes de partie : ni noms, ni adresses IP, ni contenu des coups.
