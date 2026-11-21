import { describe, expect, test } from 'vitest';
import { Games, TTL, type Room, type SeatNo } from '../server/games';
import type { ServerMsg } from '../src/net/protocol';

const A = 'a'.repeat(32), B = 'b'.repeat(32), C = 'c'.repeat(32);

function setup() {
  const sent: { seat: SeatNo; msg: ServerMsg }[] = [];
  let now = 1_000_000;
  const games = new Games({
    send: (_r, seat, msg) => sent.push({ seat, msg }),
    invalidWords: (w) => w.filter((x) => x === 'ZZZ'),
    changed: () => {},
    now: () => now,
  });
  return { games, sent, tick: (ms: number) => { now += ms; } };
}
const seatOf = (r: ReturnType<Games['join']>) => { if ('close' in r) throw new Error(`refus ${r.close}`); return r; };

describe('serveur de jeu', () => {
  test('création, arrivée de l’adversaire, début de partie', async () => {
    const { games, sent } = setup();
    const a = seatOf(games.join('ABC234', A, true));
    expect(a.seat).toBe(0);
    await games.message(a.room, 0, { type: 'hello', name: 'Alice', options: { variant: 'hardcore' } });
    expect(sent.pop()).toEqual({ seat: 0, msg: { type: 'waiting' } });
    const b = seatOf(games.join('ABC234', B, false));
    expect(b.seat).toBe(1);
    await games.message(b.room, 1, { type: 'hello', name: 'Bob' });
    const states = sent.filter((s) => s.msg.type === 'state');
    expect(states.map((s) => s.seat)).toEqual([0, 1]);
    const st = states[1].msg as Extract<ServerMsg, { type: 'state' }>;
    expect(st.you).toBe(1);
    expect(st.state.variant).toBe('hardcore');
    expect(st.state.players.map((p) => p.name)).toEqual(['Alice', 'Bob']);
    expect(st.state.players[0].rack.every((l) => l === '')).toBe(true); // chevalet adverse masqué
  });

  test('la partie est arbitrée avec la liste choisie à la création', async () => {
    const asked: string[] = [];
    const games = new Games({
      send: () => {}, changed: () => {},
      invalidWords: (w, dict) => { asked.push(dict); return []; },
    });
    const a = seatOf(games.join('ABC234', A, true));
    await games.message(a.room, 0, { type: 'hello', name: 'Alice', options: { variant: null, dict: 'etendu' } });
    const b = seatOf(games.join('ABC234', B, false));
    await games.message(b.room, 1, { type: 'hello', name: 'Bob' });
    const s = a.room.state!;
    expect(s.dict).toBe('etendu');
    s.players[s.current].rack = ['C', 'H', 'A', 'T', 'E', 'S', 'R'];
    const chat = [..."CHAT"].map((letter, i) => ({ r: 7, c: 6 + i, letter, blank: false }));
    await games.message(a.room, s.current, { type: 'action', action: { type: 'play', placements: chat } });
    expect(asked).toEqual(['etendu']);
    // Une liste inconnue (ou le fichier ODS d'un joueur) est ignorée : liste libre.
    const c = seatOf(games.join('XYZ234', C, true));
    await games.message(c.room, 0, { type: 'hello', name: 'Carl', options: { variant: null, dict: 'ods' } });
    expect(c.room.dict).toBeNull();
  });

  test('résumé « Mes parties en cours » : seulement pour le détenteur du jeton', async () => {
    const { games } = setup();
    const a = seatOf(games.join('ABC234', A, true));
    await games.message(a.room, 0, { type: 'hello', name: 'Alice' });
    expect(games.summary('ABC234', A)).toEqual({ code: 'ABC234', found: true, waiting: true });
    const b = seatOf(games.join('ABC234', B, false));
    await games.message(b.room, 1, { type: 'hello', name: 'Bob' });
    const cur = a.room.state!.current;
    const sa = games.summary('ABC234', A);
    expect(sa).toMatchObject({ found: true, opp: 'Bob', scores: [0, 0], myTurn: cur === 0, over: false });
    expect(games.summary('ABC234', B)).toMatchObject({ opp: 'Alice', myTurn: cur === 1 });
    expect(games.summary('ABC234', C)).toEqual({ code: 'ABC234', found: false });
    expect(games.summary('NOPE99', A)).toEqual({ code: 'NOPE99', found: false });
  });

  test('refus : code pris, partie complète, introuvable ; reconnexion acceptée', () => {
    const { games } = setup();
    seatOf(games.join('ABC234', A, true));
    expect(games.join('ABC234', C, true)).toEqual({ close: 4001 });
    seatOf(games.join('ABC234', B, false));
    expect(games.join('ABC234', C, false)).toEqual({ close: 4003 });
    expect(games.join('ZZZ999', C, false)).toEqual({ close: 4004 });
    expect(seatOf(games.join('ABC234', B, false)).seat).toBe(1);
    expect(seatOf(games.join('ABC234', A, false)).seat).toBe(0);
    expect(games.join('abc', A, true)).toEqual({ close: 4000 });
  });

  test('coups arbitrés par le serveur, partie sauvegardable et rechargeable', async () => {
    const { games, sent } = setup();
    const a = seatOf(games.join('ABC234', A, true));
    await games.message(a.room, 0, { type: 'hello', name: 'Alice' });
    const b = seatOf(games.join('ABC234', B, false));
    await games.message(b.room, 1, { type: 'hello', name: 'Bob' });
    const room = a.room;
    const who = room.state!.current;
    const other = (1 - who) as SeatNo;
    sent.length = 0;
    await games.message(room, other, { type: 'action', action: { type: 'pass' } });
    expect(sent).toEqual([{ seat: other, msg: { type: 'error', message: 'Ce n’est pas votre tour.' } }]);
    await games.message(room, who, { type: 'action', action: { type: 'pass' } });
    expect(room.state!.current).toBe(other);
    expect(sent.filter((s) => s.msg.type === 'state')).toHaveLength(2);

    const copy = new Games({ send: () => {}, invalidWords: () => [], changed: () => {} });
    copy.load(JSON.parse(JSON.stringify(games)) as Room[]);
    expect(copy.rooms.get('ABC234')?.state?.history).toHaveLength(1);
  });

  test('départ des deux joueurs : partie supprimée ; expiration', async () => {
    const { games, sent, tick } = setup();
    const a = seatOf(games.join('ABC234', A, true));
    await games.message(a.room, 0, { type: 'hello', name: 'Alice' });
    const b = seatOf(games.join('ABC234', B, false));
    await games.message(b.room, 1, { type: 'hello', name: 'Bob' });
    await games.message(a.room, 0, { type: 'bye' });
    expect(sent.at(-1)).toEqual({ seat: 1, msg: { type: 'left' } });
    await games.message(b.room, 1, { type: 'bye' });
    expect(games.rooms.size).toBe(0);

    seatOf(games.join('XYZ234', A, true));
    tick(TTL.waiting + 1);
    expect(games.sweep()).toEqual(['XYZ234']);
  });
});
