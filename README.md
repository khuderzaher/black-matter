# BLACK MATTER

An immersive, monochrome particle environment built with Three.js, custom GLSL shaders, and optional local hand tracking.

**Status:** 0.1.0 — Particle Core

## Experience

- Full-screen black environment with a volumetric field of up to 88,000 GPU-rendered particles.
- A continuous five-stream spiral structure with layered motion and depth.
- Pointer and touch interaction as a fallback and a way to explore the field immediately.
- Optional camera-based hand tracking powered by MediaPipe Tasks Vision 1.2.x. Camera frames are processed locally in the browser; no video upload is implemented.
- Responsive rendering with a device-aware particle budget.

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

The included GitHub Actions workflow builds the site and publishes `dist/` to GitHub Pages. In the repository settings, set **Pages → Build and deployment → Source** to **GitHub Actions**.

The production base path is configured as `/black-matter/` for this repository.

## Controls

- Move the pointer or drag a finger across the canvas to disturb the field.
- Select **Enable Hand Tracking** to request camera permission and use one hand to influence the particle volume.
- Use **Esc** or the small corner control to return to the entry screen.

## Technical notes

The particle motion is evaluated in a vertex shader, avoiding thousands of individual JavaScript objects and keeping the animation work on the GPU. Hand landmark inference runs in a dedicated Web Worker. Camera frames are transferred as ImageBitmap objects at a bounded cadence, keeping model inference off the main render thread.

## Privacy

The camera is optional. If enabled, the browser obtains a media stream and MediaPipe runs inference locally in a dedicated worker. Camera frames are transferred only to that worker; the application does not send them to a backend. Stopping the page stops the active media tracks.
