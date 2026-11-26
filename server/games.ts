// Parties en ligne gardées par le serveur. Ce module ne connaît pas les WebSockets :
// il reçoit les messages des joueurs et dit quoi envoyer à qui (testable sans réseau).
import { newGame, type GameState, type Variant } from '../src/game/game';
import { applyAction, parseAction, viewFor } from '../src/game/remote';
import { CLOSE, cleanName, type GameSummary, type ServerMsg } from '../src/net/protocol';
import { isThemeWord, themeOf, type ThemeId } from '../src/game/themes';
import { DEFAULT_DICT, dictOf, type DictId } from '../src/game/dicts';
import { CLOCK_MINUTES, DEFAULT_MINUTES, clockUpdate, nextTimeout, settleTime } from '../src/game/clock';
import { migrateScralatro, newScralatro, openShops, type SGame } from '../src/scralatro/engine';
import { applySxOp, mayAct, parseSxOp, sxView, type SxEvent } from '../src/scralatro/remote';

export type SeatNo = 0 | 1;
export interface Seat { token: string; name: string; left: boolean }
export interface Room {
  code: string;
  seats: [Seat, Seat | null];
  variant: Variant | null;
  theme?: ThemeId | null;
  /** Liste de mots qui arbitre la partie (absente = liste libre). */
  dict?: DictId | null;
  /** Mode compétition : minutes par joueur. */
  minutes?: number;
  state: GameState | null;
  /** SCRALATRO : mode choisi à la création, et partie en cours (à la place de `state`). */
  sxMode?: 'coop' | 'compet';
  sx?: SGame | null;
  /** Dernière activité (création, arrivée d'un joueur, coup joué), en ms. */
  updated: number;
}

const DAY = 24 * 60 * 60 * 1000;
/** Durées de conservation : partie jamais commencée, partie finie, partie en cours sans aucun coup. */
export const TTL = { waiting: 2 * DAY, over: 3 * DAY, idle: 30 * DAY };
const MAX_ROOMS = 5000;

const isCode = (s: string) => /^[A-Z0-9]{6}$/.test(s);
const isToken = (s: string) => /^[a-f0-9]{16,64}$/.test(s);

export interface GamesIo {
  /** Envoie un message au joueur `seat` de la partie s'il est connecté. */
  send(room: Room, seat: SeatNo, msg: ServerMsg): void;
  /** Mots absents de la liste `dict` (chargée à la demande). */
  invalidWords(words: string[], dict: DictId): string[] | Promise<string[]>;
  /** Les parties ont changé (à sauvegarder). */
  changed(): void;
  now?: () => number;
}

/** La partie a commencé (Scrabble ou SCRALATRO). */
const started = (room: Room) => !!(room.state || room.sx);

export class Games {
  rooms = new Map<string, Room>();
  /** SCRALATRO : actions d'une même partie traitées une à une (la vérification des mots est asynchrone). */
  private queues = new Map<string, Promise<unknown>>();
  constructor(private io: GamesIo) {}
  private now() { return this.io.now?.() ?? Date.now(); }

  /**
   * Arrivée d'un joueur (connexion ou reconnexion). `create` : la personne crée la partie avec ce code.
   * Renvoie sa place, ou un code de fermeture si elle est refusée.
   */
  join(code: string, token: string, create: boolean): { room: Room; seat: SeatNo } | { close: number } {
    if (!isCode(code) || !isToken(token)) return { close: CLOSE.BAD_REQUEST };
    let room = this.rooms.get(code);
    if (!room) {
      if (!create) return { close: CLOSE.NOT_FOUND };
      if (this.rooms.size >= MAX_ROOMS) return { close: CLOSE.BUSY };
      room = { code, seats: [{ token, name: '', left: false }, null], variant: null, state: null, updated: this.now() };
      this.rooms.set(code, room);
      this.io.changed();
      return { room, seat: 0 };
    }
    const seat = room.seats.findIndex((s) => s?.token === token);
    if (seat >= 0) return { room, seat: seat as SeatNo };
    if (create) return { close: CLOSE.CODE_TAKEN };
    if (room.seats[1]) return { close: CLOSE.ROOM_FULL };
    room.seats[1] = { token, name: '', left: false };
    room.updated = this.now();
    this.io.changed();
    return { room, seat: 1 };
  }

  /** Message d'un joueur déjà installé à sa place. */
  async message(room: Room, seat: SeatNo, raw: unknown) {
    if (!raw || typeof raw !== 'object') return;
    const m = raw as Record<string, unknown>;
    const me = room.seats[seat]!;
    if (m.type === 'hello') {
      me.name = cleanName(m.name) || (seat === 0 ? 'Joueur 1' : 'Joueur 2');
      me.left = false;
      if (seat === 0 && !started(room) && m.options && typeof m.options === 'object') {
        const v = (m.options as Record<string, unknown>).variant;
        room.variant = v === 'challenge' || v === 'hardcore' || v === 'tournoi' ? v : null;
        const min = (m.options as Record<string, unknown>).minutes;
        room.minutes = (CLOCK_MINUTES as readonly unknown[]).includes(min) ? min as number : DEFAULT_MINUTES;
        room.theme = themeOf((m.options as Record<string, unknown>).theme);
        room.dict = dictOf((m.options as Record<string, unknown>).dict);
        const sx = (m.options as Record<string, unknown>).scralatro;
        if (sx === 'coop' || sx === 'compet') room.sxMode = sx; else delete room.sxMode;
      }
      if (!started(room) && room.seats[0].name && room.seats[1]?.name) return this.start(room);
      if (!started(room)) return this.io.send(room, seat, { type: 'waiting' });
      if (room.sx) {
        if (room.sx.players[seat].name !== me.name) {
          room.sx.players[seat].name = me.name;
          this.io.changed();
          return this.broadcast(room);
        }
        return this.sendState(room, seat);
      }
      if (!room.state) return;
      if (room.state.players[seat].name !== me.name) {
        room.state.players[seat].name = me.name;
        this.io.changed();
        return this.broadcast(room);
      }
      return this.sendState(room, seat);
    }
    if (m.type === 'sx' || m.type === 'sx-restart') {
      const run = async () => {
        if (this.rooms.get(room.code) !== room || !room.sx) return this.io.send(room, seat, { type: 'error', message: 'La partie n’a pas commencé.' });
        if (m.type === 'sx-restart') { this.start(room); return; }
        const op = parseSxOp(m.op);
        if (!op) return this.io.send(room, seat, { type: 'error', message: 'Action mal formée.' });
        const res = await applySxOp(room.sx, seat, op, {
          invalid: async (w) => w.length ? this.io.invalidWords(w, room.dict ?? DEFAULT_DICT) : [],
        });
        if (!res.ok) return this.io.send(room, seat, { type: 'error', message: res.error });
        room.updated = this.now();
        this.io.changed();
        this.broadcast(room, res.ev);
      };
      const next = (this.queues.get(room.code) ?? Promise.resolve()).then(run, run);
      this.queues.set(room.code, next);
      await next;
      if (this.queues.get(room.code) === next) this.queues.delete(room.code);
      return;
    }
    if (m.type === 'action') {
      if (!room.state) return this.io.send(room, seat, { type: 'error', message: 'La partie n’a pas commencé.' });
      const action = parseAction(m.action);
      if (!action) return this.io.send(room, seat, { type: 'error', message: 'Coup mal formé.' });
      const st = room.state;
      // Compétition : un joueur dont le temps vient de s'épuiser a déjà passé son tour.
      if (st.clock && settleTime(st, this.now())) { this.io.changed(); this.broadcast(room); }
      const err = await applyAction(st, seat, action, async (w) => {
        // Partie à thème : les mots du thème (jargon compris) sont valides même hors de la liste.
        const theme = room.theme;
        const rest = theme ? w.filter((x) => !isThemeWord(theme, x)) : w;
        return rest.length ? this.io.invalidWords(rest, room.dict ?? DEFAULT_DICT) : [];
      });
      if (err) return this.io.send(room, seat, { type: 'error', message: err });
      if (st.clock) { clockUpdate(st, this.now()); settleTime(st, this.now()); }
      room.updated = this.now();
      this.io.changed();
      this.arm(room);
      return this.broadcast(room);
    }
    if (m.type === 'rematch') {
      if (room.state?.over || room.sx?.phase === 'over') this.start(room);
      return;
    }
    if (m.type === 'bye') {
      me.left = true;
      const other = room.seats[seat === 0 ? 1 : 0];
      if (!other || other.left) this.rooms.delete(room.code);
      else this.io.send(room, seat === 0 ? 1 : 0, { type: 'left' });
      this.io.changed();
    }
  }

  private start(room: Room) {
    const [a, b] = room.seats;
    if (room.sxMode) {
      room.sx = newScralatro(room.sxMode, [a.name, b!.name]);
      // Coopération en ligne : les deux joueurs font leurs achats en même temps.
      if (room.sxMode === 'coop') { room.sx.together = true; openShops(room.sx); }
      room.state = null;
      room.updated = this.now();
      this.io.changed();
      return this.broadcast(room);
    }
    room.state = newGame('moyen', { names: [a.name, b!.name] }, {
      variant: room.variant, theme: room.theme, dict: room.dict, minutes: room.minutes ?? DEFAULT_MINUTES, now: this.now(),
    });
    room.updated = this.now();
    this.io.changed();
    this.arm(room);
    this.broadcast(room);
  }

  /** Compétition : programme le « temps écoulé » du joueur dont la pendule tourne. */
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private arm(room: Room) {
    clearTimeout(this.timers.get(room.code));
    this.timers.delete(room.code);
    const st = room.state;
    const left = st ? nextTimeout(st, this.now()) : null;
    if (left === null || !Number.isFinite(left)) return;
    const t = setTimeout(() => {
      this.timers.delete(room.code);
      if (this.rooms.get(room.code) !== room || room.state !== st) return;
      if (settleTime(st!, this.now())) { room.updated = this.now(); this.io.changed(); this.broadcast(room); }
      this.arm(room);
    }, left + 50);
    (t as { unref?: () => void }).unref?.();
    this.timers.set(room.code, t);
  }

  private sendState(room: Room, seat: SeatNo, ev?: SxEvent) {
    if (room.sx) return this.io.send(room, seat, { type: 'sx', state: sxView(room.sx, seat), you: seat, ...(ev ? { ev } : {}) });
    if (room.state) this.io.send(room, seat, { type: 'state', state: viewFor(room.state, seat), you: seat, now: this.now() });
  }
  private broadcast(room: Room, ev?: SxEvent) { this.sendState(room, 0, ev); this.sendState(room, 1, ev); }

  /** Résumé de la partie `code` pour le joueur qui détient `token`. */
  summary(code: unknown, token: unknown): GameSummary {
    const c = typeof code === 'string' ? code : '';
    const room = this.rooms.get(c);
    const seat = room?.seats.findIndex((s) => !!s && s.token === token) ?? -1;
    if (!room || seat < 0) return { code: c, found: false };
    const me = seat as SeatNo, opp = me === 0 ? 1 : 0;
    const g = room.sx;
    if (g) {
      return {
        code: c, found: true, opp: g.players[opp].name, scores: [g.players[me].total, g.players[opp].total],
        myTurn: g.phase !== 'over' && (g.won || mayAct(g, me)), over: g.phase === 'over', sx: g.mode === 'coop' ? 'coop' : 'compet',
      };
    }
    const st = room.state;
    if (!st) return { code: c, found: true, waiting: true };
    const myTurn = !st.over && (st.proposal ? st.proposal.player !== me : st.current === me);
    return {
      code: c, found: true, opp: st.players[opp].name, scores: [st.players[me].score, st.players[opp].score],
      myTurn, over: st.over,
    };
  }

  /** Supprime les parties trop anciennes ; renvoie leurs codes. */
  sweep(): string[] {
    const now = this.now(), gone: string[] = [];
    for (const [code, r] of this.rooms) {
      const ttl = !started(r) ? TTL.waiting : r.state?.over || r.sx?.phase === 'over' ? TTL.over : TTL.idle;
      if (now - r.updated > ttl) { this.rooms.delete(code); gone.push(code); }
    }
    if (gone.length) this.io.changed();
    return gone;
  }

  toJSON() { return [...this.rooms.values()]; }
  load(rooms: Room[]) {
    const now = this.now();
    for (const r of rooms) {
      if (!r || !isCode(r.code) || !r.seats?.[0]) continue;
      // Les pendules ne tournent pas pendant que le serveur est arrêté.
      if (r.state?.clock) r.state.clock.since = now;
      // Partie SCRALATRO d'une version précédente : mise à jour (achats en même temps en coopération).
      if (r.sx) { if (r.sx.mode === 'coop') r.sx.together = true; migrateScralatro(r.sx); }
      this.rooms.set(r.code, r);
      this.arm(r);
    }
  }
}
