# libp2p-audio-protocol
A place for testing and definition of an audio protocol for libp2p

This repo will have a collection of examples and tests for the audio protocol. The goal is to have a simple protocol that can be used to stream audio between peers.

The progress of this protocol will roughly follow the following order:

- [ ] Example: Simple audio streaming between two browsers/tabs (no data, no steganography) -- Cover the basics of microphone capture, audio streaming, and audio playback
- [ ] Example: Simple audio streaming between two browsers/tabs (with data, no steganography) -- Ensure that data can be sent and retrieved within the audio stream
- [ ] Example: Simple audio streaming between two browsers/tabs (with data, with steganography) -- Ensure that a given audio sample can be steganographically encoded, transmitted, and decoded
- [ ] Example: Simple audio streaming between two libp2p peers -- Apply the above concepts to libp2p peers via a libp2p audio protocol (see https://github.com/libp2p/js-libp2p/blob/main/packages/protocol-dcutr/src/dcutr.ts)
- [ ] Example: Audio streaming libp2p peer discovery -- Use the audio protocol to announce self so that others can connect
- [ ] Example: Continuously streaming an audio clip that encodes peer information -- As peers connect to first broadcast audio message, can we append their peer information to the audio clip and then broadcast the updated audio clip?

## Getting started

Check out some of the code in the `examples` folder. Each `examples` sub-folder contains a `README.md` with instructions on how to run the examples.

You can check out notes and progress in the `notes` folder.
