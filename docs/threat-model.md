# Threat model

What libp2p-over-audio protects, against whom, and what it deliberately does not protect. Update this file whenever a mitigation lands or a new attack is found.

## What the protocol promises

1. **Authorship.** A verified frame was signed by the private key behind the PeerId shown. Nobody can forge or alter a frame without that key.
2. **Integrity.** A frame is delivered byte-for-byte or not at all (Reed-Solomon, CRC-32, then the signature).
3. **Freshness.** Each message is delivered at most once, with its signed send time, and only if it is recent (T2, T5, T6).

It does **not** promise:

- **Confidentiality.** Everything on air is plaintext. Anyone in earshot can read it. This is deliberate: broadcasts are meant to be heard, and ham radio rules (47 CFR 97.113(a)(4)) forbid encoding to obscure meaning. Signatures are fine because they don't hide content.
- **Trust.** A valid signature proves *which key* signed, not *who* the person is or whether to believe them. Anyone can generate keys.
- **Delivery.** Audio is lossy and shared. A frame can always be lost.

## Attackers

| Attacker | Can do |
|---|---|
| Listener | Hear and record everything in range |
| Replayer | Record a real frame and play it back later, anywhere |
| Injector | Transmit arbitrary audio, but has no victim's private key |
| Jammer | Transmit loud noise or tones on our band |
| Key holder | A real peer, possibly malicious, or one whose key was stolen |

## Threats

Status: **Mitigated** (done, with where), **Planned** (agreed, not built), **Accepted** (not mitigating, with the reason).

| # | Threat | Example | Status | How / why |
|---|---|---|---|---|
| T1 | Forged message | Injector broadcasts "evacuate now" as the county's PeerId | **Mitigated** | Ed25519 signed envelopes, verified in `openFrame` (`src/protocol.ts`); tampered frames are rejected (test in `test/libp2p.test.ts`) |
| T2 | Stale instructions via replay | "Evacuate to the high school" replayed after the school flooded | **Mitigated** | Every signed message carries `sentAt`. `AudioService` rejects messages older than `maxAgeMs` (default 1 h) or more than `maxSkewMs` (5 min) in the future, and emits `rejected` so the UI can say why instead of dropping silently; accepted messages show their age. Clocks after a disaster may be off, so keep `maxAgeMs` generous. Test: `test/replay.test.ts` (T2). |
| T3 | Fake presence via replay | Replaying a medic's announcement makes them seem to be in this shelter | **Mitigated**, one limit | Timestamps alone can't prove presence, so a listener can `challenge()`: it broadcasts a random 8-byte nonce, and peers' next messages carry the last challenge they heard. A message carrying *my* nonce was signed after I asked, so it is marked `present`; an old recording can't contain it. **Limit (accepted):** a live relay (someone streaming the room's audio to the medic in real time) defeats any challenge-response over audio. Test: `test/replay.test.ts` (T3). |
| T4 | Stale addresses via replayed PeerRecord | An old record advertises addresses that are gone | **Mitigated** | `AudioService` keeps the highest PeerRecord `seqNumber` per peer and rejects equal or lower ones (`rejected`, reason `old-record`). Test: `test/replay.test.ts` (T4). |
| T5 | Out-of-order delivery | "Shelter open" replayed after "shelter closed" | **Mitigated** | `sentAt` is strictly increasing per sender (it doubles as the sequence number, so nothing needs persisting), so receivers can order by send time. A per-sender anti-replay window (`windowMs`, default 10 min, as in IPsec) accepts mild reordering from relays but rejects anything older than the window. Test: `test/replay.test.ts` (T5). |
| T6 | Duplicate events | One relayed or echoed frame fires the event twice | **Mitigated** | The anti-replay window remembers each sender's `sentAt` values, so a relayed or replayed copy is delivered once and the rest are rejected as `duplicate`. Fountain broadcasts also remember finished messages, so a broadcast that keeps looping decodes once. Tests: `test/replay.test.ts` (T6), `test/broadcast.test.ts`. |
| T7 | Jamming | Loud noise or tones on 1000-2500 Hz | **Accepted** | Any shared medium can be jammed, so there is no protocol-level fix. Partial help: erasure decoding survives ~1 s bursts, other presets use other bands, and moving closer raises signal over noise. |
| T8 | CPU drain from false syncs | Audio looping the sync pattern makes the receiver try many decodes | **Planned** | Measure CPU per audio second under hostile audio (scorecard), then cap decode attempts per second. |
| T9 | Channel hogging | Endless valid replays crowd out new messages | **Planned** (partial) | Dedupe (T6) removes the processing and display cost; airtime itself can't be protected (same as T7). |
| T10 | Tracking / privacy | Your PeerId is broadcast to everyone in range, so devices can be followed across places | **Accepted for now** | Discovery needs a stable identity. Users who care can rotate keys (new identity = new PeerId). Revisit if a use case needs anonymity. |
| T11 | Sybil / spam identities | One person makes many keys to flood or impersonate a crowd | **Accepted** | Keys are free. Trust has to come from outside the protocol: known PeerIds (e.g. an official broadcaster's key printed on a poster), or web of trust. |
| T12 | Stolen or leaked key | Attacker uses a real broadcaster's key | **Accepted for now** | No revocation over audio yet. The demo keeps keys in browser `localStorage`, which is fine for demos only. |
| T13 | Malformed frames | Crafted bytes crash the parser | **Mitigated** | Length header check, CRC-32, RS, then protobuf parsing inside `try` in `openFrame`; anything unparseable is dropped. Fuzzing is still a good idea. |
| T14 | Wrong correction accepted | Erasure decoding "corrects" garbage into a valid-looking frame | **Mitigated** | CRC-32 inside the frame, then the signature check. |

## Open questions

- What max age for each message type (announcement, chat, emergency broadcast)? Today one `maxAgeMs` covers all messages.
- Should relays add their own signature ("I heard this at time T") so listeners can see the path?
- How should an official broadcaster publish its PeerId so people can trust it offline?
