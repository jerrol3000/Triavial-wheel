// Deterministic PRNG used by every mini-game that needs reproducible
// content. Same seed → same sequence of values, so both players in a
// VS match (or both sides of a friend challenge) see identical
// problems / colors / patterns. JS's Math.random isn't seedable; this
// is a tiny LCG that gives us 32 bits of cycle, plenty for a 30-second
// game.
export function makeRng(seed) {
  let s = (Number(seed) >>> 0) || 1;
  return {
    next() {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s;
    },
    // Integer in [0, n).
    int(n) { return this.next() % Math.max(1, n | 0); },
    // Pick one of arr.
    pick(arr) { return arr[this.int(arr.length)]; },
    // Float in [0, 1).
    float() { return this.next() / 0x100000000; },
  };
}
