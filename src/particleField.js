import * as THREE from 'three';

const MAX_HANDS = 2;
const LANDMARKS_PER_HAND = 21;
const MAX_JOINTS = MAX_HANDS * LANDMARKS_PER_HAND;

const nebulaVertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const nebulaFragmentShader = `
  uniform float uTime;
  varying vec2 vUv;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    for (int i = 0; i < 4; i++) {
      value += noise(p) * amplitude;
      p = mat2(1.62, -1.18, 1.18, 1.62) * p + vec2(0.13, -0.17);
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 uv = vUv;
    vec2 drift = vec2(uTime * 0.006, -uTime * 0.004);
    float broad = fbm(uv * 3.1 + drift);
    float detail = fbm(uv * 6.4 - drift * 1.7 + vec2(broad * 0.55));
    float wisps = fbm(uv * 10.2 + vec2(-uTime * 0.003, uTime * 0.005) + vec2(detail * 0.3));

    float cloud = smoothstep(0.29, 0.76, broad * 0.66 + detail * 0.34);
    float filament = smoothstep(0.58, 0.82, detail * 0.72 + wisps * 0.28);
    vec2 centered = (uv - 0.5) * vec2(1.0, 0.88);
    float envelope = pow(max(0.0, 1.0 - length(centered) * 1.42), 1.65);
    float alpha = (cloud * 0.17 + filament * 0.065) * envelope;

    float hue = fract(broad * 0.72 + uv.x * 0.16 + uv.y * 0.12 + uTime * 0.0015);
    vec3 deepIndigo = vec3(0.12, 0.12, 0.36);
    vec3 blue = vec3(0.10, 0.34, 0.57);
    vec3 violet = vec3(0.36, 0.20, 0.49);
    vec3 rose = vec3(0.48, 0.22, 0.38);
    vec3 teal = vec3(0.11, 0.38, 0.37);
    vec3 color = mix(deepIndigo, blue, smoothstep(0.05, 0.34, hue));
    color = mix(color, teal, smoothstep(0.28, 0.54, hue) * 0.58);
    color = mix(color, violet, smoothstep(0.46, 0.76, hue) * 0.8);
    color = mix(color, rose, smoothstep(0.72, 0.96, hue) * 0.62);
    color *= 0.75 + detail * 0.46;

    gl_FragColor = vec4(color, alpha);
  }
`;

const vertexShader = `
  attribute float aSeed;
  attribute float aSize;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uInteraction;
  uniform float uHandInteraction;
  uniform float uGesture;
  uniform vec3 uPointer;
  uniform float uEnergy;
  uniform vec4 uJoints[${MAX_JOINTS}];

  varying float vDepth;
  varying float vTwinkle;
  varying float vInfluence;
  varying float vHue;
  varying float vGlow;

  void main() {
    vec3 p = position;
    float seed = aSeed * 6.2831853;
    float radius = length(p.xz);

    // Slow orbital drift and layered waves create a coherent spacetime current.
    float orbit = uTime * 0.026 + p.y * 0.055 + sin(seed + uTime * 0.11) * 0.025;
    float c = cos(orbit);
    float s = sin(orbit);
    p.xz = mat2(c, -s, s, c) * p.xz;

    float waveA = sin(p.y * 1.35 + seed * 0.55 + uTime * 0.19);
    float waveB = cos(p.x * 1.08 - p.z * 0.72 + uTime * 0.16 + seed);
    float waveC = sin(p.z * 1.2 + p.x * 0.45 - uTime * 0.12);
    p += vec3(waveA * 0.13, waveB * 0.12, waveC * 0.17);

    // A slow, low-amplitude lensing field bends the volume as if space were elastic.
    float lens = sin(p.z * 0.62 + p.x * 0.28 - uTime * 0.075) * 0.12;
    p.xy *= 1.0 + lens * (0.35 + radius * 0.08);
    p.z += sin(p.x * 0.42 + p.y * 0.57 + uTime * 0.085) * 0.16;

    // Pointer fallback: a soft vortex rather than a hard cursor repulsion.
    vec3 pointerDelta = p - uPointer;
    float pointerDistance = length(pointerDelta);
    float pointerInfluence = exp(-pointerDistance * pointerDistance / 1.65) * uInteraction;
    vec3 pointerDirection = normalize(pointerDelta + vec3(0.0001));
    vec3 pointerTangent = normalize(vec3(-pointerDirection.y, pointerDirection.x, 0.16));
    p += pointerDirection * pointerInfluence * mix(-0.34, 0.52, uGesture);
    p += pointerTangent * pointerInfluence * 0.26;

    // Every detected landmark contributes its own local force field.
    float jointInfluence = 0.0;
    vec3 jointFlow = vec3(0.0);
    for (int i = 0; i < ${MAX_JOINTS}; i++) {
      vec4 joint = uJoints[i];
      float active = step(0.015, joint.w);
      vec3 delta = p - joint.xyz;
      float distanceSquared = dot(delta, delta);
      float influenceRadius = mix(0.24, 0.62, clamp(joint.w, 0.0, 1.0));
      float field = exp(-distanceSquared / (influenceRadius * influenceRadius)) * joint.w * active * uHandInteraction;
      vec3 radial = normalize(delta + vec3(0.0001));
      vec3 curl = normalize(vec3(-delta.y, delta.x, 0.18 + delta.z * 0.16));
      float pulse = 0.78 + 0.22 * sin(uTime * 1.4 + float(i) * 0.63 + distanceSquared * 2.1);
      jointFlow += (radial * mix(-0.22, 0.48, uGesture) + curl * 0.33) * field * pulse;
      jointInfluence = max(jointInfluence, field);
    }

    p += jointFlow * (0.24 + uEnergy * 0.16);

    // A traveling wave ties distant filaments into a single responsive organism.
    float collectivePulse = sin(length(p) * 1.72 - uTime * 0.42 + seed * 0.12);
    p += normalize(p + vec3(0.0001)) * collectivePulse * (0.032 + uEnergy * 0.04);

    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;

    float perspective = 11.0 / max(2.0, -viewPosition.z);
    gl_PointSize = clamp(aSize * uPixelRatio * perspective, 0.7, 4.2);
    vDepth = clamp((-viewPosition.z - 1.2) / 13.0, 0.0, 1.0);
    vTwinkle = 0.78 + 0.22 * sin(uTime * (0.42 + aSeed * 0.72) + seed);
    vInfluence = max(pointerInfluence, jointInfluence);
    vGlow = clamp(jointInfluence * 1.7 + pointerInfluence * 0.55, 0.0, 1.0);
    vHue = fract(0.54 + atan(p.z, p.x) * 0.115 + p.y * 0.036 + aSeed * 0.18 + uTime * 0.003);
  }
`;

const fragmentShader = `
  varying float vDepth;
  varying float vTwinkle;
  varying float vInfluence;
  varying float vHue;
  varying float vGlow;

  vec3 nebulaPalette(float t) {
    vec3 indigo = vec3(0.27, 0.30, 0.72);
    vec3 cyan = vec3(0.19, 0.67, 0.82);
    vec3 teal = vec3(0.22, 0.66, 0.59);
    vec3 lavender = vec3(0.62, 0.48, 0.82);
    vec3 rose = vec3(0.86, 0.43, 0.63);
    vec3 amber = vec3(0.91, 0.69, 0.43);

    float x = fract(t) * 6.0;
    if (x < 1.0) return mix(indigo, cyan, smoothstep(0.0, 1.0, x));
    if (x < 2.0) return mix(cyan, teal, smoothstep(1.0, 2.0, x));
    if (x < 3.0) return mix(teal, lavender, smoothstep(2.0, 3.0, x));
    if (x < 4.0) return mix(lavender, rose, smoothstep(3.0, 4.0, x));
    if (x < 5.0) return mix(rose, amber, smoothstep(4.0, 5.0, x));
    return mix(amber, indigo, smoothstep(5.0, 6.0, x));
  }

  void main() {
    vec2 point = gl_PointCoord - vec2(0.5);
    float r = length(point);
    float core = 1.0 - smoothstep(0.02, 0.24, r);
    float aura = exp(-r * r * 25.0);
    float halo = exp(-r * r * 8.5);
    float alpha = (core * 0.78 + aura * 0.35 + halo * 0.12) * vTwinkle;
    alpha *= 0.36 + (1.0 - vDepth) * 0.53 + vInfluence * 0.18;
    if (alpha < 0.018) discard;

    vec3 color = nebulaPalette(vHue);
    vec3 depthTint = mix(vec3(0.43, 0.50, 0.68), vec3(1.0, 0.96, 1.0), 1.0 - vDepth);
    color *= depthTint;
    color = mix(color, vec3(0.86, 0.91, 1.0), 0.17 + vGlow * 0.36);
    color *= 0.72 + vGlow * 0.7;
    gl_FragColor = vec4(color, alpha);
  }
`;

const bonePairs = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [0, 9], [9, 10], [10, 11], [11, 12],
  [0, 13], [13, 14], [14, 15], [15, 16],
  [0, 17], [17, 18], [18, 19], [19, 20],
  [5, 9], [9, 13], [13, 17]
];

const fingerColor = [
  new THREE.Color('#9be8eb'), new THREE.Color('#9be8eb'), new THREE.Color('#9be8eb'),
  new THREE.Color('#9be8eb'), new THREE.Color('#9be8eb'),
  new THREE.Color('#b9a8f5'), new THREE.Color('#b9a8f5'), new THREE.Color('#b9a8f5'), new THREE.Color('#b9a8f5'),
  new THREE.Color('#c4a5fa'), new THREE.Color('#c4a5fa'), new THREE.Color('#c4a5fa'), new THREE.Color('#c4a5fa'),
  new THREE.Color('#e6a8ca'), new THREE.Color('#e6a8ca'), new THREE.Color('#e6a8ca'), new THREE.Color('#e6a8ca'),
  new THREE.Color('#a6d8c8'), new THREE.Color('#a6d8c8'), new THREE.Color('#a6d8c8'), new THREE.Color('#a6d8c8')
];

function randomGenerator(seed = 9137) {
  let value = seed >>> 0;
  return () => {
    value = (value * 1664525 + 1013904223) >>> 0;
    return value / 4294967296;
  };
}

function createFieldGeometry(count) {
  const random = randomGenerator();
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  const sizes = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const diffuse = random() < 0.19;
    let x; let y; let z;

    if (diffuse) {
      const theta = random() * Math.PI * 2;
      const phi = Math.acos(2 * random() - 1);
      const radius = 1.5 + Math.pow(random(), 0.62) * 4.3;
      x = Math.sin(phi) * Math.cos(theta) * radius * 1.13;
      y = Math.cos(phi) * radius * 0.56;
      z = Math.sin(phi) * Math.sin(theta) * radius * 0.92;
    } else {
      const arm = Math.floor(random() * 7);
      const radius = 0.16 + Math.pow(random(), 0.66) * 4.15;
      const angle = random() * 0.56 + arm * (Math.PI * 2 / 7) + radius * 0.29;
      const spread = (random() - 0.5) * (0.13 + radius * 0.105);
      x = Math.cos(angle + spread) * radius * 1.18;
      z = Math.sin(angle + spread) * radius * 0.88;
      y = (random() - 0.5) * (0.48 + radius * 0.62) + Math.sin(angle * 1.7) * 0.19;
    }

    const offset = i * 3;
    positions[offset] = x;
    positions[offset + 1] = y;
    positions[offset + 2] = z;
    seeds[i] = random();
    sizes[i] = 0.54 + Math.pow(random(), 2.4) * 1.9;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function getJointWeight(index, speed, fingerOpen) {
  const tip = [4, 8, 12, 16, 20].includes(index);
  const palm = [0, 5, 9, 13, 17].includes(index);
  const articulation = tip ? 0.94 : palm ? 0.38 : 0.62;
  return Math.min(1, articulation + Math.min(0.28, speed * 0.14) + fingerOpen * (tip ? 0.12 : 0.04));
}

export class ParticleField {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.count = this.getParticleCount();
    this.pointerTarget = new THREE.Vector3();
    this.pointerCurrent = new THREE.Vector3();
    this.interactionTarget = 0;
    this.interactionCurrent = 0;
    this.handInteractionTarget = 0;
    this.handInteraction = 0;
    this.gestureTarget = 0.62;
    this.energy = 0;

    this.jointUniforms = Array.from({ length: MAX_JOINTS }, () => new THREE.Vector4());
    this.jointTargets = Array.from({ length: MAX_JOINTS }, () => new THREE.Vector4());
    this.handTargetPositions = new Float32Array(MAX_JOINTS * 3);
    this.handCurrentPositions = new Float32Array(MAX_JOINTS * 3);
    this.handTargetPositions.fill(1000);
    this.handCurrentPositions.fill(1000);
    this.handSlotActive = [false, false];
    this.handVisibilityTarget = 0;
    this.handVisibility = 0;

    this.uniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: this.getPixelRatio() },
      uInteraction: { value: 0 },
      uHandInteraction: { value: 0 },
      uGesture: { value: 0.62 },
      uPointer: { value: new THREE.Vector3() },
      uEnergy: { value: 0 },
      uJoints: { value: this.jointUniforms }
    };

    this.geometry = createFieldGeometry(this.count);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.scene.add(this.points);

    this.createNebula();
    this.createHandConstellation();
    this.createDistantStars();
  }

  getPixelRatio() {
    const mobile = window.innerWidth < 760;
    return Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.65);
  }

  getParticleCount() {
    const cores = navigator.hardwareConcurrency || 4;
    const memory = navigator.deviceMemory || 4;
    if (memory <= 4 || cores <= 4) return 42000;
    if (memory <= 8 || cores <= 8) return 76000;
    return 112000;
  }

  createNebula() {
    this.nebulaGeometry = new THREE.PlaneGeometry(40, 24);
    this.nebulaMaterial = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: nebulaVertexShader,
      fragmentShader: nebulaFragmentShader,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false
    });
    this.nebula = new THREE.Mesh(this.nebulaGeometry, this.nebulaMaterial);
    this.nebula.position.set(0, 0, -10.5);
    this.nebula.renderOrder = -2;
    this.scene.add(this.nebula);
  }

  createHandConstellation() {
    const nodePositions = new Float32Array(MAX_JOINTS * 3);
    const nodeColors = new Float32Array(MAX_JOINTS * 3);
    for (let hand = 0; hand < MAX_HANDS; hand += 1) {
      for (let index = 0; index < LANDMARKS_PER_HAND; index += 1) {
        const color = fingerColor[index];
        const offset = (hand * LANDMARKS_PER_HAND + index) * 3;
        nodeColors[offset] = color.r;
        nodeColors[offset + 1] = color.g;
        nodeColors[offset + 2] = color.b;
      }
    }

    this.handPointsGeometry = new THREE.BufferGeometry();
    this.handPointsGeometry.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.handPointsGeometry.setAttribute('color', new THREE.BufferAttribute(nodeColors, 3));
    this.handPointsMaterial = new THREE.PointsMaterial({
      size: 0.055,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.handPoints = new THREE.Points(this.handPointsGeometry, this.handPointsMaterial);
    this.handPoints.frustumCulled = false;
    this.scene.add(this.handPoints);

    const linePositions = new Float32Array(MAX_HANDS * bonePairs.length * 2 * 3);
    const lineColors = new Float32Array(linePositions.length);
    let cursor = 0;
    for (let hand = 0; hand < MAX_HANDS; hand += 1) {
      for (const [from, to] of bonePairs) {
        for (const index of [from, to]) {
          const color = fingerColor[index];
          lineColors[cursor] = color.r;
          lineColors[cursor + 1] = color.g;
          lineColors[cursor + 2] = color.b;
          cursor += 3;
        }
      }
    }
    this.handLinesGeometry = new THREE.BufferGeometry();
    this.handLinesGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3).setUsage(THREE.DynamicDrawUsage));
    this.handLinesGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));
    this.handLinesMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    this.handLines = new THREE.LineSegments(this.handLinesGeometry, this.handLinesMaterial);
    this.handLines.frustumCulled = false;
    this.scene.add(this.handLines);
  }

  createDistantStars() {
    const random = randomGenerator(4481);
    const count = 1800;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      const offset = i * 3;
      positions[offset] = (random() - 0.5) * 25;
      positions[offset + 1] = (random() - 0.5) * 15;
      positions[offset + 2] = -2.8 - random() * 11;
      const tint = 0.42 + random() * 0.42;
      colors[offset] = tint * (0.78 + random() * 0.18);
      colors[offset + 1] = tint * (0.82 + random() * 0.18);
      colors[offset + 2] = tint;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    this.starsMaterial = new THREE.PointsMaterial({
      size: 0.018,
      vertexColors: true,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      sizeAttenuation: true
    });
    this.stars = new THREE.Points(geometry, this.starsMaterial);
    this.stars.frustumCulled = false;
    this.scene.add(this.stars);
    this.starsGeometry = geometry;
  }

  setPointer(normalizedX, normalizedY, strength = 1, gesture = 0.62) {
    const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 8.5;
    const visibleWidth = visibleHeight * this.camera.aspect;
    this.pointerTarget.set(normalizedX * visibleWidth * 0.5, normalizedY * visibleHeight * 0.5, 0);
    this.interactionTarget = THREE.MathUtils.clamp(strength, 0, 1);
    this.gestureTarget = THREE.MathUtils.clamp(gesture, 0, 1);
    this.energy = Math.max(this.energy, Math.min(1, strength * 0.8));
  }

  setHands(hands = []) {
    const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 8.5;
    const visibleWidth = visibleHeight * this.camera.aspect;
    const usableHands = hands.slice(0, MAX_HANDS);
    let opennessTotal = 0;
    let activeHands = 0;

    this.jointTargets.forEach((joint) => joint.set(0, 0, 0, 0));
    this.handTargetPositions.fill(1000);
    const nextActiveSlots = [false, false];

    usableHands.forEach((hand, handIndex) => {
      if (!Array.isArray(hand.landmarks) || hand.landmarks.length < LANDMARKS_PER_HAND) return;
      const handSlot = hand.handedness === 'Right' ? 1 : hand.handedness === 'Left' ? 0 : handIndex;
      activeHands += 1;
      nextActiveSlots[handSlot] = true;
      opennessTotal += hand.openness ?? 0.5;

      hand.landmarks.slice(0, LANDMARKS_PER_HAND).forEach((landmark, index) => {
        const slot = handSlot * LANDMARKS_PER_HAND + index;
        // A short predictive lead makes the field feel connected to motion, not delayed coordinates.
        const lead = 0.026;
        const predictedX = landmark.x + (landmark.vx || 0) * lead;
        const predictedY = landmark.y + (landmark.vy || 0) * lead;
        const predictedZ = (landmark.z || 0) + (landmark.vz || 0) * lead * 0.5;
        const x = (0.5 - predictedX) * visibleWidth * 0.5;
        const y = (0.5 - predictedY) * visibleHeight * 0.5;
        const z = THREE.MathUtils.clamp(-predictedZ * 9, -1.5, 1.5);
        const speed = landmark.speed || hand.velocity || 0;
        const fingerOpen = hand.fingers?.[this.fingerForLandmark(index)] || 0;
        const weight = getJointWeight(index, speed, fingerOpen);

        this.jointTargets[slot].set(x, y, z, weight);
        const offset = slot * 3;
        this.handTargetPositions[offset] = x;
        this.handTargetPositions[offset + 1] = y;
        this.handTargetPositions[offset + 2] = z;
      });
    });

    // Keep unused hand slots outside the view; snap newly acquired hands into place.
    for (let handIndex = 0; handIndex < MAX_HANDS; handIndex += 1) {
      const base = handIndex * LANDMARKS_PER_HAND;
      for (let index = 0; index < LANDMARKS_PER_HAND; index += 1) {
        const slot = base + index;
        const offset = slot * 3;
        if (!nextActiveSlots[handIndex]) {
          this.handTargetPositions[offset] = 1000;
          this.handTargetPositions[offset + 1] = 1000;
          this.handTargetPositions[offset + 2] = 1000;
          this.handCurrentPositions[offset] = 1000;
          this.handCurrentPositions[offset + 1] = 1000;
          this.handCurrentPositions[offset + 2] = 1000;
          this.jointUniforms[slot].set(0, 0, 0, 0);
        } else if (!this.handSlotActive[handIndex]) {
          this.handCurrentPositions[offset] = this.handTargetPositions[offset];
          this.handCurrentPositions[offset + 1] = this.handTargetPositions[offset + 1];
          this.handCurrentPositions[offset + 2] = this.handTargetPositions[offset + 2];
          this.jointUniforms[slot].copy(this.jointTargets[slot]);
        }
      }
    }
    this.handSlotActive = nextActiveSlots;

    this.handVisibilityTarget = activeHands > 0 ? 1 : 0;
    this.handInteractionTarget = activeHands > 0 ? 1 : 0;
    this.interactionTarget = 0;
    this.gestureTarget = activeHands > 0 ? opennessTotal / activeHands : 0.62;
    this.energy = Math.max(this.energy, activeHands > 0 ? 0.88 : 0);
  }

  fingerForLandmark(index) {
    if (index >= 1 && index <= 4) return 'thumb';
    if (index >= 5 && index <= 8) return 'index';
    if (index >= 9 && index <= 12) return 'middle';
    if (index >= 13 && index <= 16) return 'ring';
    if (index >= 17 && index <= 20) return 'pinky';
    return 'palm';
  }

  releasePointer() {
    this.interactionTarget = 0;
    this.handInteractionTarget = 0;
    this.handVisibilityTarget = 0;
    this.handSlotActive = [false, false];
    this.handTargetPositions.fill(1000);
    this.handCurrentPositions.fill(1000);
    this.jointTargets.forEach((joint) => joint.set(0, 0, 0, 0));
    this.jointUniforms.forEach((joint) => joint.set(0, 0, 0, 0));
  }

  updateHandConstellation(delta) {
    const easing = 1 - Math.exp(-delta * 12);
    for (let i = 0; i < MAX_JOINTS; i += 1) {
      const target = this.jointTargets[i];
      const current = this.jointUniforms[i];
      current.lerp(target, easing);
      const offset = i * 3;
      this.handCurrentPositions[offset] += (this.handTargetPositions[offset] - this.handCurrentPositions[offset]) * easing;
      this.handCurrentPositions[offset + 1] += (this.handTargetPositions[offset + 1] - this.handCurrentPositions[offset + 1]) * easing;
      this.handCurrentPositions[offset + 2] += (this.handTargetPositions[offset + 2] - this.handCurrentPositions[offset + 2]) * easing;
    }

    const nodePosition = this.handPointsGeometry.attributes.position;
    nodePosition.array.set(this.handCurrentPositions);
    nodePosition.needsUpdate = true;

    const linePosition = this.handLinesGeometry.attributes.position;
    let cursor = 0;
    for (let hand = 0; hand < MAX_HANDS; hand += 1) {
      const base = hand * LANDMARKS_PER_HAND;
      for (const [from, to] of bonePairs) {
        for (const landmarkIndex of [from, to]) {
          const offset = (base + landmarkIndex) * 3;
          linePosition.array[cursor] = this.handCurrentPositions[offset];
          linePosition.array[cursor + 1] = this.handCurrentPositions[offset + 1];
          linePosition.array[cursor + 2] = this.handCurrentPositions[offset + 2];
          cursor += 3;
        }
      }
    }
    linePosition.needsUpdate = true;

    this.handVisibility = THREE.MathUtils.damp(this.handVisibility, this.handVisibilityTarget, 9, delta);
    this.handPointsMaterial.opacity = this.handVisibility * 0.76;
    this.handLinesMaterial.opacity = this.handVisibility * 0.28;
  }

  update(elapsed, delta) {
    const smoothing = 1 - Math.exp(-delta * 5.5);
    this.pointerCurrent.lerp(this.pointerTarget, smoothing);
    this.interactionCurrent = THREE.MathUtils.damp(this.interactionCurrent, this.interactionTarget, 3.8, delta);
    this.energy = THREE.MathUtils.damp(this.energy, 0, 1.15, delta);
    this.uniforms.uTime.value = elapsed;
    this.nebulaMaterial.uniforms.uTime.value = elapsed;
    this.uniforms.uPointer.value.copy(this.pointerCurrent);
    this.uniforms.uInteraction.value = this.interactionCurrent;
    this.handInteraction = THREE.MathUtils.damp(this.handInteraction, this.handInteractionTarget, 5.5, delta);
    this.uniforms.uHandInteraction.value = this.handInteraction;
    this.uniforms.uGesture.value = THREE.MathUtils.damp(this.uniforms.uGesture.value, this.gestureTarget, 3.8, delta);
    this.uniforms.uEnergy.value = this.energy;
    this.uniforms.uJoints.value = this.jointUniforms;
    this.updateHandConstellation(delta);

    this.points.rotation.y = Math.sin(elapsed * 0.035) * 0.035;
    this.stars.rotation.y = elapsed * 0.0015;
    this.stars.rotation.x = Math.sin(elapsed * 0.025) * 0.012;
  }

  resize() {
    this.uniforms.uPixelRatio.value = this.getPixelRatio();
  }

  dispose() {
    this.scene.remove(this.points, this.handPoints, this.handLines, this.stars, this.nebula);
    this.geometry.dispose();
    this.nebulaGeometry.dispose();
    this.nebulaMaterial.dispose();
    this.material.dispose();
    this.handPointsGeometry.dispose();
    this.handPointsMaterial.dispose();
    this.handLinesGeometry.dispose();
    this.handLinesMaterial.dispose();
    this.starsGeometry.dispose();
    this.starsMaterial.dispose();
  }
}
