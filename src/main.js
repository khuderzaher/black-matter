import * as THREE from 'three';
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

const camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 80);
camera.position.set(0, 0, 8.5);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  alpha: false,
  powerPreference: 'high-performance'
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const field = new ParticleField(renderer, scene, camera);
const clock = new THREE.Clock();
const pointer = { x: 0, y: 0, active: false };
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
  pointer.x = (x - 0.5) * 2;
  pointer.y = (0.5 - y) * 2;
  pointer.active = true;
  field.setPointer(pointer.x, pointer.y, 0.78, 0.7);
}

canvas.addEventListener('pointermove', updatePointer, { passive: true });
canvas.addEventListener('pointerdown', (event) => {
  updatePointer(event);
  field.setPointer(pointer.x, pointer.y, 1, 0.88);
});
canvas.addEventListener('pointerleave', () => {
  pointer.active = false;
  if (!handTracking?.running) field.releasePointer();
});

function onHand(hand) {
  if (!hand) {
    field.releasePointer();
    return;
  }
  field.setPointer(hand.x, hand.y, hand.strength, hand.gesture);
}

function setCameraState(state) {
  cameraState.classList.toggle('is-live', state === 'live');
  if (state === 'loading') cameraLabel.textContent = 'INITIALIZING CAMERA';
  else if (state === 'live') cameraLabel.textContent = 'HAND TRACKING ACTIVE';
  else if (state === 'error') cameraLabel.textContent = 'CAMERA UNAVAILABLE';
  else cameraLabel.textContent = 'POINTER FIELD';
}

async function enableCamera() {
  cameraButton.disabled = true;
  cameraButton.textContent = 'INITIALIZING HAND TRACKING…';
  try {
    handTracking = new HandTracking(video, onHand, setCameraState);
    await handTracking.start();
    cameraButton.textContent = 'HAND TRACKING ENABLED';
    cameraButton.disabled = false;
    permissionNote.textContent = 'Your hand is now shaping the field. Camera frames stay on this device.';
  } catch (error) {
    console.error('Black Matter camera setup failed:', error);
    handTracking?.stop();
    handTracking = null;
    cameraButton.disabled = false;
    cameraButton.textContent = 'TRY CAMERA AGAIN';
    permissionNote.textContent = error?.message || 'Camera setup failed. You can continue using pointer or touch interaction.';
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
  field.resize();
}
window.addEventListener('resize', resize, { passive: true });

function animate() {
  if (disposed) return;
  const delta = Math.min(clock.getDelta(), 0.05);
  const elapsed = clock.elapsedTime;
  field.update(elapsed, delta);
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}
animate();

window.addEventListener('pagehide', () => {
  disposed = true;
  handTracking?.stop();
  field.dispose();
  renderer.dispose();
}, { once: true });