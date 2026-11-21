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
