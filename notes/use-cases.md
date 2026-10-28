# Use cases to explore

Things that are easier, more fun, or more provable because the medium is sound. Each entry says what already works, what is missing, and the catch. Numbers are from `benchmarks/RESULTS.md` and `benchmarks/OVER-THE-AIR.md` (voice preset 10 B/s at 40 ms symbols; ultrasonic at 20 ms symbols is 2x faster on a laptop, untested on phones).

## 1. Audio QR: a presenter sends a link to a whole room

A presenter tells the room "turn your volume down, open this page, allow the microphone", then pushes a URL (or any short message) to every phone at once. Like a QR code, but it reaches people who can't see the screen, works across a big hall through the PA, and arrives signed by the presenter's key.

- **Works today:** `say('https://example.com/talk')` is one signed frame: about 12 s on `voice`, about 5 s on `ultrasonic` at 20 ms. Every listening page shows it with the sender's PeerId and `✔ signed`. `broadcast()` loops it as fountain chunks for people who open the page late.
- **Missing:** a presenter page (type a URL, one big button, keep looping, count replies) and a receiver page that shows the link as a tappable card and nothing else. Receivers could answer with a tiny signed "got it" so the presenter sees a live count (one frame each; with 50 phones that needs listen-before-talk and random backoff, both in the browser link now).
- **Catch:** the PA's frequency response and room reverb: the scorecard's RT60 0.8 s row is ~55%, so loop it. Phones need the page open and the mic allowed; iOS Safari needs a real certificate.

## 2. Event presence: prove you were in the room

A venue plays a signed challenge from a loudspeaker. Phones that hear it reply with a signed message carrying the nonce, so the organizer has a list of PeerIds that were in earshot at that time. Unlike a QR code or a Wi-Fi check-in, the proof can't be forwarded as a screenshot and can't be scanned from outside the door.

- **Works today:** `challenge()` + `say()` already produce `present` (threat T3), and an open connection's handshake is a mutual, replay-proof proof of presence.
- **Missing:** a check-in page; a way for the organizer to publish its PeerId beforehand (poster, ticket, website) so attendees know who asked; many simultaneous replies (a reply slot scheme: each phone waits a random slot, 60-byte reply frames are ~7 s, so a few hundred phones need minutes or several tone bands).
- **Catch:** a live relay (someone on a phone call streaming the room audio) defeats any acoustic proof; a recording does not. Acoustic distance bounding (speed of sound) is an idea only, see `notes/two-way-transport.md`.
- **Variants:** a raffle (first N verified replies), proof of attendance tokens signed by the venue key in response to each reply, a silent roll-call in a classroom.

## 3. Disaster notices with repeaters

The original use case: a county key publishes a notice as a CID; anyone who verified it can opt in as a repeater and extend the range. See `notes/content-broadcast.md` and `benchmarks/REPEATERS.md`: 3 repeaters take a 2 KB notice from 7 of 20 listeners to all 20.

- **Missing:** publishing the official key offline (printed on a poster), priority generations (headline first), CAR export so the content verifies in kubo.

## 4. Pairing without a network

Two devices in the same room open a libp2p connection by sound (35 s phone to laptop today), exchange keys or Wi-Fi credentials, then switch to a fast transport. Being in earshot is the authorization: no codes to type, no Bluetooth pairing UI.

- **Works today:** `node.dial(heardPeer)` over `/audio`, encrypted.
- **Missing:** a "pair" protocol that hands over a Wi-Fi/WebRTC address and dials it, and a UI that explains the wait.

## 5. Radios and PA systems

Walkie-talkies, FRS/GMRS, ham (sign-only mode), the PA at a stadium, FM broadcast. The `voice` preset fits the 300-3000 Hz voice path (scorecard radio row 100%). Open: a real radio test, tuning `symbolSeconds`, legal review of data on FRS/GMRS. See `docs/roadmap.md` section 3.

## 6. Smaller ideas

- **Audio business card:** announce your PeerRecord once; the other phone has your addresses and can reach you later over the internet.
- **Signed "now playing" / set-list from a DJ booth**, or a venue broadcasting a signed schedule change to everyone present.
- **Classroom or museum guide:** a looping fountain broadcast of a page of text; walk in at any time and get it.
- **Hidden in music:** the `ultrasonic` preset under a track; the audience's phones get the link without hearing beeps (phone hardware untested).
- **Cross-device proof of co-location** for two people (both heard the same challenge from a third device).
- **Accessibility:** a screen reader gets the link as text; no camera needed, no pointing at a code.
- **Meshtastic / LoRa gateway:** a phone hears a frame and forwards it on LoRa, and back; frames fit a Meshtastic packet.

## What would make these easy to build

- A tiny receiver-only page (`examples/listen`) and a presenter page (`examples/presenter`): no chat, one job each.
- A "reply slot" helper in the service for many-to-one replies (random slot, listen-before-talk, dedupe).
- A faster default preset that phones handle (25 ms symbols, or ultrasonic once verified on phones), since every use case above is bounded by seconds per frame.
