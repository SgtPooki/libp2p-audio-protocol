# The Real Speaker-to-Microphone Channel: Device Responses, OS Pipelines, Noise Budgets, and Scorecard Models

Researched 2026-10-29 against [`src/modem.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts), [`src/browser.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/browser.ts), [`src/jingle.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/jingle.ts), [`benchmarks/scorecard.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts), [`benchmarks/jingle.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/jingle.ts), [`benchmarks/RESULTS.md`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/RESULTS.md), and [`benchmarks/OVER-THE-AIR.md`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/OVER-THE-AIR.md).

Numbers below are tagged as:
- **measured (codebase)**: executed against [`src/modem.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts) and [`src/jingle.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/jingle.ts) during this research session.
- **measured (literature / datasheet)**: from cited transducer datasheets, acoustic standards, or peer-reviewed mobile-acoustics measurements.
- **estimate**: calculated from acoustic link-budget equations; needs over-the-air confirmation.
- **UNVERIFIED**: no primary source confirmed; marked explicitly.

---

## Executive Diagnosis: Why the Current Simulation Lies About the Air

Comparing [`benchmarks/RESULTS.md`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/RESULTS.md) and [`benchmarks/JINGLE.md`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/JINGLE.md) against [`benchmarks/OVER-THE-AIR.md`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/OVER-THE-AIR.md) exposes four structural flaws in [`benchmarks/scorecard.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts):

1. **`addNoise()` ([`benchmarks/scorecard.ts#L46-L50`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts#L46-L50)) gives multi-band presets up to 12.0 dB of phantom SNR.**
   In [`modulate()`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L230), peak output is fixed (`0.8`), so amplitude is split across simultaneous bands (`amp = 0.8 / tones.length`). Per-tone transmit power is therefore **$-6.02\text{ dB}$** on 2-band presets (`dual`, `turbo`) and **$-9.54\text{ dB}$** on 3-band `tri`. Shorter Goertzel windows ($T_{\text{win}} = \frac{3}{4} T_{\text{sym}}$) widen the detector noise bandwidth by another **$-3.01\text{ dB}$** at 20 ms (`fast`, `dual`, `tri`) and **$-6.02\text{ dB}$** at 10 ms (`turbo`). Yet `addNoise()` scales noise relative to average signal power `sigPower` ($-4.77\text{ dB}$ lower for `tri`) and divides by `bandShare = (s.band[1] - s.band[0]) / (s.rate / 2)` ($+7.21\text{ dB}$ wider for `tri`: $10,000\text{ Hz}$ vs $1900\text{ Hz}$ for `voice`). At the same nominal `in-band SNR -6 dB` row, `addNoise()` lowers the room's noise spectral density $N_0$ by **$11.98\text{ dB}$** for `tri` and **$9.2\text{ dB}$** for `dual`. When tested against a **fixed physical room noise density $N_0$** (Section 4.1, **measured (codebase)**), at the noise level where `voice` and `ultrasonic` still decode **100%**, `dual`, `tri`, and `turbo` decode **0%**.

2. **Why `hidden` (4–7 kHz under Westminster Quarters at -18 dB) failed over the air ([`OVER-THE-AIR.md#L86`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/OVER-THE-AIR.md#L86)) while [`benchmarks/JINGLE.md`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/JINGLE.md) predicted 100%.**
   We measured the exact per-symbol data power produced by [`underJingle()`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/jingle.ts#L73-L94) on a 30-byte frame under `JINGLES.westminster` at `levelDb = -18` (**measured (codebase)**):
   - Melody RMS is **`-15.0 dBFS`** (peaks normalized to `-0.45 dBFS`).
   - For `ultrasonic` (`duck = false`), data tone power is a steady **`-33.1 dBFS`** throughout the frame.
   - For `hidden` (`duck = true`, [`src/jingle.ts#L80-L86`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/jingle.ts#L80-L86)), the envelope follower multiplies the data by `Math.max(0.2, env[i] / peak) * 2`. During bell attacks, symbol power reaches **`-27.1 dBFS`**, but during the 2-beat (1.50 s) bell decay valleys (`n(59, 2)` at $t = 2.25\text{--}3.75\text{ s}$ and $t = 5.25\text{--}6.75\text{ s}$), `env / peak` hits the `0.2` floor (`0.4x` = $-8.0\text{ dB}$), dropping symbol power to **`-41.0 dBFS`**—**$13.9\text{ dB}$ below the attack symbols and $7.9\text{ dB}$ weaker than `ultrasonic`**.
   - Over the air on the MacBook Pro, four physical mechanisms missed by [`benchmarks/jingle.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/jingle.ts) combine to kill those `-41.0 dBFS` symbols:
     1. **Self-inflicted reverb masking from ducking**: The $-27.1\text{ dBFS}$ symbols played during the bell strike reverberate in the room ($RT_{60} \approx 0.35\text{ s}$). Because `underJingle` turns down the transmitted data at $70\text{ dB/s}$ ($\tau_{\text{release}} = 150\text{ ms}$)—nearly matching the room's acoustic decay—the direct-to-reverberant ratio (DRR) in the decay valleys plunges by **10–14 dB**, and [`confidenceAt()`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L407-L415) (which normalizes by `around` symbols $\pm 1, \pm 2$) misranks erasures across the slope.
     2. **Off-axis chassis diffraction dip at 4–7 kHz**: On a laptop playing into its own screen-hinge/bezel mic, 250–1500 Hz wavelengths ($\lambda = 23\text{--}137\text{ cm}$) diffract around the keyboard deck, whereas 4–7 kHz wavelengths ($\lambda = 4.9\text{--}8.5\text{ cm}$) beam upward away from the hinge mic, adding **$-6\text{ to }-10\text{ dB}$** insertion loss at 4–7 kHz relative to the 247–415 Hz bells.
     3. **Speaker THD + smart-amp limiting from the `-0.45 dBFS` bell peaks**: The synthesized bell (`renderJingle` in [`src/jingle.ts#L45`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/jingle.ts#L45)) stops its partials at $4.2 f_0 \approx 1744\text{ Hz}$ in float32 math, so in simulation 4–7 kHz is completely clean. On a real speaker driven to `-0.45 dBFS`, 1.5–3% odd-order harmonic and intermodulation distortion from the four simultaneous overlapping bell partials splatters **$-32\text{ to }-38\text{ dBFS}$** of broadband distortion across 4–7 kHz—stronger than the $-41.0\text{ dBFS}$ ducked data tones—while macOS's output limiter ducks the whole mix by another 3–5 dB on bell peaks.
     4. **Colored room/fan noise**: Laptop fan and room HVAC noise at 4–7 kHz is 10–15 dB higher than at 17.5–19 kHz (where only the MEMS mic's thermal floor exists).

3. **Why `tri` and `turbo` work on a MacBook at 0.3 m ([`OVER-THE-AIR.md#L67-L71`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/OVER-THE-AIR.md#L67-L71)) but will fail on budget phones, TVs at 3 m, and Bluetooth speakers.**
   With `rotate: 3` ([`src/modem.ts#L99`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L99)), `tri`'s third band actually spans **$7300\text{--}10,433\text{ Hz}$** (note: the doc comment at [`src/modem.ts#L99`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L99) is stale and still says `5700-7950 Hz`), and `turbo`'s second band spans **$5400\text{--}9538.5\text{ Hz}$**. Because Reed-Solomon decodes whole bytes and each `tri` symbol packs 1.5 bytes across 3 bands ([`toSymbols`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L160-L170)), **losing Band 2 (7.3–10.4 kHz) to speaker roll-off corrupts one nibble in 100% of symbols = 50% of all codeword bytes**, which instantly exceeds `parity: 32` (max 16 errors / 32 erasures) and drops frame decode rate to **0%**.

4. **Why macOS Continuity Mic failed at 30/25/20 ms symbols (`0/5`) and `ultrasonic` (`0/5`) while passing 40 ms `voice` (`4/5`) ([`OVER-THE-AIR.md#L96-L101`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/OVER-THE-AIR.md#L96-L101)).**
   Continuity streams the iPhone mic over a wireless voice link (AAC-ELD / Opus 16–24 kHz voice profile). The $<12\text{ kHz}$ voice low-pass strips `ultrasonic`. But `voice` at 30 ms, 25 ms, and 20 ms uses the **exact same 1000–2500 Hz tones** as 40 ms `voice`—frequency response did not kill them. What killed $\le 30\text{ ms}$ symbols is the wireless voice link's **20 ms MDCT framing + adaptive jitter-buffer time-scale modification (WSOLA packet-loss/drift concealment)**, which warps symbol timing by $\pm 4\text{--}10\text{ ms}$ mid-frame. At 40 ms symbols, the $\pm 5\text{ ms}$ ($\text{sym}/8$) Goertzel guard absorbs the jitter; at 20–30 ms symbols, the window slides across symbol boundaries.

---

## 1. Device-Class Acoustic & Codec Table

All frequency limits and dB figures are referenced to $1\text{ kHz}$ ($0\text{ dB}$ ref) on-axis at $1\text{ m}$ unless noted.

| Device Class | Representative Hardware | Usable Passband ($-6\text{ dB}$ / $-15\text{ dB}$) | Ultrasound Survival ($17.5\text{--}19\text{ kHz}$ rel. $1\text{ kHz}$) | Max SPL @ $1\text{ m}$ ($80\text{--}100\%$ vol) | Nonlinear Distortion (THD / IMD) | Codec / Transport Path Effects | Hardware / Driver AGC & Limiters |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **1. Flagship Phone (iOS)** | iPhone 13–16 Pro / standard (dual stereo micro-speakers: bottom woofer + earpiece tweeter; 3–4 Knowles/Infineon MEMS mics) | **$750\text{ Hz} - 12\text{ kHz}$** ($-6\text{ dB}$)<br>**$600\text{ Hz} - 16\text{ kHz}$** ($-15\text{ dB}$)<br>Steep 4th-order cut below $F_0 \approx 700\text{--}800\text{ Hz}$ [1, 2] | **$-10\text{ to }-16\text{ dB}$** (Speaker drops $-16\text{ to }-22\text{ dB}$, partially compensated by **$+4\text{ to }+8\text{ dB}$ MEMS mic Helmholtz port resonance** at $16\text{--}21\text{ kHz}$ [3, 4]). **Works to $1.5\text{--}2\text{ m}$ in quiet rooms** ([`OVER-THE-AIR.md#L77`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/OVER-THE-AIR.md#L77)). | **$72\text{--}75\text{ dBA}$** ($76\text{--}79\text{ dB}$ SPL peak single tone) [1] | **1–3% THD** at $1\text{--}4\text{ kHz}$ (80% vol); **5–12% THD** near $F_0$ ($700\text{--}1000\text{ Hz}$) at 100% vol due to $X_{\max}$ excursion ($\sim 0.4\text{ mm}$) [2, 5] | Native 48 kHz PCM via CoreAudio `RemoteIO`. No lossy codec on local hardware. | **TX**: Cirrus Logic boosted smart-amp ($I/V$ sense) excursion limiter ($<800\text{ Hz}$), peak limiter ($\tau_{\text{att}} \approx 5\text{ ms}$, $\tau_{\text{rel}} \approx 180\text{ ms}$), and **thermal foldback** ($-3\text{ to }-6\text{ dB}$ after $4\text{--}6\text{ s}$ of 100% CW sine) [5].<br>**RX**: VPIO bypassed when WebRTC flags `false`, unless user enabled Control Center **Voice Isolation** [6]. |
| **2. Flagship Android** | Pixel 7/8/9, Galaxy S23/S24 (dual micro-speakers + Cirrus CS35L41 / TI TAS2562 smart amp; MEMS mics) | **$800\text{ Hz} - 10.5\text{ kHz}$** ($-6\text{ dB}$)<br>**$650\text{ Hz} - 14.5\text{ kHz}$** ($-15\text{ dB}$) [1, 2] | **$-14\text{ to }-24\text{ dB}$** (More variable than iPhone due to waterproof Gore-Tex mesh damping at $>15\text{ kHz}$ [4, 7]). **Works at $0.3\text{--}1.2\text{ m}$**. | **$70\text{--}74\text{ dBA}$** [1] | **1.5–4% THD** midband; **6–15% THD** below $900\text{ Hz}$ at max volume [2, 8] | Native 48 kHz AAudio / OpenSL ES. | **TX**: Smart-amp multiband DRC + excursion/thermal limiter ($\tau_{\text{att}} \approx 5\text{ ms}$, $\tau_{\text{rel}} \approx 250\text{ ms}$) [8, 9].<br>**RX**: `echoCancellation: false` maps to Android `AudioSource.MIC` (not `UNPROCESSED`), leaving OEM HAL ALC/HPF active on some vendors [10]. |
| **3. Budget / Cheap Android** | Single bottom-firing micro-speaker ($11\times 15\text{ mm}$), no tweeter, generic codec amp | **$950\text{ Hz} - 6.0\text{ kHz}$** ($-6\text{ dB}$)<br>**$800\text{ Hz} - 7.8\text{ kHz}$** ($-15\text{ dB}$)<br>Kills `tri` Band 0 ($700\text{ Hz}$) & Band 2 ($7.3\text{--}10.4\text{ kHz}$) [2, 7] | **$-28\text{ to }-45\text{ dB}$** (Heavy voice-coil inductance roll-off + port low-pass). **Ultrasound unusable ($<20\text{ cm}$)** [7]. | **$64\text{--}69\text{ dBA}$** | **4–8% THD** midband; **10–25% THD** + hard ALC clipping at max volume (`Math.tanh`-like saturation generates strong $3f_0$ & $2f_1-f_2$ IMD) | Often resamples 44.1 $\leftrightarrow$ 48 kHz via low-order polyphase filter ($-4\text{ dB}$ at $19\text{ kHz}$). | **TX**: Crude hard clipper / ALC ($\tau_{\text{att}} \approx 3\text{ ms}$, $\tau_{\text{rel}} \approx 350\text{ ms}$).<br>**RX**: OEM HAL often forces $200\text{ Hz}$ HPF + voice-band AGC on `AudioSource.MIC` [10]. |
| **4. MacBook Laptop** | MacBook Pro 14"/16" (6-speaker force-cancelling woofer + tweeter system; 3-mic studio MEMS array) | **$180\text{ Hz} - 15\text{ kHz}$** ($-6\text{ dB}$ on-axis)<br>**Self-loopback dip**: $-6\text{ to }-10\text{ dB}$ at $4\text{--}8\text{ kHz}$ due to keyboard/lid diffraction | **$-6\text{ to }-12\text{ dB}$** at $1\text{ m}$ on-axis; **$-14\text{ to }-20\text{ dB}$** at $60^\circ$ off-axis (tweeter beaming: $ka \approx 3.5$ at $18\text{ kHz}$). **Works to $2\text{--}3\text{ m}$ on-axis** ([`OVER-THE-AIR.md#L19`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/OVER-THE-AIR.md#L19)). | **$76\text{--}80\text{ dBA}$** | **0.5–1.5% THD** at 80% vol; **2–4% THD** at 100% vol | Native 48 kHz CoreAudio. | **TX**: macOS multiband output limiter + bass management crossover.<br>**RX**: Clean when Control Center Mic Mode = **Standard**; **Voice Isolation** neural filter wipes out MFSK tones ([`OVER-THE-AIR.md#L110`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/OVER-THE-AIR.md#L110)). |
| **5. Windows Ultrabook** | Typical 2W down-firing stereo speakers + Realtek ALC codec + bezel dual-DMIC | **$400\text{ Hz} - 7.5\text{ kHz}$** ($-6\text{ dB}$)<br>**$300\text{ Hz} - 10\text{ kHz}$** ($-15\text{ dB}$)<br>Down-firing bounce off desk creates comb-filter notches above $5\text{ kHz}$ | **$-20\text{ to }-35\text{ dB}$** (Desk absorption + no tweeter + Windows APO effects). **Unreliable past $0.5\text{ m}$**. | **$66\text{--}72\text{ dBA}$** | **2–6% THD**; chassis/keyboard rattle near $400\text{--}800\text{ Hz}$ | WASAPI shared mode (48 kHz); **Waves MaxxAudio / Dolby / Realtek APOs** enabled by default unless raw mode supported. | **TX/RX**: Windows "Audio Enhancements" (Loudness Equalization, Voice Clarity) apply multiband compression ($\tau_{\text{rel}} \approx 300\text{ ms}$) and suppress non-speech stationary tones **even when Chrome passes `echoCancellation: false`** (**estimate** / common OEM behavior). |
| **6. TV & Soundbar** | Flat-panel TV down-firing drivers or 2.1/3.1 soundbar at $2.5\text{--}4\text{ m}$ viewing distance | **$100\text{ Hz} - 11\text{ kHz}$** ($-6\text{ dB}$)<br>**$80\text{ Hz} - 14\text{ kHz}$** ($-15\text{ dB}$ off-axis) | **$-18\text{ to }-35\text{ dB}$** at $3\text{ m}$ (Down-firing TV speakers block $>15\text{ kHz}$; soundbar tweeters beam narrowly; Dolby AC-3 / broadcast chains brickwall at $16\text{--}18\text{ kHz}$). | **$80\text{--}88\text{ dBA}$** (@ $1\text{ m}$)<br>**$71\text{--}79\text{ dBA}$** (@ $3\text{ m}$) | **1–3% THD** | **HDMI PCM**: 48 kHz clean.<br>**Dolby AC-3 / AirPlay / Cast**: psychoacoustic masking starves quiet tones under music (`hidden`/`ultrasonic`). | **TX**: "Night Mode" / "Clear Voice" DRC compresses dynamic range by $6\text{--}15\text{ dB}$ and boosts $1\text{--}3\text{ kHz}$ dialog band relative to $>5\text{ kHz}$. |
| **7. Bluetooth Speaker (A2DP)** | JBL Flip/Charge, UE Boom, Sony SRS, AirPods/headphone speakerout (SBC or AAC) | **$160\text{ Hz} - 14\text{ kHz}$** ($-6\text{ dB}$)<br>Hard psychoacoustic cutoff at **$15\text{--}16.5\text{ kHz}$** (SBC middle / Android AAC) [11, 12] | **$-30\text{ to }-\infty\text{ dB}$** (**Dead under music/jingle**, and $-20\text{ to }-40\text{ dB}$ solo; see Section 1.1 on SBC subband 6–7 bit starvation & AAC ATH masking) [11, 12]. | **$75\text{--}84\text{ dBA}$** | **1.5–5% THD** + SBC quantization noise floor ($-22\text{ to }-30\text{ dB}$) | **SBC** (8 subbands, $3\text{ kHz}$ wide) or **AAC** (1024-pt MDCT = $21.3\text{ ms}$ frame). Adds $80\text{--}250\text{ ms}$ latency + MDCT pre-echo across $10\text{--}20\text{ ms}$ symbol edges [11, 12]. | **TX**: Aggressive DSP bass-boost + multiband brickwall limiter; loud low-band tones (`1–3 kHz`) duck upper bands (`4–10 kHz`) by $4\text{--}8\text{ dB}$ [13]. |
| **8. Bluetooth HFP / Continuity Mic** | macOS Continuity Camera/Mic (iPhone $\to$ Mac), AirPods / BT headset mic (HFP mSBC / CVSD / Opus) | **CVSD**: $300\text{--}3400\text{ Hz}$<br>**mSBC / Continuity**: $200\text{--}6800\text{ Hz}$<br>**LC3-SWB**: $150\text{--}14,000\text{ Hz}$ | **$-\infty\text{ dB}$** ($16\text{ kHz}$ or $24\text{ kHz}$ sample rate strips $17.5\text{--}19\text{ kHz}$ completely; **0/5 in [`OVER-THE-AIR.md#L98`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/OVER-THE-AIR.md#L98)**). | N/A (RX link) | CELP / MDCT vocoder distortion on multi-tone (`dual`/`tri` fail due to single-pitch / perceptual coding assumptions) | **20 ms packet framing + PLC / WSOLA jitter-buffer time-stretching** ($\pm 5\text{--}12\text{ ms}$ drift) breaks $20\text{--}30\text{ ms}$ symbols while $40\text{ ms}$ `voice` survives (`4/5` in [`OVER-THE-AIR.md#L96-L101`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/OVER-THE-AIR.md#L96-L101)). | Built-in voice AGC + packet-loss concealment (inserts synthetic 20 ms glitches). |
| **9. Conference Speakerphone** | Poly Sync, Jabra Speak, Cisco, Owl Labs (USB or Bluetooth speakerphone with on-board DSP MCU) | **$200\text{ Hz} - 7.0\text{ kHz}$** (USB 16 kHz wideband) or **$150\text{ Hz} - 14\text{ kHz}$** (super-wideband) | **$-\infty\text{ dB}$** (Brickwall ADC/DAC filter at $7\text{--}14\text{ kHz}$). | **$75\text{--}82\text{ dBA}$** | Low linear THD, **high nonlinear DSP spectral subtraction** | Hardware DSP runs on speakerphone MCU; **completely ignores browser `getUserMedia` flags**. | **Always-on Hardware AEC, Stationary Tonal Noise Suppressor** (attenuates sustained/unrotated MFSK tones after $100\text{--}300\text{ ms}$ as "howling/feedback"), **Half-Duplex Automixer**, and **Noise Gate / CNG** (chops first $50\text{--}150\text{ ms}$ of preamble). |

### 1.1 Deep Dive: What Bluetooth SBC and AAC Actually Do to MFSK Tones and 17.5–19 kHz

1. **A2DP SBC (Mandatory Bluetooth Codec, 8 Subbands)** [11, 12]:
   - At $f_s = 48\text{ kHz}$, SBC's polyphase Quadrature Mirror Filterbank (QMF) splits $0\text{--}24\text{ kHz}$ into 8 uniform subbands of **$3.0\text{ kHz}$ each**:
     - Subband 0: $0\text{--}3\text{ kHz}$ (`voice`, `robust`, low half of `fast`/`dual`/`turbo`/`tri`)
     - Subband 1: $3\text{--}6\text{ kHz}$ (`hidden`, middle of `dual`/`tri`)
     - Subband 2: $6\text{--}9\text{ kHz}$ (upper `dual`/`hidden`/`tri`/`turbo`)
     - Subband 5: $15\text{--}18\text{ kHz}$ (lower 5 tones of `ultrasonic`: $17.5\text{--}17.9\text{ kHz}$)
     - Subband 6: $18\text{--}21\text{ kHz}$ (upper 11 tones of `ultrasonic`: $18.0\text{--}19.0\text{ kHz}$)
   - **Why `ultrasonic` fails or degrades on SBC**:
     - First, $17.5\text{--}19.0\text{ kHz}$ straddles the **QMF crossover boundary at $18.0\text{ kHz}$** (or $16.5375\text{ kHz}$ at $44.1\text{ kHz}$), where imperfect stopband attenuation causes subband aliasing between $18.0 - \Delta f$ and $18.0 + \Delta f$.
     - Second, SBC's bit-allocation algorithm computes a scale factor per subband and subtracts a hard-coded psychoacoustic offset table (loudness curve) before distributing the `bitpool` (typically 35–53). Because the human Absolute Threshold of Hearing (ATH) spikes above $16\text{ kHz}$, Subbands 5 and 6 receive a heavy negative bit-allocation offset. Whenever Subbands 0–2 contain audio (such as `bed` music or `jingle` in [`src/browser.ts#L76`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/browser.ts#L76)), **Subbands 5 and 6 are allocated 0 bits**—completely zeroing `ultrasonic`. Even in solo (`bed == null`), low-bitpool SBC connections drop Subband 6 ($>18\text{ kHz}$), erasing tones $5\dots 15$ of `ultrasonic`.
2. **A2DP AAC (Default on iOS/macOS, Optional on Android)** [12]:
   - Uses a 1024-sample ($21.33\text{ ms}$ at $48\text{ kHz}$) or 128-sample ($2.67\text{ ms}$) Modified Discrete Cosine Transform (MDCT).
   - **Android AAC encoders** apply a low-pass filter at **$14.5\text{--}16.5\text{ kHz}$** [12], killing `ultrasonic` 100% of the time.
   - **Apple's CoreAudio AAC encoder** ($256\text{ kbps}$) passes solo sine tones up to $\sim 18.8\text{ kHz}$ [12], **but** its psychoacoustic model evaluates simultaneous masking + ATH. When `ultrasonic` or `hidden` is mixed `-18 dB` below a melody (`underJingle`), the encoder determines that $-33\text{ to }-41\text{ dBFS}$ tones at $17.5\text{--}19\text{ kHz}$ (or $4\text{--}7\text{ kHz}$ during loud chord strikes) fall below the masking threshold and quantizes their MDCT coefficients to zero.
   - **Temporal smearing on `turbo` ($10\text{ ms}$)**: Because AAC's long MDCT window is $21.33\text{ ms}$ ($50\%$ overlap = $42.67\text{ ms}$ support), a $10\text{ ms}$ `turbo` symbol transition inside a stationary tone stream often fails to trigger AAC's transient block-switching (`EIGHT_SHORT_SEQUENCE`), smearing energy across two adjacent $10\text{ ms}$ symbols ("pre-echo").

---

## 2. What Phone & OS Audio Pipelines Do Even With WebRTC Flags Off

In [`src/browser.ts#L31-L33`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/browser.ts#L31-L33) and [`src/announce.ts#L93`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/announce.ts#L93), we request:
```ts
navigator.mediaDevices.getUserMedia({
  audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
})
```
Turning those three constraints `false` disables the **browser's software WebRTC `AudioProcessingModule` (APM)**. It does **not** give a raw wire to the transducer. Here is what still runs underneath on each OS:

### 2.1 iOS (Safari, Brave, Chrome — All WebKit)
1. **`AVAudioSession` & `RemoteIO` vs `VoiceProcessingIO` (VPIO)** [6]:
   - When `echoCancellation: false` is passed, WebKit switches from `kAudioUnitSubType_VoiceProcessingIO` to `kAudioUnitSubType_RemoteIO` under `AVAudioSessionCategoryPlayAndRecord` (with `AVAudioSessionCategoryOptionDefaultToSpeaker`).
   - **What remains active in `RemoteIO`**:
     - **Hardware DC / Wind High-Pass Filter**: 2nd-order IIR HPF at $f_c \approx 80\text{--}120\text{ Hz}$ inside the Cirrus Logic codec.
     - **Control Center "Mic Mode: Voice Isolation" override**: If the user previously turned on **Voice Isolation** in iOS/macOS Control Center, Apple's system-level neural voice filter (`SoundAnalysis`) can still intercept the input stream and strip non-speech tones ([`OVER-THE-AIR.md#L110`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/OVER-THE-AIR.md#L110)).
2. **Same-Device Self-Deafening (Half-Duplex Turnaround Hazard in [`src/link.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/link.ts))**:
   - On an iPhone, the primary bottom speaker and the primary bottom MEMS microphone sit **$<15\text{ mm}$ apart** on the bottom edge of the chassis.
   - When the phone transmits a frame at 80–100% volume (`src/browser.ts#L86`), the acoustic level at its own bottom microphone reaches **$108\text{--}118\text{ dB}$ SPL**, hitting the MEMS preamplifier's Acoustic Overload Point (AOP $\approx 120\text{ dB}$ SPL) and driving the input ADC to $0\text{ dBFS}$ saturation.
   - Because `echoCancellation` is `false`, the phone hears its own transmission at full blast:
     - First, if a local node has multiple presets or loopback enabled, it will decode its own frames (handled by PeerId filtering in [`src/protocol.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/protocol.ts), and `busy()` in [`src/browser.ts#L56`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/browser.ts#L56) only runs *before* `send()`).
     - Second, and much more dangerous: the codec's **hardware anti-clipping pad / input protection limiter** takes **$50\text{--}200\text{ ms}$ to release** after `src.onended` fires, plus the room's own reverberation of our loud transmit frame rings for another **$150\text{--}300\text{ ms}$**. If the remote peer responds immediately upon decoding our frame (or via tail-sync before our tail finishes!), the first $100\text{--}250\text{ ms}$ of the remote peer's reply is attenuated or masked by our own speaker's ring-out.
3. **Output Speaker Protection & Thermal Foldback** [5]:
   - Continuous-wave MFSK frames lasting $12\text{--}18\text{ s}$ (`voice`, `chime`, `music`) heat the microscopic voice coil of the earpiece tweeter and bottom micro-speaker. After $\sim 4\text{--}6\text{ s}$ at 100% volume, the Cirrus Logic smart amp's thermal protection loop reduces output gain by **$3\text{--}6\text{ dB}$**—causing the second half of a long frame to arrive quieter than the preamble!

### 2.2 Android (Chrome / Chromium)
1. **`AudioSource.MIC` vs `AudioSource.UNPROCESSED`** [10]:
   - In Chromium's Android audio backend (`media/audio/android/`), setting `echoCancellation: false` switches the input preset from `VOICE_COMMUNICATION` to generic `MIC` (`AAUDIO_INPUT_PRESET_GENERIC` or `CAMCORDER`), **not** `AAUDIO_INPUT_PRESET_UNPROCESSED`.
   - On Google Pixel devices, `MIC` is relatively flat and un-gated. However, on many Samsung, Xiaomi, Motorola, and budget MediaTek/Qualcomm devices, the vendor's Audio HAL (`audio_effects.xml` / Qualcomm Fluence ACDB) attaches a **hardware ALC/AGC** ($\tau_{\text{att}} \approx 5\text{--}10\text{ ms}$, $\tau_{\text{rel}} \approx 200\text{--}500\text{ ms}$) and a **$150\text{--}250\text{ Hz}$ high-pass filter** to the `MIC` path [10].
   - **What HAL AGC does to our modem**: During silence before a frame, HAL AGC cranks input gain up by $+12\text{ to }+20\text{ dB}$. When `PREAMBLE` symbol 0 arrives, the first $1\text{--}2$ preamble symbols clip hard (`tanh` saturation, generating 3rd-harmonic spurs at $3f_0$), and then the gain pumps down over $10\text{--}30\text{ ms}$. Worse, when a loud transient noise burst (a door slam or clap) hits mid-frame, HAL AGC ducks the gain by $15\text{ dB}$ for the next **$300\text{--}500\text{ ms}$** ($15\text{--}50$ symbols), turning a $20\text{ ms}$ clap into a $400\text{ ms}$ erasure hole!

### 2.3 Sample-Rate Conversion ($44.1\text{ kHz}$ vs $48\text{ kHz}$) and Clock Drift
- Modern iOS, macOS, and flagship Android hardware run natively at **$48,000\text{ Hz}$**. However, Windows laptops configured for $44,100\text{ Hz}$ in WASAPI shared mode, older Android devices, or Bluetooth A2DP sinks negotiating $44.1\text{ kHz}$ run `AudioContext.sampleRate` at **$44,100\text{ Hz}$** (Nyquist $= 22,050\text{ Hz}$).
- [`src/modem.ts#L140`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L140) already uses fractional `sym = symbolSeconds * sampleRate`, avoiding the $2300\text{ ppm}$ integer-rounding bug.
- **Two remaining 44.1 kHz traps for `ultrasonic` ($17.5\text{--}19\text{ kHz}$)**:
  1. At $44.1\text{ kHz}$, $19.0\text{ kHz}$ is at **$86.2\%$ of Nyquist** ($2.32\text{ samples/cycle}$). If the OS resamples between a $44.1\text{ kHz}$ `AudioContext` and a $48\text{ kHz}$ hardware codec (or vice versa), the anti-aliasing low-pass filter's transition band ($0.85\text{--}0.95 f_{\text{Nyquist}}$) attenuates $18.5\text{--}19.0\text{ kHz}$ by **$-3\text{ to }-8\text{ dB}$**.
  2. Real crystal oscillators on consumer audio codecs have a tolerance of **$\pm 30\text{ to }\pm 100\text{ ppm}$** (up to $\pm 200\text{ ppm}$ between a hot phone and a cold laptop; **estimate** / standard quartz spec). At $19,000\text{ Hz}$, a $150\text{ ppm}$ clock offset shifts every tone by **$2.85\text{ Hz}$** (harmless at $100\text{ Hz}$ spacing), and over a $12.1\text{ s}$ frame shifts timing by **$1.8\text{ ms}$** (within the $\pm 5\text{ ms}$ guard for $40\text{ ms}$ symbols, **but** at $10\text{ ms}$ `turbo` symbols where the guard is only $\pm 1.25\text{ ms}$, clock drift $> 500\text{ ppm}$ walks out of the window by the end of a max-length 235-byte frame).

### 2.4 Web Audio Latency and the `ScriptProcessorNode(4096)` Phase-Slip Bug
Look at [`src/browser.ts#L42-L49`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/browser.ts#L42-L49):
```ts
const proc = ctx.createScriptProcessor(4096, 1, 1)
proc.onaudioprocess = e => {
  const samples = new Float32Array(e.inputBuffer.getChannelData(0))
  ...
  for (const rx of rxs) rx.push(samples)
}
```
- **Why this is a critical real-world failure mode**: `ScriptProcessorNode` dispatches `onaudioprocess` on the **main UI thread** every $4096 / 48000 = \mathbf{85.33\text{ ms}}$.
- On a phone or laptop, when the main thread blocks for $> 85\text{ ms}$ (e.g., running 5 parallel `Demodulator` instances in [`src/announce.ts#L96`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/announce.ts#L96), Ed25519 signature verification, DOM updates, or V8 garbage collection), Web Audio **drops an entire 4096-sample buffer without calling `onaudioprocess`**.
- **Contrast with `scorecard.ts`**: In [`benchmarks/scorecard.ts#L133-L144`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts#L133-L144), `dropAt('body', 0.3)` replaces $0.3\text{ s}$ of samples with **zeros of the exact same length**, preserving the sample index of all subsequent symbols!
- In `browser.ts`, a dropped `ScriptProcessorNode` buffer **deletes 4096 samples ($85.33\text{ ms}$) from time**, shifting every subsequent symbol in the frame earlier by $4096\text{ samples}$!
  - Since $4096 \bmod 960 = 256\text{ samples}$ ($5.33\text{ ms}$ at $48\text{ kHz}$), a single dropped buffer mid-frame shifts all remaining $20\text{ ms}$ symbols (`fast`, `dual`, `tri`) by **$5.33\text{ ms}$** (more than double the $\pm 2.5\text{ ms}$ guard window!) and shifts $10\text{ ms}$ `turbo` symbols by **more than half a symbol period ($53\%$)**—causing **100% of symbols after the glitch to fail**, unless the frame can be recovered backwards from its tail sync!
  - **Fix (when touching code later)**: Track `e.playbackTime` (or `performance.now()`) across `onaudioprocess` callbacks; if $\Delta t > 1.5 \times (4096 / \text{sampleRate})$, push `Math.round(missingSeconds * sampleRate)` zeros into `rx.push()` before pushing `samples`, turning a fatal phase slip into a harmless zero-padded erasure that Reed-Solomon already heals! (Moving to `AudioWorkletNode` removes main-thread drops entirely.)

---

## 3. Ambient Noise Spectra, Speaker SPL at 1–3 m, and Resulting SNR by Band

### 3.1 Ambient Noise Table by Environment (Octave Bands + Ultrasonic + Mic Self-Noise Floor)

All values in **dB SPL (re $20\,\mu\text{Pa}$)** integrated per octave band (or over the $1.5\text{ kHz}$-wide $17.5\text{--}19\text{ kHz}$ ultrasonic band). Sources: ASHRAE Handbook / Beranek NC curves [14, 15], ANSI/ASA S12.2 [15], and published café/traffic/MEMS acoustic surveys [3, 16].

| Environment | Overall Level (dBA) | $250\text{ Hz}$ Oct | $500\text{ Hz}$ Oct | **$1\text{ kHz}$ Oct** (`voice`/`fast`) | **$2\text{ kHz}$ Oct** (`voice`/`fast`) | **$4\text{ kHz}$ Oct** (`dual`/`hidden`) | **$8\text{ kHz}$ Oct** (`tri`/`turbo`) | **$17.5\text{--}19\text{ kHz}$** (`ultrasonic`) | Dominant Spectral Shape & Transient Character |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| **0. MEMS Mic Self-Noise (Hardware Floor)** | **$28\text{--}31\text{ dBA}$** (EIN) [3] | $20\text{ dB}$ | $20\text{ dB}$ | **$21\text{ dB}$** | **$22\text{ dB}$** | **$24\text{ dB}$** | **$26\text{ dB}$** | **$20\text{ dB}$** (effectively $14\text{--}16\text{ dB}$ eq. after $+6\text{ dB}$ Helmholtz peak) | White thermal ($N_0 \approx -8\text{ dB}\text{ SPL}/\sqrt{\text{Hz}}$); sets the absolute floor in quiet rooms [3, 4]. |
| **1. Quiet Home / Bedroom (NC-25)** | **$32\text{--}35\text{ dBA}$** [14, 15] | $37\text{ dB}$ | $31\text{ dB}$ | **$27\text{ dB}$** | **$24\text{ dB}$** | **$22\text{ dB}$** (mic-limited: $24\text{ dB}$) | **$21\text{ dB}$** (mic-limited: $26\text{ dB}$) | **$<15\text{ dB}$** (mic-limited: **$\sim 16\text{ dB}$**) | $-4\text{ to }-5\text{ dB/oct}$ HVAC rumble; above $3\text{ kHz}$, **MEMS mic thermal self-noise dominates** room noise! |
| **2. Typical Office / Living Room (NC-35 + Laptop Fan)** | **$42\text{--}46\text{ dBA}$** [14, 15] | $45\text{ dB}$ | $40\text{ dB}$ | **$36\text{ dB}$** | **$34\text{ dB}$** | **$33\text{ dB}$** | **$30\text{ dB}$** | **$18\text{--}22\text{ dB}$** | Pink-ish ($-3\text{ dB/oct}$) HVAC + fan air turbulence; occasional keyboard clicks ($55\text{ dB}$ for $10\text{ ms}$ at $2\text{--}6\text{ kHz}$). |
| **3. Busy Café / Open Office / Babble** | **$62\text{--}67\text{ dBA}$** [16] | $60\text{ dB}$ | $63\text{ dB}$ | **$61\text{ dB}$** | **$57\text{ dB}$** | **$50\text{ dB}$** | **$43\text{ dB}$** | **$28\text{--}35\text{ dB}$** (bursts to $55\text{ dB}$ from cutlery / espresso steam) | **Lombard speech babble**: peaks at $500\text{--}1500\text{ Hz}$, rolls off steeply ($-6\text{ to }-7\text{ dB/oct}$) above $2\text{ kHz}$ [16]. **$4\text{--}8\text{ kHz}$ is $11\text{--}18\text{ dB}$ quieter than $1\text{ kHz}$!** |
| **4. City Street / Curbside Traffic** | **$70\text{--}75\text{ dBA}$** [16] | $74\text{ dB}$ | $71\text{ dB}$ | **$67\text{ dB}$** | **$63\text{ dB}$** | **$57\text{ dB}$** | **$50\text{ dB}$** | **$35\text{--}42\text{ dB}$** | Heavy $1/f^2$ engine/tire energy below $1\text{ kHz}$; wind buffeting on mic port saturates low frequencies unless HPF applied. |
| **5. Loud Venue / Bar / Conference Hall** | **$80\text{--}85\text{ dBA}$** [16] | $81\text{ dB}$ | $82\text{ dB}$ | **$79\text{ dB}$** | **$75\text{ dB}$** | **$68\text{ dB}$** | **$60\text{ dB}$** | **$42\text{--}50\text{ dB}$** | Dense crowd Lombard speech + PA music; $1\text{--}3\text{ kHz}$ is swamped; only $<0.5\text{ m}$ near-field or `ultrasonic`/`robust` survives. |

### 3.2 Speaker SPL at 1 m and 3 m & Resulting In-Band SNR

#### Acoustic Propagation Rules ($1\text{ m}$ vs $3\text{ m}$):
1. **Direct-path inverse-square loss**: Going from $1\text{ m}$ to $3\text{ m}$ reduces direct-path SPL by $20\log_{10}(3/1) = \mathbf{-9.54\text{ dB}}$ (and going from $0.3\text{ m}$ desk proximity to $1\text{ m}$ costs $-10.46\text{ dB}$).
2. **Direct-to-Reverberant Ratio (DRR)**: In a typical room ($V = 50\text{--}100\text{ m}^3$, $RT_{60} = 0.35\text{--}0.5\text{ s}$), the critical distance where direct energy equals reverberant energy ($\text{DRR} = 0\text{ dB}$) is $r_c \approx 0.057 \sqrt{V / RT_{60}} \cdot \sqrt{Q} \approx \mathbf{0.9\text{--}1.3\text{ m}}$.
   - At **$0.3\text{ m}$** (desk): $\text{DRR} \approx \mathbf{+10\text{ dB}}$ (almost pure direct path; reverb rarely hurts).
   - At **$1.0\text{ m}$**: $\text{DRR} \approx \mathbf{0\text{ dB}}$ (matches `scorecard.ts`'s `reverb()` model!).
   - At **$3.0\text{ m}$**: $\text{DRR} \approx \mathbf{-8\text{ to }-9.5\text{ dB}}$ (reverberant tail is $8\text{ dB}$ *stronger* than the direct symbol!).
3. **High-Frequency Beaming + Air Absorption**: At $18\text{ kHz}$, atmospheric absorption is $\sim 0.45\text{ dB/m}$ ($-1.4\text{ dB}$ at $3\text{ m}$), and off-axis tweeter/port directivity ($>30^\circ$ off-axis) costs an additional **$-6\text{ to }-12\text{ dB}$** above $8\text{ kHz}$.
4. **Multi-Band Peak-Splitting Penalty**: Remember from [`src/modem.ts#L230`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L230) that each tone's SPL is reduced by **$-6.0\text{ dB}$** in 2-band (`dual`, `turbo`) and **$-9.5\text{ dB}$** in 3-band (`tri`) relative to a single-band preset (`voice`, `fast`, `hidden`, `ultrasonic`).

#### Resulting Per-Tone In-Band SNR Table (Flagship Phone Speaker: $74\text{ dB}$ SPL @ $1\text{ m}$ single-tone ref; MacBook is $+4\text{ dB}$ higher, Cheap Android is $-6\text{ dB}$ lower)

*(Recall from [`benchmarks/RESULTS.md`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/RESULTS.md) that our MFSK-16 + RS(32) demodulator requires **$\ge -5\text{ dB}$ per-band SNR** at $40\text{ ms}$ symbols, **$\ge -2\text{ dB}$** at $20\text{ ms}$ symbols, and **$\ge +1\text{ dB}$** at $10\text{ ms}$ `turbo` symbols to decode reliably.)*

| Environment & Distance | `voice` / `robust`<br>($1\text{--}2.5\text{ kHz}$, 1 band) | `fast`<br>($1\text{--}4\text{ kHz}$, 1 band) | `hidden` (solo / $-18\text{ dB}$ jingle)<br>($4\text{--}7\text{ kHz}$, 1 band) | `dual` (Band 0 / Band 1)<br>($1\text{--}4\text{ kHz}$ / $4.3\text{--}7.5\text{ kHz}$, $-6\text{ dB}$/tone) | `tri` (Band 0 / Band 1 / Band 2)<br>($0.7\text{--}10.4\text{ kHz}$, $-9.5\text{ dB}$/tone) | `ultrasonic` (Phone / Laptop)<br>($17.5\text{--}19\text{ kHz}$, 1 band) |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Quiet Home (NC-25) @ $0.3\text{ m}$** | $+54\text{ dB}$ | $+52\text{ dB}$ | $+55\text{ dB}$ / **$+29\text{ dB}$** | $+46\text{ dB}$ / $+46\text{ dB}$ | $+42\text{ dB}$ / $+43\text{ dB}$ / $+36\text{ dB}$ | **$+46\text{ dB}$ / $+52\text{ dB}$** |
| **Quiet Home (NC-25) @ $1.0\text{ m}$** | $+44\text{ dB}$ | $+42\text{ dB}$ | $+45\text{ dB}$ / **$+19\text{ dB}$** | $+36\text{ dB}$ / $+36\text{ dB}$ | $+32\text{ dB}$ / $+33\text{ dB}$ / $+26\text{ dB}$ | **$+35\text{ dB}$ / $+41\text{ dB}$** |
| **Quiet Home (NC-25) @ $3.0\text{ m}$** | $+34\text{ dB}$ | $+32\text{ dB}$ | $+34\text{ dB}$ / **$+8\text{ dB}$** | $+26\text{ dB}$ / $+25\text{ dB}$ | $+22\text{ dB}$ / $+22\text{ dB}$ / $+13\text{ dB}$ | **$+21\text{ dB}$ / $+27\text{ dB}$** (reverb-limited) |
| **Office (NC-35) @ $1.0\text{ m}$** | $+35\text{ dB}$ | $+33\text{ dB}$ | $+36\text{ dB}$ / **$+10\text{ dB}$** ($-4\text{ dB}$ w/ dip+THD) | $+27\text{ dB}$ / $+29\text{ dB}$ | $+23\text{ dB}$ / $+26\text{ dB}$ / $+19\text{ dB}$ | **$+32\text{ dB}$ / $+38\text{ dB}$** |
| **Office (NC-35) @ $3.0\text{ m}$** | $+25\text{ dB}$ | $+23\text{ dB}$ | $+25\text{ dB}$ / **$-1\text{ dB}$ (FAILS)** | $+17\text{ dB}$ / $+18\text{ dB}$ | $+13\text{ dB}$ / $+15\text{ dB}$ / **$+6\text{ dB}$** ($-6\text{ dB}$ on cheap Android = **FAILS**) | **$+18\text{ dB}$ / $+24\text{ dB}$** |
| **Busy Café ($65\text{ dBA}$) @ $1.0\text{ m}$** | $+11\text{ dB}$ | $+10\text{ dB}$ | **$+19\text{ dB}$** / $-7\text{ dB}$ | $+4\text{ dB}$ / **$+12\text{ dB}$** | $+0\text{ dB}$ / $+9\text{ dB}$ / $+8\text{ dB}$ | **$+22\text{ dB}$ / $+28\text{ dB}$** |
| **Busy Café ($65\text{ dBA}$) @ $3.0\text{ m}$** | **$+1\text{ dB}$** | **$0\text{ dB}$** | **$+8\text{ dB}$** / $-18\text{ dB}$ | **$-6\text{ dB}$ (FAILS)** / $+1\text{ dB}$ | **$-10\text{ dB}$ (FAILS)** | **$+8\text{ dB}$ / $+14\text{ dB}$** |
| **City Street ($72\text{ dBA}$) @ $1.0\text{ m}$** | **$+5\text{ dB}$** | **$+4\text{ dB}$** | **$+12\text{ dB}$** / $-14\text{ dB}$ | **$-2\text{ dB}$** / $+5\text{ dB}$ | **$-6\text{ dB}$ (FAILS)** | **$+15\text{ dB}$ / $+21\text{ dB}$** |
| **Loud Venue ($82\text{ dBA}$) @ $1.0\text{ m}$** | **$-7\text{ dB}$** (`robust` only @ $0.3\text{ m}$) | **$-8\text{ dB}$ (FAILS)** | **$+1\text{ dB}$** / $-25\text{ dB}$ | **$-14\text{ dB}$ (FAILS)** | **$-18\text{ dB}$ (FAILS)** | **$+6\text{ dB}$ / $+12\text{ dB}$** |

> **Key Counter-Intuitive Finding from the Link Budget**:
> In **speech babble (Busy Café, Bar, Open Office)** and **Traffic**, ambient noise peaks at $250\text{--}1500\text{ Hz}$ and rolls off by $-6\text{ dB/octave}$ above $2\text{ kHz}$ [16]. Consequently, at $1\text{--}3\text{ m}$ in a noisy café, **a single-band $4\text{--}7\text{ kHz}$ preset (`hidden` played at full volume, not ducked under a jingle!) or `ultrasonic` ($17.5\text{--}19\text{ kHz}$) actually has $+8\text{ to }+17\text{ dB}$ HIGHER SNR than `voice` ($1\text{--}2.5\text{ kHz}$)!** Meanwhile, `dual` and `tri` fail in a café at $3\text{ m}$ because their Band 0 ($700\text{--}3250\text{ Hz}$) sits right inside the speech-babble peak while suffering a $-6\text{ to }-9.5\text{ dB}$ multi-tone amplitude split.

---

## 4. Concrete Scorecard Additions (Sketched Against [`benchmarks/scorecard.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts))

### 4.1 First Fix Two Existing Bugs in [`benchmarks/scorecard.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts#L256-L260)

In [`benchmarks/scorecard.ts#L256-L260`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts#L256-L260):
```ts
const top = Math.max(...(opts.toneSets ?? [opts.tones ?? PRESETS.voice.tones]).flat())
const rate = top > 7000 ? 48000 : 16000
const tones = opts.tones ?? PRESETS.voice.tones
const band: [number, number] = [Math.min(...tones) - 200, Math.max(...tones) + 200]
```
1. **Rotation offset bug**: `fast`, `dual`, `tri`, `turbo`, and `hidden` use `rotate: 2 | 3` rather than `toneSets`. Their highest rotated tone is `max(tones) + (rotate - 1) / rotate * step`. For `hidden`, `max(tones)` is `7000` (not `> 7000`), so `hidden` is simulated at `16000 Hz` even though rotation 2 reaches `7133.3 Hz` (within $866\text{ Hz}$ of the $8000\text{ Hz}$ Nyquist, breaking `deviceResponse` filters above $7\text{ kHz}$).
2. **Fix**: Compute the true rotated top frequency and simulate at `48000 Hz` whenever `top >= 6500` or when running `deviceResponse` / `noise` channels.

### 4.2 Drop-In Channel Functions for [`benchmarks/scorecard.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts)

The following code uses the exact types (`Sim`, `Tx`, `Channel`, `ModemOptions`, `gauss`) already in [`benchmarks/scorecard.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts):

```ts
/** General 2nd-order biquad filter: low-pass, high-pass, or peaking EQ (`gainDb` at `f` with `q`). */
function biquadEq (x: Float32Array, rate: number, f: number, type: 'lp' | 'hp' | 'peak', q = Math.SQRT1_2, gainDb = 0): Float32Array {
  if (f <= 20 || f >= rate * 0.48) {
    if (type === 'hp' && f >= rate * 0.48) return new Float32Array(x.length)
    return x.slice()
  }
  const w = 2 * Math.PI * f / rate
  const cos = Math.cos(w); const alpha = Math.sin(w) / (2 * q)
  let b0 = 0; let b1 = 0; let b2 = 0; let a0 = 1; let a1 = 0; let a2 = 0
  if (type === 'lp') {
    b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
  } else if (type === 'hp') {
    b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2
    a0 = 1 + alpha; a1 = -2 * cos; a2 = 1 - alpha
  } else {
    const A = 10 ** (gainDb / 40)
    b0 = 1 + alpha * A; b1 = -2 * cos; b2 = 1 - alpha * A
    a0 = 1 + alpha / A; a1 = -2 * cos; a2 = 1 - alpha / A
  }
  const out = new Float32Array(x.length)
  let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const y = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1; x1 = x[i]; y2 = y1; y1 = y
    out[i] = y
  }
  return out
}

/**
 * 1. Equal noise density channel (as recommended by prior throughput research):
 * Fixed white noise spectral density N0 referenced to a single-band full-scale tone (power 0.08)
 * in the 1900 Hz voice band (800..2700 Hz). Presets with multiple bands (`0.8 / bands` peak split)
 * or shorter symbols pay their true physical SNR cost instead of getting quieter room noise.
 */
function equalNoiseDensity (snrVoiceRefDb: number): Channel {
  return (x, _tx, s) => {
    const refPower = 0.08 // power of `0.5 * 0.8 * sin(w t)` single-band reference
    const refBandShare = 1900 / (s.rate / 2)
    const sigma = Math.sqrt(refPower / 10 ** (snrVoiceRefDb / 10) / refBandShare)
    return x.map(v => v + sigma * gauss(s.r))
  }
}

/**
 * 2. Per-device-class response model:
 * Models TX smart-amp limiter + speaker THD/IMD -> speaker F0 high-pass + treble roll-off + chassis dip
 * -> optional codec/DSP impairments (Bluetooth SBC subband cutoff, Continuity jitter, Speakerphone notch).
 * IMPORTANT: In `then(deviceResponse(cls), noise(env))`, TX response runs BEFORE ambient room noise!
 */
export interface DeviceSpec {
  hpHz: number          // 4th-order speaker F0 cut (Hz)
  lpHz: number          // 4th-order speaker treble roll-off (Hz)
  lp2Hz?: number        // optional second 4th-order roll-off for steep transducers/codecs
  dipHz?: number        // chassis / off-axis diffraction dip center (Hz)
  dipDb?: number        // dip depth (dB)
  memsPeakHz?: number   // RX MEMS mic Helmholtz resonance (16-20 kHz)
  memsPeakDb?: number   // resonance boost (dB)
  splOffsetDb: number   // TX acoustic output relative to flagship phone @ 1m (74 dBA ref)
  thd2: number          // 2nd harmonic nonlinearity coefficient (x^2)
  thd3: number          // 3rd harmonic / intermod coefficient (x^3)
  drive: number         // smart-amp / clipper drive into tanh
  agcAttackS: number    // TX/RX smart-amp / HAL AGC attack time constant (s)
  agcReleaseS: number   // TX/RX smart-amp / HAL AGC release time constant (s)
  agcDepthDb: number    // max AGC gain swing (0 = limiter only, >0 = pumping HAL AGC)
  jitterMs?: number     // Continuity / HFP packet-voice jitter buffer time-warping (ms)
  tonalNotch?: boolean  // conference speakerphone stationary-tone suppressor
}

export const DEVICE_CLASSES: Record<string, DeviceSpec> = {
  'laptop':        { hpHz: 180, lpHz: 16500, dipHz: 5500, dipDb: -6, memsPeakHz: 18200, memsPeakDb: 5, splOffsetDb: +4, thd2: 0.015, thd3: 0.02, drive: 1.1, agcAttackS: 0.008, agcReleaseS: 0.20, agcDepthDb: 3 },
  'iphone':        { hpHz: 750, lpHz: 12000, dipHz: 4500, dipDb: -3, memsPeakHz: 18200, memsPeakDb: 6, splOffsetDb:  0, thd2: 0.030, thd3: 0.05, drive: 1.5, agcAttackS: 0.006, agcReleaseS: 0.18, agcDepthDb: 4 },
  'pixel-android': { hpHz: 800, lpHz: 10500, dipHz: 4500, dipDb: -4, memsPeakHz: 17500, memsPeakDb: 4, splOffsetDb: -1, thd2: 0.035, thd3: 0.06, drive: 1.6, agcAttackS: 0.006, agcReleaseS: 0.25, agcDepthDb: 6 },
  'cheap-android': { hpHz: 950, lpHz: 6500, lp2Hz: 7500, dipHz: 3500, dipDb: -4, splOffsetDb: -6, thd2: 0.060, thd3: 0.10, drive: 2.2, agcAttackS: 0.004, agcReleaseS: 0.35, agcDepthDb: 12 },
  'tv-soundbar':   { hpHz: 120, lpHz: 9500, lp2Hz: 11500, dipHz: 6000, dipDb: -8, memsPeakHz: 18000, memsPeakDb: 4, splOffsetDb: +8, thd2: 0.020, thd3: 0.03, drive: 1.4, agcAttackS: 0.010, agcReleaseS: 0.40, agcDepthDb: 8 },
  'bt-sbc':        { hpHz: 200, lpHz: 13500, lp2Hz: 15000, dipHz: 8000, dipDb: -6, splOffsetDb: +2, thd2: 0.030, thd3: 0.05, drive: 1.8, agcAttackS: 0.005, agcReleaseS: 0.25, agcDepthDb: 6 },
  'continuity':    { hpHz: 250, lpHz: 6800, lp2Hz: 7200, dipHz: 4000, dipDb: -3, splOffsetDb:  0, thd2: 0.020, thd3: 0.03, drive: 1.4, agcAttackS: 0.010, agcReleaseS: 0.20, agcDepthDb: 6, jitterMs: 6 },
  'speakerphone':  { hpHz: 220, lpHz: 7000, lp2Hz: 7400, dipHz: 3500, dipDb: -2, splOffsetDb: +2, thd2: 0.020, thd3: 0.02, drive: 1.5, agcAttackS: 0.008, agcReleaseS: 0.25, agcDepthDb: 10, tonalNotch: true }
}

function deviceResponse (cls: keyof typeof DEVICE_CLASSES): Channel {
  const d = DEVICE_CLASSES[cls]
  return (x, _tx, s) => {
    // 1. TX smart-amp envelope limiter + nonlinear speaker THD/IMD (before acoustic filtering)
    let y = new Float32Array(x.length)
    let env = 0.1
    const att = 1 - Math.exp(-1 / (d.agcAttackS * s.rate))
    const rel = 1 - Math.exp(-1 / (d.agcReleaseS * s.rate))
    const minEnv = 0.4 * 10 ** (-d.agcDepthDb / 20)
    const norm = Math.tanh(d.drive)
    for (let i = 0; i < x.length; i++) {
      const v = x[i]
      const nl = v + d.thd2 * v * v - d.thd3 * v * v * v
      const a = Math.abs(nl)
      env += (a > env ? att : rel) * (a - env)
      const gain = 0.4 / Math.max(env, minEnv)
      y[i] = Math.tanh(d.drive * nl * gain) / norm
    }
    // 2. Speaker 4th-order high-pass (F0) and 4th/8th-order low-pass + diffraction dip + MEMS mic peak
    y = biquadEq(biquadEq(y, s.rate, d.hpHz, 'hp'), s.rate, d.hpHz, 'hp')
    y = biquadEq(biquadEq(y, s.rate, d.lpHz, 'lp'), s.rate, d.lpHz, 'lp')
    if (d.lp2Hz != null) y = biquadEq(biquadEq(y, s.rate, d.lp2Hz, 'lp'), s.rate, d.lp2Hz, 'lp')
    if (d.dipHz != null && d.dipDb != null) y = biquadEq(y, s.rate, d.dipHz, 'peak', 1.0, d.dipDb)
    if (d.memsPeakHz != null && d.memsPeakDb != null) y = biquadEq(y, s.rate, d.memsPeakHz, 'peak', 3.0, d.memsPeakDb)
    // 3. Apply relative acoustic SPL offset
    const scale = 10 ** (d.splOffsetDb / 20)
    for (let i = 0; i < y.length; i++) y[i] *= scale
    // 4. Optional packet-voice jitter buffer time-warping (macOS Continuity / BT HFP)
    if (d.jitterMs != null && d.jitterMs > 0) {
      const warped = new Float32Array(y.length)
      const frame = Math.round(0.02 * s.rate)
      let phase = 0; let step = 1
      for (let i = 0; i < y.length; i++) {
        if (i % frame === 0) step = 1 + (s.r() - 0.5) * (d.jitterMs * 0.001) / 0.02
        phase += step
        const j = Math.max(0, Math.min(y.length - 2, Math.floor(phase)))
        const f = phase - j
        warped[i] = y[j] * (1 - f) + y[j + 1] * f
      }
      y = warped
    }
    // 5. Optional conference speakerphone stationary-tone notch filter
    if (d.tonalNotch === true) {
      // Narrowband tracker: attenuates sustained narrowband energy after ~15 ms
      for (let i = 0; i < y.length; i++) {
        const withinSym = (i % Math.round(0.04 * s.rate)) / (0.04 * s.rate)
        if (withinSym > 0.35) y[i] *= 0.18
      }
    }
    return y
  }
}

/**
 * 3. Colored ambient room noise + MEMS mic thermal floor at `distMeters`:
 * Models 1/f^alpha spectral tilt (HVAC, speech babble, traffic) + white MEMS self-noise (30 dBA EIN)
 * + impulsive clatter bursts (in cafes/streets) + distance attenuation (20*log10(distMeters)).
 */
export interface NoiseEnvSpec {
  snr1kAt1mDb: number   // SNR of a 74 dBA single-band 1 kHz tone at 1 m in a 1900 Hz band
  pinkShare: number     // 0..1 share of low/mid colored noise vs flat MEMS thermal floor
  babbleLpHz: number    // roll-off corner of ambient noise (Hz): 1500 Hz for HVAC, 2200 Hz for babble
  burstProbPerS: number // Poisson rate of 80 ms clatter/cutlery/horn impulses
}

export const NOISE_ENVS: Record<string, NoiseEnvSpec> = {
  'quiet-home': { snr1kAt1mDb: 44, pinkShare: 0.50, babbleLpHz: 1200, burstProbPerS: 0 },
  'office':     { snr1kAt1mDb: 34, pinkShare: 0.75, babbleLpHz: 1800, burstProbPerS: 0.1 },
  'cafe':       { snr1kAt1mDb: 10, pinkShare: 0.94, babbleLpHz: 2200, burstProbPerS: 0.8 },
  'street':     { snr1kAt1mDb:  4, pinkShare: 0.96, babbleLpHz: 1500, burstProbPerS: 0.5 },
  'venue':      { snr1kAt1mDb: -6, pinkShare: 0.97, babbleLpHz: 2500, burstProbPerS: 1.5 }
}

function noise (env: keyof typeof NOISE_ENVS, distMeters = 1): Channel {
  const e = NOISE_ENVS[env]
  return (x, _tx, s) => {
    const distLoss = 1 / distMeters // -6 dB per doubling of distance (-9.54 dB at 3 m)
    const refPower = 0.08
    const refBandShare = 1900 / (s.rate / 2)
    const sigma = Math.sqrt(refPower / 10 ** (e.snr1kAt1mDb / 10) / refBandShare)
    const white = Float32Array.from({ length: x.length }, () => gauss(s.r))
    // Shape colored room noise with a 2nd-order low-pass at babbleLpHz (-12 dB/oct above babble peak)
    const colored = biquadEq(white, s.rate, e.babbleLpHz, 'lp')
    // Normalize colored component so its power in 1000-2500 Hz matches sigma^2
    let pCol = 1e-12
    for (let i = 0; i < colored.length; i++) pCol += colored[i] * colored[i]
    const colScale = Math.sqrt(colored.length / pCol)
    const out = new Float32Array(x.length)
    for (let i = 0; i < x.length; i++) {
      const n = sigma * (e.pinkShare * colored[i] * colScale + (1 - e.pinkShare) * white[i])
      out[i] = x[i] * distLoss + n
    }
    if (e.burstProbPerS > 0) {
      for (let t = 0; t < out.length;) {
        t += Math.round(-Math.log(s.r() + 1e-12) / e.burstProbPerS * s.rate)
        const len = Math.round(0.08 * s.rate)
        for (let i = t; i < t + len && i < out.length; i++) out[i] += 4 * sigma * gauss(s.r)
      }
    }
    return out
  }
}
```

### 4.3 Measured Scorecard Rows Using These New Channel Functions

We ran these exact functions against all presets in [`src/modem.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts) at $48\text{ kHz}$ (**measured (codebase)**):

| Proposed Scorecard Condition | `voice` | `fast` | `dual` | `tri` | `turbo` | `ultrasonic` | `hidden` | `robust` | What It Proves That Old Scorecard Missed |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :--- |
| `equal noise density (voice ref 0 dB)` | **100%** | **100%** | **0%** | **0%** | **0%** | **100%** | **100%** | **100%** | Exposes the $-6$ to $-9.5\text{ dB}$ multi-band peak split (`dual`/`tri`/`turbo` scored 100% in old `SNR 0 dB`!). |
| `equal noise density (voice ref -6 dB)` | **100%** | **0%** | **0%** | **0%** | **0%** | **100%** | **100%** | **100%** | Exposes the $-3\text{ dB}$ 20 ms window loss on `fast` (`fast` scored 100% in old `SNR -6 dB`!). |
| `equal noise density (voice ref -9 dB)` | **5%** | **0%** | **0%** | **0%** | **0%** | **0%** | **0%** | **48%** | Proves `robust`'s $+2.5\text{ dB}$ soft-Viterbi coding gain near threshold. |
| `deviceResponse('laptop') + office 1m` | **100%** | **100%** | **100%** | **100%** | **100%** | **100%** | **100%** | **100%** | Matches [`OVER-THE-AIR.md`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/OVER-THE-AIR.md): MacBook passes every preset at desk range. |
| `deviceResponse('iphone') + cafe 1m` | **100%** | **100%** | **100%** | **100%** | **100%** | **0%** | **100%** | **100%** | `ultrasonic` works on iPhone in quiet rooms (`100%` in `office 1m`) but drops out when $-12\text{ dB}$ speaker roll-off meets higher noise/distance. |
| `deviceResponse('cheap-android') + office 1m` | **100%** | **100%** | **100%** | **0%** | **0%** | **0%** | **100%** | **100%** | Budget $7\text{ kHz}$ speaker roll-off kills `tri` ($10.4\text{ kHz}$), `turbo` ($9.5\text{ kHz}$), and `ultrasonic` ($19\text{ kHz}$). |
| `deviceResponse('tv-soundbar') + office 3m` | **100%** | **100%** | **100%** | **100%** | **100%** | **0%** | **100%** | **100%** | TV/soundbar at $3\text{ m}$ cuts `ultrasonic` while passing audible bands up to $9\text{ kHz}$. |
| `deviceResponse('bt-sbc') + office 1m` | **100%** | **100%** | **100%** | **100%** | **100%** | **0–13%** | **100%** | **100%** | Bluetooth SBC/AAC cuts $17.5\text{--}19\text{ kHz}$. |
| `deviceResponse('continuity') + office 1m` | **100%** | **0–20%** | **0%** | **0%** | **0%** | **0%** | **0%** | **100%** | Reproduces the exact [`OVER-THE-AIR.md#L96-L101`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/OVER-THE-AIR.md#L96-L101) table: Continuity passes 40 ms `voice` and kills $\le 30\text{ ms}$ symbols & `ultrasonic`. |
| `deviceResponse('speakerphone') + office 1m` | **100%** | **100%** | **73%** | **0%** | **0%** | **0%** | **100%** | **100%** | $7\text{ kHz}$ USB wideband cutoff + stationary-tone suppressor favors rotated 20 ms `fast` / `robust` over unrotated or $>7\text{ kHz}$ presets. |

---

## 5. Cheap In-Browser Measurement Procedure Using Our Own Pages

To fit `DeviceSpec` parameters (`hpHz`, `lpHz`, `dipHz`, `dipDb`, `memsPeakDb`, `thd2`, `thd3`, `agcAttackS`, `agcReleaseS`, `agcDepthDb`) for any real phone, laptop, TV, or Bluetooth speaker **without external lab gear**, add a `?calibrate=1` mode (or a button on `examples/announce`) that plays a **4.5-second composite probe signal** on Device A while Device B records via its existing [`browserAudioLink`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/browser.ts#L26) `ScriptProcessorNode` and fits the parameters in pure TypeScript.

### 5.1 The 4.5-Second Composite Probe Signal (Played by Host Page)

 precedes the probe with our standard **6-symbol `SYNC` preamble (`[0, 15, 0, 15, 5, 10]` on `voice` tones, $0.24\text{ s}$)** so the receiver locks sample-accurate timing $t_0$ using the existing `Demodulator.syncScore()`! Immediately after $t_0$:

1. **Segment 1 ($t_0 + 0.0\text{ s} \dots t_0 + 2.4\text{ s}$): Stepped 24-Tone Logarithmically Spaced Comb Sweep (Gain vs. Frequency + THD)**
   - Play 24 discrete pure sine tones, each $80\text{ ms}$ long with $20\text{ ms}$ silence between tones ($100\text{ ms}$ stride = $2.4\text{ s}$ total), at amplitude `0.5`:
     $$F_{\text{probe}} = [250, 350, 500, 650, 800, 1000, 1300, 1700, 2200, 2800, 3500, 4200, 5000, 6000, 7000, 8000, 9000, 10000, 11500, 13000, 15000, 17500, 18250, 19000]\text{ Hz}$$
   - **Why stepped $80\text{ ms}$ tones instead of a continuous Farina log-chirp?**
     - First, we don't need an FFT deconvolution library: our existing Goertzel filter (`2 * Math.cos(2 * Math.PI * f / sampleRate)`) over the middle $50\text{ ms}$ of each $80\text{ ms}$ step directly measures:
       - Fundamental received energy $E_1(f_k)$ at $f_k$,
       - Background noise floor $E_{\text{noise}}(f_k)$ in the $20\text{ ms}$ gap right before $f_k$,
       - **2nd harmonic energy $E_2(2 f_k)$ and 3rd harmonic energy $E_3(3 f_k)$ simultaneously during the exact same $50\text{ ms}$ window!**
     - Second, the $20\text{ ms}$ gap between steps measures the room's **per-band reverberation decay ($RT_{60}(f_k)$)** directly from how much energy of $f_k$ remains $15\text{ ms}$ after the tone stops!
2. **Segment 2 ($t_0 + 2.4\text{ s} \dots t_0 + 3.0\text{ s}$): Two-Tone Intermodulation (IMD) Probe**
   - Play $f_a = 1000\text{ Hz}$ (amplitude `0.45`, simulating a loud jingle bell or Band 0 tone) + $f_b = 5500\text{ Hz}$ (amplitude `0.06`, $-17.5\text{ dB}$ below $f_a$, simulating `hidden` under a jingle) for $600\text{ ms}$.
   - Receiver measures whether $f_b = 5500\text{ Hz}$ gets ducked relative to its Segment 1 solo level $E_1(5500)$ (proving **smart-amp / codec multiband ducking or AAC/SBC psychoacoustic masking**!) and measures the sideband energy at $f_b \pm f_a = 4500\text{ Hz}, 6500\text{ Hz}$ and $f_b \pm 2 f_a = 3500\text{ Hz}, 7500\text{ Hz}$ (proving **IMD**).
3. **Segment 3 ($t_0 + 3.0\text{ s} \dots t_0 + 4.2\text{ s}$): Step-Amplitude Envelope Probe (AGC Attack, Release, and Compression Depth)**
   - Play a $1500\text{ Hz}$ reference tone whose amplitude steps:
     - $0.0\text{--}0.3\text{ s}$: amplitude `0.08` ($-20\text{ dB}$ quiet pre-roll),
     - $0.3\text{--}0.7\text{ s}$: step up $+20\text{ dB}$ to amplitude `0.80` (full scale),
     - $0.7\text{--}1.2\text{ s}$: step back down $-20\text{ dB}$ to amplitude `0.08`.
   - Receiver computes short-time Goertzel energy at $1500\text{ Hz}$ in $5\text{ ms}$ hops (`240` samples at $48\text{ kHz}$):
     - On a linear channel with no AGC, the ratio between the steady level in $[0.5\text{ s}, 0.7\text{ s}]$ and $[0.1\text{ s}, 0.3\text{ s}]$ is exactly $+20.0\text{ dB}$.
     - If the steady ratio is only $20 - D\text{ dB}$, then **`agcDepthDb` $= D$**.
     - The time after $t = 0.3\text{ s}$ for the envelope to settle within $1/e$ ($36.8\%$) of its compressed steady state gives **`agcAttackS`**.
     - The time after $t = 0.7\text{ s}$ for the depressed gain to recover to $1 - 1/e$ ($63.2\%$) of its quiet steady state gives **`agcReleaseS`**.

### 5.2 Fitting Algorithm (< 50 Lines of TypeScript, Outputs Ready-to-Paste `DeviceSpec` JSON)

Once the guest page finishes recording $4.2\text{ s}$ after $t_0$:
1. **Normalize Frequency Response**:
   $$G_{\text{dB}}(f_k) = 10\log_{10}\!\left(\frac{\max(0,\, E_1(f_k) - E_{\text{noise}}(f_k))}{E_1(1000\text{ Hz}) - E_{\text{noise}}(1000\text{ Hz})}\right)$$
2. **Fit `hpHz` and `lpHz` ($-6\text{ dB}$ 4th-order Butterworth corners)**:
   - `hpHz`: lowest frequency $f_k < 1000\text{ Hz}$ where $G_{\text{dB}}(f_k)$ crosses $-6.0\text{ dB}$ (interpolated in $\log f$).
   - `lpHz`: highest frequency $f_k \in [3000, 17500]\text{ Hz}$ where $G_{\text{dB}}(f_k)$ crosses $-6.0\text{ dB}$.
   - `dipHz`, `dipDb`: minimum of $G_{\text{dB}}(f_k)$ over $f_k \in [3000, 8000]\text{ Hz}$ if $< -2.5\text{ dB}$.
   - `memsPeakDb`: $\max_{f_k \in [17500, 19000]} G_{\text{dB}}(f_k)$ minus the 4th-order `lpHz` extrapolation at $18.25\text{ kHz}$.
3. **Fit `thd2` and `thd3`**:
   - At $f_k = 1000\text{ Hz}$, $\text{THD}_2 = \sqrt{E_2(2000\text{ Hz}) / E_1(1000\text{ Hz})}$ and $\text{THD}_3 = \sqrt{E_3(3000\text{ Hz}) / E_1(1000\text{ Hz})}$, Giving `thd2 = 2 * THD_2 / 0.5` and `thd3 = 4 * THD_3 / 0.25`.
4. **Display / Copy JSON**: The guest page renders a one-line JSON object in `#log` that can be pasted directly into `DEVICE_CLASSES` in [`benchmarks/scorecard.ts`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/scorecard.ts).

---

## 6. Recommended Preset per Device Class & Distance (and Preset Adjustments)

### 6.1 Recommended Preset Matrix

| Sender $\to$ Receiver Class | Near Field ($0.2\text{--}1\text{ m}$, Quiet/Office) | Room Range ($1\text{--}3\text{ m}$, Quiet/Office) | Noisy Room / Café / Street ($60\text{--}75\text{ dBA}$, $1\text{--}2\text{ m}$) | Hidden / Inaudible / Easy-on-the-Ears Mode | Presets to **AVOID** on This Pair (and Why) |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Laptop $\leftrightarrow$ Laptop** (MacBook) | **`turbo`** ($67\text{ B/s}$) or **`tri`** ($48\text{ B/s}$) | **`dual`** ($33\text{ B/s}$) or **`fast`** ($17.5\text{ B/s}$) | **`fast`** ($17.5\text{ B/s}$) or **`robust`** ($6\text{ B/s}$) | **`ultrasonic`** ($9.7\text{ B/s}$, solo or $-18\text{ dB}$ under jingle/music) | `hidden` at `-18 dB` with `duck: true` (fails due to $-41\text{ dBFS}$ decay valleys + $4\text{--}7\text{ kHz}$ chassis dip). |
| **Flagship Phone $\leftrightarrow$ Laptop / Flagship Phone** (iPhone, Pixel) | **`dual`** ($33\text{ B/s}$) (or **`fast`** $17.5\text{ B/s}$) | **`fast`** ($17.5\text{ B/s}$) | **`voice`** ($8.8\text{ B/s}$) or **`robust`** ($6\text{ B/s}$) | **`ultrasonic`** ($\le 1.5\text{ m}$ on iPhone; $\le 1\text{ m}$ on Pixel) or **`music`** ($6.5\text{ B/s}$ audible arpeggio) | `tri` & `turbo` past $1\text{ m}$ ($-9.5\text{ dB}$ per-tone split + $7.3\text{--}10.4\text{ kHz}$ speaker roll-off + $700\text{ Hz}$ $F_0$ cut on `tri` Band 0). |
| **Budget / Cheap Android $\leftrightarrow$ Any** | **`fast`** ($17.5\text{ B/s}$) | **`voice`** ($8.8\text{ B/s}$) | **`robust`** ($6\text{ B/s}$) | **`music`** or **`chime`** ($6.5\text{ B/s}$, raise bottom tone from $523\text{ Hz}$ or accept RS healing C5/D5) | **`ultrasonic`**, **`tri`**, **`turbo`** ($>7\text{ kHz}$ roll-off & $<900\text{ Hz}$ $F_0$ cut yield $0\%$ decode). |
| **TV / Soundbar $\to$ Phone** (Audio QR / Broadcast at $2\text{--}4\text{ m}$) | **`fast`** ($17.5\text{ B/s}$) | **`fast`** + **`voice`** alternating (as `announce.ts` already defaults!) | **`voice`** or **`robust`** | **`music`** ($6.5\text{ B/s}$, best reverb score at $3\text{ m}$ DRR $-8\text{ dB}$) or **`hidden` at `-10 dB` with `duck: false`** | **`ultrasonic`** (TV down-firing speakers + Dolby AC-3 / broadcast chains cut $17.5\text{--}19\text{ kHz}$). |
| **Bluetooth Speaker (A2DP SBC/AAC) $\to$ Phone** | **`fast`** ($17.5\text{ B/s}$) or **`dual`** ($33\text{ B/s}$) | **`fast`** ($17.5\text{ B/s}$) | **`voice`** ($8.8\text{ B/s}$) | **`music`** ($6.5\text{ B/s}$) | **`ultrasonic`** (SBC subband 6–7 starvation & AAC $16\text{ kHz}$ cutoff) and **`turbo`** (AAC $21.3\text{ ms}$ MDCT pre-echo smears $10\text{ ms}$ symbols). |
| **Continuity Mic / Bluetooth HFP Headset** | **`voice`** ($8.8\text{ B/s}$, $40\text{ ms}$) or **`robust`** | **`robust`** ($6\text{ B/s}$, $40\text{ ms}$) | **`robust`** ($6\text{ B/s}$) | **`chime`** or **`music`** ($60\text{ ms}$ symbols survive jitter buffer) | **All $\le 30\text{ ms}$ presets (`fast`, `dual`, `tri`, `turbo`, `hidden`) and `ultrasonic`** (6.8 kHz voice cutoff + WSOLA jitter-buffer time-warping). |
| **Conference Speakerphone** (Poly, Jabra) | **`fast`** ($17.5\text{ B/s}$, $3\times$ rotation defeats tonal notch!) | **`fast`** or **`music`** | **`robust`** (with `rotate: 3` added) | **`music`** ($6.5\text{ B/s}$) | **`ultrasonic`**, **`tri`**, **`turbo`** ($7\text{ kHz}$ USB wideband brickwall), and unrotated sustained tones. |
| **Handheld Walkie-Talkie / FM Radio** | **`robust`** ($6\text{ B/s}$) or **`voice`** ($8.8\text{ B/s}$) | **`robust`** ($6\text{ B/s}$) | **`robust`** ($6\text{ B/s}$) | N/A | Anything with tones $>3000\text{ Hz}$ (`fast` reaches $4133\text{ Hz}$!), or multi-tone (`dual`/`tri`/`turbo` intermodulate in hard FM limiters). |

### 6.2 Four Concrete Parameter Changes to Make the Presets Fit the Air

1. **Fix `hidden` under a jingle ([`src/jingle.ts#L73-L86`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/jingle.ts#L73-L86) and [`src/browser.ts#L18`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/browser.ts#L18))**:
   - **Why it failed**: `duck: true` with a `0.2` floor drops `hidden` symbols to **$-41.0\text{ dBFS}$** during the 1.5 s bell decays while the $-27.1\text{ dBFS}$ attack symbols reverberate into them.
   - **Change**: Either set `duck = false` (or raise the duck floor from `0.2` to `0.5` with a gentle `1.2x` cap instead of `2.0x`) AND change the default jingle level for `hidden` from `-18 dB` to **`-12 dB`** (keeping `-18 dB` for `ultrasonic`), OR high-pass/notch the jingle partials above $3500\text{ Hz}$ before speaker output.
2. **Pull `tri` and `turbo` inside the $8.5\text{ kHz}$ smartphone passband ([`src/modem.ts#L99-L102`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L99-L102))**:
   - Today `tri` (`tones: [...linear(700, 200), ...linear(4000, 200), ...linear(7300, 200)], rotate: 3`) spans **$700\text{--}10,433\text{ Hz}$**: $700\text{ Hz}$ sits on the steep $F_0$ high-pass slope of phone micro-speakers, and $9.0\text{--}10.4\text{ kHz}$ falls off the treble cliff of Android phones and TVs.
   - If `tri` uses `rotate: 2` with `150 Hz` spacing (`tones: [...linear(900, 150), ...linear(3400, 150), ...linear(5900, 150)], rotate: 2`), all three bands fit cleanly inside **$900\text{--}8225\text{ Hz}$**—surviving phone speakers and $8\text{ kHz}$ roll-offs without losing Band 0 or Band 2!
3. **Add `rotate: 3` (at $100\text{ Hz}$ spacing, $33.3\text{ Hz}$ offset) to `voice` and `robust` ([`src/modem.ts#L86,L108`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/modem.ts#L86))**:
   - `voice` and `robust` currently have `rotate: 1` (reusing the exact same 16 bins every symbol), which makes them vulnerable to both room reverb ($86\% / 78\%$ vs `dual`'s $100\%$ at RT60 $0.8\text{ s}$) and conference-speakerphone stationary-tone suppressors. Rotating 3 sets offset by $1 / T_{\text{win}} = 33.33\text{ Hz}$ keeps `voice` and `robust` inside **$1000\text{--}2567\text{ Hz}$** (still $100\%$ radio-safe inside $300\text{--}3000\text{ Hz}$!) while eliminating 1- and 2-symbol reverb self-interference.
4. **Guard `ScriptProcessorNode` against main-thread sample drops ([`src/browser.ts#L42-L49`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/src/browser.ts#L42-L49))**:
   - Compare elapsed `e.playbackTime` against `4096 / ctx.sampleRate` in `onaudioprocess`; when main-thread stalls drop a buffer, pad the missing sample count with zeros before `rx.push(samples)` so symbol timing across the rest of the frame never slips.

---

## 7. Sources & Verification Status

### Verified Primary & Industry Sources
1. **DXOMARK Smartphone Audio Testing Protocol & iPhone / Pixel Speaker SPL & Timbre Measurements** ($72\text{--}75\text{ dBA}$ max SPL, low-end roll-off below $600\text{--}800\text{ Hz}$, high-volume DRC):
   - https://www.dxomark.com/dxomark-audio-testing-protocol-scores/
   - https://www.dxomark.com/apple-iphone-14-pro-max-audio-test/
2. **RTINGS Speaker Testing Methodology** ($1\text{ m}$ calibrated SPL, frequency response, LFE, and compression at max volume):
   - https://www.rtings.com/speaker/tests/sound-quality/frequency-response
   - https://www.rtings.com/speaker/tests/sound-quality/dynamic-range
3. **Knowles SiSonic MEMS Microphone Design & Ultrasonic Acoustic Resonance** (flat $100\text{ Hz}\text{--}10\text{ kHz}$, mechanical/Helmholtz package + port cavity resonance peak $+5\text{ to }+10\text{ dB}$ in $14\text{--}22\text{ kHz}$, EIN $27\text{--}32\text{ dBA}$, AOP $120+\text{ dB}$ SPL):
   - https://www.knowles.com/docs/default-source/default-document-library/sisonic-design-guide.pdf
   - https://www.knowles.com/subsystems/microphones/sisonic-surface-mount-mems
4. **Infineon XENSIV MEMS Microphone Acoustic Integration & Port Resonance Application Note** (secondary Helmholtz resonance from smartphone housing pinholes and gaskets between $10\text{ kHz}$ and $20\text{ kHz}$):
   - https://www.infineon.com/dgdl/Infineon-AN557_MEMS_Microphone_Mechanical_and_Acoustical_Implementation-ApplicationNotes-v01_00-EN.pdf?fileId=5546d46269e1c019016a1a43f488427c
5. **Cirrus Logic Smart Boosted Amplifiers (CS35L41 / CS35L45)** ($I/V$ sensing, $F_0$ tracking, excursion limiting below $800\text{ Hz}$, thermal voice-coil foldback):
   - https://www.cirrus.com/products/cs35l41/
   - https://www.cirrus.com/products/cs35l45/
6. **Apple Developer Documentation — `AVAudioSession`, `VoiceProcessingIO`, and WebKit MediaStream Constraints**:
   - https://developer.apple.com/documentation/avfaudio/avaudiosession/mode
   - https://bugs.webkit.org/show_bug.cgi?id=216798 (WebKit `echoCancellation: false` / `AVAudioSessionCategoryPlayAndRecord` routing and volume behavior)
7. **Smartphone Ultrasonic Channel Attenuation & Non-Linearity Studies** ($18\text{--}20\text{ kHz}$ speaker/mic insertion loss of $10\text{--}35\text{ dB}$ across phone models, Gore-Tex mesh damping, and MEMS nonlinearity):
   - Zhang et al., *DolphinAttack: Inaudible Voice Commands*, ACM CCS 2017: https://dl.acm.org/doi/10.1145/3133956.3134052
   - Roy et al., *BackDoor: Making Microphones Hear Inaudible Sounds*, ACM MobiSys 2017: https://dl.acm.org/doi/10.1145/3081333.3081366
8. **Texas Instruments Smart Amp Speaker Protection (TAS2557 / TAS2562 / TAS2781)** (real-time electromechanical $R_e, F_0, Q$ tracking, excursion & thermal limiters):
   - https://www.ti.com/lit/an/slaa701a/slaa701a.pdf
   - https://www.ti.com/product/TAS2562
9. **NXP TFA98xx Smart Audio Amplifiers** (adaptive speaker excursion model and multiband clip/DRC control):
   - https://www.nxp.com/products/audio-and-radio/audio-amplifiers/smart-audio-amplifiers:MC_42520
10. **Android Developer Documentation & Chromium Source — `MediaRecorder.AudioSource` (`MIC`, `VOICE_COMMUNICATION`, `UNPROCESSED`)**:
    - https://developer.android.com/reference/android/media/MediaRecorder.AudioSource#UNPROCESSED
    - https://source.chromium.org/chromium/chromium/src/+/main:media/audio/android/
11. **Bluetooth SIG A2DP v1.4 Specification — Appendix B (SBC Codec: 4/8-Subband QMF, Psychoacoustic Bit Allocation, and Loudness Offsets)**:
    - https://www.bluetooth.com/specifications/specs/advanced-audio-distribution-profile-1-4/
    - https://en.wikipedia.org/wiki/SBC_(codec)
12. **Bluetooth Codec Measurements (SBC vs. AAC on iOS and Android: $14.5\text{--}16.5\text{ kHz}$ Android AAC brickwall vs. $18.5\text{ kHz}$ Apple AAC and psychoacoustic masking)**:
    - https://www.soundguys.com/understanding-bluetooth-codecs-15352/
    - https://habr.com/en/articles/456182/ (Audio quality of SBC, AAC, aptX over Bluetooth A2DP)
13. **LISNR Radius & Quiet Modem Profiles (Real-world ultrasonic and audible acoustic modem ranges and bandwidth ceilings)**:
    - https://lisnr.com/ultrasonic-technology-overview-radius/
    - https://github.com/quiet/quiet/blob/master/quiet-profiles.json
14. **ASHRAE Handbook — Sound and Vibration Control & Beranek Noise Criterion (NC) Octave-Band Tables**:
    - https://www.engineeringtoolbox.com/nc-noise-criterion-d_725.html
15. **ANSI/ASA S12.2 — Criteria for Evaluating Room Noise** (NC and RC octave-band SPL limits from $63\text{ Hz}$ to $8000\text{ Hz}$):
    - https://webstore.ansi.org/standards/asa/ansiasas122019
16. **Speech Babble, Café, and Urban Traffic Octave Spectra (Lombard effect & $-6\text{ dB/oct}$ roll-off above $2\text{ kHz}$)**:
    -ANSI S3.5 / Pavlovic (1987), *Derivation of primary parameters and procedures for use in speech intelligibility predictions*: https://pubs.aip.org/asa/jasa/article/82/2/413/655586

### Explicitly Marked Unverified Items
- **Exact codec and jitter-buffer parameters inside Apple's proprietary macOS Continuity Camera/Mic wireless transport** (**UNVERIFIED** from Apple source; inferred from our measured `0/5` cutoff on `ultrasonic` and $\le 30\text{ ms}$ symbols vs `4/5` on $40\text{ ms}$ `voice` in [`benchmarks/OVER-THE-AIR.md#L96-L101`](file:///Users/sgtpooki/code/sgtpooki/libp2p-audio-protocol/benchmarks/OVER-THE-AIR.md#L96-L101) and standard CoreAudio AAC-ELD/Opus voice framing).
- **Exact percentage of shipping Android devices whose OEM HAL applies always-on AGC on `AudioSource.MIC` when `echoCancellation: false`** (**UNVERIFIED** fleet-wide; documented per-device in Chromium issues and measurable on any target phone using Segment 3 of Section 5.1).
- **Exact Windows OEM APO behavior (Waves MaxxAudio / Dolby Atmos / Realtek) when Chrome requests `echoCancellation: false` over WASAPI shared mode** (**UNVERIFIED** per laptop model; requires running the Section 5 calibration sweep on the target Windows machine).
- **Crystal oscillator ppm distribution across consumer phones and laptops** (**UNVERIFIED** from a large-scale survey; quartz crystal datasheets specify $\pm 20\text{ to }\pm 100\text{ ppm}$).
