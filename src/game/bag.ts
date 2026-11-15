import { LETTERS } from './constants';

export function newBag(rng: () => number = Math.random): string[] {
  const bag: string[] = [];
  for (const [l, { count }] of Object.entries(LETTERS)) for (let i = 0; i < count; i++) bag.push(l);
  shuffle(bag, rng);
  return bag;
}

export function shuffle<T>(a: T[], rng: () => number = Math.random): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function draw(bag: string[], n: number): string[] {
  return bag.splice(Math.max(0, bag.length - n), n);
}
