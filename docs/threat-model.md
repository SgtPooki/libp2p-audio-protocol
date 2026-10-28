# Threat model

What libp2p-over-audio protects, against whom, and what it deliberately does not protect. Update this file whenever a mitigation lands or a new attack is found.

## What the protocol promises

1. **Authorship.** A verified frame was signed by the private key behind the PeerId shown. Nobody can forge or alter a frame without that key.
2. **Integrity.** A frame is delivered byte-for-byte or not at all (Reed-Solomon, CRC-32, then the signature).

It does **not** promise:

- **Confidentiality.** Everything on air is plaintext. Anyone in earshot can read it. This is deliberate: broadcasts are meant to be heard, and ham radio rules (47 CFR 97.113(a)(4)) forbid encoding to obscure meaning. Signatures are fine because they don't hide content.
- **Trust.** A valid signature proves *which key* signed, not *who* the person is or whether to believe them. Anyone can generate keys.
- **Freshness.** Not yet: see replay below.
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
| T2 | Stale instructions via replay | "Evacuate to the high school" replayed after the school flooded | **Planned** | Signed timestamp in every message, a max age per message type, and the UI shows message age instead of dropping silently. Clocks after a disaster may be off, so windows must be generous. |
| T3 | Fake presence via replay | Replaying a medic's announcement makes them seem to be in this shelter | **Planned** (partial) | Timestamps narrow the window but can't prove presence: a recording replayed seconds later has a fresh timestamp. Real proof needs a challenge-response: the listener broadcasts a random nonce, and the peer signs it back. |
| T4 | Stale addresses via replayed PeerRecord | An old record advertises addresses that are gone | **Planned** | Keep the highest `seqNumber` seen per peer and drop lower ones. libp2p's peer store does this for records it consumes; our `peer:discovery` path does not yet. |
| T5 | Out-of-order delivery | "Shelter open" replayed after "shelter closed" | **Planned** | Per-sender sequence counter in signed messages; show order by sender time, not arrival time. |
| T6 | Duplicate events | One relayed or echoed frame fires the event twice | **Planned** | Cache of recently seen envelope hashes. Relaying copies on purpose is a feature (mesh spread), so dedupe by hash rather than rejecting repeats. |
| T7 | Jamming | Loud noise or tones on 1000-2500 Hz | **Accepted** | Any shared medium can be jammed, so there is no protocol-level fix. Partial help: erasure decoding survives ~1 s bursts, other presets use other bands, and moving closer raises signal over noise. |
| T8 | CPU drain from false syncs | Audio looping the sync pattern makes the receiver try many decodes | **Planned** | Measure CPU per audio second under hostile audio (scorecard), then cap decode attempts per second. |
| T9 | Channel hogging | Endless valid replays crowd out new messages | **Planned** | Dedupe (T6) stops the processing cost; airtime itself can't be protected (same as T7). |
| T10 | Tracking / privacy | Your PeerId is broadcast to everyone in range, so devices can be followed across places | **Accepted for now** | Discovery needs a stable identity. Users who care can rotate keys (new identity = new PeerId). Revisit if a use case needs anonymity. |
| T11 | Sybil / spam identities | One person makes many keys to flood or impersonate a crowd | **Accepted** | Keys are free. Trust has to come from outside the protocol: known PeerIds (e.g. an official broadcaster's key printed on a poster), or web of trust. |
| T12 | Stolen or leaked key | Attacker uses a real broadcaster's key | **Accepted for now** | No revocation over audio yet. The demo keeps keys in browser `localStorage`, which is fine for demos only. |
| T13 | Malformed frames | Crafted bytes crash the parser | **Mitigated** | Length header check, CRC-32, RS, then protobuf parsing inside `try` in `openFrame`; anything unparseable is dropped. Fuzzing is still a good idea. |
| T14 | Wrong correction accepted | Erasure decoding "corrects" garbage into a valid-looking frame | **Mitigated** | CRC-32 inside the frame, then the signature check. |

## Open questions

- What max age for each message type (announcement, chat, emergency broadcast)?
- Should relays add their own signature ("I heard this at time T") so listeners can see the path?
- How should an official broadcaster publish its PeerId so people can trust it offline?
