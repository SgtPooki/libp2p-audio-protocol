<!-- toc -->

# Intro

The notes below were written during Protocol Labs 2023 LabWeek in Istanbul, Turkey

They have been slightly cleaned up, organized, and added to but still require further refinement.

# Why audio?

- Audio is a ubiquitous medium that is available on almost all devices
- Audio is a medium that has a lot of potential for steganography
- Audio is a medium that is often overlooked for practical use-cases

Because of all of the above, audio is a great medium for a libp2p protocol.

## Benefits over other transports

- Doesn't require line of site
- Audio can be more direct for a room of potential peers than typical network traversal.
- Audio lends itself to p2p and decentralization better than centralized bootstrap servers.
- Audio may be used to bootstrap other transports (bluetooth, webrtc, etc)
- Audio can completely bypass censorship by ISPs and other internet providers
- Audio is local-first, and can be used to transmit data without the need for an internet connection

## Potential use-cases

All of the below ideas could use the same audio transport that simply have a different signaling header. Peers can choose whether to enable/disable listening for each.

### Audio bootstrapping

We could encode multiaddr (fairly small data) in audio snippet, and use to allow for easily announcing ones multiaddr for peer discovery. listeners (hearing peer) could immediately try to connect to heard multiaddr. All listeners connect to sound player (speaking peer) and then sound player can tell everyone about the peers that connect to it.

The result is a quickly connected room after a short sound byte

### Secret drops at concerts & private events

Encode data in random location in audio clip, and then play at event. Folks can run an app to listen to the live concert to prove they were at the event. Could be used for NFTs, or other special content.

### Emergency Broadcast System (radio/tv/etc)

Constantly announce a CID for data containing further details about whatever needed. In an IPFS world with no ISPs or internet backbone, a network of long/short wave enabled IPFS nodes could host and fetch content easily.

### Broadcast stations sharing data

A radio/tv station could encode a CID into their audio stream, and then listeners could fetch the data from IPFS. If we provide an app similar to "Shazam" (or integrate with existing apps) that can listen to the radio and then fetch the data, we could have a way for radio/tv stations to share data more easily with their listeners.

Because the CID references a content-addressed piece of data, and IPFS


## Other thoughts

- Do we want different audio clips for different data types? Or do we want to be able to send data in any audio clip?
    - I think we want to be able to send data in any audio clip, but we should start with a single audio clip and then move to any audio clip
- Play a recognizeable jingle/clip with a QR code so we have visual + audio
- Bit rate, reduce the bit rate of an audio file, and then encode our data bits into the remaining space to result in a song with the same bit rate?

## Questions

- How does one peer differentiate between two separate peers playing sound at the same time?
    - Is it feasible to have a room full of peers transmitting data only over audio? How can we encode the data in a way that allows listeners to discern between multiple peers emitting audio simultaneously?
- There is a patent for transmitting data over audio.. I haven't read it, but there are plenty of audio signaling prior to that patent (also, IANAL)?
    - https://smus.com/ultrasonic-networking/ & [https://smus.com/patents/2017 - Communicating Data with Audible Harmonies.pdf](https://smus.com/patents/2017%20-%20Communicating%20Data%20with%20Audible%20Harmonies.pdf)
- Do we want audio that is recorded to be the same as audio that is played? Or do we only want to be able to play audio so that a recording of the audio would not be able to have it's data extracted?
    - I think both are useful, but we should start with the former and then move to the latter
- Is this a protocol or a transport or both?
    - Do we want to be as flexible as other libp2p transports? Or do we want to be more rigid? If the latter, then we should be a protocol. If the former, then we should be a transport.
        - Does it make sense to send typical libp2p messages over audio or should we stick to signaling and then use other transports for the actual data?
- Could we use the audio protocol to bootstrap a bluetooth connection?
- Could we use the audio protocol to transmit a password to only libp2p-audio-protocol enabled devices and then use MDNS?


## References and links

### Prior art

- https://ggerganov.github.io/wave-share
- https://smus.com/ultrasonic-networking/


### Misc

- https://github.com/libp2p/js-libp2p/issues/262
- https://meyda.js.org/audio-features.html
- https://gist.github.com/EmilHernvall/1250788
- Fm, am: https://www.reddit.com/r/explainlikeimfive/comments/3m42g8/comment/cvbsohh/
- Pulse code modulation (PCM) (how rc car controllers work): https://www.usbmemorydirect.com/blog/audio-encoding-a-sample/
- Frequency Shift Keying (FSK) - https://electronicscoach.com/frequency-shift-keying.html
- [https://github.com/ggerganov/ggwave/tree/master/examples/arduino-tx](https://github.com/ggerganov/ggwave/tree/master/examples/arduino-tx)
- https://support.serato.com/hc/en-us/articles/202841084-Audio-Encoding-101
- https://medium.com/analytics-vidhya/get-secret-message-from-audio-file-8769421205c3

## Radio & Audio Terms

### General

- DSP: Digital signal processing
- ADC: Analog-to-digital converter
- DAC: Digital-to-analog converter

### Modulation

- FM: Frequency modulation
- PCM: Pulse-code modulation
- FSK: Frequency-shift keying
- BFSK: Binary frequency-shift keying
- QPSK: Quadrature phase-shift keying
- BPSK: Binary phase-shift keying
- AM: Amplitude modulation
- QAM: Quadrature amplitude modulation
- ASK: Amplitude-shift keying

### Filtering

- LPF: Low-pass filter
- HPF: High-pass filter
- BPF: Band-pass filter
- BSF: Band-stop filter
- FIR: Finite impulse response
- IIR: Infinite impulse response
- Goertzel filter: https://en.wikipedia.org/wiki/Goertzel_algorithm

### Multiplexing

- FDM: Frequency-division multiplexing

### Transforms

- FFT: Fast Fourier transform
- DFT: Discrete Fourier transform
- STFT: Short-time Fourier transform
- DCT: Discrete cosine transform
- MDCT: Modified discrete cosine transform
- DWT: Discrete wavelet transform
- DHT: Discrete Hartley transform
- DTFT: Discrete-time Fourier transform
- DRT: Discrete Radon transform
- DST: Discrete sine transform

### Signaling

- DTMF: Dual-tone multi-frequency signaling
- DCS: Digital-Coded Squelch
- CTCSS: Continuous Tone-Coded Squelch System

### Other terms that may or may not be related

- BAO: Baryon acoustic oscillations - https://en.wikipedia.org/wiki/Baryon_acoustic_oscillations
