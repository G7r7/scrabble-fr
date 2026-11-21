#!/bin/sh
# Compile le serveur de jeu et l'envoie sur alwaysdata (accès SSH par clé requis), avec les listes de mots.
# Les parties en cours sont dans ~/$DEST/data/games.json : ce script n'y touche pas.
# Après le premier envoi, créez le site dans l'administration alwaysdata (voir README).
# Pour une mise à jour : relancez ce script, puis redémarrez le site depuis l'administration.
set -eu
ACCOUNT=${ALWAYSDATA_ACCOUNT:-grullier}
DEST=${ALWAYSDATA_DIR:-scrabble-relay}
HOST="$ACCOUNT@ssh-$ACCOUNT.alwaysdata.net"
# Node par défaut d'alwaysdata est ancien : on prend la version 24 la plus récente installée.
NODE_PATH_CMD='export PATH="$(ls -d /usr/alwaysdata/nodejs/24.* | sort -V | tail -1)/bin:$PATH"'
cd "$(dirname "$0")/.."
npm run server:build
ssh "$HOST" "mkdir -p ~/$DEST"
# dist/server.mjs est copié sous le nom server.mjs : la commande du site (node server.mjs) ne change pas.
scp server/dist/server.mjs "$HOST:~/$DEST/server.mjs"
scp server/package.json server/package-lock.json public/dict/fr-*.txt "$HOST:~/$DEST/"
ssh "$HOST" "$NODE_PATH_CMD && cd ~/$DEST && node -v && npm ci --omit=dev --no-audit --no-fund"
echo "Serveur envoyé dans ~/$DEST sur $HOST. Redémarrez le site depuis l'administration alwaysdata."
