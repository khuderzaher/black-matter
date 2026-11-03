import * as THREE from 'three';

const vertexShader = `
  attribute float aSeed;
  attribute float aSize;

  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uInteraction;
  uniform float uGesture;
  uniform vec3 uPointer;
  uniform float uEnergy;

  varying float vDepth;
  varying float vTwinkle;
  varying float vInfluence;

  void main() {
    vec3 p = position;
    float seed = aSeed * 6.2831853;

    // A slow rotation gives the cloud a readable, continuous spatial structure.
    float orbit = uTime * 0.035 + p.y * 0.075 + sin(seed + uTime * 0.12) * 0.035;
    float c = cos(orbit);
    float s = sin(orbit);
    p.xz = mat2(c, -s, s, c) * p.xz;

    // Layered travelling waves keep neighbouring particles related, not random.
    float waveA = sin(p.y * 1.55 + seed * 0.7 + uTime * 0.24);
    float waveB = cos(p.x * 1.22 - p.z * 0.8 + uTime * 0.19 + seed);
    p += vec3(waveA * 0.105, waveB * 0.085, sin(seed + uTime * 0.16) * 0.11);

    vec3 delta = p - uPointer;
    delta.z *= 0.58;
    float distanceToHand = length(delta);
    float radius = 1.45 + uGesture * 0.45;
    float influence = exp(-distanceToHand * distanceToHand / (radius * radius)) * uInteraction;
    vec3 away = normalize(delta + vec3(0.0001));
    vec3 tangent = normalize(vec3(-away.y, away.x, 0.08));
    float polarity = mix(-0.72, 1.05, uGesture);

    p += away * influence * polarity * (0.72 + uEnergy * 0.32);
    p += tangent * influence * 0.22;

    // A tiny collective pulse travels through the volume.
    float pulse = sin(length(p) * 2.1 - uTime * 0.55 + seed * 0.18);
    p += normalize(p + vec3(0.0001)) * pulse * (0.025 + uEnergy * 0.035);

    vec4 viewPosition = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewPosition;

    float perspective = 10.0 / max(2.0, -viewPosition.z);
    gl_PointSize = clamp(aSize * uPixelRatio * perspective, 0.65, 3.2);
    vDepth = clamp((-viewPosition.z - 2.0) / 11.0, 0.0, 1.0);
    vTwinkle = 0.72 + 0.28 * sin(uTime * (0.7 + aSeed * 1.1) + seed);
    vInfluence = influence;
  }
`;

const fragmentShader = `
  varying float vDepth;
  varying float vTwinkle;
  varying float vInfluence;

  void main() {
    vec2 point = gl_PointCoord - vec2(0.5);
    float radius = length(point);
    float core = 1.0 - smoothstep(0.08, 0.5, radius);
    float halo = 1.0 - smoothstep(0.12, 0.5, radius);
    float alpha = (core * 0.72 + halo * 0.17) * vTwinkle;
    alpha *= 0.48 + (1.0 - vDepth) * 0.42 + vInfluence * 0.22;
    if (alpha < 0.025) discard;

    vec3 nearTone = vec3(0.94, 0.96, 1.0);
    vec3 farTone = vec3(0.48, 0.53, 0.62);
    vec3 color = mix(nearTone, farTone, vDepth * 0.82);
    color += vec3(0.10) * vInfluence;
    gl_FragColor = vec4(color, alpha);
  }
`;

function randomGenerator(seed = 173) {
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
    const arm = Math.floor(random() * 5);
    const angle = random() * Math.PI * 2;
    const radial = Math.pow(random(), 0.64) * 3.45 + 0.08;
    const armAngle = angle + arm * (Math.PI * 2 / 5) + radial * 0.23;
    const filament = random() < 0.68 ? 1 : 0;

    // Five broad, imperfect spiral streams sit inside a soft volumetric envelope.
    const spiralOffset = filament ? (random() - 0.5) * (0.16 + radial * 0.11) : (random() - 0.5) * 1.05;
    const x = Math.cos(armAngle + spiralOffset) * radial * 1.18;
    const z = Math.sin(armAngle + spiralOffset) * radial * 0.78;
    const y = (random() - 0.5) * (1.15 + radial * 0.72) + Math.sin(armAngle * 2.0) * 0.15;

    const i3 = i * 3;
    positions[i3] = x;
    positions[i3 + 1] = y;
    positions[i3 + 2] = z;
    seeds[i] = random();
    sizes[i] = 0.62 + Math.pow(random(), 3.0) * 1.55;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
  geometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

export class ParticleField {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.count = this.getParticleCount();
    this.pointerTarget = new THREE.Vector3(0, 0, 0);
    this.pointerCurrent = new THREE.Vector3(0, 0, 0);
    this.interactionTarget = 0;
    this.interactionCurrent = 0;
    this.gestureTarget = 0.68;
    this.energy = 0;

    this.uniforms = {
      uTime: { value: 0 },
      uPixelRatio: { value: Math.min(window.devicePixelRatio || 1, 2) },
      uInteraction: { value: 0 },
      uGesture: { value: 0.68 },
      uPointer: { value: new THREE.Vector3() },
      uEnergy: { value: 0 }
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
  }

  getParticleCount() {
    const cores = navigator.hardwareConcurrency || 4;
    if (cores <= 4) return 38000;
    if (cores <= 8) return 62000;
    return 88000;
  }

  setPointer(normalizedX, normalizedY, strength = 1, gesture = 0.68) {
    const visibleHeight = 2 * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 8.5;
    const visibleWidth = visibleHeight * this.camera.aspect;
    this.pointerTarget.set(normalizedX * visibleWidth * 0.5, normalizedY * visibleHeight * 0.5, 0);
    this.interactionTarget = THREE.MathUtils.clamp(strength, 0, 1);
    this.gestureTarget = THREE.MathUtils.clamp(gesture, 0, 1);
    this.energy = Math.max(this.energy, Math.min(1, strength * 0.9));
  }

  releasePointer() {
    this.interactionTarget = 0;
  }

  update(elapsed, delta) {
    const smoothing = 1 - Math.exp(-delta * 4.5);
    this.pointerCurrent.lerp(this.pointerTarget, smoothing);
    this.interactionCurrent = THREE.MathUtils.damp(this.interactionCurrent, this.interactionTarget, 3.2, delta);
    this.energy = THREE.MathUtils.damp(this.energy, 0, 1.5, delta);
    this.uniforms.uTime.value = elapsed;
    this.uniforms.uPointer.value.copy(this.pointerCurrent);
    this.uniforms.uInteraction.value = this.interactionCurrent;
    this.uniforms.uGesture.value = THREE.MathUtils.damp(this.uniforms.uGesture.value, this.gestureTarget, 4, delta);
    this.uniforms.uEnergy.value = this.energy;
  }

  resize() {
    this.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);
  }

  dispose() {
    this.scene.remove(this.points);
    this.geometry.dispose();
    this.material.dispose();
  }
}