// Relais WebSocket pour le jeu en ligne de Scrabble FR.
// Il ne connaît pas les règles : il met en relation l'hôte et l'invité d'une partie (identifiée par un code)
// et transmet leurs messages. C'est le navigateur de l'hôte qui arbitre la partie.
//
//   wss://…/?code=ABC234&role=host|guest&token=<jeton secret du joueur>
//
// Le serveur envoie lui-même un seul type de message : {"type":"_peer","online":true|false}.
import { createServer } from 'node:http';
import { WebSocketServer } from 'ws';

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.IP ?? '0.0.0.0';
const MAX_MSG = 64 * 1024;
const ROOM_TTL = 2 * 60 * 60 * 1000; // une partie abandonnée par les deux joueurs disparaît après 2 h
const MAX_ROOMS = 2000;

// Codes de fermeture (le client les traduit en messages).
const CLOSE = { BAD_REQUEST: 4000, CODE_TAKEN: 4001, ROOM_FULL: 4003, NOT_FOUND: 4004, REPLACED: 4005, BUSY: 4029 };

/** @type {Map<string, {host: any, guest: any, hostToken: string, guestToken: string | null, idleSince: number | null}>} */
const rooms = new Map();

const http = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end(`Relais Scrabble FR — ${rooms.size} partie(s) ouverte(s).\n`);
});
const wss = new WebSocketServer({ server: http, maxPayload: MAX_MSG });

// Journal : uniquement des événements et des codes de partie (ni noms, ni adresses IP, ni contenu des coups).
const log = (msg) => console.log(`${new Date().toISOString()} ${msg} [${rooms.size} partie(s), ${wss.clients.size} connexion(s)]`);
const ROLE = { host: 'hôte', guest: 'invité' };

const send = (ws, obj) => { if (ws?.readyState === 1) ws.send(JSON.stringify(obj)); };

wss.on('connection', (ws, req) => {
  const q = new URL(req.url ?? '/', 'http://x').searchParams;
  const code = q.get('code') ?? '', role = q.get('role'), token = q.get('token') ?? '';
  if (!/^[A-Z0-9]{6}$/.test(code) || !['host', 'guest'].includes(role) || !/^[a-f0-9]{16,64}$/.test(token)) {
    log('refus : requête invalide');
    return ws.close(CLOSE.BAD_REQUEST, 'requête invalide');
  }

  let room = rooms.get(code);
  if (role === 'host') {
    if (room && room.hostToken !== token) { log(`${code} refus : code déjà pris`); return ws.close(CLOSE.CODE_TAKEN, 'code pris'); }
    if (!room) {
      if (rooms.size >= MAX_ROOMS) { log(`${code} refus : serveur plein`); return ws.close(CLOSE.BUSY, 'serveur plein'); }
      room = { host: null, guest: null, hostToken: token, guestToken: null, idleSince: null };
      rooms.set(code, room);
      log(`${code} partie créée`);
    }
  } else {
    if (!room) { log(`${code} refus : partie introuvable`); return ws.close(CLOSE.NOT_FOUND, 'partie introuvable'); }
    if (room.guestToken && room.guestToken !== token) { log(`${code} refus : partie complète (intrus)`); return ws.close(CLOSE.ROOM_FULL, 'partie complète'); }
    room.guestToken = token;
  }

  // Une reconnexion du même joueur remplace l'ancienne liaison.
  const old = room[role];
  room[role] = ws;
  room.idleSince = null;
  if (old && old !== ws) old.close(CLOSE.REPLACED, 'remplacé');
  log(`${code} ${ROLE[role]} connecté${old ? ' (reconnexion)' : ''}`);
  const other = role === 'host' ? 'guest' : 'host';
  send(ws, { type: '_peer', online: !!room[other] });
  send(room[other], { type: '_peer', online: true });

  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  let budget = 30; // limite simple : 30 messages, rechargés de 1 par seconde
  const refill = setInterval(() => { budget = Math.min(30, budget + 1); }, 1000);

  ws.on('message', (data, isBinary) => {
    if (isBinary || room[role] !== ws) return;
    if (--budget < 0) { log(`${code} ${ROLE[role]} coupé : trop de messages`); return ws.close(CLOSE.BUSY, 'trop de messages'); }
    if (room[other]?.readyState === 1) room[other].send(data.toString());
  });

  ws.on('close', () => {
    clearInterval(refill);
    if (room[role] !== ws) return;
    room[role] = null;
    log(`${code} ${ROLE[role]} déconnecté`);
    send(room[other], { type: '_peer', online: false });
    if (!room.host && !room.guest) room.idleSince = Date.now();
  });
});

// Battement de cœur : détecte les connexions mortes et garde les proxys ouverts.
setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
  const now = Date.now();
  for (const [code, r] of rooms) {
    if (r.idleSince && now - r.idleSince > ROOM_TTL) { rooms.delete(code); log(`${code} partie expirée`); }
  }
}, 30_000);

http.listen(PORT, HOST, () => console.log(`Relais Scrabble FR à l'écoute sur ${HOST}:${PORT}`));
