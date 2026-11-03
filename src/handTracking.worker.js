import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';

let recognizer = null;
let busy = false;
const history = new Map();

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance2D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

async function initialize({ wasmUrl, modelUrl }) {
  const vision = await FilesetResolver.forVisionTasks(wasmUrl);
  const options = {
    baseOptions: { modelAssetPath: modelUrl, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.58,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.58
  };

  try {
    recognizer = await GestureRecognizer.createFromOptions(vision, options);
  } catch (gpuError) {
    console.warn('Black Matter: GPU gesture recognition unavailable; trying CPU.', gpuError);
    recognizer = await GestureRecognizer.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' }
    });
  }

  self.postMessage({ type: 'ready' });
}

function fingerOpenness(landmarks) {
  const wrist = landmarks[0];
  const definitions = {
    thumb: [2, 4],
    index: [5, 8],
    middle: [9, 12],
    ring: [13, 16],
    pinky: [17, 20]
  };

  const fingers = {};
  for (const [name, [base, tip]] of Object.entries(definitions)) {
    const baseDistance = Math.max(0.035, distance2D(wrist, landmarks[base]));
    const extension = distance2D(wrist, landmarks[tip]) / baseDistance;
    fingers[name] = clamp((extension - 1.12) / 0.78, 0, 1);
  }
  const values = Object.values(fingers);
  return { fingers, openness: values.reduce((sum, value) => sum + value, 0) / values.length };
}

function buildHand(result, index, timestamp) {
  const raw = result.landmarks[index];
  const world = result.worldLandmarks?.[index] || [];
  const handedness = result.handednesses?.[index]?.[0] || result.handedness?.[index]?.[0] || {};
  const gesture = result.gestures?.[index]?.[0] || {};
  const key = handedness.categoryName || String(index);
  const previous = history.get(key);
  const dt = previous ? Math.max(0.016, (timestamp - previous.timestamp) / 1000) : 1 / 30;
  const smoothed = [];
  let totalVelocity = 0;

  for (let pointIndex = 0; pointIndex < 21; pointIndex += 1) {
    const point = raw[pointIndex];
    const old = previous?.landmarks?.[pointIndex];
    const alpha = old ? 0.42 : 1;
    const x = old ? old.x + (point.x - old.x) * alpha : point.x;
    const y = old ? old.y + (point.y - old.y) * alpha : point.y;
    const z = old ? old.z + (point.z - old.z) * alpha : point.z;
    const vx = old ? clamp((point.x - old.x) / dt, -2.2, 2.2) : 0;
    const vy = old ? clamp((point.y - old.y) / dt, -2.2, 2.2) : 0;
    const vz = old ? clamp((point.z - old.z) / dt, -2.8, 2.8) : 0;
    const speed = old ? clamp(Math.hypot(vx, vy, vz * 0.42) / 3.2, 0, 1) : 0;
    totalVelocity += speed;
    smoothed.push({ x, y, z, speed, vx, vy, vz });
  }

  history.set(key, { timestamp, landmarks: smoothed });
  const { fingers, openness } = fingerOpenness(smoothed);
  const palm = [0, 5, 9, 13, 17].map((landmarkIndex) => smoothed[landmarkIndex]);
  const center = palm.reduce((sum, point) => ({ x: sum.x + point.x / 5, y: sum.y + point.y / 5 }), { x: 0, y: 0 });

  return {
    handedness: key,
    handednessScore: handedness.score ?? 0,
    gesture: gesture.categoryName || 'Unknown',
    gestureScore: gesture.score ?? 0,
    openness,
    fingers,
    velocity: totalVelocity / 21,
    center,
    landmarks: smoothed,
    worldLandmarks: world.map((point) => ({ x: point.x, y: point.y, z: point.z }))
  };
}

function processFrame(bitmap, timestamp) {
  if (!recognizer || busy) {
    bitmap.close();
    return;
  }
  busy = true;
  try {
    const result = recognizer.recognizeForVideo(bitmap, timestamp);
    const hands = (result.landmarks || []).slice(0, 2).map((_, index) => buildHand(result, index, timestamp));
    if (hands.length === 0) {
      history.clear();
    }
    self.postMessage({ type: 'hands', hands, timestamp });
  } catch (error) {
    self.postMessage({ type: 'frame-error', message: error?.message || 'Gesture recognition failed.' });
  } finally {
    bitmap.close();
    busy = false;
  }
}

self.addEventListener('message', async (event) => {
  const data = event.data;
  if (data?.type === 'init') {
    try {
      await initialize(data);
    } catch (error) {
      self.postMessage({ type: 'init-error', message: error?.message || 'Unable to initialize gesture recognition.' });
    }
    return;
  }
  if (data?.type === 'frame') {
    processFrame(data.bitmap, data.timestamp);
    return;
  }
  if (data?.type === 'stop') {
    recognizer?.close();
    recognizer = null;
    history.clear();
    self.close();
  }
});
