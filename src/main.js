import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ParticleField } from './particleField.js';
import { HandTracking } from './handTracking.js';
import './style.css';

const canvas = document.querySelector('#field');
const video = document.querySelector('#camera-video');
const intro = document.querySelector('#intro');
const enterButton = document.querySelector('#enter-button');
const cameraButton = document.querySelector('#camera-button');
const exitButton = document.querySelector('#exit-button');
const cameraState = document.querySelector('#camera-state');
const cameraLabel = document.querySelector('#camera-label');
const permissionNote = document.querySelector('#permission-note');

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x000000);
scene.fog = new THREE.FogExp2(0x03030a, 0.012);

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 90);
camera.position.set(0, 0, 8.5);

const pixelRatio = Math.min(window.devicePixelRatio || 1, window.innerWidth < 760 ? 1.2 : 1.55);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.NoToneMapping;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.12,
  0.72,
  0.16
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

const field = new ParticleField(renderer, scene, camera);
const clock = new THREE.Clock();
let experienceStarted = false;
let handTracking = null;
let disposed = false;

function requestImmersiveFullscreen() {
  const root = document.documentElement;
  if (!document.fullscreenElement && typeof root.requestFullscreen === 'function') {
    root.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
      // Fullscreen is an enhancement; the experience remains usable when it is denied.
    });
  }
}

function setExperienceStarted(started) {
  experienceStarted = started;
  intro.classList.toggle('is-hidden', started);
  cameraState.classList.toggle('is-visible', started);
  exitButton.classList.toggle('is-visible', started);
  document.body.classList.toggle('is-immersive', started);
  if (!started) field.releasePointer();
}

function updatePointer(event) {
  if (!experienceStarted || handTracking?.running) return;
  const rect = canvas.getBoundingClientRect();
  const x = (event.clientX - rect.left) / rect.width;
  const y = (event.clientY - rect.top) / rect.height;
  field.setPointer((x - 0.5) * 2, (0.5 - y) * 2, 0.82, 0.62);
}
canvas.addEventListener('pointermove', updatePointer, { passive: true });
canvas.addEventListener('pointerdown', updatePointer, { passive: true });
canvas.addEventListener('pointerleave', () => {
  if (!handTracking?.running) field.releasePointer();
});

function onHands(hands) {
  field.setHands(hands);
}

function setCameraState(state, count = 0, hands = [], metrics = {}) {
  const active = state === 'live' || state === 'tracking' || state === 'muted' || state === 'warning';
  cameraState.classList.toggle('is-live', active);
  cameraState.classList.toggle('is-warning', state === 'warning' || state === 'muted' || state === 'error');

  if (state === 'loading') {
    cameraLabel.textContent = 'STARTING CAMERA AND MODEL';
  } else if (state === 'live') {
    cameraLabel.textContent = 'CAMERA LIVE · WAITING FOR FIRST RESULT';
    if (metrics.message) permissionNote.textContent = metrics.message;
  } else if (state === 'tracking') {
    const details = hands.map((hand) => hand.gesture.replaceAll('_', ' ')).join(' · ');
    const inference = Number.isFinite(metrics.inferenceMs) ? ` · ${metrics.inferenceMs} MS` : '';
    cameraLabel.textContent = count > 0
      ? `${count} HAND${count > 1 ? 'S' : ''} · ${details}${inference}`
      : `CAMERA LIVE · NO HAND DETECTED${inference}`;
    if (metrics.frames) permissionNote.textContent = `Live analysis · ${metrics.frames} frames processed · ${metrics.width || 0}×${metrics.height || 0} camera`;
  } else if (state === 'recovering') {
    cameraLabel.textContent = 'RESTARTING HAND ENGINE';
    if (metrics.message) permissionNote.textContent = metrics.message;
  } else if (state === 'warning' || state === 'muted') {
    const detail = (metrics.message || 'Waiting for the camera stream.').replaceAll('_', ' ');
    cameraLabel.textContent = (state === 'muted' ? 'CAMERA PAUSED · ' : 'ANALYSIS WARNING · ') + detail.slice(0, 76);
    permissionNote.textContent = metrics.message || 'The recognition engine reported a temporary warning.';
  } else if (state === 'error') {
    const detail = metrics.message || 'Camera or recognition worker stopped unexpectedly.';
    cameraLabel.textContent = `TRACKING ERROR · ${detail.slice(0, 82)}`;
    permissionNote.textContent = detail;
    cameraButton.disabled = false;
    cameraButton.textContent = 'RETRY HAND TRACKING';
  } else {
    cameraLabel.textContent = 'POINTER FIELD';
  }
}

async function enableCamera() {
  cameraButton.disabled = true;
  cameraButton.textContent = 'INITIALIZING SPATIAL SENSING…';
  try {
    handTracking = new HandTracking(video, onHands, setCameraState);
    await handTracking.start();
    cameraButton.textContent = 'SPATIAL SENSING ACTIVE';
    cameraButton.disabled = false;
    permissionNote.textContent = 'Camera connected. Waiting for live hand landmarks…';
  } catch (error) {
    console.error('Black Matter hand sensing failed:', error);
    handTracking?.stop();
    handTracking = null;
    cameraButton.disabled = false;
    cameraButton.textContent = 'TRY HAND TRACKING AGAIN';
    const detail = error?.message || 'Hand tracking failed. Pointer and touch interaction remain available.';
    permissionNote.textContent = detail;
    setCameraState('error', 0, [], { message: detail });
  }
}

enterButton.addEventListener('click', () => {
  requestImmersiveFullscreen();
  setExperienceStarted(true);
});
cameraButton.addEventListener('click', async () => {
  requestImmersiveFullscreen();
  setExperienceStarted(true);
  await enableCamera();
});

function exitExperience() {
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  handTracking?.stop();
  handTracking = null;
  setExperienceStarted(false);
  cameraButton.disabled = false;
  cameraButton.textContent = 'ENABLE HAND TRACKING';
  permissionNote.textContent = 'Camera access is optional. Video is processed locally in your browser.';
  setCameraState('off');
}
exitButton.addEventListener('click', exitExperience);
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && experienceStarted) exitExperience();
});

function resize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
  composer.setSize(width, height);
  field.resize();
}
window.addEventListener('resize', resize, { passive: true });

function animate() {
  if (disposed) return;
  const delta = Math.min(clock.getDelta(), 0.05);
  field.update(clock.elapsedTime, delta);
  composer.render(delta);
  requestAnimationFrame(animate);
}
animate();

window.addEventListener('pagehide', () => {
  disposed = true;
  handTracking?.stop();
  field.dispose();
  composer.dispose();
  renderer.dispose();
}, { once: true });

// Leaving browser fullscreen must not terminate the camera stream or the recognition worker.
document.addEventListener('fullscreenchange', resize);
