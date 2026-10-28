# Two-way libp2p over audio: can it be a real transport?

Researched October 2026. Question: can libp2p-over-audio be a real libp2p transport (bidirectional connections, streams, protocols), and what is the best way to build it?

Short answer: **yes, and js-libp2p v3 already has the hooks to make it fast enough to be usable.** Stock libp2p over our modem works but takes about 95-110 s to the first application byte. A transport that does its own compact signed handshake (the same thing the WebRTC transport does) and ships a tiny muxer with pre-negotiated protocols gets that to about 26 s at today's 10 B/s and about 11 s at 25 B/s, while still handing libp2p a normal `Connection` with streams and protocol handlers.

Items marked **UNVERIFIED** were not confirmed from a primary source or a local measurement.

## The channel we are designing for

From `src/modem.ts`: a frame is 10 preamble symbols + 4 header symbols + 2 symbols per byte of (payload + 4 CRC + 16 RS parity), at 40 ms per symbol. So:

- airtime(L bytes) = **2.16 s fixed + 0.08 s per byte**. A full 235-byte frame is 21 s (11.2 B/s); a 30-byte frame is 4.6 s.
- Every transmission pays 2.16 s no matter how small. On this channel, **turnarounds cost more than bytes** for anything under about 30 bytes.
- Half-duplex: the sender is deaf while it plays. A room is one shared medium with several possible talkers.

The "25 B/s" scenario below assumes a 2.5x faster modem (for example 16 ms symbols), so fixed overhead scales to 0.86 s and 0.032 s/byte. Each turnaround adds a guard `g = 0.5 s` for audio output latency and receiver settle (**UNVERIFIED**, measure it on real phones; for comparison KISS defaults TXDELAY to 500 ms, [KISS spec](https://www.ax25.net/kiss.aspx)).

## 1. What a libp2p connection costs on the wire

### Measured, not guessed

I ran two js-libp2p 3.5.1 nodes (this repo's `node_modules`: `@chainsafe/libp2p-noise` 17.0.0, `@chainsafe/libp2p-yamux` 8.0.1, `@libp2p/multistream-select` 7.0.32) over TCP through a logging proxy, dialed, opened one stream on a custom `/x/1.0.0` protocol, sent 10 bytes and read the echo. No identify service configured. Script: scratchpad `measure.mjs` (not committed).

Stock config, each line is one burst in one direction:

| # | Dir | Bytes | What it is |
|---|---|---|---|
| 1 | D to L | 28 | multistream header + `/noise` proposal |
| 2 | L to D | 28 | multistream header + `/noise` echo |
| 3 | D to L | 34 | Noise XX msg 1 (2-byte length + 32-byte ephemeral) |
| 4 | L to D | 218 | Noise msg 2: e, encrypted static, payload (identity key, signature, `stream_muxers: ["/yamux/1.0.0"]`) |
| 5 | D to L | 216 | Noise msg 3 (186) + a yamux ping (30) |
| 6-7 | both | 60 + 30 | yamux initial ping and pongs (keepalive is on by default, every 30 s) |
| 8-11 | both | 90 + 120 + 100 + 100 | yamux SYN, multistream select of `/x/1.0.0`, 10 bytes, echo |

Total to first echoed byte: **1024 bytes, 11 transmissions, 10 turnarounds.** Muxer selection costs no round trip because js Noise already does early muxer negotiation in the handshake extensions ([noise spec](https://github.com/libp2p/specs/blob/master/noise/README.md), `stream_muxers` field; confirmed in `@chainsafe/libp2p-noise/dist/src/noise.js`).

With `yamux({ enableKeepAlive: false })` and `newStream(proto, { negotiateFully: false })`: **904 bytes, 8 transmissions.** The multistream exchange in front of Noise was still a full round trip in js (step 1-2 were not lazily merged with msg 1).

Important side finding: **yamux keepalive** is 2 x 30 bytes every 30 s, which on our modem is 2 frames = about 9 s of airtime every 30 s, forever. It must be off on an audio connection.

### Where the bytes go

| Piece | Bytes | Source |
|---|---|---|
| Noise framing | 2-byte length per message, 16-byte AEAD tag per encrypted part | [noise spec](https://github.com/libp2p/specs/blob/master/noise/README.md) |
| Noise XX | msg1 32, msg2 32 + 48 + payload, msg3 48 + payload; 1.5 round trips | Noise spec; measured 34 / 218 / 186 |
| Noise payload | identity key 36 (protobuf Ed25519, measured), signature 64 over `"noise-libp2p-static-key:" + static key` | noise spec |
| multistream-select | `/multistream/1.0.0\n` is 20 bytes with its varint; each proposal is `len + name + \n` | [connections spec](https://github.com/libp2p/specs/blob/master/connections/README.md) |
| V1Lazy | dialer with one protocol can send proposal + data without waiting: "0-RTT negotiation if the dialer only supports a single protocol" | [rust-libp2p docs](https://docs.rs/multistream-select/latest/multistream_select/enum.Version.html) |
| yamux | 12-byte header per frame; data may ride with SYN; 256 KB initial window | [yamux spec](https://github.com/hashicorp/yamux/blob/master/spec.md) |
| mplex | varint header, 2-3 bytes typical; deprecated in libp2p (**UNVERIFIED** status here) | |
| identify | pubkey, listenAddrs, protocols, observedAddr, agentVersion, signedPeerRecord; both sides by default when the service is on | [identify spec](https://github.com/libp2p/specs/blob/master/identify/README.md) |
| signed PeerRecord | 157 bytes with no addresses (measured with `sealPeerRecord`) | this repo |

Identify per side: signed record about 170 + key 38 + protocol list + agentVersion. Estimate **400-600 bytes per side** (**UNVERIFIED**, the browser agentVersion can be long).

### Budget table

Model: sum over transmissions of frames x fixed overhead + bytes x per-byte time + turnarounds x 0.5 s. No losses (see section 4).

| Design | Bytes | Transmissions | Frames | 10 B/s | 25 B/s |
|---|---|---|---|---|---|
| Stock js-libp2p, measured | 1024 | 11 | 11 | 111 s | 47 s |
| Lean config, measured (no keepalive, lazy stream) | 904 | 8 | 9 | 95 s | 40 s |
| Stock protocols, ideal laziness everywhere (est.) | 646 | 4 | 6 | 66 s | 27 s |
| ... plus identify both ways (est.) | about 1850 | 5 | 11 | 173 s | 71 s |
| QUIC + libp2p TLS (est.) | about 3400 | 4 | 17 | 312 s | 126 s |
| Reticulum link (297 B) + 12 B data | about 320 | 4 | 4 | 36 s | 15 s |
| Noise IK with 0-RTT data (est.) | about 290 | 2 | 2 | 28 s | 12 s |
| Signed-nonce handshake in transport (est.) | about 260 | 2 | 2 | 26 s | 11 s |

QUIC notes: a client Initial must be padded to at least 1200 bytes ([RFC 9000 s14.1](https://www.rfc-editor.org/rfc/rfc9000#section-14.1)) and the server is limited to 3x what it received before address validation ([RFC 9000 s8.1](https://www.rfc-editor.org/rfc/rfc9000#section-8.1)); the libp2p cert carries the identity key and a signature in an X.509 extension ([libp2p TLS spec](https://github.com/libp2p/specs/blob/master/tls/tls.md)). The 2000-byte server flight is an estimate (**UNVERIFIED**). QUIC is the wrong shape here: it pays for padding and certificates to defend against IP spoofing that does not exist in a room.

Reticulum: "The combined bandwidth cost of setting up a link is 3 packets totalling 297 bytes" (83 request, 115 proof, 99 RTT), keepalive 20 bytes, "0.45 bits per second" ([Reticulum manual](https://reticulum.network/manual/understanding.html)). It is the right order of magnitude to aim for, and it proves a signed ephemeral-key link fits our frame size.

### The funkpost argument

[NiKrause/funkpost#1](https://github.com/NiKrause/funkpost/issues/1) says libp2p as a transport over LoRa is "buildable, and wrong": multistream-select, Noise, muxer negotiation, identify ("a couple of kilobytes by itself"), and GossipSub heartbeats every second "forever". The measurements agree with the diagnosis but not the conclusion. Muxer negotiation is already free (Noise extensions), identify and GossipSub are optional services, and the remaining cost is the handshake shape, which a transport is allowed to own. Their legal-airtime point (EU 868 duty cycle) does not apply to an acoustic room; it does apply if we ever run this over radio.

## 2. How to cut it, and what js-libp2p v3 allows

### The interfaces (from `@libp2p/interface` 3.4.0, `dist/src/transport.d.ts`)

- `Transport`: `dial(ma, options): Promise<Connection>`, `createListener(options): Listener`, `listenFilter`, `dialFilter`, plus `[transportSymbol]` and `[Symbol.toStringTag]`. `options.upgrader` is handed to the transport.
- `Listener`: event target with `listen(ma)`, `getAddrs()`, `updateAnnounceAddrs(addrs)`, `close()`; emits `connection`/`listening`/`close`.
- `MultiaddrConnection`: a `MessageStream` plus `remoteAddr` and `timeline`. This is the raw byte pipe the upgrader works on.
- `Upgrader.upgradeOutbound/upgradeInbound(maConn, opts)`. The key options:
  - `skipEncryption: true` with `remotePeer: PeerId`: "the invoking transport is expected to implement its own encryption", so no Noise and no multistream for security.
  - `muxerFactory`: "If a transport provides its own stream muxing facility pass a muxer factory instance here to skip muxer negotiation."
  - `skipProtection` (pnet).
- `StreamMuxer.createStream({ protocol })`: "If a single protocol was requested and the muxer has support for this, pre-negotiate the protocol using this value, otherwise multistream-select". In `libp2p/dist/src/connection.js`, both `newStream` and `onIncomingStream` skip `mss.select`/`mss.handle` when the muxed stream already has `protocol` set ("pre-negotiated protocol").

So yes, **the upgrader can be bypassed piece by piece while the result is still a first-class libp2p `Connection`** (connection manager, gater, registrar, protocol handlers all work). Precedent: the WebRTC-direct transport runs Noise itself over a data channel, then calls `upgrader.upgradeOutbound(maConn, { skipProtection: true, skipEncryption: true, remotePeer, muxerFactory })` ([connect.ts](https://github.com/libp2p/js-libp2p/blob/main/packages/transport-webrtc/src/private-to-public/utils/connect.ts)). The global `connectionEncrypters`/`streamMuxers` config only matters for transports that do not pass these options, so TCP etc. keep using Noise + yamux on the same node.

### Cuts, in order of value

| Cut | Saves | Cost / risk |
|---|---|---|
| No identify, no keepalive, no GossipSub on audio conns | about 1.2 KB + 9 s/30 s forever | Peer protocols unknown; we pre-agree them |
| Muxer with pre-negotiated protocol (1-2 byte protocol id: index into a shared table or truncated hash of the protocol string) | all multistream bytes and round trips per stream | Must ship a fallback to mss for unknown ids |
| Tiny muxer header (stream id + flags in 1 byte, no window updates) instead of yamux 12 bytes | 11 bytes per frame | Our own muxer to maintain (small) |
| Transport-owned handshake using the PeerId we already heard in the audio PeerRecord | 1.5 RTT Noise + 28-byte mss round trip becomes 1 RTT | Must get the crypto right; review it |
| First application bytes in handshake msg 1 and the response in msg 2 | the stream round trip | msg 1 data is replayable; only for idempotent requests (same caveat as Noise early data) |
| Faster modem (25 B/s) | about 2.4x everything | Robustness in echoey rooms |

Two handshake options for the transport:

1. **Noise IK.** One round trip and 0-RTT data, but the libp2p Noise spec removed IK ("Noise Pipes" was dropped in r2; only XX is supported) and js-libp2p-noise has only `XXHandshakeState`. IK also needs the responder's Noise static key, which a PeerRecord does not carry. Fixable by deriving X25519 from the Ed25519 identity key (as libsodium and Reticulum-style designs do) or by putting the static key in the audio announcement. Custom either way.
2. **Signed ephemeral handshake (SIGMA-style), recommended.** msg 1 (D to L): dialer identity key (36), ephemeral X25519 (32), nonce (8), signature (64) over a domain string + listener PeerId + the rest, plus first stream data. msg 2 (L to D): listener ephemeral (32), signature (64) over the transcript hash, plus response data. Both sides then derive keys from the X25519 shared secret. The responder's identity is the PeerId in the dialed multiaddr, which the dialer heard in a signed audio PeerRecord. About 260 bytes and 2 transmissions. Same size class as Reticulum's link.

Confidentiality is optional by design: in a room, encrypt with ChaCha20-Poly1305; on amateur radio, 47 CFR 97.113(a)(4) forbids obscuring meaning (see `docs/threat-model.md`), so a **ham mode** keeps the signatures and uses a MAC only. With `skipEncryption`, that choice lives in the transport, which is exactly where it belongs.

### Multiaddr

`@multiformats/multiaddr` 13 exposes `registry.addProtocol(codec)`, so a prototype can register `audio` with a private-use code (this repo already uses 0x300001 for `AudioMessage`) and register it properly in the multicodec table later. Proposed shape:

```
/audio/voice/p2p/12D3KooW...        # preset (tone set) is the "channel"; both sides must match
/audio/ultrasonic/p2p/12D3KooW...
```

There is no addressing below the PeerId: in a room, "dialing" is addressing frames to a peer. The link header carries a short destination tag (for example 2 bytes of the PeerId's hash) for handshake frames and a 1-byte connection id after, the way Reticulum uses 16-byte truncated hashes. The full key in the handshake resolves tag collisions.

## 3. Sharing a half-duplex room

| Scheme | How it works | Fit for a room of phones |
|---|---|---|
| p-persistent CSMA (AX.25, KISS) | Listen; when clear, transmit with probability p, else wait a slot. KISS defaults: p = 0.25, slot 100 ms, TXDELAY 500 ms ([KISS](https://www.ax25.net/kiss.aspx)) | **Good.** We can carrier-sense: the demodulator already scores tone energy, so "band busy" is cheap. No hidden terminals in one room (mostly) |
| AX.25 priority slot (T101 PRIACK) | First slot after the channel clears is reserved for ACKs and digipeats ([AX.25 2.2](https://www.ax25.net/AX25.2.2-Jul%2098-2.pdf), s6.7.1) | **Take this idea.** The expected responder answers immediately; everyone else waits at least one slot |
| Slotted ALOHA | Transmit only at slot boundaries | Poor: needs shared clocks, and our frames vary from 2 to 21 s |
| TDMA | Fixed time slots per station | Poor: needs a coordinator and membership; wastes airtime when idle |
| Token passing | Only the token holder talks | Overkill for a room; fragile when the holder walks away |
| ARDOP / VARA / PACTOR session ARQ | Two stations alternate as ISS (sender) and IRS (receiver); every ISS burst is answered by an ACK/NAK that also reports quality; BREAK hands the turn over ([ARDOP spec](https://winlink.org/sites/default/files/downloads/_ardop_specification.pdf), [host interface](https://winlink.org/sites/default/files/downloads/_ardop_tnc_interface_spec.pdf)) | **Good model inside one connection**: turn-taking with piggybacked ACKs and an "over" flag |
| STANAG 5066 | Selective-repeat ARQ in the data transfer sublayer, window up to 128 D_PDUs, ACK-only and DATA-ACK PDUs, works half-duplex ([Annex C](http://www.n2ckh.com/MARS_ALE_FORUM/S5066AnnexC_v1_2.pdf)) | Good reference for frame formats; heavier than we need |
| Reticulum | Link request / proof / RTT, then per-packet proofs; runs over KISS soundmodems | Good reference for handshake size and keepalive budget |

Recommendation: **listen-before-talk p-persistent CSMA between conversations, ARDOP-style turn-taking within a conversation.** A transmission ends with an "over" bit; the addressed peer answers in the priority slot; others back off. Collisions are still possible and show up as lost frames, which section 4 handles. VARA and PACTOR internals are proprietary (**UNVERIFIED** beyond their public descriptions).

## 4. Reliability: ARQ vs FEC

- Keep the per-frame RS + CRC we have (that is type-I hybrid ARQ: FEC fixes most errors, ARQ fixes the rest).
- **Stop-and-wait per frame is too expensive** here: each ACK is a full transmission (at least 2.16 s + guard). Use **selective repeat over bursts**: a transmission may carry several frames; the reply carries an ACK bitmap for them, piggybacked on reply data (the handshake msg 2 is the ACK of msg 1). This is what ARDOP and STANAG 5066 do.
- Fewer frames matters more than fewer bytes: with per-frame success 0.9, an 11-frame stock handshake is clean only 31% of the time; a 2-frame one 81% of the time.
- Timeout: expected reply airtime + 2 slots + guard. Since our frame header carries the length, the receiver knows exactly when a burst ends.
- The fountain code in `src/broadcast.ts` is the right tool for one-to-many (no ACKs possible) and the wrong one for a connection, where the receiver can just say what it is missing.
- Turnaround time on phones (speaker latency, mic AGC recovery after our own playback) is the number most worth measuring next (**UNVERIFIED**; the 0.5 s above is a placeholder).

## 5. Presence and liveness

Today: an unsigned 8-byte challenge is broadcast, and later signed messages echo it (`src/protocol.ts`, threat T3). Once two-way exists:

- **The handshake is the presence proof.** In the signed handshake, the listener signs a transcript that includes the dialer's fresh nonce and ephemeral key, and vice versa. A replayed recording cannot do that. This is mutual, immediate, and costs nothing extra.
- **libp2p ping** ([spec](https://github.com/libp2p/specs/blob/master/ping/ping.md): 32 random bytes echoed on `/ipfs/ping/1.0.0`) inside the authenticated connection proves the session holder is still there. At our rates make it 8 bytes on a pre-negotiated id, and only on demand, never periodic.
- **Better framing: presence is "last authenticated round trip at time T", a property of a connection,** not a flag on a message. The UI can show "heard 12 s ago, two-way". Keep the one-way challenge for broadcast mode, where many listeners cannot all answer.
- Limits stay as in T3: a live relay (someone forwarding audio over a phone call) passes any challenge-response. Acoustic distance bounding (speed of sound, about 2.9 ms/m) could bound how far away the responder is, but needs symbol-level response timing, not multi-second frames. Idea only, **UNVERIFIED** as practical.

## 6. Recommended architecture

```
libp2p Connection (registrar, handlers, connection manager)   <- unchanged libp2p
  audiomux: 1-byte header, protocol id pre-negotiated per stream   (StreamMuxerFactory)
  audio handshake: signed ephemeral X25519, optional AEAD (ham mode: MAC only)
  AudioTransport / Listener: /audio/<preset>/p2p/<id>; upgrader(skipEncryption, remotePeer, muxerFactory)
  link: fragmentation, selective-repeat ARQ with piggybacked ACK bitmaps, turn-taking, CSMA
  modem: existing MFSK frames (RS + CRC), 235-byte payload
```

PeerRecord broadcast stays as discovery, now advertising `/audio/voice/p2p/<id>` so `peer:discovery` leads straight to an audio dial.

### Phased prototype

| Phase | Build | Done when | Expected time to first byte |
|---|---|---|---|
| 0 | `AudioByteLink`: fragmentation, selective-repeat ARQ, turn-taking, over the simulated room in `test/libp2p.test.ts` (`air()`) | Two endpoints exchange 1 KB reliably with 20% frame loss in sim | n/a |
| 1 | `AudioTransport` + `Listener` + `MultiaddrConnection` on top of phase 0, **stock upgrader**: Noise + `yamux({ enableKeepAlive: false })`, no identify | Two js-libp2p nodes in Node dial `/audio/voice/p2p/<id>` and echo on a protocol; then two browsers over the air | **about 95-110 s** at 10 B/s, 40-47 s at 25 B/s (measured byte counts) |
| 2 | `audiomux` muxer factory with pre-negotiated protocol ids; pass `muxerFactory` | Same test, no multistream bytes on air | about 60-70 s |
| 3 | Transport-owned signed handshake with 0-RTT data, `skipEncryption: true`; ham mode flag | Mutual auth verified, tamper and replay tests pass, threat model updated | **about 26 s** at 10 B/s, about 11 s at 25 B/s |
| 4 | CSMA + priority slot; 3-4 phones in one room; presence from last round trip | Two concurrent connections in one room without starving | per connection as above, plus backoff |
| 5 | Faster modem preset (25 B/s target) tuned on the scorecard | Scorecard reverb cell not worse than today | about 11 s |

Phase 1 is the honest first milestone: it proves "real libp2p transport" with zero libp2p changes, and the measured cost is the baseline every later phase is scored against (add it to the scorecard). Phase 3 needs a crypto review before anyone relies on it.

## Open questions

- Real turnaround time and AGC recovery on iOS Safari and Android Chrome after playing our own tones.
- Whether to propose the compact handshake upstream as a libp2p spec (a "low-bandwidth transport handshake") or keep it transport-internal, as WebRTC does.
- How many concurrent connections a room can carry before CSMA collisions dominate (simulate in the scorecard).
