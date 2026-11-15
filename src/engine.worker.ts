/// <reference lib="webworker" />
import { Dawg } from './dict/dawg';
import { normalizeWord } from './dict/normalize.js';
import { chooseMove, type Level } from './ai/player';
import type { Board } from './game/types';

export type WorkerRequest =
  | { id: number; type: 'load'; text: string }
  | { id: number; type: 'check'; words: string[] }
  | { id: number; type: 'ai'; board: Board; rack: string[]; bagSize: number; level: Level };

let dawg: Dawg | null = null;

function parse(text: string): string[] {
  const set = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    // tolère « mot » ou « mot<tab/espace/;>autre chose »
    const n = normalizeWord(line.split(/[\s;,]/)[0] ?? '');
    if (n) set.add(n);
  }
  return [...set].sort();
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const msg = e.data;
  try {
    if (msg.type === 'load') {
      const words = parse(msg.text);
      dawg = new Dawg(words);
      self.postMessage({ id: msg.id, ok: true, count: dawg.wordCount, normalized: words.join('\n') });
    } else if (!dawg) {
      self.postMessage({ id: msg.id, ok: false, error: 'Dictionnaire non chargé' });
    } else if (msg.type === 'check') {
      self.postMessage({ id: msg.id, ok: true, invalid: msg.words.filter((w) => !dawg!.has(w)) });
    } else if (msg.type === 'ai') {
      self.postMessage({ id: msg.id, ok: true, decision: chooseMove(dawg, msg.board, msg.rack, msg.bagSize, msg.level) });
    }
  } catch (err) {
    self.postMessage({ id: msg.id, ok: false, error: String(err) });
  }
};
