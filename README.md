# Scrabble FR

Scrabble en français, à jouer dans le navigateur contre l'ordinateur.

**Jouer : https://g7r7.github.io/scrabble-fr/**

- Règles francophones : 102 jetons, 2 jokers, valeurs françaises, scrabble à +50.
- Ordinateur en trois niveaux (facile, moyen, difficile). Il cherche ses coups avec l'algorithme d'Appel–Jacobson sur un graphe de mots (DAWG), calculé dans un Web Worker.
- Glisser-déposer à la souris ou au doigt, ou bien toucher une lettre puis une case. Un aperçu affiche les mots formés et le score avant de jouer.
- La partie en cours est sauvegardée dans le navigateur.

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
