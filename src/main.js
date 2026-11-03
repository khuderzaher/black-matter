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
const sensorToggle = document.querySelector('#sensor-toggle');
const sensorPanel = document.querySelector('#sensor-panel');
const sensorClose = document.querySelector('#sensor-close');
const sensorStatus = document.querySelector('#sensor-status');
const sensorPreview = document.querySelector('#sensor-preview');
const handOverlay = document.querySelector('#hand-overlay');
const previewEmpty = document.querySelector('#preview-empty');
const sensorLatency = document.querySelector('#sensor-latency');
const sensorFps = document.querySelector('#sensor-fps');
const sensorHandCount = document.querySelector('#sensor-hand-count');
const sensorSummary = document.querySelector('#sensor-summary');
const jointCount = document.querySelector('#joint-count');
const jointReadout = document.querySelector('#joint-readout');
const sensorResolution = document.querySelector('#sensor-resolution');

const handConnections = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];
const landmarkNames = [
  'Wrist', 'Thumb CMC', 'Thumb MCP', 'Thumb IP', 'Thumb tip',
  'Index MCP', 'Index PIP', 'Index DIP', 'Index tip',
  'Middle MCP', 'Middle PIP', 'Middle DIP', 'Middle tip',
  'Ring MCP', 'Ring PIP', 'Ring DIP', 'Ring tip',
  'Pinky MCP', 'Pinky PIP', 'Pinky DIP', 'Pinky tip'
];
const fingerColors = ['#80d9dd', '#9ee0ed', '#aeb3ff', '#c3a7fa', '#e4a8d2', '#a0d8c4'];
let inspectorOpen = false;
let latestHands = [];
let inspectorStructureKey = '';
let jointValueNodes = [];
let handSummaryNodes = [];

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

function makeNode(tag, className, text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function setInspectorOpen(open) {
  inspectorOpen = Boolean(open);
  sensorPanel.hidden = !inspectorOpen;
  sensorPanel.setAttribute('aria-hidden', String(!inspectorOpen));
  sensorToggle.setAttribute('aria-expanded', String(inspectorOpen));
  sensorToggle.classList.toggle('is-open', inspectorOpen);
  if (inspectorOpen) {
    requestAnimationFrame(() => updateInspectorReadout(latestHands));
  }
}

function syncInspectorStructure(hands) {
  const key = hands.map((hand) => hand.handedness || 'HAND').join('|') || 'empty';
  if (key === inspectorStructureKey) return;
  inspectorStructureKey = key;
  jointValueNodes = [];
  handSummaryNodes = [];
  sensorSummary.replaceChildren();
  jointReadout.replaceChildren();

  if (!hands.length) {
    sensorSummary.append(makeNode('p', 'sensor-empty-summary', 'No hand landmarks received yet.'));
    jointReadout.append(makeNode('p', 'sensor-empty-summary', 'Coordinates will appear when a hand is detected.'));
    jointCount.textContent = '0 POINTS';
    return;
  }

  hands.forEach((hand, handIndex) => {
    const summary = makeNode('div', 'hand-summary-card');
    const title = makeNode('span', 'hand-summary-title', `${(hand.handedness || `HAND ${handIndex + 1}`).toUpperCase()} HAND`);
    const gesture = makeNode('span', 'hand-summary-value', 'GESTURE —');
    const speed = makeNode('span', 'hand-summary-value', 'SPEED —');
    const pinch = makeNode('span', 'hand-summary-value', 'PINCH —');
    const openness = makeNode('span', 'hand-summary-value', 'OPEN —');
    summary.append(title, gesture, speed, pinch, openness);
    sensorSummary.append(summary);
    handSummaryNodes.push({ gesture, speed, pinch, openness });

    jointReadout.append(makeNode('div', 'joint-group-title', `${(hand.handedness || `HAND ${handIndex + 1}`).toUpperCase()} · 21 LANDMARKS`));
    for (let landmarkIndex = 0; landmarkIndex < 21; landmarkIndex += 1) {
      const row = makeNode('div', 'joint-row');
      const index = makeNode('span', 'joint-index', String(landmarkIndex).padStart(2, '0'));
      const name = makeNode('span', 'joint-name', landmarkNames[landmarkIndex]);
      const x = makeNode('span', 'joint-value', '—');
      const y = makeNode('span', 'joint-value', '—');
      const z = makeNode('span', 'joint-value', '—');
      const velocity = makeNode('span', 'joint-value', '—');
      row.append(index, name, x, y, z, velocity);
      jointReadout.append(row);
      jointValueNodes.push({ handIndex, landmarkIndex, x, y, z, velocity });
    }
  });

  jointCount.textContent = `${hands.length * 21} POINTS`;
}

function drawHandOverlay(hands) {
  if (!inspectorOpen) return;
  const bounds = sensorPreview.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const width = bounds.width;
  const height = bounds.height;
  const pixelWidth = Math.round(width * dpr);
  const pixelHeight = Math.round(height * dpr);
  if (handOverlay.width !== pixelWidth || handOverlay.height !== pixelHeight) {
    handOverlay.width = pixelWidth;
    handOverlay.height = pixelHeight;
  }
  const context = handOverlay.getContext('2d');
  if (!context) return;
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.clearRect(0, 0, width, height);

  const videoWidth = video.videoWidth;
  const videoHeight = video.videoHeight;
  if (!videoWidth || !videoHeight || !hands.length) return;

  // Match object-fit: cover so the skeleton stays registered to the visible camera crop.
  const scale = Math.max(width / videoWidth, height / videoHeight);
  const drawnWidth = videoWidth * scale;
  const drawnHeight = videoHeight * scale;
  const offsetX = (width - drawnWidth) * 0.5;
  const offsetY = (height - drawnHeight) * 0.5;
  const pointAt = (point) => ({
    x: offsetX + point.x * drawnWidth,
    y: offsetY + point.y * drawnHeight
  });

  hands.forEach((hand, handIndex) => {
    if (!Array.isArray(hand.landmarks) || hand.landmarks.length < 21) return;
    context.save();
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.shadowBlur = 7;

    for (const [from, to] of handConnections) {
      const a = pointAt(hand.landmarks[from]);
      const b = pointAt(hand.landmarks[to]);
      const color = fingerColors[Math.min(5, Math.floor(to / 4))];
      context.beginPath();
      context.moveTo(a.x, a.y);
      context.lineTo(b.x, b.y);
      context.strokeStyle = color;
      context.shadowColor = color;
      context.globalAlpha = 0.76;
      context.lineWidth = 1.25;
      context.stroke();
    }

    hand.landmarks.forEach((landmark, index) => {
      const point = pointAt(landmark);
      const tip = [4, 8, 12, 16, 20].includes(index);
      const radius = tip ? 3.1 : [0, 5, 9, 13, 17].includes(index) ? 2.65 : 2.15;
      const color = fingerColors[Math.min(5, Math.floor(index / 4))];
      context.beginPath();
      context.arc(point.x, point.y, radius, 0, Math.PI * 2);
      context.fillStyle = color;
      context.shadowColor = color;
      context.shadowBlur = 9;
      context.globalAlpha = 0.98;
      context.fill();
      context.shadowBlur = 0;
      context.font = '7px "DM Mono", monospace';
      context.textAlign = 'left';
      context.fillStyle = 'rgba(248,250,255,.88)';
      context.fillText(String(index), point.x + 4, point.y - 3);
    });

    const palm = pointAt(hand.center || hand.landmarks[0]);
    context.beginPath();
    context.arc(palm.x, palm.y, 5.5, 0, Math.PI * 2);
    context.strokeStyle = handIndex === 0 ? 'rgba(175,225,255,.86)' : 'rgba(232,183,239,.86)';
    context.lineWidth = 1;
    context.globalAlpha = 0.85;
    context.stroke();
    context.restore();
  });
}

function updateInspectorReadout(hands = latestHands) {
  syncInspectorStructure(hands);
  sensorHandCount.textContent = `${hands.length} / 2`;
  previewEmpty.hidden = video.readyState >= 2 && video.videoWidth > 0;
  sensorResolution.textContent = video.videoWidth
    ? `${video.videoWidth} × ${video.videoHeight} / ${hands.length} HAND(S)`
    : 'CAMERA NOT CONNECTED';

  handSummaryNodes.forEach((nodes, index) => {
    const hand = hands[index];
    if (!hand) return;
    nodes.gesture.textContent = `${(hand.gesture || 'UNKNOWN').replaceAll('_', ' ')} ${Math.round((hand.gestureScore || 0) * 100)}%`;
    nodes.speed.textContent = `SPEED ${(hand.velocity || 0).toFixed(2)}`;
    nodes.pinch.textContent = `PINCH ${((hand.pinch || 0) * 100).toFixed(0)}%`;
    nodes.openness.textContent = `OPEN ${((hand.openness || 0) * 100).toFixed(0)}%`;
  });

  jointValueNodes.forEach((nodes) => {
    const point = hands[nodes.handIndex]?.landmarks?.[nodes.landmarkIndex];
    if (!point) return;
    nodes.x.textContent = point.x.toFixed(3);
    nodes.y.textContent = point.y.toFixed(3);
    nodes.z.textContent = point.z.toFixed(3);
    const velocity = Math.hypot(point.vx || 0, point.vy || 0, (point.vz || 0) * 0.42);
    nodes.velocity.textContent = velocity.toFixed(2);
    nodes.velocity.title = `Acceleration: ${(point.acceleration || 0).toFixed(2)} normalized units/s²`;
  });

  drawHandOverlay(hands);
}

function onHands(hands) {
  latestHands = hands;
  field.setHands(hands);
  if (inspectorOpen) updateInspectorReadout(hands);
}

function setCameraState(state, count = 0, hands = [], metrics = {}) {
  const active = state === 'live' || state === 'tracking' || state === 'muted' || state === 'warning';
  cameraState.classList.toggle('is-live', active);
  cameraState.classList.toggle('is-warning', state === 'warning' || state === 'muted' || state === 'error');
  sensorToggle.classList.toggle('is-live', active);
  sensorStatus.classList.toggle('is-live', state === 'live' || state === 'tracking');
  sensorStatus.classList.toggle('is-error', state === 'error' || state === 'warning' || state === 'muted');

  if (Number.isFinite(metrics.inferenceMs)) sensorLatency.textContent = `${metrics.inferenceMs} MS`;
  if (Number.isFinite(metrics.fps) && metrics.fps > 0) sensorFps.textContent = `${metrics.fps.toFixed(1)} FPS`;
  sensorHandCount.textContent = `${count} / 2`;
  if (metrics.width && metrics.height) sensorResolution.textContent = `${metrics.width} × ${metrics.height} / ${count} HAND(S)`;

  if (state === 'loading') {
    cameraLabel.textContent = 'STARTING CAMERA AND MODEL';
    sensorStatus.textContent = 'INITIALIZING SENSOR';
  } else if (state === 'live') {
    cameraLabel.textContent = 'CAMERA LIVE · WAITING FOR FIRST RESULT';
    sensorStatus.textContent = 'CAMERA LIVE · ANALYSIS STARTING';
    if (metrics.message) permissionNote.textContent = metrics.message;
  } else if (state === 'tracking') {
    const details = hands.map((hand) => hand.gesture.replaceAll('_', ' ')).join(' · ');
    const inference = Number.isFinite(metrics.inferenceMs) ? ` · ${metrics.inferenceMs} MS` : '';
    cameraLabel.textContent = count > 0
      ? `${count} HAND${count > 1 ? 'S' : ''} · ${details}${inference}`
      : `CAMERA LIVE · NO HAND DETECTED${inference}`;
    sensorStatus.textContent = count > 0 ? `TRACKING ${count} HAND${count > 1 ? 'S' : ''}` : 'SEARCHING FOR HANDS';
    if (metrics.frames) permissionNote.textContent = `Live analysis · ${metrics.frames} frames processed · ${metrics.width || 0}×${metrics.height || 0} camera`;
  } else if (state === 'recovering') {
    cameraLabel.textContent = 'RESTARTING HAND ENGINE';
    sensorStatus.textContent = 'RECONNECTING SENSOR';
    if (metrics.message) permissionNote.textContent = metrics.message;
  } else if (state === 'warning' || state === 'muted') {
    const detail = (metrics.message || 'Waiting for the camera stream.').replaceAll('_', ' ');
    cameraLabel.textContent = (state === 'muted' ? 'CAMERA PAUSED · ' : 'ANALYSIS WARNING · ') + detail.slice(0, 76);
    sensorStatus.textContent = state === 'muted' ? 'CAMERA STREAM PAUSED' : 'ANALYSIS WARNING';
    permissionNote.textContent = metrics.message || 'The recognition engine reported a temporary warning.';
  } else if (state === 'error') {
    const detail = metrics.message || 'Camera or recognition worker stopped unexpectedly.';
    cameraLabel.textContent = `TRACKING ERROR · ${detail.slice(0, 82)}`;
    sensorStatus.textContent = 'TRACKING ERROR';
    permissionNote.textContent = detail;
    cameraButton.disabled = false;
    cameraButton.textContent = 'RETRY HAND TRACKING';
  } else {
    cameraLabel.textContent = 'POINTER FIELD';
    sensorStatus.textContent = 'CAMERA STANDBY';
    sensorLatency.textContent = '—';
    sensorFps.textContent = '—';
  }

  if (inspectorOpen) updateInspectorReadout(latestHands);
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
  setInspectorOpen(false);
  handTracking?.stop();
  handTracking = null;
  setExperienceStarted(false);
  cameraButton.disabled = false;
  cameraButton.textContent = 'ENABLE HAND TRACKING';
  permissionNote.textContent = 'Camera access is optional. Video is processed locally in your browser.';
  setCameraState('off');
}
exitButton.addEventListener('click', exitExperience);
sensorToggle.addEventListener('click', () => setInspectorOpen(!inspectorOpen));
sensorClose.addEventListener('click', () => setInspectorOpen(false));
window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && inspectorOpen) {
    setInspectorOpen(false);
    return;
  }
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
  if (inspectorOpen) drawHandOverlay(latestHands);
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
