# BLACK MATTER

An immersive spatial particle universe built with Three.js, custom GLSL shaders, Unreal Bloom, and optional local hand-gesture recognition.

**Status:** 0.2.0 — Spatial Nebula

## Experience

- A full-screen black environment with a volumetric field of GPU-rendered particles.
- Multicolour nebula light in indigo, cyan, teal, lavender, rose, and warm amber.
- A slow spacetime-lensing motion field and multi-layer depth.
- Soft post-processing bloom for luminous particle halos.
- Up to two tracked hands, with 21 landmarks per hand, world landmark data, handedness, finger articulation, motion estimates, and recognized gesture categories.
- A subtle luminous hand constellation maps detected joints and bone connections into the 3D field.
- Pointer and touch interaction remain available as a fallback.
- Camera inference runs in a dedicated Web Worker; camera frames stay on-device.

## Run locally

Requirements: Node.js 20.19+, 22.12+, or 24+.

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Camera access is available on localhost and secure HTTPS origins.

## Production build

```bash
npm run build
npm run preview
```

The generated static site is written to `dist/`.

## GitHub Pages

The GitHub Actions workflow builds the site and publishes `dist/`. Set **Settings → Pages → Build and deployment → Source** to **GitHub Actions**.

The production base path is configured as `/black-matter/`.

## Hand tracking

The Gesture Recognizer returns 21 image landmarks, 21 world landmarks, handedness, and gesture categories. Landmark positions and finger openness shape the particle field; a light constellation shows the detected hand articulation. Detection supports up to two hands.

## Privacy

The camera is optional. When enabled, the browser obtains a media stream and transfers image frames to a dedicated local Web Worker for MediaPipe inference. No camera frames are uploaded to an application server. Stopping the experience stops the media tracks.
