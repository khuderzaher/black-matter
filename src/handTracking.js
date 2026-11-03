import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.22/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export class HandTracking {
  constructor(video, onHand, onState) {
    this.video = video;
    this.onHand = onHand;
    this.onState = onState;
    this.landmarker = null;
    this.stream = null;
    this.running = false;
    this.lastVideoTime = -1;
    this.lastDetection = 0;
    this.previousCenter = null;
    this.previousAt = 0;
    this.smoothed = null;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access is not available in this browser context. Use HTTPS or localhost.');
    }

    this.onState('loading');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 }
      }
    });

    this.video.srcObject = this.stream;
    await this.video.play();

    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    this.landmarker = await HandLandmarker.createFromOptions(vision, {
      baseOptions: { modelAssetPath: MODEL_URL, delegate: 'GPU' },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.55,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5
    });

    this.running = true;
    this.onState('live');
    this.loop();
  }

  loop() {
    if (!this.running || !this.landmarker) return;
    const now = performance.now();

    // Hand inference runs at a bounded rate; the particle simulation keeps its own frame cadence.
    if (this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime && now - this.lastDetection > 28) {
      this.lastVideoTime = this.video.currentTime;
      this.lastDetection = now;
      const result = this.landmarker.detectForVideo(this.video, now);
      const landmarks = result.landmarks?.[0];

      if (landmarks) {
        const palmPoints = [landmarks[0], landmarks[5], landmarks[9], landmarks[13], landmarks[17]];
        const center = palmPoints.reduce((acc, point) => ({ x: acc.x + point.x / palmPoints.length, y: acc.y + point.y / palmPoints.length }), { x: 0, y: 0 });
        const wrist = landmarks[0];
        const middleTip = landmarks[12];
        const indexTip = landmarks[8];
        const pinkyTip = landmarks[20];
        const palmScale = Math.max(0.04, Math.hypot(landmarks[5].x - landmarks[17].x, landmarks[5].y - landmarks[17].y));
        const spread = (
          Math.hypot(indexTip.x - wrist.x, indexTip.y - wrist.y) +
          Math.hypot(middleTip.x - wrist.x, middleTip.y - wrist.y) +
          Math.hypot(pinkyTip.x - wrist.x, pinkyTip.y - wrist.y)
        ) / (3 * palmScale);
        const gesture = Math.max(0, Math.min(1, (spread - 1.5) / 1.35));

        if (!this.smoothed) this.smoothed = { ...center };
        this.smoothed.x += (center.x - this.smoothed.x) * 0.34;
        this.smoothed.y += (center.y - this.smoothed.y) * 0.34;

        const velocity = this.previousCenter && this.previousAt
          ? Math.min(1, Math.hypot(center.x - this.previousCenter.x, center.y - this.previousCenter.y) / Math.max(0.016, (now - this.previousAt) / 1000) / 2.5)
          : 0;
        this.previousCenter = { ...center };
        this.previousAt = now;

        // Mirror X so movement matches the user's view of their own hand.
        this.onHand({
          x: (0.5 - this.smoothed.x) * 2,
          y: (0.5 - this.smoothed.y) * 2,
          strength: 0.78 + velocity * 0.22,
          gesture,
          velocity
        });
      } else {
        this.onHand(null);
      }
    }
    this.frame = requestAnimationFrame(() => this.loop());
  }

  stop() {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.onState('off');
  }
}