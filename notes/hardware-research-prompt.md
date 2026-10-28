# Research prompt: hardware to test libp2p-audio-protocol over LoRa and real radios

Paste this into a research agent. Fill in the two brackets first.

---

I maintain libp2p-audio-protocol (https://github.com/sgtpooki/libp2p-audio-protocol): js-libp2p over sound. It has a 235-byte frame format (signed envelopes, fountain-coded content chunks, and a small ARQ link layer for real libp2p connections), and the only audio-specific layer is the modem. I want to carry those same frames over LoRa mesh radios and through handheld voice radios, and I need to know what hardware to buy. I am in [COUNTRY/REGION] and my budget for a first kit is about [BUDGET]. I write TypeScript; the app runs in a browser (Chrome) and in Node.

Research and recommend what to buy, with reasons and current prices and links. Verify facts against primary sources (manufacturer pages, Meshtastic and MeshCore docs, the meshtastic.js repo), mark anything you could not verify, and prefer things in stock now.

## Part A: LoRa mesh (Meshtastic and MeshCore, the radios meshkit.org teaches)

1. Which boards, for a first kit of 3 nodes (two endpoints plus one repeater candidate)? Compare at least: Heltec V3 / V4, LilyGO T-Beam and T-Echo, RAK WisBlock (RAK4631), Seeed SenseCAP T1000-E and Card Tracker, Station G2, and any newer board the community recommends in 2026. For each: chip (nRF52 vs ESP32: battery life, BLE/Wi-Fi), band for my region (915 vs 868 MHz), antenna included or not, GPS, battery, case, price.
2. How a browser or Node app talks to the node to send and receive raw packets on a private app port (PortNum PRIVATE_APP / 256-511): Web Bluetooth, Web Serial, Wi-Fi HTTP, and which boards support which. Confirm the maximum payload bytes per Meshtastic packet (I believe ~233 B; I need to carry frames up to 235 B, so tell me the exact number and whether it depends on the modem preset or encryption) and the airtime of a max packet at the default preset (LongFast) and at faster presets.
3. Duty cycle and legal limits for data on LoRa in my region, and Meshtastic's own airtime fairness rules, so I know how many 235-byte frames per minute are realistic.
4. MeshCore: which of the same boards run it, how a browser or script talks to it, and whether its packet payload is bigger or smaller than Meshtastic's.
5. A solar + battery repeater setup for a park test (what meshkit.org suggests), with price.

## Part B: audio through real radios

6. Two cheap handheld radios to push a 1000-2500 Hz audio data signal through: FRS/GMRS options (what is legal for data on FRS/GMRS in my region: cite the rule) and a ham option if a license is needed (how to get one quickly). Note anything about VOX, squelch tail, and audio bandwidth that affects data.
7. A cheap audio interface from laptop headphone jack to radio mic input and radio speaker to laptop mic (a sound-card interface like Digirig, or a cable), so I can test without holding a phone to a radio.

## Deliverables

- Three buy lists: minimum (~2 nodes, no radios), recommended (3 nodes + handhelds + interface), and "park test" (adds the solar repeater), each with total price and links.
- A one-page "first test" plan: what to flash, how to connect from Chrome, how to send a 235-byte packet on a private port and read it on the other node.
- Open questions you could not settle from primary sources.
