import { describe, expect, test } from 'vitest';
import {
  buy, endTurn, exchangeTiles, geometry, leaveShop, levelTarget, lvlOf, newScralatro, newTile, passTurn, placeCell,
  resolveMove, runProgram, sellPower, startProgram, useReserve, validate, applyOffer, mergeCell, type Lex, type Req, type SGame, type STile,
} from '../src/scralatro/engine';
import { actor, applySxOp, parseSxOp, sxView } from '../src/scralatro/remote';
import { Games } from '../server/games';
import type { ServerMsg } from '../src/net/protocol';

const WORDS = new Set(['CHAT', 'CHATS', 'MOT', 'AS', 'TA', 'ME', 'PORTER', 'PORTAIT', 'GRAND', 'GRANDE', 'EAU', 'ZUT']);
const lex: Lex = { invalid: async (ws) => ws.filter((w) => !WORDS.has(w)) };

/** Met des tuiles choisies sur le chevalet du joueur. */
function rack(g: SGame, pi: number, letters: string, extra: Partial<STile> = {}): STile[] {
  const p = g.players[pi];
  p.bag.push(...p.rack);
  p.rack = [...letters].map((l) => newTile(g, l, pi as 0 | 1, extra));
  return p.rack;
}
const row = (tiles: STile[], r: number, c: number): Req[] => tiles.map((t, i) => ({ id: t.id, r, c: c + i }));

async function play(g: SGame, pi: number, reqs: Req[]) {
  const geo = geometry(g, pi, reqs);
  if (!geo.ok) throw new Error(geo.error);
  const v = await validate(g, pi, geo.words, lex);
  if (!v.ok) throw new Error(v.invalid.join());
  const res = resolveMove(g, pi, reqs, v.infos, { cancre: v.cancre });
  const end = await endTurn(g, pi, reqs.map((q) => q.id), lex);
  return { res, end };
}

describe('scralatro', () => {
  test('objectifs : 25 points en 3 coups au niveau 1, difficulté croissante', () => {
    expect(levelTarget(1, null)).toBe(25);
    for (let n = 2; n <= 15; n++) expect(levelTarget(n, null)).toBeGreaterThan(levelTarget(n - 1, null));
    expect(levelTarget(15, 'omega')).toBeGreaterThan(levelTarget(15, 'alpha'));
    const g = newScralatro('solo');
    expect(g.phase).toBe('shop');
    expect(g.players[0].money).toBe(5);
    expect(g.players[0].shop!.items.filter((i) => i.kind === 'pack')).toHaveLength(2);
    expect(g.players[0].shop!.items).toHaveLength(5);
    leaveShop(g);
    expect(g.phase).toBe('play');
    expect(g.lvl).toMatchObject({ n: 1, target: 25, moves: 3 });
    expect(g.players[0].rack).toHaveLength(7);
  });

  test('premier mot par la case départ, score classique et objectif atteint', async () => {
    const g = newScralatro('solo');
    leaveShop(g);
    const t = rack(g, 0, 'CHATXYZ');
    expect(geometry(g, 0, row(t.slice(0, 4), 0, 0)).ok).toBe(false);
    // C H A T sur la ligne 7 à partir de la colonne 4 : C=3 (LD en 7,3 non), ★ en 7,7 sur T.
    const { res } = await play(g, 0, row(t.slice(0, 4), 7, 4));
    expect(res.score).toBe(3 + 4 + 1 + 1);
    expect(g.lvl.used).toBe(1);
  });

  test('texture or et pastille rouge : ×2 deux fois', async () => {
    const g = newScralatro('solo');
    leaveShop(g);
    const t = rack(g, 0, 'MOT');
    t[1].tex = 'or';
    t[1].pas.push('rouge');
    const { res } = await play(g, 0, row(t, 7, 6));
    expect(res.score).toBe((2 + 1 + 1) * 4);
  });

  test('niveau réussi : récompense, retour des tuiles au sac, magasin', async () => {
    const g = newScralatro('solo');
    leaveShop(g);
    g.lvl.target = 5;
    const t = rack(g, 0, 'CHAT');
    const { end } = await play(g, 0, row(t, 7, 4));
    expect(end.levelDone).toBeTruthy();
    // 3 $ + 2 coups restants + 0 $ (9 - 5 < 10)
    expect(g.players[0].money).toBe(5 + 3 + 2);
    expect(g.phase).toBe('shop');
    expect(g.board.flat().every((x) => !x)).toBe(true);
    expect(g.players[0].bag.length + g.players[0].rack.length).toBe(102 + 4); // 4 tuiles créées par le test
    expect(g.lvl.n).toBe(2);
  });

  test('défaite quand les coups sont épuisés', async () => {
    const g = newScralatro('solo');
    leaveShop(g);
    for (let i = 0; i < 3; i++) { passTurn(g, 0); await endTurn(g, 0, [], lex); }
    expect(g.phase).toBe('over');
  });

  test('pouvoirs : clown (HAHA valide) et professeur de français', async () => {
    const g = newScralatro('solo');
    leaveShop(g);
    g.players[0].powers.push({ uid: 900, id: 'clown', price: 4, n: 0 });
    const t = rack(g, 0, 'HAHA');
    const { res } = await play(g, 0, row(t, 7, 5));
    // HAHA : (4+1+4+1) = 10, ×(1 + 2×2 occurrences) = 50
    expect(res.score).toBe(50);

    const h = newScralatro('solo');
    leaveShop(h);
    h.players[0].powers.push({ uid: 901, id: 'profFr', price: 6, n: 0 });
    const u = rack(h, 0, 'PORTAIT');
    const geo = geometry(h, 0, row(u, 7, 2));
    if (!geo.ok) throw new Error(geo.error);
    const v = await validate(h, 0, geo.words, lex);
    expect(v.ok && v.infos[0].conj).toBe(true);
  });

  test('échange de tuiles en bois : le tour continue', () => {
    const g = newScralatro('solo');
    leaveShop(g);
    const t = rack(g, 0, 'AB', { tex: 'bois' });
    const r = exchangeTiles(g, 0, [t[0].id]);
    expect(r.ok && r.endsTurn).toBe(false);
    expect(g.lvl.used).toBe(0);
  });

  test('magasin : achat, vente à moitié prix, cases et programmes', () => {
    const g = newScralatro('solo');
    const p = g.players[0];
    p.money = 100;
    p.shop!.items[0] = { kind: 'power', id: 'duo', price: 4 };
    expect(buy(g, 0, 0).ok).toBe(true);
    expect(p.powers.map((x) => x.id)).toEqual(['duo']);
    expect(sellPower(g, 0, p.powers[0].uid).ok).toBe(true);
    expect(p.money).toBe(100 - 4 + 2);

    applyOffer(g, 0, { kind: 'cell', cell: { t: 'MQ' } });
    expect(g.pending?.type).toBe('cell');
    placeCell(g, 0, 0, 1);
    expect(g.cells[0][1]).toMatchObject({ t: 'MQ' });

    const before = p.bag.length;
    startProgram(g, 0, 'poubelle', false);
    expect(g.pending?.type).toBe('program');
    const drawn = g.pending!.type === 'program' ? g.pending!.drawn : [];
    expect(drawn).toHaveLength(7);
    expect(runProgram(g, 0, [drawn[0].id, drawn[1].id]).ok).toBe(true);
    expect(p.bag.length).toBe(before - 2);
  });

  test('compétition : niveaux séparés, plateau vidé quand les deux passent', async () => {
    const g = newScralatro('compet', ['Ana', 'Bob']);
    leaveShop(g);
    leaveShop(g);
    expect(g.phase).toBe('play');
    const t = rack(g, 0, 'CHAT');
    await play(g, 0, row(t, 7, 4));
    expect(lvlOf(g, 0).score).toBe(9);
    expect(lvlOf(g, 1).score).toBe(0);
    passTurn(g, 1); await endTurn(g, 1, [], lex);
    passTurn(g, 0); const end = await endTurn(g, 0, [], lex);
    expect(end.cleared).toBe(true);
    expect(g.board.flat().every((x) => !x)).toBe(true);
    expect(g.clears).toBe(1);
  });

  test('réserve : un programme sauvé ne sert qu’une fois', () => {
    const g = newScralatro('solo');
    const p = g.players[0];
    startProgram(g, 0, 'trading', false);
    startProgram(g, 0, 'sauver', false);
    expect(p.reserve).toBe('trading');
    expect(useReserve(g, 0).ok).toBe(true);
    expect(p.reserve).toBeNull();
    expect(useReserve(g, 0).ok).toBe(false);
  });
});

describe('scralatro : cases, actions, en ligne', () => {
  test('une case garde son type quand on lui ajoute une texture, et inversement', () => {
    const g = newScralatro('solo');
    g.cells[0][0] = { t: 'MT' };
    applyOffer(g, 0, { kind: 'cell', cell: { x: 'air' } });
    placeCell(g, 0, 0, 0);
    expect(g.cells[0][0]).toMatchObject({ t: 'MT', x: 'air' });
    applyOffer(g, 0, { kind: 'cell', cell: { x: 'feu' } });
    placeCell(g, 0, 0, 0);
    expect(g.cells[0][0]).toMatchObject({ t: 'MT', x: 'feu' });
    applyOffer(g, 0, { kind: 'cell', cell: { t: 'LQ' } });
    placeCell(g, 0, 0, 0);
    expect(g.cells[0][0]).toMatchObject({ t: 'LQ', x: 'feu' });
    expect(mergeCell({ t: 'RND', rnd: 'MT', x: 'eau' }, { x: 'air' })).toEqual({ t: 'RND', rnd: 'MT', x: 'air' });
  });

  test('actions : seul le joueur qui doit agir peut le faire, abandon possible', async () => {
    const g = newScralatro('compet', ['Ana', 'Bob']);
    expect(actor(g)).toBe(0);
    expect((await applySxOp(g, 1, { k: 'leave' }, lex)).ok).toBe(false);
    expect((await applySxOp(g, 0, { k: 'leave' }, lex)).ok).toBe(true);
    expect(actor(g)).toBe(1);
    await applySxOp(g, 1, { k: 'leave' }, lex);
    expect(g.phase).toBe('play');
    const t = rack(g, 0, 'CHAT');
    const r = await applySxOp(g, 0, { k: 'play', reqs: row(t, 7, 4) }, lex);
    expect(r.ok && r.ev.res?.score).toBe(9);
    expect(actor(g)).toBe(1);
    const bad = await applySxOp(g, 1, { k: 'play', reqs: [{ id: 99999, r: 0, c: 0 }] }, lex);
    expect(bad.ok).toBe(false);
    expect((await applySxOp(g, 0, { k: 'abandon' }, lex)).ok).toBe(true);
    expect(g.phase).toBe('over');
    expect(g.overText).toContain('Ana');
  });

  test('messages réseau vérifiés, vue sans les lettres adverses', () => {
    expect(parseSxOp({ k: 'play', reqs: [{ id: 3, r: 7, c: 7, as: 'E' }] })).toEqual({ k: 'play', reqs: [{ id: 3, r: 7, c: 7, as: 'E' }], crypto: null });
    expect(parseSxOp({ k: 'play', reqs: [{ id: 3, r: 70, c: 7 }] })).toBeNull();
    expect(parseSxOp({ k: 'nope' })).toBeNull();
    const g = newScralatro('compet', ['Ana', 'Bob']);
    leaveShop(g); leaveShop(g);
    const v = sxView(g, 0);
    expect(v.players[0].rack.map((t) => t.l)).toEqual(g.players[0].rack.map((t) => t.l));
    expect(v.players[1].rack.every((t) => t.l === '?')).toBe(true);
    expect(v.players[1].rack).toHaveLength(7);
  });

  test('serveur : partie Scralatro en ligne à deux', async () => {
    const sent: { seat: number; msg: ServerMsg }[] = [];
    const games = new Games({ send: (_r, seat, msg) => sent.push({ seat, msg }), invalidWords: (w) => w.filter((x) => !WORDS.has(x)), changed: () => {} });
    const A = 'a'.repeat(32), B = 'b'.repeat(32);
    const a = games.join('SXA234', A, true);
    if ('close' in a) throw new Error();
    await games.message(a.room, 0, { type: 'hello', name: 'Ana', options: { variant: null, scralatro: 'coop' } });
    const b = games.join('SXA234', B, false);
    if ('close' in b) throw new Error();
    await games.message(b.room, 1, { type: 'hello', name: 'Bob' });
    const last = () => sent.filter((s) => s.msg.type === 'sx').at(-1)!.msg as Extract<ServerMsg, { type: 'sx' }>;
    expect(last().state.mode).toBe('coop');
    expect(last().state.players.map((p) => p.name)).toEqual(['Ana', 'Bob']);
    await games.message(a.room, 1, { type: 'sx', op: { k: 'leave' } });
    expect(sent.at(-1)).toMatchObject({ seat: 1, msg: { type: 'error' } });
    await games.message(a.room, 0, { type: 'sx', op: { k: 'leave' } });
    await games.message(a.room, 1, { type: 'sx', op: { k: 'leave' } });
    expect(last().state.phase).toBe('play');
    expect(last().ev).toMatchObject({ by: 1, k: 'leave' });
    expect(games.summary('SXA234', A)).toMatchObject({ found: true, opp: 'Bob', sx: 'coop', myTurn: true });
    await games.message(a.room, 1, { type: 'sx-restart' });
    expect(last().state.phase).toBe('shop');
  });
});
