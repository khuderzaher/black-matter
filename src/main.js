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

function setCameraState(state, count = 0, hands = []) {
  cameraState.classList.toggle('is-live', state === 'live' || state === 'tracking');
  if (state === 'loading') cameraLabel.textContent = 'PREPARING SPATIAL SENSING';
  else if (state === 'live') cameraLabel.textContent = 'HAND SENSING READY';
  else if (state === 'tracking') {
    const details = hands.map((hand) => hand.gesture.replaceAll('_', ' ')).join(' · ');
    cameraLabel.textContent = count > 0 ? `${count} HAND${count > 1 ? 'S' : ''} · ${details}` : 'SEARCHING FOR HANDS';
  } else if (state === 'error') cameraLabel.textContent = 'CAMERA UNAVAILABLE';
  else cameraLabel.textContent = 'POINTER FIELD';
}

async function enableCamera() {
  cameraButton.disabled = true;
  cameraButton.textContent = 'INITIALIZING SPATIAL SENSING…';
  try {
    handTracking = new HandTracking(video, onHands, setCameraState);
    await handTracking.start();
    cameraButton.textContent = 'SPATIAL SENSING ACTIVE';
    cameraButton.disabled = false;
    permissionNote.textContent = 'Up to two hands · 21 landmarks each · local camera processing only.';
  } catch (error) {
    console.error('Black Matter hand sensing failed:', error);
    handTracking?.stop();
    handTracking = null;
    cameraButton.disabled = false;
    cameraButton.textContent = 'TRY HAND TRACKING AGAIN';
    permissionNote.textContent = error?.message || 'Hand tracking failed. Pointer and touch interaction remain available.';
    setCameraState('error');
  }
}

enterButton.addEventListener('click', () => setExperienceStarted(true));
cameraButton.addEventListener('click', async () => {
  setExperienceStarted(true);
  await enableCamera();
});

function exitExperience() {
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
