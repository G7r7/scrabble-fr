#!/bin/sh
# Affiche en direct le journal du relais sur alwaysdata (Ctrl+C pour quitter).
set -eu
ACCOUNT=${ALWAYSDATA_ACCOUNT:-grullier}
exec ssh -t "$ACCOUNT@ssh-$ACCOUNT.alwaysdata.net" \
  'tail -n 5000 -F ~/admin/logs/sites/$(date +%Y)/sites-$(date +%F).log | grep --line-buffered -E "STD(OUT|ERR):" | sed -u -E "s/^.*STD(OUT|ERR): //"'
