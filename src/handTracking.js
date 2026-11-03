const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';

export class HandTracking {
  constructor(video, onHands, onState) {
    this.video = video;
    this.onHands = onHands;
    this.onState = onState;
    this.stream = null;
    this.worker = null;
    this.running = false;
    this.framePending = false;
    this.lastVideoTime = -1;
    this.lastSentAt = 0;
    this.frame = 0;
    this.resolveReady = null;
    this.rejectReady = null;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access is unavailable here. Use HTTPS or localhost.');
    }
    if (typeof createImageBitmap !== 'function') {
      throw new Error('This browser cannot transfer camera frames to the hand-recognition worker.');
    }

    this.onState('loading');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: 'user',
        width: { ideal: 960 },
        height: { ideal: 540 },
        frameRate: { ideal: 30, max: 30 }
      }
    });

    this.video.srcObject = this.stream;
    await this.video.play();

    this.worker = new Worker(new URL('./handTracking.worker.js', import.meta.url), { type: 'module' });
    const ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.worker.addEventListener('message', (event) => {
      const data = event.data;
      if (data?.type === 'ready') this.resolveReady?.();
      if (data?.type === 'init-error') this.rejectReady?.(new Error(data.message));
      if (data?.type === 'hands') {
        this.framePending = false;
        this.onHands(data.hands || []);
        this.onState('tracking', data.hands?.length || 0, data.hands || []);
      }
      if (data?.type === 'frame-error') {
        this.framePending = false;
        console.warn('Black Matter gesture frame:', data.message);
      }
    });

    this.worker.addEventListener('error', (event) => {
      this.framePending = false;
      this.rejectReady?.(new Error(event.message || 'The gesture worker stopped unexpectedly.'));
    });

    this.worker.postMessage({ type: 'init', wasmUrl: WASM_URL, modelUrl: MODEL_URL });
    await ready;

    this.running = true;
    this.onState('live');
    this.loop();
  }

  loop() {
    if (!this.running || !this.worker) return;
    const now = performance.now();

    // Inference is capped independently of the graphics frame loop.
    if (
      this.video.readyState >= 2 &&
      this.video.currentTime !== this.lastVideoTime &&
      now - this.lastSentAt >= 30 &&
      !this.framePending
    ) {
      this.lastVideoTime = this.video.currentTime;
      this.lastSentAt = now;
      this.framePending = true;

      createImageBitmap(this.video).then((bitmap) => {
        if (!this.running || !this.worker) {
          bitmap.close();
          this.framePending = false;
          return;
        }
        this.worker.postMessage({ type: 'frame', bitmap, timestamp: now }, [bitmap]);
      }).catch((error) => {
        this.framePending = false;
        console.warn('Black Matter could not transfer a camera frame:', error);
      });
    }

    this.frame = requestAnimationFrame(() => this.loop());
  }

  stop() {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.worker?.postMessage({ type: 'stop' });
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.framePending = false;
    this.onHands([]);
    this.onState('off');
  }
}
