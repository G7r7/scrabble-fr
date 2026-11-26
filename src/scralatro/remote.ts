// SCRALATRO à distance : les actions d'un joueur sous forme de messages, appliquées à la partie.
// Sert à la fois au jeu sur un appareil (appel direct) et au serveur de jeu en ligne (qui arbitre).
import { SIZE } from '../game/constants';
import {
  applyOffer, buy, checkAfterSale, migrateScralatro, shopping, continueAfterWin, endTurn, exchangeTiles, geometry, has, LAST_LEVEL, leaveShop,
  movePower, passTurn, placeCell, rerollShop, resolveMove, runProgram, sellPower, skipPending, useReserve, validate,
  type Lex, type MoveResult, type Req, type SGame, type TurnEnd,
} from './engine';

/**
 * Version des règles et des messages en ligne : à augmenter quand le serveur change de comportement.
 * Le serveur l'envoie avec chaque état ; une page plus ancienne propose alors de se recharger.
 */
export const SX_VERSION = 2;

export type SxOp =
  | { k: 'play'; reqs: Req[]; crypto?: number | null }
  | { k: 'pass' }
  | { k: 'exchange'; ids: number[] }
  | { k: 'sell'; uid: number }
  | { k: 'move'; uid: number; d: -1 | 1 }
  | { k: 'reserve' }
  | { k: 'buy'; i: number }
  | { k: 'reroll' }
  | { k: 'leave' }
  | { k: 'offer'; i: number }
  | { k: 'skip' }
  | { k: 'cell'; r: number; c: number }
  | { k: 'program'; ids: number[]; letter?: string }
  | { k: 'continue' }
  | { k: 'finish' }
  | { k: 'abandon' }
  /** Article regardé au magasin (montré au partenaire). */
  | { k: 'look'; i: number | null };

/** Ce qui s'est passé, pour l'affichage (décompte du coup, messages, niveau réussi…). */
export interface SxEvent {
  by: 0 | 1;
  k: SxOp['k'];
  msg?: string;
  res?: MoveResult;
  end?: TurnEnd;
  /** Échange : le tour continue (tuiles en bois). */
  goOn?: boolean;
}
export type SxResult = { ok: true; ev: SxEvent } | { ok: false; error: string };

/** Joueur qui doit agir (le premier au magasin s'ils y sont ensemble), pour l'affichage. */
export function actor(g: SGame): 0 | 1 {
  if (g.phase === 'shop') return (g.shopQueue[0] ?? 0) as 0 | 1;
  return g.cur;
}
/** Le joueur peut-il agir maintenant ? Au magasin, les joueurs coopératifs en ligne achètent en même temps. */
export function mayAct(g: SGame, seat: number): boolean {
  if (g.phase === 'over' || g.won) return false;
  if (g.phase === 'shop') return shopping(g).includes(seat);
  return g.cur === seat;
}

const int = (v: unknown, min: number, max: number): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max ? v : null;
const ids = (v: unknown): number[] | null =>
  Array.isArray(v) && v.length <= 30 && v.every((x) => int(x, 0, 1e9) !== null) ? v as number[] : null;

/** Vérifie la forme d'une action reçue du réseau. */
export function parseSxOp(raw: unknown): SxOp | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  switch (o.k) {
    case 'play': {
      if (!Array.isArray(o.reqs) || !o.reqs.length || o.reqs.length > 30) return null;
      const reqs: Req[] = [];
      for (const q of o.reqs as Record<string, unknown>[]) {
        const id = int(q?.id, 0, 1e9), r = int(q?.r, 0, SIZE - 1), c = int(q?.c, 0, SIZE - 1);
        if (id === null || r === null || c === null) return null;
        const as = typeof q.as === 'string' && /^[A-Z]$/.test(q.as) ? q.as : undefined;
        reqs.push(as ? { id, r, c, as } : { id, r, c });
      }
      return { k: 'play', reqs, crypto: int(o.crypto, 0, 25) };
    }
    case 'exchange': { const l = ids(o.ids); return l ? { k: 'exchange', ids: l } : null; }
    case 'sell': { const uid = int(o.uid, 0, 1e9); return uid === null ? null : { k: 'sell', uid }; }
    case 'move': { const uid = int(o.uid, 0, 1e9); return uid === null || (o.d !== 1 && o.d !== -1) ? null : { k: 'move', uid, d: o.d }; }
    case 'buy': case 'offer': { const i = int(o.i, 0, 10); return i === null ? null : { k: o.k, i }; }
    case 'cell': { const r = int(o.r, 0, SIZE - 1), c = int(o.c, 0, SIZE - 1); return r === null || c === null ? null : { k: 'cell', r, c }; }
    case 'program': {
      const l = ids(o.ids);
      if (!l) return null;
      return typeof o.letter === 'string' && /^[A-Z]$/.test(o.letter) ? { k: 'program', ids: l, letter: o.letter } : { k: 'program', ids: l };
    }
    case 'pass': case 'reserve': case 'reroll': case 'leave': case 'skip': case 'continue': case 'finish': case 'abandon':
      return { k: o.k };
    case 'look': return { k: 'look', i: o.i === null ? null : int(o.i, 0, 10) };
    default: return null;
  }
}

/**
 * Applique l'action du joueur `seat`. Seul le joueur qui doit agir peut le faire (sauf abandon) ;
 * une action refusée ne modifie pas la partie.
 */
export async function applySxOp(g: SGame, seat: 0 | 1, op: SxOp, lex: Lex): Promise<SxResult> {
  const ev = (extra: Partial<SxEvent> = {}): SxResult => ({ ok: true, ev: { by: seat, k: op.k, ...extra } });
  const fail = (error: string): SxResult => ({ ok: false, error });
  migrateScralatro(g);
  if (op.k === 'abandon') {
    if (g.phase === 'over') return fail('La partie est déjà finie.');
    g.phase = 'over'; g.won = false;
    for (const p of g.players) p.pending = null;
    g.overText = g.players.length > 1 ? `${g.players[seat].name} a abandonné la partie.` : 'Partie abandonnée.';
    return ev();
  }
  if (g.phase === 'over') return fail('La partie est finie.');
  if (op.k === 'continue' || op.k === 'finish') {
    if (!g.won) return fail('Rien à décider.');
    if (op.k === 'continue') continueAfterWin(g);
    else { g.phase = 'over'; g.won = false; g.overText = `Victoire ! Les ${LAST_LEVEL} niveaux sont validés.`; }
    return ev();
  }
  if (g.won) return fail('Choisissez d’abord de continuer ou de terminer la partie.');
  if (!mayAct(g, seat)) return fail(g.phase === 'shop' ? 'Vous avez terminé vos achats : votre partenaire finit les siens.' : 'Ce n’est pas à vous.');
  const pi = seat;
  const me = g.players[pi];
  const play = g.phase === 'play' && !me.pending;

  switch (op.k) {
    case 'play': {
      if (!play) return fail('Ce n’est pas le moment de jouer.');
      const geo = geometry(g, pi, op.reqs);
      if (!geo.ok) return fail(geo.error);
      const v = await validate(g, pi, geo.words, lex);
      if (!v.ok) return fail(`Mot${v.invalid.length > 1 ? 's' : ''} absent${v.invalid.length > 1 ? 's' : ''} du dictionnaire : ${v.invalid.join(', ')}`);
      const p = g.players[pi];
      const crypto = has(g, pi, 'cryptographe') && p.crypto === null && !p.played ? (op.crypto ?? 0) : null;
      const res = resolveMove(g, pi, op.reqs, v.infos, { crypto, cancre: v.cancre });
      const end = await endTurn(g, pi, op.reqs.map((q) => q.id), lex);
      return ev({ res, end });
    }
    case 'pass': {
      if (!play) return fail('Ce n’est pas le moment de jouer.');
      passTurn(g, pi);
      return ev({ end: await endTurn(g, pi, [], lex) });
    }
    case 'exchange': {
      if (!play) return fail('Ce n’est pas le moment de jouer.');
      const r = exchangeTiles(g, pi, op.ids);
      if (!r.ok) return fail(r.error);
      if (!r.endsTurn) return ev({ goOn: true, msg: ['Échange de tuiles en bois : le tour continue.', ...r.lines].join(' · ') });
      const end = await endTurn(g, pi, [], lex);
      return ev({ end, msg: [...r.lines, ...end.lines].join(' · ') });
    }
    case 'sell': {
      const r = sellPower(g, pi, op.uid);
      if (!r.ok) return fail(r.error);
      const done = checkAfterSale(g, pi);
      return ev({ msg: r.msg, ...(done ? { end: { lines: [], extra: 0, levelDone: done } } : {}) });
    }
    case 'move': movePower(g, pi, op.uid, op.d); return ev();
    case 'reserve': {
      const r = useReserve(g, pi);
      return r.ok ? ev({ msg: r.msg }) : fail(r.error);
    }
    case 'buy': {
      if (g.phase !== 'shop') return fail('Le magasin est fermé.');
      const r = buy(g, pi, op.i);
      return r.ok ? ev({ msg: r.msg }) : fail(r.error);
    }
    case 'reroll': {
      if (g.phase !== 'shop' || me.pending) return fail('Le magasin est fermé.');
      const err = rerollShop(g, pi);
      return err ? fail(err) : ev({ msg: 'Nouveaux articles !' });
    }
    case 'leave': {
      if (g.phase !== 'shop') return fail('Le magasin est fermé.');
      return ev({ msg: leaveShop(g, pi).join(' · ') });
    }
    case 'offer': {
      if (me.pending?.type !== 'choose') return fail('Aucun paquet ouvert.');
      const o = me.pending.offers[op.i];
      if (!o) return fail('Choix invalide.');
      const r = applyOffer(g, pi, o);
      return r.ok ? ev({ msg: r.msg }) : fail(r.error);
    }
    case 'skip': {
      if (!me.pending) return fail('Rien à annuler.');
      skipPending(g, pi);
      return ev();
    }
    case 'cell': {
      const r = placeCell(g, pi, op.r, op.c);
      return r.ok ? ev({ msg: r.msg }) : fail(r.error);
    }
    case 'program': {
      const r = runProgram(g, pi, op.ids, op.letter);
      return r.ok ? ev({ msg: r.msg }) : fail(r.error);
    }
    case 'look': {
      if (!me.shop) return fail('Le magasin est fermé.');
      me.shop.look = op.i;
      return ev();
    }
  }
}

/** Mélange une copie (l'ordre des sacs est secret). */
function shuffled<T>(a: T[]): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [b[i], b[j]] = [b[j], b[i]]; }
  return b;
}
/**
 * Vue de la partie envoyée au joueur `seat` : ordre des sacs caché ; en compétition,
 * lettres du chevalet adverse cachées (des jokers sans valeur, pour garder le nombre de tuiles).
 */
export function sxView(g: SGame, seat: 0 | 1): SGame {
  const v = structuredClone(g);
  v.players.forEach((p, i) => {
    p.bag = shuffled(p.bag);
    if (g.mode === 'compet' && i !== seat) {
      p.rack = p.rack.map((t) => ({ id: t.id, l: '?', bonus: 0, pas: [], sty: [], own: t.own }));
      delete p.shop;
    }
  });
  v.players.forEach((p, i) => { if (i !== seat && p.pending?.type === 'program') p.pending.drawn = []; });
  return v;
}
