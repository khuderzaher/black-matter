import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

let landmarker = null;
let previousCenter = null;
let previousAt = 0;
let smoothed = null;
let busy = false;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function initialize({ wasmUrl, modelUrl }) {
  const vision = await FilesetResolver.forVisionTasks(wasmUrl);
  const options = {
    baseOptions: { modelAssetPath: modelUrl, delegate: 'GPU' },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5
  };

  try {
    landmarker = await HandLandmarker.createFromOptions(vision, options);
  } catch (gpuError) {
    // GPU delegates are not available in every browser/device combination.
    console.warn('Black Matter: GPU hand inference unavailable; falling back to CPU.', gpuError);
    landmarker = await HandLandmarker.createFromOptions(vision, {
      ...options,
      baseOptions: { modelAssetPath: modelUrl, delegate: 'CPU' }
    });
  }

  self.postMessage({ type: 'ready' });
}

function estimateHand(landmarks, timestamp) {
  const palmPoints = [landmarks[0], landmarks[5], landmarks[9], landmarks[13], landmarks[17]];
  const center = palmPoints.reduce((acc, point) => ({
    x: acc.x + point.x / palmPoints.length,
    y: acc.y + point.y / palmPoints.length
  }), { x: 0, y: 0 });

  const wrist = landmarks[0];
  const indexTip = landmarks[8];
  const middleTip = landmarks[12];
  const pinkyTip = landmarks[20];
  const palmScale = Math.max(0.04, Math.hypot(
    landmarks[5].x - landmarks[17].x,
    landmarks[5].y - landmarks[17].y
  ));

  const spread = (
    Math.hypot(indexTip.x - wrist.x, indexTip.y - wrist.y) +
    Math.hypot(middleTip.x - wrist.x, middleTip.y - wrist.y) +
    Math.hypot(pinkyTip.x - wrist.x, pinkyTip.y - wrist.y)
  ) / (3 * palmScale);
  const gesture = clamp((spread - 1.5) / 1.35, 0, 1);

  if (!smoothed) smoothed = { ...center };
  smoothed.x += (center.x - smoothed.x) * 0.34;
  smoothed.y += (center.y - smoothed.y) * 0.34;

  const seconds = Math.max(0.016, (timestamp - previousAt) / 1000);
  const velocity = previousCenter && previousAt
    ? clamp(Math.hypot(center.x - previousCenter.x, center.y - previousCenter.y) / seconds / 2.5, 0, 1)
    : 0;

  previousCenter = { ...center };
  previousAt = timestamp;

  // Mirror X so the field follows the hand as seen in a mirror.
  return {
    x: (0.5 - smoothed.x) * 2,
    y: (0.5 - smoothed.y) * 2,
    strength: 0.78 + velocity * 0.22,
    gesture,
    velocity
  };
}

async function processFrame(bitmap, timestamp) {
  if (!landmarker || busy) {
    bitmap.close();
    return;
  }
  busy = true;
  try {
    const result = landmarker.detectForVideo(bitmap, timestamp);
    const landmarks = result.landmarks?.[0];
    self.postMessage({
      type: 'hand',
      hand: landmarks ? estimateHand(landmarks, timestamp) : null
    });
  } catch (error) {
    self.postMessage({ type: 'frame-error', message: error?.message || 'Hand inference failed.' });
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
      self.postMessage({ type: 'init-error', message: error?.message || 'Unable to initialize hand tracking.' });
    }
    return;
  }

  if (data?.type === 'frame') {
    await processFrame(data.bitmap, data.timestamp);
    return;
  }

  if (data?.type === 'stop') {
    landmarker?.close();
    landmarker = null;
    self.close();
  }
});
