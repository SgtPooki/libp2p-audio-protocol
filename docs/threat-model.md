# Threat model

What libp2p-over-audio protects, against whom, and what it deliberately does not protect. Update this file whenever a mitigation lands or a new attack is found.

## What the protocol promises

1. **Authorship.** A verified frame was signed by the private key behind the PeerId shown. Nobody can forge or alter a frame without that key.
2. **Integrity.** A frame is delivered byte-for-byte or not at all (Reed-Solomon, CRC-32, then the signature).
3. **Freshness.** While a receiver runs, each message is delivered at most once, with its signed send time, and only if it is recent (T2, T5, T6). Apps that track state must order by `sentAt`.
4. **Content.** Bytes delivered by a `content` event hash to the CID in a signed pointer from the PeerId shown, no matter who relayed the chunks (T15, T16).
5. **Connections** (the `/audio` transport). Both ends are mutually authenticated by their identity keys with fresh ephemeral keys (replay-proof, forward secret). Encrypted by default (ChaCha20-Poly1305); **sign-only mode** for amateur radio keeps authentication and integrity and sends plaintext (47 CFR 97.113(a)(4) forbids obscuring meaning, not signing). Review: [`notes/lean-transport-review.md`](../notes/lean-transport-review.md).

It does **not** promise:

- **Confidentiality of broadcasts.** Announcements, messages, pointers and chunks are plaintext. Anyone in earshot can read them. This is deliberate: broadcasts are meant to be heard. Only connections are encrypted.
- **Identity hiding.** PeerIds are broadcast in discovery and sent in the clear in the connection handshake (Noise XX would hide them).
- **Trust.** A valid signature proves *which key* signed, not *who* the person is or whether to believe them. Anyone can generate keys.
- **Delivery.** Audio is lossy and shared. A frame can always be lost, and a connection can always be cut.

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
| T3 | Fake presence via replay | Replaying a medic's announcement makes them seem to be in this shelter | **Mitigated**, with limits | A listener can `challenge()`: it broadcasts a random 8-byte nonce, and peers' next messages echo up to 3 challenges heard in the last 5 minutes. A message echoing *my* nonce, received within 5 minutes of my asking, is marked `present`; an old recording can't contain it, and a junk challenge can't push mine out. **Limits (accepted):** a live relay (someone streaming the room's audio to the medic in real time) defeats any challenge-response over audio; and `present` means "heard my challenge within 5 minutes", not "is here this second". Tests: `test/replay.test.ts` (T3). |
| T4 | Stale addresses via replayed PeerRecord | An old record advertises addresses that are gone | **Mitigated** after first contact | `AudioService` keeps the highest PeerRecord `seqNumber` per peer and rejects equal or lower ones (`rejected`, reason `old-record`). **Limit:** a receiver that has never heard the peer (or just restarted) accepts whatever record arrives first, even an old one; it is corrected as soon as a newer one is heard. Test: `test/replay.test.ts` (T4). |
| T5 | Out-of-order delivery | "Shelter open" replayed after "shelter closed" | **Partly mitigated** | `sentAt` is strictly increasing per sender (it doubles as the sequence number, so nothing needs persisting) and every delivered message carries it, so an app can show messages in send order and see that "open" is older than "closed". Messages older than the per-sender window (`windowMs`, default 10 min) are rejected. **Not prevented:** within the window, an older message that arrives late is still delivered (bounded reordering, needed for relays); apps that track state ("is the shelter open?") must compare `sentAt`. **Limit:** a sender whose clock jumps backwards (or that restarts with a slower clock) can produce `sentAt` values receivers reject as duplicates or too old. Test: `test/replay.test.ts` (T5). |
| T6 | Duplicate events | One relayed or echoed frame fires the event twice | **Mitigated** while the receiver runs | The anti-replay window remembers each sender's `sentAt` values, so a relayed or replayed copy is delivered once and the rest are rejected as `duplicate`. Fountain broadcasts also remember finished messages, so a broadcast that keeps looping decodes once. **Limit:** replay memory is in RAM; a restarted receiver can accept a replay again until it ages out under T2. State is capped at 1024 peers. Tests: `test/replay.test.ts` (T6), `test/broadcast.test.ts`. |
| T7 | Jamming | Loud noise or tones on 1000-2500 Hz | **Accepted** | Any shared medium can be jammed, so there is no protocol-level fix. Partial help: erasure decoding survives ~1 s bursts, other presets use other bands, and moving closer raises signal over noise. |
| T8 | CPU drain from false syncs | Audio looping the sync pattern makes the receiver try many decodes | **Measured, accepted for now** | The scorecard's "under looped sync tones" CPU row tracks it; the tail-sync decoder roughly doubles the work per false sync. Cap decode attempts per second if a real device shows it. |
| T9 | Channel hogging | Endless valid replays crowd out new messages | **Planned** (partial) | Dedupe (T6) removes the processing and display cost; airtime itself can't be protected (same as T7). |
| T10 | Tracking / privacy | Your PeerId is broadcast to everyone in range, so devices can be followed across places | **Accepted for now** | Discovery needs a stable identity. Users who care can rotate keys (new identity = new PeerId). Revisit if a use case needs anonymity. |
| T11 | Sybil / spam identities | One person makes many keys to flood or impersonate a crowd | **Accepted** | Keys are free. Trust has to come from outside the protocol: known PeerIds (e.g. an official broadcaster's key printed on a poster), or web of trust. |
| T12 | Stolen or leaked key | Attacker uses a real broadcaster's key | **Accepted for now** | No revocation over audio yet. The demo keeps keys in browser `localStorage`, which is fine for demos only. |
| T13 | Malformed frames | Crafted bytes crash the parser | **Mitigated** | Length header check, CRC-32, RS, then protobuf parsing inside `try` in `openFrame`; anything unparseable is dropped. Fuzzing is still a good idea. |
| T14 | Wrong correction accepted | Erasure decoding "corrects" garbage into a valid-looking frame | **Mitigated** | CRC-32 inside the frame, then the signature check. |
| T15 | Poisoned fountain chunks | Chunks are not signed one by one, so an injector sends a forged chunk with a real broadcast's id to spoil reassembly | **Mitigated** (DoS remains) | The reassembled message must match its hash and then pass the signature check, so a forged chunk can never produce a wrong message. A failed reassembly starts over from fresh chunks instead of giving up on the message, and pending reassemblies are capped at 32. **Accepted:** an attacker who keeps injecting forged chunks can keep spoiling reassembly, which is a form of jamming (T7). Test: `test/broadcast.test.ts`. |

| T16 | Poisoned content, untrusted repeaters | A repeater or injector sends chunks that rebuild into different bytes | **Mitigated** | The rebuilt bytes must match the chunk id, decompress to the signed length, and hash to the CID in the signed pointer (`decodeContent`, `src/content.ts`). Repeaters re-send only content they verified themselves, so no trust in them is needed. Test: `test/content.test.ts`. |
| T17 | Stale or replayed pointer | An old "evacuate to the school" notice is replayed after a newer one | **Mitigated** | Pointers carry a signed `validFor`; expired ones are rejected (`expired`). Per publisher and name the highest `sentAt` wins; older ones are rejected (`old-record`) and a newer one retires any relay in progress. |
| T18 | Relay amplification of spam | A spammer's pointer gets re-sent by every repeater in range | **Mitigated** | Repeating is off by default and needs an allowlist of publisher PeerIds; content from anyone else is delivered locally but never relayed. Per content item a repeater sends a fixed number of loops. **Accepted:** the allowlist has to come from outside the protocol (T11). |
| T19 | Decompression bomb | A pointer claims a small size, chunks hold a zip bomb | **Mitigated** | Decompression stops at the signed `len`; the result must be exactly `len` bytes and hash to the CID. |
| T20 | Replayed connection handshake | A recording of a dialer's msg1 is played back so the listener "sees" that peer connect | **Mitigated** | The listener only reports a connection after receiving a record under the fresh session keys, which a recording cannot produce. Both signatures cover the other side's fresh ephemeral key, so neither side can be impersonated or redirected (identity misbinding) and the encrypt/sign-only choice is inside the signed message (no downgrade). Tests: `test/handshake.test.ts`. |
| T21 | Link-layer injection | Anyone can send unsigned link frames: SYNs, forged ACKs, FIN or RST for a connection they can hear | **Partly mitigated** | SYNs are bounded (16 connections per link, one SYN-ACK per timeout, half-open connections expire). A forged FIN that cuts a record in half is reported as an error, not a clean close. **Accepted:** a forged RST or ACK can still kill or stall a connection; so can a jammer (T7). Authenticated link control frames would cost bytes on every frame; revisit if targeted disruption becomes a real problem. |

## Open questions

- What max age for each message type (announcement, chat, emergency broadcast)? Today one `maxAgeMs` covers all messages.
- Should relays add their own signature ("I heard this at time T") so listeners can see the path?
- How should an official broadcaster publish its PeerId so people can trust it offline?
