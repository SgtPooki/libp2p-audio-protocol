# Content broadcast: getting a CID's data to listeners, then to their neighbors

Design question (project owner, 2026-10-28): "If someone broadcasts a CID with the latest disaster recovery instructions and the broadcaster is the only one with the data, how do listeners get the data? A bunch of listeners should be able to download the data by listening, and then add repeaters to distribute it to other listeners over a wider range."

Short answer: broadcast the bytes, not just the CID. Send a small signed pointer (name, sequence, expiry, CID, length) plus the content itself as fountain-coded chunks on a loop. Listeners verify the decoded bytes against the CID, so after that the bytes are trustworthy no matter who relayed them. Any listener that holds verified content can become a repeater, sending its own fresh coded chunks under suppression and airtime rules. The CID ties it all together: the content can be checked by any IPFS node and moved over any other link later.

Items marked **UNVERIFIED** were not confirmed from a primary source. Numbers marked **measured** were run on this repo or this machine on 2026-10-28.

## 1. Prior art for one-way content delivery

| System | How content reaches receivers with no back channel | What we take |
|---|---|---|
| FLUTE over ALC ([RFC 6726](https://www.rfc-editor.org/rfc/rfc6726.html), [RFC 5775](https://www.rfc-editor.org/rfc/rfc5775.html)) | Files are ALC objects with a TOI. A File Delivery Table (FDT, sent as TOI 0, with an expiry) maps TOIs to names, sizes and FEC parameters. "FLUTE provides reliability using the FEC building block" and "does not require connectivity from receivers to a sender". | A small, separately repeated manifest with an expiry, plus FEC-coded objects. Our signed pointer plays the FDT role. |
| DVB data/object carousels ([ETSI EN 301 192](https://www.etsi.org/deliver/etsi_en/301100_301199/301192/01.08.01_60/en_301192v010801p.pdf)) | DSM-CC modules split into blocks and sent periodically. `DownloadInfoIndication` describes the modules of a group; `DownloadDataBlock` carries the data. Object carousels add a file-system tree on top. | Carousel = loop forever; a description message separate from the data blocks. Giving important modules a higher repeat rate is common practice but was not checked in the spec text (**UNVERIFIED**). |
| ATSC 3.0 ROUTE ([A/331:2025-06](https://www.atsc.org/wp-content/uploads/2025/06/A331-2025-06-Signaling-Delivery-Sync-FEC.pdf)) | ROUTE runs on ALC/LCT like FLUTE, adds an Extended FDT, and carries non-real-time files (apps, emergency alert content) as well as DASH media, with AL-FEC. | Broadcast TV already ships emergency files this way: object delivery plus FEC plus signaling, no return path. |
| Othernet / Outernet ([Wikipedia](https://en.wikipedia.org/wiki/Othernet), [rtl-sdr.com](https://www.rtl-sdr.com/video-about-receiving-the-othernet-satellite-data-service-free-aprs-news-weather/)) | One-way satellite datacast, about 20 kbit/s (~200 MB/day), curated news, weather and Wikipedia pages. The receiver caches and serves the content to phones over its own Wi-Fi in a browser. Secondary sources only; whether it still runs in 2026 is **UNVERIFIED**. | A receiver becomes a local server. A listener that decoded the content can also serve it over local Wi-Fi/HTTP, not only re-sing it. |
| NOAA Weather Radio / EAS ([47 CFR 11.31](https://www.law.cornell.edu/cfr/text/47/11.31), [NWS](https://www.weather.gov/nwr/nwrsame)) | SAME header sent 3 times, then voice; ~40 miles per transmitter. [47 CFR 11.45](https://www.law.cornell.edu/cfr/text/47/11.45) forbids reusing EAS codes or tones. | Repeat the short pointer several times; never mimic EAS (already in `notes/avenues.md`). |
| APRS bulletins ([APRS101 ch. 14](https://www.aprs.org/doc/APRS101.PDF), [APRS 1.0 draft](https://web.tapr.org/software_library/aprs/aprsspec/spec/aprs100/APRSProt.pdf), [APRSdos notes](http://www.aprs.net/vm/DOS/OPS.HTM)) | `BLNn` bulletins, up to 67 characters, never acked. The 1.0 draft says every 20 min for 4 h; announcements hourly for 4 days. Retransmits decay. A newer `BLNx` replaces the old one at every station. | A decaying repeat schedule, and "newer replaces older by name" (our name + sequence). Digipeaters relay but do not check content. |
| Winlink | Store-and-forward radio email over VARA, Pactor, ARDOP, packet. winlink.org returned 403 earlier, so details are **UNVERIFIED**. | Email-shaped, point-to-point. Not a fit for broadcast. |
| DTN Bundle Protocol v7 ([RFC 9171](https://www.rfc-editor.org/rfc/rfc9171.html)) | Store-and-forward bundles. Lifetime is when "the bundle's payload will no longer be useful". The Hop Count block is "mainly intended as a safety mechanism". Appendix A: BPv7 "migrates custody transfer to the bundle-in-bundle encapsulation specification". | Signed expiry bounds the life of content and relay. Custody transfer needs acks, so it does not fit a one-way channel. |
| Epidemic routing ([Vahdat and Becker, Duke CS-2000-06](http://issg.cs.duke.edu/epidemic/)) | Nodes buffer messages, exchange summary vectors on contact, request what they lack; unique message IDs; a max hop count trades delivery for resources. | Unique IDs (our CID) and buffering. The summary-vector exchange needs two-way contact; our one-way version just pushes. |
| Meshtastic managed flooding ([mesh algorithm](https://meshtastic.org/docs/overview/mesh-algo/)) | Every node rebroadcasts until the 3-bit HopLimit (max 7) runs out. A node waits a random number of slots from a contention window that is small for low SNR, so far nodes go first; if it hears someone else rebroadcast, it stays silent. ROUTER roles always rebroadcast. Default hop limit 3 per [Austin Mesh](https://www.austinmesh.org/about/meshcore-vs-meshtastic/) (secondary). | Listen-then-suppress with a random delay biased toward the farthest receivers. |
| MeshCore ([docs FAQ](https://docs.meshcore.io/faq/), [CTMesh setup](https://ctmesh.org/repeater-setup)) | Only repeater nodes relay, clients never do. Floods until a learned path exists; repeaters cap floods with `flood.max` (0-64). Mostly secondary sources (**UNVERIFIED** in firmware). | Repeating is an explicit role chosen by the owner, not automatic for every listener. |
| Briar BSP ([ETH report](https://ethz.ch/content/dam/ethz/special-interest/infk/inst-infsec/appliedcrypto/education/theses/report_YuanmingSong.pdf), [briar-devel 2014](https://sourceforge.net/p/briar/mailman/briar-devel/thread/540F0702.3060303@briarproject.org/)) | Records ACK, MESSAGE, OFFER, REQUEST. In high-latency mode (USB sticks), each side "sends any blocks it doesn't know the other device has got" with no offer or request. The official BSP.md returned 403 (**UNVERIFIED** against the spec). | High-latency mode is our case: push everything, use acks only if a back channel shows up. |
| Bridgefy ([Albrecht et al., CT-RSA 2021](https://eprint.iacr.org/2021/214)) | Protest mesh app. Found to offer "no authenticity", let anyone "impersonate anyone to anyone", and let one crafted message shut the network down. | Verify before relaying, and harden parsers. A relay must never amplify unverified bytes. |

The pattern is consistent: one-way delivery is **manifest + FEC-coded objects on a carousel + expiry**. Relay meshes add **dedupe by ID, random backoff, suppression when others already relayed, and a bound on spread**.

## 2. IPFS/IPLD building blocks

- **CID.** A CIDv1 with `raw` codec (0x55) and sha2-256 is 36 bytes and is just the hash of the bytes. Per the [UnixFS spec](https://specs.ipfs.tech/unixfs/), "Single-block files SHOULD prefer the raw codec (0x55) over dag-pb for the canonical CID." A 2 KB notice is one raw block, so its CID verifies the whole file directly. Kubo should give the same CID with `ipfs add --cid-version 1 --raw-leaves` for files under the chunk size (**UNVERIFIED**, check with kubo before relying on it).
- **Bigger content.** Multi-block UnixFS files are a `dag-pb` root that lists child CIDs and sizes; leaves can be raw blocks. Spec guidance is 256 KiB or 1 MiB chunks, with decoders required to handle 2 MiB. Those sizes are for the internet. On air, a block should match our chunk size (60-200 bytes), which costs ~40 bytes of root per link. That is a lot of overhead, so multi-block only pays off for content well beyond 1 KB that needs partial verification (see section 4).
- **CAR files** ([CARv1](https://ipld.io/specs/transport/car/carv1/)): a header with roots, then `(varint, CID, block)` sections. CARv1 itself has no verification; it "must be performed externally". The [trustless gateway spec](https://specs.ipfs.tech/http-gateways/trustless-gateway/) gives the rule we follow: clients MUST verify "that the digest in the CID's Multihash matches the digest of the block payload" and MUST NOT trust CAR order. A listener with internet later can export what it heard as a CAR and anyone can check it.
- **Verifying blocks from untrusted repeaters.** The signed pointer binds the broadcaster's key to the root CID. From then on, every block is checked by hash: a root block against the root CID, and each child against the CID listed in its verified parent. Who relayed a block does not matter, so repeaters need no keys and no trust.
- **IPNS** ([record spec](https://specs.ipfs.tech/ipns/ipns-record/)): a signed record whose V2 CBOR `data` holds `Value` (the path), `Validity` (RFC 3339 expiry), `ValidityType` 0, `Sequence` (starts at 0, higher wins) and `TTL`, signed over `ipns-signature:` + the CBOR bytes, up to 10 KiB. It is exactly "a stable name pointing at the latest CID, with sequence and expiry". My estimate for a V2-only record with an Ed25519 name is ~250 bytes, and ~400 with the V1 compatibility fields (**UNVERIFIED**, measure it). That is more than one 235-byte frame, so it would go out through the existing multi-frame `broadcast()` path.
- **Why bitswap does not fit.** [Bitswap](https://specs.ipfs.tech/bitswap-protocol/) is message-based, but a client sends a wantlist and the server answers it. On a one-way channel nobody can send a want, and with many listeners the wants would collide on air anyway. The broadcast-friendly alternative is a **push carousel of CID-addressed blocks**, a CAR on a loop where the sender picks order and repeat rates, verified block by block with the trustless gateway rules. Bitswap stays useful at the edge: a listener who reaches any IP network can fetch the same CID normally.

## 3. Repeaters

### Becoming a repeater safely

A listener relays content only if all of these hold:

1. **Opted in.** Repeating is a setting, off by default (the MeshCore model). Phones listening in a pocket should not start making noise.
2. **Trusted publisher.** The pointer is signed by a key on the repeater's allowlist, for example the county key printed on a poster (threat model T11). Without this, every repeater amplifies spam (T9).
3. **Verified.** The repeater has decoded the content and the hash matches the CID. It never forwards coded chunks it has not decoded. Recoding partial RLNC state, which network coding allows in principle, is out because nobody can verify it.
4. **Current.** The pointer is not past its signed `validUntil`, and its sequence is the highest seen for that `(key, name)`. A newer sequence immediately replaces the older content in the relay queue, as with APRS `BLNx`.
5. **Within budget.** Each repeater spends a bounded airtime per CID (for example 3 full loops, then decaying like APRS bulletins) and a bounded share of total airtime (for example 30%).

**Hop limit: none in v1, on purpose.** Meshtastic needs a hop limit because each packet is forwarded as-is and has no other end of life. Here, dedupe by CID, the per-repeater airtime budget and the signed expiry already end the spread, and disaster instructions should reach as far as they can until they expire (the DTN lifetime model). A hop count would have to sit outside the signature, so anyone could reset it anyway. If scoped spread is ever needed, add one unsigned hop byte to the relay framing and accept that it is advisory.

### Not everyone talking at once

| Tool | How | Cost |
|---|---|---|
| Trickle suppression ([RFC 6206](https://www.rfc-editor.org/rfc/rfc6206.html)) | Each repeater picks a random time in the second half of an interval I. If it has already heard k transmissions of this CID (k = 1 or 2) in the interval, it skips. I doubles up to a maximum while things are consistent and resets to the minimum when a newer sequence for the name appears. Same idea as Meshtastic's listen-and-suppress, with backoff built in. | Slower spread at the edges; k tunes redundancy |
| Distance bias | Like Meshtastic's contention window: listeners that heard the source weakly (low SNR, many RS corrections) wait less, because they are likely at the edge and add the most new coverage. | Needs an SNR estimate from the demodulator |
| Listen-before-talk + random backoff | Before each frame, check in-band mic energy; if busy, back off randomly. Already ranked step 2 in `docs/roadmap.md`. | No airtime cost |
| Distinct chunk indices | Repeaters start `chunks()` at a random index ≥ K, not at 0. A listener hearing the source and a repeater then gets innovative chunks instead of duplicates. One-line change; see section 4. | None |
| Time slots | If the source announces a schedule in its pointer (for example "source in even minutes"), repeaters take the gaps. Needs clocks within a few seconds. | Halves source airtime |
| Preset/frequency separation | Repeaters on a second tone set (for example `voice` 1000-2500 Hz for the source, a 400-950 Hz set for repeaters) so both can sound at once. Listeners must demodulate two presets, roughly doubling CPU. | CPU; voice-band width through radios |
| Simulcast | Several speakers sending the same chunk index at the same instant. Over audio, offsets of a few ms probably look like reverb to the differential detector, but larger offsets break symbols. Land mobile radio simulcast needs tight timing alignment (general knowledge, **UNVERIFIED**). | Experimental; needs a sim row before any build |

### Measuring coverage growth

In simulation (extend `bench/scorecard.ts`): place N listeners in a 2D area with a path-loss model that maps distance to the existing SNR rows, so listener i hears node j at an SNR from distance and gets a frame error rate from the current scorecard curves. Track per listener the time of verified decode. Report T50/T90 (time for 50%/90% of listeners to hold verified content), total airtime spent, and collisions. In the field, presence challenges (`challenge()`) already let a listener count who is around, and a "have CID x" reply on a back channel could count coverage directly.

## 4. Fountain codes over CID-addressed content

The existing `chunks()`/`ChunkCollector` code in `src/broadcast.ts` is systematic RLNC over GF(256): chunk i < K is block i in the clear, later chunks are random mixes. Coded chunks carry no hash of their own, so they cannot be verified one by one. Only reconstructed data can.

- **Verify after decode, by hash.** Today the decoded message is checked with a 32-bit FNV-1a, then by the envelope signature. For content, decode then sha2-256 against the CID, which the signed pointer vouches for. A forged chunk can then never yield wrong content (T15 still holds), only a failed decode.
- **Pollution.** One forged coded chunk corrupts every block it touches, and you cannot tell which chunk was bad. Today's rule (on a hash mismatch, start over from fresh chunks) stays. For content above ~1 KB, a better rule: make each DAG block exactly one chunk's data size. Then systematic chunks (i < K) are whole blocks, each checkable against the child CIDs in the root. Keep verified systematic blocks, throw away only the coded rows, and re-collect. This is the one reason to go multi-block on air.
- **msgId.** Use the first 4 bytes of the CID's digest as the chunk `msgId`, so chunks can be matched to a pointer heard earlier or later. Chunks with no pointer yet are already buffered (32 pending messages cap).
- **Repeaters re-encode, not forward.** A repeater with verified content runs `chunks()` itself, starting at a random index ≥ K. Every index ≥ K is a fresh random combination, so listeners collect useful chunks from the source and repeaters together. Coefficients derive from `(msgId, index)`, so every sender of the same content produces compatible chunks.
- **RaptorQ** ([RFC 6330](https://www.rfc-editor.org/rfc/rfc6330.html), up to 56403 source symbols per block) is the standard choice for large K. Our RLNC decode is O(K^2) per chunk and is fine up to a few hundred chunks (a 30-minute broadcast of 60-byte chunks is ~300). Keep RLNC; revisit only if K grows past ~1000.

## 5. Practical budget

**Measured:** voice preset 10.2 B/s for 117-byte frames (`bench/RESULTS.md`). Each frame also costs ~22 bytes of RS parity, CRC and length, plus a 0.4 s preamble. So 60-byte chunks (69 bytes with header) carry ~7.8 content B/s, and 200-byte chunks ~10.6 B/s. Larger frames, though, suffer more from clock drift and dropouts (`docs/roadmap.md` section 2).

**Measured, compression** (a 1,963-byte flood notice, Node 26 zlib): brotli q11 text mode 873 bytes (2.25x; brotli has a built-in English dictionary, [RFC 7932](https://www.rfc-editor.org/rfc/rfc7932.html)); deflate 1,128; zstd level 19 1,152 with no dictionary. On a 500-byte excerpt: brotli 267, zstd 372. Zstd supports trained dictionaries selected by a `Dictionary_ID` in the frame header ([RFC 8878](https://www.rfc-editor.org/rfc/rfc8878.html)), but the dictionary has to be distributed out of band (preloaded in the app). The gain for alert text was not measured. **Use brotli now**; try a trained zstd dictionary only if a corpus of real alerts exists.

**Measured, pointer size:** a signed envelope from this repo is 112 bytes plus payload. A ~80-byte pointer payload (section 6) gives ~192 bytes, one frame (~19 s).

Content that fits at zero loss, after one pointer frame. The 25 B/s column is a hypothetical faster mode (shorter symbols or more tones), not measured:

| Airtime | 10 B/s mode: content bytes | ≈ plain text (x2.25) | 25 B/s mode: content bytes | ≈ plain text |
|---|---|---|---|---|
| 1 min | ~320 B | ~700 B: a headline and 3-4 key lines | ~1.0 KB | ~2.3 KB: the whole 2 KB notice |
| 5 min | ~2.2 KB | ~5 KB: a full notice with shelter list | ~5.7 KB | ~13 KB |
| 30 min | ~14 KB | ~31 KB: a small handbook | ~35 KB | ~80 KB |

With frame loss p, the time scales by about 1/(1-p): 20% loss costs 25% more time. The 2 KB notice (873 bytes brotli, K = 15 chunks of 60 bytes) needs ~2.3 min of clean airtime at 10 B/s.

**Most important content first.** Do not send one big blob. Split the content into priority generations, each its own CID with its own fountain stream:

1. **Headline**: up to ~60 bytes of text in the pointer itself ("Boil water. Shelters: N High, Community Ctr. Fairgrounds CLOSED."). It arrives in ~19 s and is signed.
2. **Core**: the 2 KB notice, ~2-3 min.
3. **Extras**: maps as text, phone lists, the full handbook.

Interleave the carousel by weight (for example core chunks 3 times as often as extras) so a late joiner finishes the core first. A dag-pb root linking the generations gives one CID for the whole bundle, which matters for interop, not for listeners.

**Repair with a back channel.** FLUTE gives up on acks entirely; NORM ([RFC 5740](https://www.rfc-editor.org/rfc/rfc5740.html)) adds NACKs. Because the code is rateless, a repair request never needs to name missing chunks, just "need about n more for msgId x": `[0xC2][msgId u32][n u8]`, 6 bytes, unsigned (like `challenge()`, it only asks a question). The source or any repeater answers with n·1.1 fresh coded chunks. Each listener waits a random delay and stays quiet if it hears an equal or larger NEED (Trickle again), and senders rate-limit NEED-triggered airtime so a flood of requests cannot take over the channel.

## 6. Protocol sketch for this repo

**What is signed, what is content-addressed:**

| Thing | Protection | Carried as |
|---|---|---|
| Pointer (`ContentPointer`) | Ed25519 signed envelope, new domain `libp2p-audio-content`, private-use codec `0x300002` | One frame, repeated (EAS-style 3x at start, then every few minutes in the carousel) |
| Content bytes | CID (sha2-256) in the signed pointer | Fountain chunks, existing `0xB0` frame: `[0xB0][msgId = CID digest[0..4]][encLen u16][index u16][data]` |
| IPNS record (optional, phase 3) | Its own signature | Multi-frame `broadcast()`, for gateways and IPFS interop |
| NEED repair request | Unsigned, harmless | `[0xC2][msgId u32][n u8]` |

**`ContentPointer` payload** (fixed binary like `AudioMessage`; ~80 bytes plus the headline):

```
[version=1][sentAt u48 ms][validFor u32 s][nameLen u8][name][cid bytes (36)]
[len u32: decoded size][encoding u8: 0 identity, 1 brotli][encLen u16][priority u8][headline utf-8]
```

`sentAt` doubles as the sequence for `(key, name)`, as in `AudioMessage`, and `validUntil = sentAt + validFor`. Existing replay rules apply. One addition: the pointer `maxAge` should be its own `validFor`, not the 1 h default, which answers the threat model question about per-type max age.

**Listener:** verify the pointer, then collect chunks by msgId. On decode: if `encLen` does not match, drop. Decompress with a hard cap of `len` bytes (decompression-bomb guard), then sha2-256 must equal the CID. Emit `content { from, name, cid, bytes, sentAt, validUntil }`. Store `(cid -> bytes)` so the content can be exported as a CAR or served over local HTTP later (the Othernet pattern).

**Repeater:** relays the pointer frame unchanged (it is signed) and its own chunks of the verified encoded bytes, subject to the five rules in section 3, Trickle suppression, listen-before-talk, and random start indices.

**Threat model additions to propose** (not edited here): relay amplification of untrusted publishers (mitigated by allowlist); decompression bomb (cap by signed `len`); stale pointer relay (signed `validFor` + highest `sentAt` per name); NEED flooding (rate limit, accepted as jamming T7); a repeater that is honest but has the wrong sequence (newer pointer wins).

### Phased build plan

| Phase | Build | Done when |
|---|---|---|
| 0 | Scorecard rows for effective content rate at chunk sizes 60/120/200 under the existing noise, drift and dropout rows | We know which block size to pick |
| 1 | `publish(bytes, { name, validFor, headline })` and the `content` event; raw-block CID, brotli, pointer, chunks with msgId from the CID, sha2-256 check. Reuses `chunks`/`ChunkCollector` with a pluggable check instead of FNV. | 2 KB notice decodes in sim and over the air between two devices; forged chunks and forged pointers never produce content |
| 2 | Repeater mode: allowlist, verify-then-relay, random start index, Trickle, listen-before-talk, airtime budget. Multi-node simulator in the scorecard. | T90 improves with repeaters at a distance the source alone cannot cover |
| 3 | Priority generations, multi-block DAG with chunk-sized blocks for partial verification, CAR export, optional IPNS record, kubo CID cross-check | A listener's CAR verifies in kubo; same CID as `ipfs add` |
| 4 | NEED repair, audio <-> Meshtastic gateway (pointer + chunks fit a 233-byte packet), real radios | Repair cuts T90 when a back channel exists; content crosses audio -> LoRa -> audio and still verifies |

### Scorecard metrics that prove it works

| Metric | Setup | Target to beat |
|---|---|---|
| T50 / T90 to verified content | 2 KB notice (873 B brotli), N = 20 listeners spread over 1x, 2x, 4x the source's 90%-frame-success radius; 0, 1, 3 repeaters | Without repeaters, listeners beyond 1x never finish; with repeaters, T90 at 2x within ~3x the 1x time |
| Airtime per listener reached | Total transmitted seconds / listeners that decoded | Should fall as N grows (broadcast advantage) |
| Collisions | Frames lost to overlapping senders, with and without Trickle + listen-before-talk | Under 10% of frames |
| Late-join overhead | Chunks heard beyond K before decode, joining at a random time | Under 1.2 K at 0% loss (RLNC should be close to K) |
| False accepts | Injector sends forged chunks (10%, 30%) and forged pointers | Always 0; decode time grows by under 2x at 10% |
| Headline latency | Time to the signed headline from a random join point | Under one pointer repeat interval + 19 s |
| Repair gain (phase 4) | Same as T90, with a back channel and NEED | T90 down by a measured amount, NEED airtime under 5% |

## Open questions

- Should the pointer be an IPNS record from the start (interop, but ~250+ bytes, multi-frame) or our compact pointer with IPNS as a phase 3 add-on? This note recommends the compact pointer first, because one frame matters on a 10 B/s link and on a Meshtastic packet.
- Who is on the default allowlist? Without one, repeating is off. The "how does an official broadcaster publish its PeerId offline" question in the threat model blocks real deployment.
- Do FRS/GMRS rules allow repeaters retransmitting data? Not researched (**UNVERIFIED**; see `notes/avenues.md`).
