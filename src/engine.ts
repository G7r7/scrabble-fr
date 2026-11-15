import type { AiDecision, Level } from './ai/player';
import type { Board } from './game/types';

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };

/** Accès asynchrone au dictionnaire et à l'IA, exécutés dans un Web Worker. */
export class Engine {
  private worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker.onmessage = (e) => {
      const { id, ok, error, ...rest } = e.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (ok) p.resolve(rest);
      else p.reject(new Error(error));
    };
  }

  private call<T>(msg: Record<string, unknown>): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ ...msg, id });
    });
  }

  /** Charge une liste de mots brute ; renvoie le nombre de mots et la liste normalisée. */
  load(text: string) {
    return this.call<{ count: number; normalized: string }>({ type: 'load', text });
  }
  async invalidWords(words: string[]): Promise<string[]> {
    return (await this.call<{ invalid: string[] }>({ type: 'check', words })).invalid;
  }
  async aiMove(board: Board, rack: string[], bagSize: number, level: Level): Promise<AiDecision> {
    return (await this.call<{ decision: AiDecision }>({ type: 'ai', board, rack, bagSize, level })).decision;
  }
}
