// Serveur de jeu en ligne de Scrabble FR : garde les parties, arbitre chaque coup avec son dictionnaire
// et envoie à chaque joueur sa vue de la partie. Les parties sont sauvegardées sur disque
// (data/games.json) et survivent à un redémarrage.
//
//   wss://…/?code=ABC234&token=<jeton secret du joueur>[&create=1]
//
// Compilé en un seul fichier dist/server.mjs (npm run server:build à la racine du dépôt).
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { normalizeWord } from '../src/dict/normalize.js';
import { CLOSE } from '../src/net/protocol';
import { Games, type Room, type SeatNo } from './games';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.IP ?? '0.0.0.0';
const MAX_MSG = 64 * 1024;
const DATA = process.env.DATA_DIR ?? join(HERE, 'data');
const SAVE = join(DATA, 'games.json');

// ---------- Dictionnaire ----------
const dictPath = [process.env.DICT_PATH, join(HERE, 'fr-libre.txt'), join(HERE, '../../public/dict/fr-libre.txt')]
  .find((p): p is string => !!p && existsSync(p));
if (!dictPath) throw new Error('Dictionnaire introuvable (fr-libre.txt)');
const words = new Set<string>();
for (const line of readFileSync(dictPath, 'utf8').split(/\r?\n/)) {
  const w = normalizeWord(line);
  if (w) words.add(w);
}

// ---------- Connexions ----------
interface Conn { ws: WebSocket; alive: boolean }
/** Connexions ouvertes par partie : [joueur 0, joueur 1]. */
const conns = new Map<string, [Conn | null, Conn | null]>();
const connsOf = (code: string) => {
  let c = conns.get(code);
  if (!c) conns.set(code, (c = [null, null]));
  return c;
};
const sendWs = (ws: WebSocket | undefined, obj: unknown) => { if (ws?.readyState === 1) ws.send(JSON.stringify(obj)); };

// ---------- Sauvegarde ----------
let saveTimer: ReturnType<typeof setTimeout> | null = null;
function saveNow() {
  saveTimer = null;
  try {
    mkdirSync(DATA, { recursive: true });
    writeFileSync(`${SAVE}.tmp`, JSON.stringify(games));
    renameSync(`${SAVE}.tmp`, SAVE);
  } catch (err) { console.error('Sauvegarde impossible :', err); }
}

const games = new Games({
  send: (room, seat, msg) => sendWs(conns.get(room.code)?.[seat]?.ws, msg),
  invalidWords: (ws) => ws.filter((w) => !words.has(w)),
  changed: () => { saveTimer ??= setTimeout(saveNow, 1000); },
});
try {
  if (existsSync(SAVE)) games.load(JSON.parse(readFileSync(SAVE, 'utf8')));
} catch (err) { console.error('Sauvegarde illisible, on repart de zéro :', err); }

// Journal : uniquement des événements et des codes de partie (ni noms, ni adresses IP, ni contenu des coups).
const online = () => [...conns.values()].reduce((n, c) => n + (c[0] ? 1 : 0) + (c[1] ? 1 : 0), 0);
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg} [${games.rooms.size} partie(s), ${online()} connexion(s)]`);
const WHO = ['joueur 1', 'joueur 2'];

const http = createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(`Serveur Scrabble FR — ${games.rooms.size} partie(s), ${words.size} mots.\n`);
});
const wss = new WebSocketServer({ server: http, maxPayload: MAX_MSG });

wss.on('connection', (ws, req) => {
  const q = new URL(req.url ?? '/', 'http://x').searchParams;
  const code = q.get('code') ?? '', token = q.get('token') ?? '', create = q.get('create') === '1';
  const res = games.join(code, token, create);
  if ('close' in res) {
    log(`${/^[A-Z0-9]{6}$/.test(code) ? code : '??????'} refus (${res.close})`);
    return ws.close(res.close, 'refusé');
  }
  const room: Room = res.room, seat: SeatNo = res.seat, other: SeatNo = seat === 0 ? 1 : 0;
  const c = connsOf(code);
  const old = c[seat];
  const me: Conn = { ws, alive: true };
  c[seat] = me;
  if (old) old.ws.close(CLOSE.REPLACED, 'remplacé');
  log(`${code} ${WHO[seat]} connecté${old ? ' (reconnexion)' : ''}`);
  sendWs(ws, { type: '_peer', online: !!c[other] });
  sendWs(c[other]?.ws, { type: '_peer', online: true });

  ws.on('pong', () => { me.alive = true; });
  let budget = 30; // limite simple : 30 messages, rechargés de 1 par seconde
  const refill = setInterval(() => { budget = Math.min(30, budget + 1); }, 1000);

  ws.on('message', (data, isBinary) => {
    if (isBinary || c[seat] !== me) return;
    if (--budget < 0) { log(`${code} ${WHO[seat]} coupé : trop de messages`); return ws.close(CLOSE.BUSY, 'trop de messages'); }
    let msg: unknown;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    // La partie a pu être supprimée (les deux joueurs l'ont quittée) : on ne la recrée pas.
    if (games.rooms.get(code) !== room) return;
    const type = (msg as { type?: unknown })?.type;
    void games.message(room, seat, msg).then(() => {
      if (type === 'action') log(`${code} coup du ${WHO[seat]}`);
      else if (type === 'bye') log(`${code} ${WHO[seat]} quitte la partie${games.rooms.has(code) ? '' : ' (supprimée)'}`);
    }, (err) => console.error(err));
  });

  ws.on('close', () => {
    clearInterval(refill);
    if (c[seat] !== me) return;
    c[seat] = null;
    if (!c[0] && !c[1]) conns.delete(code);
    log(`${code} ${WHO[seat]} déconnecté`);
    sendWs(c[other]?.ws, { type: '_peer', online: false });
  });
});

// Battement de cœur : détecte les connexions mortes et garde les proxys ouverts ; ménage des vieilles parties.
setInterval(() => {
  for (const pair of conns.values()) {
    for (const conn of pair) {
      if (!conn) continue;
      if (!conn.alive) { conn.ws.terminate(); continue; }
      conn.alive = false;
      conn.ws.ping();
    }
  }
  for (const code of games.sweep()) log(`${code} partie expirée`);
}, 30_000);

const shutdown = () => { if (saveTimer) { clearTimeout(saveTimer); saveNow(); } process.exit(0); };
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

http.listen(PORT, HOST, () =>
  console.log(`Serveur Scrabble FR à l'écoute sur ${HOST}:${PORT} — ${words.size} mots, ${games.rooms.size} partie(s) reprise(s)`));
