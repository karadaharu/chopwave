# CHOPWAVE

A browser-based, 16-slice sampling instrument built for direct, low-friction performance.

## Run locally

Node.js 20.19+ or 22.12+ is required.

```sh
pnpm install
pnpm dev
```

Then open the local URL printed by Vite in Chrome and drop a WAV onto the waveform area.

The equivalent `npm install` and `npm run dev` commands also work.

## Checks

```sh
pnpm check
pnpm typecheck
pnpm build
```

Audio stays entirely in the browser. Each pad creates a fresh one-shot Web Audio voice. A new hit
chokes the previous voice, with a shared playback-length control and short envelopes feeding a
master gain and final dynamics compressor.
