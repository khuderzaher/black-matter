import { FilesetResolver, GestureRecognizer } from '@mediapipe/tasks-vision';

let recognizer = null;
let busy = false;
let consecutiveErrors = 0;
const history = new Map();

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const distance2D = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

async function initialize({ wasmUrl, modelUrl }) {
  const startedAt = performance.now();
  const vision = await FilesetResolver.forVisionTasks(wasmUrl);

  // Use MediaPipe's documented modelAssetPath loader. This avoids a separate
  // fetch/ArrayBuffer stage and lets the task runtime load the model itself.
  recognizer = await GestureRecognizer.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: modelUrl,
      delegate: 'CPU'
    },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.55
  });

  self.postMessage({
    type: 'ready',
    backend: 'CPU',
    modelLoadMs: Math.round(performance.now() - startedAt)
  });
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

function measurePinch(landmarks) {
  const palmWidth = Math.max(0.035, distance2D(landmarks[5], landmarks[17]));
  const thumbIndexGap = distance2D(landmarks[4], landmarks[8]) / palmWidth;
  return clamp((0.92 - thumbIndexGap) / 0.62, 0, 1);
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
  const { fingers, openness: measuredOpenness } = fingerOpenness(smoothed);
  const pinch = measurePinch(smoothed);
  const gestureName = gesture.categoryName || 'Unknown';
  const gestureScore = gesture.score ?? 0;
  const gestureOpenness = {
    Closed_Fist: 0.04,
    Open_Palm: 0.98,
    Pointing_Up: 0.74,
    Victory: 0.84,
    ILoveYou: 0.9,
    Thumb_Up: 0.62,
    Thumb_Down: 0.22
  };
  const openness = gestureScore >= 0.58 && gestureOpenness[gestureName] !== undefined
    ? gestureOpenness[gestureName]
    : measuredOpenness;
  const palm = [0, 5, 9, 13, 17].map((landmarkIndex) => smoothed[landmarkIndex]);
  const center = palm.reduce((sum, point) => ({
    x: sum.x + point.x / 5,
    y: sum.y + point.y / 5
  }), { x: 0, y: 0 });

  return {
    handedness: key,
    handednessScore: handedness.score ?? 0,
    gesture: gestureName,
    gestureScore,
    openness,
    pinch,
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
    self.postMessage({ type: 'frame-error', message: 'Recognizer is not ready or is still processing.' });
    return;
  }

  busy = true;
  const startedAt = performance.now();
  try {
    const result = recognizer.recognizeForVideo(bitmap, timestamp);
    const hands = (result.landmarks || []).slice(0, 2)
      .map((_, index) => buildHand(result, index, timestamp))
      .sort((a, b) => a.handedness.localeCompare(b.handedness));

    consecutiveErrors = 0;
    if (hands.length === 0) history.clear();

    self.postMessage({
      type: 'hands',
      hands,
      timestamp,
      inferenceMs: Math.round(performance.now() - startedAt)
    });
  } catch (error) {
    consecutiveErrors += 1;
    const message = error?.message || 'Gesture recognition failed.';
    self.postMessage({
      type: consecutiveErrors >= 3 ? 'fatal' : 'frame-error',
      message,
      consecutiveErrors
    });
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
