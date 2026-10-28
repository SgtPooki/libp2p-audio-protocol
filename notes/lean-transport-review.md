# Peer review of the lean transport (2026-10-28)

Reviewers: Codex (default model) and Gemini 4 Argon via `agy`, each given `src/handshake.ts`, `src/mux.ts`, `src/link.ts`, `src/transport.ts`, the tests, `notes/two-way-transport.md` and `docs/threat-model.md`, and asked for a ranked security and engineering review with concrete attacks. Gemini's output was cut off by its print timeout after its summary and first two findings; the summary is complete.

## Where both agreed

- No concrete break of the handshake construction: msg1 binds the dialer's identity and ephemeral to the intended listener's PeerId; msg2 binds all of msg1; separate domain tags and lengths rule out reflection; the mode byte is inside the signed msg1, so encrypt vs sign-only cannot be downgraded; directional keys from HKDF over the full transcript; X25519 low-order points are rejected by the library.
- **Liveness gap (both rated it top):** msg1 carries nothing fresh from the listener, so a recorded msg1 can be replayed. The replayer cannot derive the session keys, but the listener used to publish an authenticated inbound connection under the victim's PeerId before any record proved the dialer holds the keys.
- What Noise XX gives that this does not: identity hiding (the dialer's key is sent in the clear; PeerIds are already broadcast in discovery, threat T10), static-ephemeral DH terms (`es`, `se`) alongside `ee`, and a third flight for key confirmation.

## Findings and what changed

| # | Finding | Status |
|---|---|---|
| 1 | Listener upgrades before the dialer proves possession of the session keys (replayed msg1) | **Fixed.** The dialer sends an empty record under the new keys right after msg2 (it rides in the same frame as the first stream bytes); the listener waits for one valid record before `upgradeInbound`. |
| 2 | Unsigned SYNs allocate state and queue SYN-ACK playback without limits; duplicate SYNs re-trigger replies | **Fixed.** `maxConns` (16) per link, SYN-ACK at most once per `rto`, half-open connections expire with the handshake timeout. |
| 3 | Per-connection turns do not arbitrate the shared room; both sides idle can talk at once; a burst scheduled during the holdoff does not recheck the turn | **Partly fixed.** The browser link now listens before talking (`Demodulator.busy()` with random backoff); a burst rechecks the turn after the holdoff. A room-level scheduler with responder priority is still open (roadmap). |
| 4 | Link FIN/RST/ACK are unsigned, so an injector can truncate an authenticated session and it looks like a clean close | **Partly fixed.** A close with a partially read record is now an error. An authenticated session close is not implemented; a jammer can always cut a connection (threat T7). |
| 5 | `drain` never fires when the last ACK empties the queue | **Fixed.** |
| 6 | Stream ids come back after 16 opens; a very late reply could land on the successor stream | **Accepted** with a `ponytail:` note: at 10 B/s that is minutes of traffic. Inbound OPENs with our id parity are now ignored. |
| 7 | A 65,535-byte mux write cannot be sealed (tag does not fit the record length) | **Fixed.** The MultiaddrConnection splits writes at 65,519 bytes. |
| 8 | `LinkConn.close()` hangs if the connection is reset or times out meanwhile | **Fixed.** Teardown settles the close. |
| 9 | Handshake reads ignore link closure and already-aborted signals; a failed dial leaves state behind | **Fixed.** |
| 10 | Protocol index table is not bound into the handshake; mismatched tables misroute streams | **Accepted.** The table is part of `/audiomux/1.0.0`; a custom table is a different muxer version. Unknown indexes map to no protocol. |
| 11 | Record nonce wraps after 2^32 records | **Fixed.** The session fails closed. |
| 12 | (Gemini) Receiver's retransmit timer after a frame without OVER is shorter than the rest of a multi-frame burst, so losing one frame mid-burst makes the receiver talk over the sender | **Fixed.** Timers wait `window` max-frame times; `rto` is documented as one max frame plus guard. |
| 13 | (Gemini) Record length prefix is not authenticated; counter advanced before the length check | **Fixed.** Length is AAD / inside the HMAC; the check comes first. |
| 14 | Mode byte accepted any value, HMAC compare not constant time | **Fixed.** |

## Verdict

Both reviewers: keep lean opt-in until the liveness, admission and timer issues are fixed, then validate with overlapping half-duplex playback tests and a real speaker-to-microphone run. The fixes above are in; the speaker-to-microphone run is in `benchmarks/OVER-THE-AIR.md` (16 s to a connection). The simulated room still delivers whole frames instantly, so collision behavior under real overlap remains unmeasured; that is the next transport item in `docs/roadmap.md`.

## Second review (Codex, 2026-10-28 evening): handshake in SYN/SYN-ACK, preset ladder, bridge, music preset

| # | Finding | Status |
|---|---|---|
| 1 | Bridge: an oversized topic message rejected by `audio.send` was an unhandled rejection (process exit) | **Fixed.** Size checked before queueing; the handler catches. |
| 2 | Bridge: every topic delivery queued airtime without limit; the same envelope could be queued many times before any copy was heard | **Fixed.** One playback at a time, a 4-deep queue, and an identity set so a message is queued once. |
| 3 | A SYN whose verification failed still got an (empty) SYN-ACK on the already-reset connection; a duplicate SYN during verification answered early | **Fixed.** Rejection propagates, no SYN-ACK on a closed connection or before the acceptor answered. |
| 4 | Ladder pinning: a dialer that moved down to `voice` got the stored SYN-ACK on `fast`; a SYN-ACK heard on another preset did not update the dialer's preset | **Fixed.** Duplicate SYNs update the answer preset; the dialer adopts the preset the SYN-ACK arrived on. |
| 5 | SYN timer started before the SYN finished playing, so a normal 14 s SYN + 11 s SYN-ACK exceeded the 22 s timeout | **Fixed** (found independently by the timed room): the clock starts when the SYN has played. |
| 6 | Plain-text re-signing let any publisher put words under the bridge's key | **Fixed.** Off by default (`relayPlainText`); signed envelopes always relay. |
| 7 | Music frames can last 32 s but the receiver kept 25 s, so a damaged head on a max-size music frame could not be recovered from the tail | **Fixed.** Retention derives from the longest frame at the configured symbol time. |

Codex found no replay path around the first-record liveness check with the handshake folded into SYN/SYN-ACK: a replayed SYN yields no session keys, a forged SYN-ACK fails the signature (it can abort that dial). Still open from both reviews: unsigned link control frames (T21) and the protocol-table binding (accepted).
