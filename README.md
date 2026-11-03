# BLACK MATTER

An immersive spatial particle universe built with Three.js, custom GLSL shaders, Unreal Bloom, and optional local hand-gesture recognition.

**Status:** 0.3.6 — Live Sensor Inspector & 3D Joint Telemetry

## Experience

- A full-screen black environment with a volumetric field of GPU-rendered particles.
- Multicolour nebula light in indigo, cyan, teal, lavender, rose, and warm amber.
- A slow spacetime-lensing motion field, an animated fractal nebula backdrop, and multi-layer depth.
- Soft post-processing bloom for luminous particle halos.
- Up to two tracked hands, with 21 landmarks per hand, world landmark data, handedness, finger articulation, motion estimates, and recognized gesture categories.
- A collapsible live sensor inspector shows the mirrored camera feed, 21-joint hand skeleton, live coordinates, per-joint velocity and acceleration, inference latency, frame rate, and processed-frame count.
- A subtle luminous hand constellation maps detected joints and bone connections into the 3D field. Filtered joint velocity and acceleration drive directional particle wakes, soft ripples, and gesture-controlled condensation/expansion.
- Pointer and touch interaction remain available as a fallback. The experience requests browser fullscreen from the entry action when supported.
- Camera inference runs in a dedicated Web Worker using the CPU delegate for more predictable mobile-browser operation. The camera loop monitors track state, frame transfer, inference results, and worker stalls; it attempts one worker recovery before reporting a visible error.

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

## Camera diagnostics

A small sensor icon opens a compact, closable diagnostics window without stopping the experience. It displays the live mirrored camera preview with the recognised skeleton aligned to the camera crop. Each detected hand exposes all 21 landmark coordinates (normalised image X/Y and relative depth Z), camera-pixel positions, hand-centred 3D world coordinates in metres, per-joint velocity and acceleration vectors, alongside gesture confidence, pinch, openness, inference time, smoothed inference FPS, camera resolution, and processed-frame count. Tap a joint row to expand its 3D and motion vectors. The preview and all analysis run locally in the browser.

## Hand tracking

The Gesture Recognizer returns 21 image landmarks, 21 world landmarks, handedness, and gesture categories. Recognized poses such as Open Palm and Closed Fist map to distinct expansion and contraction responses. Landmark positions, world-depth coordinates, adaptive temporal smoothing, per-joint velocity and acceleration, finger openness, and thumb-index pinch distance shape the particle field; a light constellation shows detected articulation. Detection supports up to two hands.

## Privacy

The camera is optional. When enabled, the browser obtains a media stream and transfers image frames to a dedicated local Web Worker for MediaPipe inference. No camera frames are uploaded to an application server. MediaPipe notes that it may send API performance/utilization metrics; see its [privacy notice](https://developers.google.com/edge/mediapipe/solutions/tasks#mediapipe_tasks_privacy_notice). Stopping the experience stops the media tracks.
