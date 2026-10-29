// Rate-2/3 convolutional code: K=7, polynomials 171/133 octal (CCSDS / 802.11), punctured from rate 1/2
// with pattern [1 1; 1 0] (of each two input bits, send both outputs of the first and the first output of
// the second). 6 zero tail bits return the encoder to state 0. Decoded with a soft-decision Viterbi.

const G = [0o171, 0o133]
const parity = (x: number): number => { x ^= x >> 4; x ^= x >> 2; x ^= x >> 1; return x & 1 }
/** OUT[reg] = the two output bits for the 7-bit register `reg` (newest bit lowest): bit 1 = g1, bit 0 = g2. */
const OUT = Uint8Array.from({ length: 128 }, (_, r) => (parity(r & G[0]) << 1) | parity(r & G[1]))
const TAIL = 6

/** Coded bit count for `n` data bits (tail included). */
export const codedBits = (n: number): number => Math.ceil(3 * (n + TAIL) / 2)

/** Encode bits (0/1 each) into punctured coded bits. */
export function convEncode (bits: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(codedBits(bits.length))
  let reg = 0; let j = 0
  for (let i = 0; i < bits.length + TAIL; i++) {
    reg = ((reg << 1) | (i < bits.length ? bits[i] : 0)) & 0x7f
    out[j++] = OUT[reg] >> 1
    if (i % 2 === 0) out[j++] = OUT[reg] & 1
  }
  return out
}

/**
 * Soft Viterbi over punctured coded LLRs (positive = 1), `n` data bits out. 64 states, full traceback from
 * the zero state the tail forces.
 */
export function viterbi (llr: ArrayLike<number>, n: number): Uint8Array {
  const steps = n + TAIL
  let metric = new Float64Array(64).fill(-Infinity); metric[0] = 0
  let next = new Float64Array(64)
  const from = new Uint8Array(steps * 64) // surviving predecessor state per step and state
  let j = 0
  for (let i = 0; i < steps; i++) {
    const a = llr[j++] ?? 0
    const b = i % 2 === 0 ? llr[j++] ?? 0 : 0 // punctured: no information
    next.fill(-Infinity)
    for (let s = 0; s < 64; s++) {
      if (metric[s] === -Infinity) continue
      for (let bit = 0; bit < 2; bit++) {
        const reg = (s << 1) | bit
        if (i >= n && bit === 1) continue // tail bits are zero
        const o = OUT[reg]
        const m = metric[s] + ((o & 2) !== 0 ? a : -a) + ((o & 1) !== 0 ? b : -b)
        const ns = reg & 63
        if (m > next[ns]) { next[ns] = m; from[i * 64 + ns] = s }
      }
    }
    [metric, next] = [next, metric]
  }
  const out = new Uint8Array(n)
  let s = 0
  for (let i = steps - 1; i >= 0; i--) {
    if (i < n) out[i] = s & 1
    s = from[i * 64 + s]
  }
  return out
}
