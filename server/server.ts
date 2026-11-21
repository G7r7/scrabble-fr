// Serveur de jeu en ligne de Scrabble FR : garde les parties, arbitre chaque coup avec la liste de mots choisie
// et envoie à chaque joueur sa vue de la partie. Les parties sont sauvegardées sur disque
// (data/games.json) et survivent à un redémarrage.
//
//   wss://…/?code=ABC234&token=<jeton secret du joueur>[&create=1]
//
// Compilé en un seul fichier dist/server.mjs (npm run server:build à la racine du dépôt).
import { createServer } from 'node:http';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import { normalizeWord } from '../src/dict/normalize.js';
import { CLOSE } from '../src/net/protocol';
import { Games, type Room, type SeatNo } from './games';
import { DEFAULT_DICT, dictInfo, type DictId } from '../src/game/dicts';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.IP ?? '0.0.0.0';
const MAX_MSG = 64 * 1024;
const DATA = process.env.DATA_DIR ?? join(HERE, 'data');
const SAVE = join(DATA, 'games.json');

// ---------- Listes de mots (chargées à la demande, puis gardées en mémoire) ----------
const DICT_DIRS = [process.env.DICT_DIR, HERE, join(HERE, '../../public/dict')].filter((d): d is string => !!d);
const dicts = new Map<DictId, Promise<Set<string>>>();
function loadDict(id: DictId): Promise<Set<string>> {
  let p = dicts.get(id);
  if (!p) {
    p = (async () => {
      // Sur le serveur, les listes sont compressées (fr-….txt.gz) pour tenir dans le quota disque.
      const file = dictInfo(id).file;
      const path = DICT_DIRS.flatMap((d) => [join(d, file), join(d, `${file}.gz`)]).find((f) => existsSync(f));
      if (!path) throw new Error(`Liste introuvable : ${file}`);
      const raw = await readFile(path);
      const text = (path.endsWith('.gz') ? gunzipSync(raw) : raw).toString('utf8');
      const set = new Set<string>();
      for (const line of text.split(/\r?\n/)) {
        const w = normalizeWord(line);
        if (w) set.add(w);
      }
      console.log(`Liste « ${dictInfo(id).label} » chargée : ${set.size} mots`);
      return set;
    })();
    p.catch(() => dicts.delete(id));
    dicts.set(id, p);
  }
  return p;
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
  invalidWords: async (ws, dict) => { const set = await loadDict(dict); return ws.filter((w) => !set.has(w)); },
  changed: () => { saveTimer ??= setTimeout(saveNow, 1000); },
});
try {
  if (existsSync(SAVE)) games.load(JSON.parse(readFileSync(SAVE, 'utf8')));
} catch (err) { console.error('Sauvegarde illisible, on repart de zéro :', err); }

// Journal : uniquement des événements et des codes de partie (ni noms, ni adresses IP, ni contenu des coups).
const online = () => [...conns.values()].reduce((n, c) => n + (c[0] ? 1 : 0) + (c[1] ? 1 : 0), 0);
const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg} [${games.rooms.size} partie(s), ${online()} connexion(s)]`);
const WHO = ['joueur 1', 'joueur 2'];

// HTTP : page d'état, et POST {games: [{code, token}]} → résumés pour « Mes parties en cours ».
// Le corps est envoyé en text/plain par le site (pas de requête préalable CORS) ; les jetons restent hors des URL.
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type' };
const http = createServer((req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
  if (req.method === 'POST') {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (d: string) => { body += d; if (body.length > 16_384) req.destroy(); });
    req.on('end', () => {
      let list: unknown[] = [];
      try { const j = JSON.parse(body); if (Array.isArray(j?.games)) list = j.games.slice(0, 50); } catch { /* corps invalide */ }
      const out = list.map((g) => games.summary((g as { code?: unknown })?.code, (g as { token?: unknown })?.token));
      res.writeHead(200, { ...CORS, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ games: out }));
    });
    return;
  }
  res.writeHead(200, { ...CORS, 'content-type': 'text/plain; charset=utf-8' });
  res.end(`Serveur Scrabble FR — ${games.rooms.size} partie(s), ${dicts.size} liste(s) chargée(s).\n`);
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

// La liste libre (par défaut) est chargée dès le départ ; les autres à la première partie qui les utilise.
await loadDict(DEFAULT_DICT);
http.listen(PORT, HOST, () =>
  console.log(`Serveur Scrabble FR à l'écoute sur ${HOST}:${PORT} — ${games.rooms.size} partie(s) reprise(s)`));
