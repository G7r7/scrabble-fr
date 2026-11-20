#!/bin/sh
# Envoie le relais sur alwaysdata (accès SSH par clé requis) et installe ses dépendances.
# Après le premier envoi, créez le site dans l'administration alwaysdata (voir README).
# Pour une mise à jour : relancez ce script, puis redémarrez le site depuis l'administration.
set -eu
ACCOUNT=${ALWAYSDATA_ACCOUNT:-grullier}
DEST=${ALWAYSDATA_DIR:-scrabble-relay}
HOST="$ACCOUNT@ssh-$ACCOUNT.alwaysdata.net"
# Node par défaut d'alwaysdata est ancien : on prend la version 24 la plus récente installée.
NODE_PATH_CMD='export PATH="$(ls -d /usr/alwaysdata/nodejs/24.* | sort -V | tail -1)/bin:$PATH"'
cd "$(dirname "$0")"
ssh "$HOST" "mkdir -p ~/$DEST"
scp server.mjs package.json package-lock.json "$HOST:~/$DEST/"
ssh "$HOST" "$NODE_PATH_CMD && cd ~/$DEST && node -v && npm ci --omit=dev --no-audit --no-fund"
echo "Relais envoyé dans ~/$DEST sur $HOST."
