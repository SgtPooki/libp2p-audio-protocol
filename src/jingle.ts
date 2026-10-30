// Public-domain melodies, synthesized here (no recording to license), to carry a data layer under or as part of.
// A jingle is the bed; the modem frame is mixed under it at `levelDb` relative to the jingle. The ear
// follows the tune, the receiver treats the tune as noise. Sparse bell/brass tunes with gaps hide the
// data best; dense ones mask it (see benchmarks/jingle.ts).

import type { ModemOptions } from './modem.ts'

export interface Note { midi: number | null, beats: number } // null = rest
/** chords: pitch classes (0 = C) of the harmony, one entry per beat, looping; the `tune` preset arpeggiates them. */
/** `alt`: in `tune` mode, alternate each beat's chord with the same chord this many semitones up, note to note (0 = off). */
/** `tune: false`: this jingle has no `tune` form (its own harmonics sit on any ladder that fits under 14 kHz); hide and ultrasonic still work. */
export interface Jingle { name: string, bpm: number, voice: 'bell' | 'brass', notes: Note[], chords: number[][], notesPerBeat?: number, alt?: number, tune?: false }

const n = (midi: number | null, beats = 1): Note => ({ midi, beats })
const E = [4, 8, 11]; const B7 = [11, 3, 6, 9]; const C = [0, 4, 7]; const G7 = [7, 11, 2, 5]; const Cm = [0, 3, 7]; const Gm7 = [7, 10, 2, 5]

export const JINGLES: Record<string, Jingle> = {
  /** Big Ben's first two quarters (E major, 1793). */
  westminster: { name: 'Westminster Quarters', bpm: 80, voice: 'bell', notes: [n(68), n(66), n(64), n(59, 2), n(64), n(68), n(66), n(59, 2)], chords: [E, E, E, B7, B7, E, E, E, B7, B7], alt: 2 },
  /** The two-bits call and response. */
  shave: { name: 'Shave and a Haircut', bpm: 120, voice: 'bell', notes: [n(60), n(55, 0.5), n(55, 0.5), n(57), n(55), n(null), n(59), n(60, 2)], chords: [C, G7, G7, G7, C, G7, C, C], alt: 2 },
  /** The ballpark bugle call. */
  charge: { name: 'Charge!', bpm: 140, voice: 'brass', notes: [n(67, 0.5), n(72, 0.5), n(76, 0.5), n(79, 0.75), n(76, 0.25), n(79, 2)], chords: [C, G7, C, [5, 9, 0], G7], notesPerBeat: 2, tune: false }, // tune form: 7-27% in reverb whatever the ladder (benchmarks/JINGLE.md)
  /** Da-da-da-DUM, twice (C minor). */
  beethoven5: { name: "Beethoven's 5th, opening", bpm: 108, voice: 'brass', notes: [n(67, 0.5), n(67, 0.5), n(67, 0.5), n(63, 2.5), n(null, 0.5), n(65, 0.5), n(65, 0.5), n(65, 0.5), n(62, 3)], chords: [Cm, Cm, Cm, Cm, Gm7, Gm7, Gm7, Gm7], notesPerBeat: 4, alt: 2 }
}

const hz = (midi: number): number => 440 * 2 ** ((midi - 69) / 12)

/** One pass of the melody as mono samples. Bells ring past their note; brass sustains and stops. */
export function renderJingle (j: Jingle, rate: number): Float32Array {
  const beat = 60 / j.bpm
  const total = j.notes.reduce((t, x) => t + x.beats, 0) * beat + (j.voice === 'bell' ? 1.5 : 0.2)
  const out = new Float32Array(Math.round(total * rate))
  let t0 = 0
  for (const note of j.notes) {
    const dur = note.beats * beat
    if (note.midi != null) {
      const f = hz(note.midi)
      const start = Math.round(t0 * rate)
      const ring = j.voice === 'bell' ? Math.min(2.5, dur + 1.5) : dur
      const len = Math.round(ring * rate)
      for (let i = 0; i < len && start + i < out.length; i++) {
        const t = i / rate
        const env = j.voice === 'bell'
          ? Math.min(1, t / 0.004) * Math.exp(-3 * t / ring)
          : Math.min(1, t / 0.02) * (t < dur - 0.03 ? 1 : Math.max(0, (dur - t) / 0.03))
        // a few partials: bells are inharmonic-ish and bright, brass is a soft sawtooth
        const w = 2 * Math.PI * f * t
        const s = j.voice === 'bell'
          ? Math.sin(w) + 0.5 * Math.sin(2.01 * w) * Math.exp(-t) + 0.25 * Math.sin(3.0 * w) * Math.exp(-2 * t) + 0.15 * Math.sin(4.2 * w) * Math.exp(-3 * t)
          : Math.sin(w) + 0.5 * Math.sin(2 * w) + 0.33 * Math.sin(3 * w) + 0.25 * Math.sin(4 * w) + 0.2 * Math.sin(5 * w)
        out[start + i] += 0.35 * env * s
      }
    }
    t0 += dur
  }
  return out
}

const rms = (x: Float32Array): number => { let s = 0; for (const v of x) s += v * v; return Math.sqrt(s / x.length) }

/** The melody repeated for `seconds`, each pass overlapping the last one's ring-out, so there is no seam. */
export function loopJingle (j: Jingle, rate: number, seconds: number): Float32Array {
  const pass = renderJingle(j, rate)
  const period = Math.round(j.notes.reduce((t, x) => t + x.beats, 0) * (60 / j.bpm) * rate)
  const out = new Float32Array(Math.ceil(seconds * rate))
  for (let k = 0; k * period < out.length; k++) {
    for (let i = 0; i < pass.length && k * period + i < out.length; i++) out[k * period + i] += pass[i]
  }
  return out
}

/**
 * The jingle, looped for the length of `data`, with `data` mixed in `levelDb` below the jingle's RMS.
 * `duck`: let the data follow the music's envelope (quieter in the gaps, with a floor) so an audible data
 * band stays masked; for an ultrasonic band leave it off, nobody hears it and a steady level decodes best.
 */
export function underJingle (data: Float32Array, jingle: Jingle, rate: number, levelDb: number, duck = false, fadeSeconds = 1.5): Float32Array {
  // the music runs for the data, then fades out instead of stopping mid-tune or playing a whole extra pass
  const fade = Math.round(fadeSeconds * rate)
  const bed = loopJingle(jingle, rate, (data.length + fade) / rate)
  for (let i = 0; i < fade; i++) bed[data.length + i] *= 0.5 * (1 + Math.cos(Math.PI * i / fade))
  const g = rms(bed.subarray(0, data.length)) / rms(data) * 10 ** (levelDb / 20)
  const out = bed.slice()
  if (duck) {
    // envelope: 5 ms attack, 150 ms release, normalized to its peak; floor at -14 dB
    const a = 1 - Math.exp(-1 / (0.005 * rate)); const r = 1 - Math.exp(-1 / (0.15 * rate))
    const env = new Float32Array(bed.length)
    let e = 0; let peak = 1e-9
    for (let i = 0; i < bed.length; i++) { const v = Math.abs(bed[i]); e += (v > e ? a : r) * (v - e); env[i] = e; peak = Math.max(peak, e) }
    for (let i = 0; i < data.length; i++) out[i] += g * data[i] * Math.max(0.2, env[i] / peak) * 2
  } else {
    for (let i = 0; i < data.length; i++) out[i] += g * data[i]
  }
  let peak = 0
  for (const v of out) peak = Math.max(peak, Math.abs(v))
  if (peak > 0.95) for (let i = 0; i < out.length; i++) out[i] *= 0.95 / peak
  return out
}

/**
 * The `tune` preset for a jingle: the data is a 16-tone arpeggio over the tune's chord of the beat, `notesPerBeat`
 * notes per beat, from two octaves above the melody (C6 and up) to at most 14 kHz, so the music is the known melody plus an
 * accompaniment that happens to be the data. 4 bits per note; the rate follows the tempo (Westminster at 8 per
 * beat: 94 ms notes, ~5 B/s). Mix with `underJingle(data, jingle, rate, -6)` so the melody sits 6 dB above it.
 */
/** The jingles that have a `tune` form. */
export const TUNABLE = (Object.keys(JINGLES) as Array<keyof typeof JINGLES>).filter(j => JINGLES[j].tune !== false)

export function tunePreset (j: Jingle, notesPerBeat = j.notesPerBeat ?? 8): ModemOptions {
  if (j.tune === false) throw new RangeError(`${j.name} has no tune form`)
  // the ladder starts at C6, or well above the melody's top note when that is high: a brass note's harmonics
  // land exactly on chord tones, so the data must sit above them
  const top = Math.max(...j.notes.map(x => x.midi ?? 0))
  // 16 chord tones from `from` up would span five octaves and pass 40 kHz (they used to: the modem now refuses tones
  // above Nyquist). Cap the ladder at 14 kHz; fill the rest with the chord's 9th and 13th, then start an octave lower.
  const CAP = 14000
  const ladder = (pcs: number[]): number[] => {
    const ext = [(pcs[0] + 2) % 12, (pcs[0] + 9) % 12].filter(pc => !pcs.includes(pc))
    for (let from = Math.max(84, top + 17); from > 48; from -= 12) { // C6 = 84, or well above a high melody
      for (const allowed of [pcs, [...pcs, ...ext]]) {
        const out: number[] = []
        for (let midi = from; out.length < 16 && hz(midi) < CAP; midi++) if (allowed.includes(midi % 12)) out.push(hz(midi))
        if (out.length === 16) return out
      }
    }
    throw new RangeError(`${j.name}: cannot fit 16 tones under ${CAP} Hz`)
  }
  // a note's echo never lands on the next note when the beat alternates its chord with a transposed copy; Charge!
  // is the exception (its brass harmonics sit on the transposed ladder), so it keeps one set per beat
  const alt = j.alt ?? 0
  const toneSets = alt === 0 ? j.chords.map(ladder) : j.chords.flatMap(ch => [ladder(ch), ladder(ch.map(pc => (pc + alt) % 12))])
  return { tones: toneSets[0], toneSets, barSymbols: notesPerBeat, alt: alt === 0 ? 1 : 2, symbolSeconds: 60 / j.bpm / notesPerBeat, chime: true, parity: 32 }
}
