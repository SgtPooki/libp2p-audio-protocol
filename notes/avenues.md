# Avenues for libp2p over audio

Where this project could go next, researched October 2026.

The repo has a working MFSK-16 modem (16 tones 1000-2500 Hz, 40 ms symbols, about 12 bytes/s, Reed-Solomon, max 239-byte frames) carrying libp2p signed envelopes: `PeerRecord`s for discovery and short signed text. An announce takes about 10 s on air. The vision is disaster recovery and off-grid comms: radio, loudspeakers, data hidden in other audio, and content addressing (broadcast a CID, fetch it over whatever link exists).

The thread that ties every avenue together: **a signed envelope is just bytes**. If frames stay small (under about 220 bytes), the same envelope can ride acoustic MFSK, a LoRa mesh packet, an AX.25 UI frame, or a Reticulum plain packet unchanged, and any listener can verify the PeerId that signed it. The project's leverage is the envelope format plus the "signed CID" idea, not the modem.

Items marked **UNVERIFIED** could not be confirmed from a primary source during this research.

## Avenues at a glance

| Avenue | What it is | Fit with this project | Effort | Link |
|---|---|---|---|---|
| Signed CID broadcast | New envelope type: "fetch this CID", signed by a PeerId | Core of the vision; every other avenue carries it | Low | [signed envelopes spec](https://github.com/libp2p/specs/blob/master/RFC/0002-signed-envelopes.md) |
| meshkit / Meshtastic / MeshCore bridge | meshkit is a getting-started guide for LoRa meshes (MeshCore and Meshtastic) | Gateway re-emits envelopes as LoRa packets; 233-byte payload is close to our 239 | Medium | [meshkit.org](https://www.meshkit.org/) |
| Reticulum | Crypto-first network stack over LoRa, packet radio, KISS soundmodems, pipes | Our modem could be a Reticulum interface; or envelopes ride Reticulum plain packets | Medium | [reticulum.network](https://reticulum.network/) |
| AX.25 / APRS via Dire Wolf | 1200 bps AFSK packet radio, software TNC | Envelopes fit one UI frame; reaches existing ham infrastructure | Medium (needs licensed operator) | [Dire Wolf](https://github.com/wb2osz/direwolf) |
| Real radio audio path (FM handheld, ham VHF) | Feed our MFSK tones through a voice radio | Already designed for the 300-3000 Hz voice band; roadmap item | Low | README roadmap |
| JS8Call / FT8 | Weak-signal HF keyboard modes | Too slow for 150-byte envelopes; only good for a short pointer | High, low payoff | [js8call.com](https://js8call.com/) |
| VARA / Winlink | Fast HF/FM modem; radio email system | Could carry envelopes as data, but VARA is paid and Winlink is email-shaped | Medium | [VARA](https://rosmodem.wordpress.com/) |
| EAS / SAME style headers | AFSK bursts at the start of broadcast alerts | Design template for a broadcast CID burst; EAS codes themselves are off limits | Low (design only) | [47 CFR 11.31](https://www.law.cornell.edu/cfr/text/47/11.31) |
| Ultrasonic channel | 15-20 kHz data, like ggwave/LISNR/Google Nearby | Inaudible discovery, but phone and codec support is unreliable | Medium | [ggwave](https://github.com/ggerganov/ggwave) |
| Steganography in music | Echo hiding, phase coding, spread spectrum | "Data hidden in other audio"; very low rate (about 4-32 bps) | High | [Bender et al. 1996](http://bitsavers.informatik.uni-stuttgart.de/pdf/ibm/IBM_Systems_Journal/353/sectiona/bender.pdf) |

## meshkit, Meshtastic and MeshCore

**What meshkit actually is.** [meshkit.org](https://www.meshkit.org/) describes itself as "Your starting point for LoRa mesh radio". It is a guide site covering two firmware ecosystems, [MeshCore](https://github.com/meshcore-dev/MeshCore) and [Meshtastic](https://meshtastic.org/), "from first flash to a working mesh", with links to flashers and node maps. The site says nothing about ham radio, Reticulum, audio, or who runs it beyond a contact address (info@meshkit.org). So "collaborating with meshkit" in practice means collaborating with the LoRa mesh community it serves, and the integration point is Meshtastic or MeshCore, not meshkit itself.

**How an audio link plugs in.** Meshtastic data packets carry up to 233 bytes (`DATA_PAYLOAD_LEN` in `mesh.proto`, per [meshtastic-sdk protocol docs](https://github.com/meshtastic/meshtastic-sdk/blob/main/docs/protocol.md)). Apps that don't want to register can use the private port range 256-511 ([portnum docs](https://meshtastic.org/docs/development/firmware/portnum/)). A node with Wi-Fi can also bridge to MQTT ([MQTT module](https://meshtastic.org/docs/configuration/module/mqtt/)). MeshCore is MIT-licensed, has companion apps over BLE/USB/Wi-Fi with `meshcore.js` and a Python CLI, and links a "Serial KISS protocol bridge" example; its message size limit is not documented on the README (**UNVERIFIED**).

Next experiment: a "sound to LoRa gateway". A laptop runs the audio listener plus a Meshtastic node over USB. Every verified envelope it hears gets re-sent unchanged on a private portnum. A second gateway on the mesh does the reverse and plays it from a speaker. That shows a signed `PeerRecord` or CID crossing air, LoRa, and air again while still verifying end to end. Cap our envelope at about 220 bytes so it fits a Meshtastic packet with headroom.

## Reticulum

[Reticulum](https://reticulum.network/) already does much of what this project wants over terrible links. Per its [manual](https://reticulum.network/manual/understanding.html) it targets channels with "an average throughput of 5 bits per second or greater" and a 500-byte physical MTU. It uses Ed25519 for signatures and X25519 for key exchange, and it has no source addresses. Its [interfaces](https://reticulum.network/manual/interfaces.html) include RNode (LoRa), KISS and AX.25-KISS for packet TNCs, TCP to "software-based soundmodems" with KISS framing, and a `PipeInterface` that talks to any program over stdin/stdout.

Overlap and tension: Reticulum encrypts by default and says "it is not possible to establish unencrypted links". It does have a `plain` destination type that is unencrypted and never forwarded over multiple hops, meant for broadcast. That type is the natural fit for ham bands and for our signed broadcasts. The Reticulum pages don't discuss amateur radio encryption rules at all. Prior art for libp2p on these links is thin: [libp2p-lora-transport](https://github.com/RTradeLtd/libp2p-lora-transport) is an old work-in-progress Go transport with "absolutely no security", and a recent [funkpost issue](https://github.com/NiKrause/funkpost/issues/1) argues that full libp2p as a transport over LoRa is "buildable, and wrong" because of handshake round trips and identify/GossipSub chatter. That supports this repo's current design: signed envelopes as broadcasts, real connections over whatever IP link exists.

Next experiments: (a) wrap our modem as a Reticulum `PipeInterface` (bytes in on stdin, bytes out on stdout) so Reticulum and its apps can run over the acoustic link. That needs fragmentation, or a Reticulum MTU change, since our frames are 239 bytes and Reticulum assumes 500. (b) The reverse: publish libp2p envelopes as payloads to a Reticulum `plain` destination, so libp2p peers and CIDs ride an existing Reticulum mesh with no new radio code.

## Ham radio digital modes

| Mode | Facts (sourced) | Can it carry a libp2p envelope? |
|---|---|---|
| AX.25 / APRS | [Dire Wolf](https://github.com/wb2osz/direwolf) is a soundcard AX.25 TNC: 1200 bps AFSK for VHF/UHF, 300 bps for HF, 9600 G3RUH, FX.25 and IL2P FEC, KISS over TCP/serial/Bluetooth. Bell 202 tones and APRS field limits are from the [APRS 1.01 spec](http://www.aprs.org/doc/APRS101.PDF), which returned 403 (**UNVERIFIED** here). | Yes, as one raw AX.25 UI frame through Dire Wolf KISS (about 1-2 s on air). Not as an APRS "message", whose text format is short and character-based. |
| FT8 | 77-bit payload per 15 s slot, LDPC (174,91), free text up to 13 characters ([FT4/FT8 QEX paper](https://wsjt.sourceforge.io/FT4_FT8_QEX.pdf)). | No. A 150-byte envelope would need about 16 slots (4 min). |
| JS8Call | Built on the WSJT-X/FT8 engine, adds directed, relayed, store-and-forward messages ([js8call.com](https://js8call.com/)). Normal mode about 16 WPM, 50 Hz, 15 s frames ([user guide](https://js8call.com/JS8Call-improved/d6/d14/md_docs_2user__guide_2JS8Call__User__Guide.html)). | Text only and slow. Fine for a short CID or a hash pointer, not for a signature. |
| VARA | OFDM, up to 5629 bps in 2.4 kHz (HF); VARA FM claims 25,210 bps ([VARA site](https://rosmodem.wordpress.com/)). Licenses are sold; whether it is closed source is **UNVERIFIED** from that page. | Yes, as a data pipe, but proprietary. |
| Winlink | Radio email over VARA, Pactor, ARDOP, and packet. [winlink.org](https://winlink.org/) returned 403, so details are **UNVERIFIED** here. | As an attachment, but it is store-and-forward email, not broadcast. |

**Licensing (US, verified rule text).** [47 CFR 97.113(a)(4)](https://www.law.cornell.edu/cfr/text/47/97.113) prohibits "messages encoded for the purpose of obscuring their meaning, except as otherwise provided herein". [97.309(b)](https://www.law.cornell.edu/cfr/text/47/97.309) allows unspecified digital codes, but they "must not be transmitted for the purpose of obscuring the meaning of any communication", and [97.309(a)(4)](https://www.law.cornell.edu/cfr/text/47/97.309) allows any technique "whose technical characteristics have been documented publicly". The rule bans obscuring meaning, not authentication. A signed envelope is plaintext protobuf plus a signature over it, so it reads as permitted. That is an interpretation, not legal advice, and we didn't find an FCC statement that addresses signatures specifically (**UNVERIFIED**). In practice: publish the frame format, never encrypt on ham bands, and send a callsign ID (AX.25 does this for you). Since January 8, 2024, HF data is limited by 2.8 kHz bandwidth instead of 300 baud ([ARRL](https://www.arrl.org/news/bandwidth-limits-replace-symbol-rates-on-the-hf-bands-other-bands-open-for-comment), [FR 2023-26770](https://www.federalregister.gov/documents/2023/12/07/2023-26770/amateur-radio-service-rules-to-permit-greater-flexibility-in-data-communications)). Our MFSK band of about 1.6 kHz fits. Whether unlicensed services such as FRS/GMRS (Part 95) allow this kind of data was not researched (**UNVERIFIED**; check before telling people to use walkie-talkies).

Next experiment: pipe envelopes into Dire Wolf over KISS-TCP as AX.25 UI frames. Then test with a licensed operator on 2 m. Separately, play our own MFSK through a VHF FM handheld (licensed) to see whether it survives the radio's audio path, and tune `symbolSeconds`.

## Data-over-sound prior art

- **ggwave** ([GitHub](https://github.com/ggerganov/ggwave)): multi-tone FSK with Reed-Solomon, 8-16 bytes/s, audible band from 1875 Hz and ultrasonic from 15 kHz, 46.875 Hz tone spacing. It is almost the same design as ours and the same speed. That confirms the design and gives us an interop target.
- **Chirp.io**: UCL spin-out (2011), small payloads (around 50 bytes) at 10-20 ft, audible or ultrasonic. Sonos bought it in 2020 and the SDK downloads ended March 1, 2020 ([audioXpress](https://audioxpress.com/news/data-over-sound-pioneer-chirp-acquired-by-sonos), [Wikipedia](https://en.wikipedia.org/wiki/Chirp_(company))). Lesson: closed SDKs vanish. Keep the protocol open and documented.
- **Google Nearby**: used near-ultrasonic audio (DSSS, 18.5-20 kHz, low level) to share a short copresence token, according to Google's paper ["Ultrasonic Communication Using Consumer Hardware"](https://www.researchgate.net/publication/320575022_Ultrasonic_Communication_Using_Consumer_Hardware) (seen in abstract/search summary only). Ultrasound mostly does not pass through walls, which is a useful "same room" property. The current docs say Nearby Messages uses BLE and that it "is deprecated and will stop working as of December 2023" ([docs](https://developers.google.com/nearby/messages/overview)). Eddystone was BLE-only, not audio.
- **LISNR**: proprietary near-ultrasonic (16-20 kHz currently), profiles from 66.6 bps at walking-pace range up to 2000 bps at under 1 m, three channels at 16.5/18.0/19.5 kHz ([Radius overview](https://lisnr.com/ultrasonic-technology-overview-radius/)). Lesson: range trades directly against rate, and multiple frequency channels address our "multiple speakers" question.
- **Quiet.js** ([GitHub](https://github.com/quiet/quiet-js)): liquid-dsp based, with an ultrasonic profile "around the 19kHz range" and cable profiles of "at least 40 kbps". Browser lessons: Firefox resamples mic input to 32 kHz, so ultrasound can't be received there; Chrome needs HTTPS. (Its Safari notes are dated.)
- **minimodem** ([GitHub](https://github.com/kamalmostafa/minimodem)): a CLI for Bell 103, Bell 202, RTTY, TDD, NOAA SAME, and Caller-ID. Useful as a test harness and as a reference decoder for SAME and Bell 202.
- **smus.com Sonicnet** ([post](https://smus.com/ultrasonic-networking/)): high-frequency receive "does not work on all devices", since phone mics are tuned for speech and may run at lower sample rates. Phones are often send-only.

Takeaways: our audible 1-2.5 kHz band is the right default because it survives radios, phone mics, and codecs. Ultrasonic is a nice-to-have, room-scoped mode and should never be the only path. On pleasantness, none of the sources above give a usable recipe for musical encodings. The [smus.com patent on audible harmonies](https://smus.com/patents/2017%20-%20Communicating%20Data%20with%20Audible%20Harmonies.pdf) already linked in LabWeek23 notes is the closest lead (not re-read here).

## EAS / SAME as a design template

EAS headers are already data inside broadcast audio. Per [47 CFR 11.31](https://www.law.cornell.edu/cfr/text/47/11.31): AFSK at 520.83 bit/s, mark 2083.3 Hz, space 1562.5 Hz, a 16-byte `0xAB` preamble, an ASCII header `ZCZC-ORG-EEE-PSSCCC+TTTT-JJJHHMM-LLLLLLLL-` sent three times with one-second pauses, and `NNNN` end-of-message also sent three times. NOAA Weather Radio coverage typically reaches about 40 miles per transmitter ([NWS](https://www.weather.gov/nwr/nwrsame)).

Two lessons carry over directly. First, **repeat the burst three times** and decode by majority or best CRC. That is cheap robustness for one-way broadcast where nobody can ask for a retransmit. Second, keep the burst short and put it at the start of a normal voice announcement. A signed CID envelope (estimated 150-180 bytes with an Ed25519 key, a 36-byte CIDv1, and a 64-byte signature; measure it) is about 13-15 s at our rate. That's acceptable before a town-square loudspeaker announcement, or as a station ID-style tag on a community radio stream.

Hard constraint: [47 CFR 11.45](https://www.law.cornell.edu/cfr/text/47/11.45) says "No person may transmit or cause to transmit the EAS codes or Attention Signal, or a recording or simulation thereof" outside real emergencies or authorized tests. Do not reuse SAME tones or the `ZCZC` format. Borrow the structure, use our own tones.

## Steganography and watermarking

Primary source: [Bender, Gruhl, Morimoto, Lu, "Techniques for data hiding", IBM Systems Journal 1996](http://bitsavers.informatik.uni-stuttgart.de/pdf/ibm/IBM_Systems_Journal/353/sectiona/bender.pdf). Rates from the paper:

| Technique | Rate in paper | Survives speaker to mic? |
|---|---|---|
| Low-bit coding (LSB) | about 1 kbps per kHz of sampling | No, destroyed by any analog path or lossy codec |
| Phase coding | 8-32 bps | Doubtful over air; room reverb scrambles phase (our expectation, not tested) |
| Spread spectrum (DSSS) | 4 bps in their experiments | Best robustness to noise; slowest |
| Echo hiding | about 16 bps; "a slightly richer sound" | Plausible, but room echoes compete with the hidden echo (expectation) |

At 16 bps, a 160-byte signed envelope takes about 80 s of music. That's fine for a looping town-square track or a radio jingle, but too slow for interactive use. A practical hybrid: hide only a short tag (for example 8-16 bytes: a truncated CID or a key fingerprint) in the music, and send the full signed envelope over audible MFSK or another link. The ultrasonic overlay (Nearby/LISNR style) is the other "hidden" route. Be aware that FM broadcast audio and many lossy codecs low-pass around 15-16 kHz (general knowledge, **UNVERIFIED** here). That would remove an 18-20 kHz overlay on exactly the radio paths this project cares about.

Next experiment: implement echo hiding (two delays, cepstrum decode) offline on WAV files, then play it from a speaker and record on a phone. Measure bit error rate at 1 m and 5 m. Compare against a low-level (for example -20 dB under the music) MFSK overlay in our existing band with heavy FEC.

## Top 5 next experiments (ranked)

1. **Signed CID envelope + 3x repeat.** Add an envelope type `libp2p-audio-cid` (CID plus optional short text, signed). Send it three times like SAME does. Measure its size, and target 220 bytes or less so it also fits a Meshtastic packet. On receive, try to fetch the CID over any available link (HTTP gateway, libp2p, or nothing yet, and log it). This is the core of the vision and is cheap.
2. **Real radio audio path.** Play MFSK frames through a VHF/UHF FM handheld (licensed operator, callsign ID) and through a consumer FM transmitter into a radio. Record frame error rate against `symbolSeconds`. Optionally cross-check by sending the same envelope as an AX.25 UI frame through Dire Wolf KISS.
3. **Sound to LoRa gateway (meshkit community).** Rebroadcast verified envelopes unchanged on a Meshtastic private portnum (256-511), and the reverse. Demo: phone announces by sound, LoRa carries it across town, a speaker replays it, and the far listener verifies the original PeerId. Show it to the MeshCore/Meshtastic folks meshkit points to.
4. **Reticulum interop.** Either expose the acoustic modem as a Reticulum `PipeInterface` (fragment to fit the 500-byte MTU), or publish libp2p envelopes to a Reticulum `plain` destination. Either way, we plug into an existing off-grid stack instead of building routing.
5. **Echo-hiding tag in music.** Offline WAV prototype first, then over the air. Hide a short tag (truncated CID or key fingerprint) in music at about 16 bps, and send the full signed envelope by audible MFSK. Report BER against distance.

Deprioritized: JS8Call/FT8 (too slow for signatures), VARA (proprietary), ultrasonic-only modes (unreliable on phones, filtered by FM and codecs), and full libp2p connections over audio or LoRa (handshake chatter; see the funkpost analysis).
