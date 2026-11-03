const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.0/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
const FRAME_INTERVAL_MS = 72;
const FRAME_WATCHDOG_MS = 5000;

export class HandTracking {
  constructor(video, onHands, onState) {
    this.video = video;
    this.onHands = onHands;
    this.onState = onState;
    this.stream = null;
    this.track = null;
    this.worker = null;
    this.running = false;
    this.framePending = false;
    this.lastVideoTime = -1;
    this.lastSentAt = 0;
    this.lastResultAt = 0;
    this.pendingSince = 0;
    this.frame = 0;
    this.restartCount = 0;
    this.resolveReady = null;
    this.rejectReady = null;
    this.lastInferenceMs = 0;
    this.framesProcessed = 0;
    this.handsDetected = 0;
  }

  async start() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access is unavailable here. Open the site over HTTPS or localhost.');
    }
    if (typeof createImageBitmap !== 'function') {
      throw new Error('This browser cannot transfer camera frames to the hand-recognition worker.');
    }

    this.onState('loading', 0, [], { message: 'Requesting camera permission…' });
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'user' },
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 24, max: 30 }
      }
    });

    this.track = this.stream.getVideoTracks()[0];
    if (!this.track) throw new Error('The camera stream contains no video track.');

    this.track.addEventListener('ended', () => {
      if (this.running) this.fail('The camera track ended. Check camera permissions and whether another app is using the camera.');
    });
    this.track.addEventListener('mute', () => {
      if (this.running) this.onState('muted', 0, [], { message: 'Camera stream is temporarily muted by the browser.' });
    });
    this.track.addEventListener('unmute', () => {
      if (this.running) this.onState('live', 0, [], { message: 'Camera stream resumed.' });
    });

    this.video.autoplay = true;
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = this.stream;
    await this.video.play();

    await this.initializeWorker();
    this.running = true;
    this.lastResultAt = performance.now();
    this.onState('live', 0, [], {
      backend: 'CPU',
      width: this.video.videoWidth,
      height: this.video.videoHeight,
      message: 'Camera is live; waiting for the first analysed frame.'
    });
    this.loop();
  }

  async initializeWorker() {
    const ready = new Promise((resolve, reject) => {
      this.resolveReady = resolve;
      this.rejectReady = reject;
    });

    this.worker = new Worker(new URL('./handTracking.worker.js', import.meta.url), { type: 'module' });
    this.worker.addEventListener('message', (event) => {
      const data = event.data;

      if (data?.type === 'ready') {
        this.resolveReady?.(data);
        return;
      }

      if (data?.type === 'init-error') {
        this.rejectReady?.(new Error(data.message));
        return;
      }

      if (data?.type === 'hands') {
        this.framePending = false;
        this.lastResultAt = performance.now();
        this.lastInferenceMs = data.inferenceMs || 0;
        this.framesProcessed += 1;
        this.handsDetected = data.hands?.length || 0;
        this.onHands(data.hands || []);
        this.onState('tracking', this.handsDetected, data.hands || [], {
          backend: 'CPU',
          inferenceMs: this.lastInferenceMs,
          frames: this.framesProcessed,
          width: this.video.videoWidth,
          height: this.video.videoHeight
        });
        return;
      }

      if (data?.type === 'frame-error') {
        this.framePending = false;
        console.warn('Black Matter frame inference warning:', data.message);
        this.onState('warning', this.handsDetected, [], {
          message: data.message,
          inferenceMs: this.lastInferenceMs
        });
        return;
      }

      if (data?.type === 'fatal') {
        this.framePending = false;
        this.recoverWorker(data.message || 'Repeated inference failures.');
      }
    });

    this.worker.addEventListener('error', (event) => {
      this.framePending = false;
      const message = event.message || 'The hand-recognition worker stopped unexpectedly.';
      if (!this.running) this.rejectReady?.(new Error(message));
      else this.recoverWorker(message);
    });

    this.worker.addEventListener('messageerror', () => {
      this.framePending = false;
      if (this.running) this.recoverWorker('The browser could not transfer a camera frame to the recognition worker.');
      else this.rejectReady?.(new Error('The browser could not communicate with the hand-recognition worker.'));
    });

    this.worker.postMessage({ type: 'init', wasmUrl: WASM_URL, modelUrl: MODEL_URL });

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Hand recognition took too long to initialize. Check the network connection and reload the page.')), 25000);
    });

    const readyInfo = await Promise.race([ready, timeout]);
    this.resolveReady = null;
    this.rejectReady = null;
    return readyInfo;
  }

  async recoverWorker(reason) {
    if (!this.running || this.restarting) return;
    if (this.restartCount >= 1) {
      this.fail(`Hand recognition stopped after recovery: ${reason}`);
      return;
    }

    this.restarting = true;
    this.restartCount += 1;
    this.framePending = false;
    this.lastVideoTime = -1;
    this.onState('recovering', 0, [], { message: 'Reconnecting the hand-recognition engine…' });
    this.worker?.terminate();
    this.worker = null;

    try {
      await this.initializeWorker();
      this.lastResultAt = performance.now();
      this.restarting = false;
      this.onState('live', 0, [], { backend: 'CPU', message: 'Recognition engine recovered.' });
      this.loop();
    } catch (error) {
      this.restarting = false;
      this.fail(error?.message || reason);
    }
  }

  loop() {
    if (!this.running || !this.worker || this.restarting) return;
    const now = performance.now();

    if (this.framePending && now - this.pendingSince > FRAME_WATCHDOG_MS) {
      this.recoverWorker('No recognition result arrived for five seconds.');
      return;
    }

    if (
      this.video.readyState >= 2 &&
      this.video.videoWidth > 0 &&
      this.video.videoHeight > 0 &&
      this.video.currentTime !== this.lastVideoTime &&
      now - this.lastSentAt >= FRAME_INTERVAL_MS &&
      !this.framePending
    ) {
      this.lastVideoTime = this.video.currentTime;
      this.lastSentAt = now;
      this.pendingSince = now;
      this.framePending = true;
      const activeWorker = this.worker;
      const timestamp = Math.max(now, this.lastResultAt + 1);

      createImageBitmap(this.video).then((bitmap) => {
        if (!this.running || this.worker !== activeWorker) {
          bitmap.close();
          this.framePending = false;
          return;
        }
        activeWorker.postMessage({ type: 'frame', bitmap, timestamp }, [bitmap]);
      }).catch((error) => {
        this.framePending = false;
        console.warn('Black Matter could not capture a camera frame:', error);
        this.onState('warning', this.handsDetected, [], { message: error?.message || 'Frame capture failed.' });
      });
    }

    this.frame = requestAnimationFrame(() => this.loop());
  }

  fail(message) {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.track = null;
    this.video.pause();
    this.video.srcObject = null;
    this.framePending = false;
    this.onHands([]);
    this.onState('error', 0, [], { message });
  }

  stop() {
    this.running = false;
    if (this.frame) cancelAnimationFrame(this.frame);
    this.worker?.postMessage({ type: 'stop' });
    this.worker?.terminate();
    this.worker = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.track = null;
    this.video.pause();
    this.video.srcObject = null;
    this.framePending = false;
    this.onHands([]);
    this.onState('off');
  }
}
