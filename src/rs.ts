// Reed-Solomon over GF(256), primitive poly 0x11d. Classic BM + Chien + Forney decoder.
// Ported from https://en.wikiversity.org/wiki/Reed%E2%80%93Solomon_codes_for_coders

const EXP = new Uint8Array(512)
const LOG = new Uint8Array(256)
{
  let x = 1
  for (let i = 0; i < 255; i++) {
    EXP[i] = x
    LOG[x] = i
    x <<= 1
    if (x & 0x100) x ^= 0x11d
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255]
}

export const mul = (a: number, b: number): number => (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]
const div = (a: number, b: number): number => a === 0 ? 0 : EXP[(LOG[a] + 255 - LOG[b]) % 255]
const pow = (a: number, n: number): number => EXP[(LOG[a] * n) % 255]
export const inv = (a: number): number => EXP[255 - LOG[a]]

// polynomials are number[] with highest degree first
const polyScale = (p: number[], x: number): number[] => p.map(c => mul(c, x))
const polyAdd = (p: number[], q: number[]): number[] => {
  const r = new Array(Math.max(p.length, q.length)).fill(0)
  p.forEach((c, i) => { r[i + r.length - p.length] = c })
  q.forEach((c, i) => { r[i + r.length - q.length] ^= c })
  return r
}
const polyMul = (p: number[], q: number[]): number[] => {
  const r = new Array(p.length + q.length - 1).fill(0)
  for (let j = 0; j < q.length; j++) for (let i = 0; i < p.length; i++) r[i + j] ^= mul(p[i], q[j])
  return r
}
const polyEval = (p: number[], x: number): number => p.reduce((y, c) => mul(y, x) ^ c, 0)

function generator (nsym: number): number[] {
  let g = [1]
  for (let i = 0; i < nsym; i++) g = polyMul(g, [1, pow(2, i)])
  return g
}

/** Append `nsym` parity bytes. data.length + nsym must be <= 255. */
export function rsEncode (data: Uint8Array, nsym: number): Uint8Array {
  if (data.length + nsym > 255) throw new RangeError('message too long for RS(255)')
  const gen = generator(nsym)
  const out = new Uint8Array(data.length + nsym)
  out.set(data)
  for (let i = 0; i < data.length; i++) {
    const c = out[i]
    if (c !== 0) for (let j = 1; j < gen.length; j++) out[i + j] ^= mul(gen[j], c)
  }
  out.set(data)
  return out
}

/**
 * Correct errors and erasures as long as 2*errors + erasures <= nsym.
 * `erasures` are indexes into the codeword known (or suspected) to be bad.
 * Returns the data bytes, or undefined if uncorrectable.
 */
export function rsDecode (codeword: Uint8Array, nsym: number, erasures: number[] = []): Uint8Array | undefined {
  if (erasures.length > nsym) return undefined
  const msg = Array.from(codeword)
  const n = msg.length
  for (const e of erasures) msg[e] = 0
  const syndromes = (m: number[]): number[] => [0, ...Array.from({ length: nsym }, (_, i) => polyEval(m, pow(2, i)))]
  const synd = syndromes(msg)
  if (synd.every(s => s === 0)) return Uint8Array.from(msg.slice(0, n - nsym))

  // Forney syndromes: syndromes with the known erasures factored out
  const fsynd = synd.slice(1)
  for (const e of erasures) {
    const x = pow(2, n - 1 - e)
    for (let j = 0; j < fsynd.length - 1; j++) fsynd[j] = mul(fsynd[j], x) ^ fsynd[j + 1]
  }

  // Berlekamp-Massey -> locator for the unknown errors
  let errLoc = [1]
  let oldLoc = [1]
  for (let i = 0; i < nsym - erasures.length; i++) {
    let delta = fsynd[i]
    for (let j = 1; j < errLoc.length; j++) delta ^= mul(errLoc[errLoc.length - 1 - j], fsynd[i - j])
    oldLoc = [...oldLoc, 0]
    if (delta !== 0) {
      if (oldLoc.length > errLoc.length) {
        const newLoc = polyScale(oldLoc, delta)
        oldLoc = polyScale(errLoc, inv(delta))
        errLoc = newLoc
      }
      errLoc = polyAdd(errLoc, polyScale(oldLoc, delta))
    }
  }
  while (errLoc.length > 0 && errLoc[0] === 0) errLoc.shift()
  const nErrs = errLoc.length - 1
  if (nErrs * 2 + erasures.length > nsym) return undefined

  // Chien search
  const errPos: number[] = []
  const rev = [...errLoc].reverse()
  for (let i = 0; i < n; i++) if (polyEval(rev, pow(2, i)) === 0) errPos.push(n - 1 - i)
  if (errPos.length !== nErrs) return undefined

  // Forney: magnitudes for errors and erasures together
  const errata = [...erasures, ...errPos]
  const coefPos = errata.map(p => n - 1 - p)
  let eLoc = [1]
  for (const p of coefPos) eLoc = polyMul(eLoc, polyAdd([1], [pow(2, p), 0]))
  // errata evaluator = (synd * locator) mod x^(errata+1)
  const errEval = polyMul([...synd].reverse(), eLoc).slice(-eLoc.length)
  const X = coefPos.map(p => pow(2, p))
  for (let i = 0; i < X.length; i++) {
    const XiInv = inv(X[i])
    let denom = 1
    for (let j = 0; j < X.length; j++) if (j !== i) denom = mul(denom, 1 ^ mul(XiInv, X[j]))
    if (denom === 0) return undefined
    msg[errata[i]] ^= div(mul(X[i], polyEval(errEval, XiInv)), denom)
  }
  if (syndromes(msg).some(s => s !== 0)) return undefined
  return Uint8Array.from(msg.slice(0, n - nsym))
}
