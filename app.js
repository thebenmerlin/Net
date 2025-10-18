// See the Invisible Web — Advanced (FIXED BUILD)
// Three.js + GPU particle field + video texture
import * as THREE from 'three';

let renderer, scene, camera;
let video, videoTexture;
let particleSystem, lineMesh;
let simplex;
let clock = new THREE.Clock();
let pointer = new THREE.Vector2(0, 0);
let deviceTilt = { x: 0, y: 0 };

const CONFIG = {
  particles: 6000,
  lines: 1200,
  particleSize: 3.0,
  area: 2.2,
  speed: 0.6
};

async function init() {
  video = document.getElementById('camera');
  const canvas = document.getElementById('three-canvas');

  // Renderer
  renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.autoClear = false;

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.01,
    100
  );
  camera.position.z = 1.5;

  // ✅ CAMERA FIX: Enhanced iOS Safari compatibility
  try {
    // Set video attributes BEFORE getUserMedia for iOS
    video.setAttribute('autoplay', '');
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.setAttribute('webkit-playsinline', '');
    video.autoplay = true;
    video.playsInline = true;
    video.muted = true;

    const constraints = {
      video: {
        facingMode: { ideal: "environment" }, // rear if possible
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      },
      audio: false
    };

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;

    // ✅ Wait for video to be ready before creating texture
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = () => {
        video.play()
          .then(resolve)
          .catch(reject);
      };
      video.onerror = reject;

      // Timeout after 10 seconds
      setTimeout(() => reject(new Error('Video timeout')), 10000);
    });

    console.log('✅ Camera initialized successfully');

    // Create texture from live feed
    videoTexture = new THREE.VideoTexture(video);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.format = THREE.RGBFormat;
    videoTexture.colorSpace = THREE.SRGBColorSpace;

    setupBackground(videoTexture);
  } catch (err) {
    console.warn("Camera failed:", err);
    alert('Camera access denied or failed. Using fallback background.');
    setupFallbackBackground();
  }

  // Wait for SimplexNoise to be available
  await waitForSimplex();
  simplex = new SimplexNoise();

  createParticles();
  createLines();

  // Listeners
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('mousemove', (e) => {
    pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  });
  window.addEventListener('touchmove', (e) => {
    if (e.touches[0]) {
      pointer.x = (e.touches[0].clientX / window.innerWidth) * 2 - 1;
      pointer.y = -(e.touches[0].clientY / window.innerHeight) * 2 + 1;
    }
  }, { passive: true });

  // Device tilt support (with iOS permission)
  if (
    window.DeviceOrientationEvent &&
    typeof DeviceOrientationEvent.requestPermission === 'function'
  ) {
    // iOS 13+ requires permission
    document.getElementById('pulseBtn').addEventListener(
      'click',
      async () => {
        try {
          const perm = await DeviceOrientationEvent.requestPermission();
          if (perm === 'granted') {
            window.addEventListener('deviceorientation', handleOrientation);
            console.log('✅ Device orientation permission granted');
          }
        } catch (e) {
          console.log('Device orientation not available:', e);
        }
      },
      { once: true }
    );
  } else if (window.DeviceOrientationEvent) {
    window.addEventListener('deviceorientation', handleOrientation);
  }

  // Buttons
  document.getElementById('pulseBtn').addEventListener('click', emitPulse);
  document.getElementById('screenshot').addEventListener('click', takeSnapshot);
  document.getElementById('quality').addEventListener('change', onQualityChange);

  animate();
}

// Helper function to wait for SimplexNoise to load
function waitForSimplex() {
  return new Promise((resolve) => {
    if (window.SimplexNoise) {
      resolve();
    } else {
      const checkInterval = setInterval(() => {
        if (window.SimplexNoise) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);
    }
  });
}

// Handle device orientation
function handleOrientation(ev) {
  deviceTilt.x = (ev.beta || 0) / 90;
  deviceTilt.y = (ev.gamma || 0) / 90;
}

// Background (video plane)
function setupBackground(tex) {
  const aspectRatio = window.innerWidth / window.innerHeight;
  const geom = new THREE.PlaneGeometry(2 * aspectRatio, 2);
  const mat = new THREE.MeshBasicMaterial({ 
    map: tex, 
    opacity: 0.98,
    transparent: true
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = -1;
  scene.add(mesh);
}

// Fallback background (no camera)
function setupFallbackBackground() {
  const color = new THREE.Color(0x02030a);
  scene.background = color;
  video.style.display = 'none';
}

// Particles
function createParticles() {
  const count = CONFIG.particles;
  const positions = new Float32Array(count * 3);
  const seeds = new Float32Array(count);

  for (let i = 0; i < count; i++) {
    const idx = i * 3;
    positions[idx] = (Math.random() * 2 - 1) * CONFIG.area;
    positions[idx + 1] = (Math.random() * 2 - 1) * CONFIG.area * 0.6;
    positions[idx + 2] = (Math.random() * 2 - 1) * 0.2;
    seeds[i] = Math.random() * 10;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uSize: { value: CONFIG.particleSize },
      uPointer: { value: new THREE.Vector2(0, 0) },
      uTilt: { value: new THREE.Vector2(0, 0) },
    },
    vertexShader: `
      attribute float aSeed;
      uniform float uTime;
      uniform vec2 uPointer;
      uniform vec2 uTilt;
      uniform float uSize;
      varying float vAlpha;

      float snoise(vec2 v){
        return (sin(v.x*12.9898+v.y*78.233)*43758.5453)-floor(sin(v.x*12.9898+v.y*78.233)*43758.5453);
      }

      void main(){
        vec3 pos = position;
        float n = snoise(vec2(pos.x*0.5+uTime*0.1+aSeed, pos.y*0.5+uTime*0.12));
        pos.x += (n-0.5)*0.25 + uPointer.x*0.4 + uTilt.x*0.5;
        pos.y += (n-0.5)*0.25 + uPointer.y*0.4 + uTilt.y*0.5;
        vec4 mvPosition = modelViewMatrix * vec4(pos,1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = uSize * (1.0 / -mvPosition.z);
        vAlpha = 0.4 + abs(n)*0.6;
      }
    `,
    fragmentShader: `
      varying float vAlpha;

      void main(){
        float d = length(gl_PointCoord - vec2(0.5));
        float alpha = smoothstep(0.5, 0.0, d) * vAlpha;
        gl_FragColor = vec4(0.5, 0.9, 1.0, alpha);
      }
    `,
  });

  particleSystem = new THREE.Points(geometry, material);
  scene.add(particleSystem);
}

// Lines
function createLines() {
  const count = CONFIG.lines;
  const positions = new Float32Array(count * 6);
  let idx = 0;

  for (let i = 0; i < count; i++) {
    const x1 = (Math.random() * 2 - 1) * CONFIG.area;
    const y1 = (Math.random() * 2 - 1) * CONFIG.area * 0.6;
    const z1 = (Math.random() * 2 - 1) * 0.1;
    const angle = Math.random() * Math.PI * 2;
    const len = 0.05 + Math.random() * 0.6;
    const x2 = x1 + Math.cos(angle) * len;
    const y2 = y1 + Math.sin(angle) * len * 0.6;
    const z2 = z1 + (Math.random() * 0.02 - 0.01);

    positions.set([x1, y1, z1, x2, y2, z2], idx);
    idx += 6;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

  const material = new THREE.LineBasicMaterial({
    color: 0x6ee7ff,
    transparent: true,
    opacity: 0.08,
    blending: THREE.AdditiveBlending,
  });

  lineMesh = new THREE.LineSegments(geometry, material);
  scene.add(lineMesh);
}

// Emit pulse
function emitPulse() {
  const mat = particleSystem.material;
  const orig = mat.uniforms.uSize.value;
  let t0 = performance.now();
  const dur = 800;

  function step() {
    const now = performance.now();
    const p = Math.min(1, (now - t0) / dur);
    mat.uniforms.uSize.value = orig * (1 + Math.sin(p * Math.PI) * 3.0);
    if (p < 1) requestAnimationFrame(step);
    else mat.uniforms.uSize.value = orig;
  }
  step();
}

// Snapshot
function takeSnapshot() {
  const canvas = renderer.domElement;
  const temp = document.createElement('canvas');
  temp.width = canvas.width;
  temp.height = canvas.height;
  const ctx = temp.getContext('2d');

  try {
    if (video && video.readyState >= 2) {
      ctx.drawImage(video, 0, 0, temp.width, temp.height);
    } else {
      ctx.fillStyle = '#02030a';
      ctx.fillRect(0, 0, temp.width, temp.height);
    }
    ctx.drawImage(canvas, 0, 0);

    const data = temp.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = data;
    a.download = 'invisible-web.png';
    a.click();
  } catch (e) {
    console.warn('snapshot failed', e);
  }
}

// Quality switch
function onQualityChange(e) {
  const q = e.target.value;

  if (q === 'low') {
    CONFIG.particles = 1500;
    CONFIG.lines = 600;
    CONFIG.particleSize = 2.0;
  } else if (q === 'medium') {
    CONFIG.particles = 4000;
    CONFIG.lines = 1000;
    CONFIG.particleSize = 2.8;
  } else {
    CONFIG.particles = 9000;
    CONFIG.lines = 1600;
    CONFIG.particleSize = 3.2;
  }

  if (particleSystem) {
    scene.remove(particleSystem);
    particleSystem.geometry.dispose();
    particleSystem.material.dispose();
  }
  if (lineMesh) {
    scene.remove(lineMesh);
    lineMesh.geometry.dispose();
    lineMesh.material.dispose();
  }

  createParticles();
  createLines();
}

// Animation
function animate() {
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();

  if (particleSystem && particleSystem.material.uniforms) {
    particleSystem.material.uniforms.uTime.value = t * CONFIG.speed;
    particleSystem.material.uniforms.uPointer.value.set(pointer.x * 0.8, pointer.y * 0.8);
    particleSystem.material.uniforms.uTilt.value.set(deviceTilt.x * 0.9, deviceTilt.y * 0.9);
  }

  if (lineMesh && simplex) {
    const pos = lineMesh.geometry.attributes.position.array;
    for (let i = 0; i < pos.length; i += 3) {
      const x = pos[i], y = pos[i + 1];
      const n = simplex.noise2D(x * 0.5 + t * 0.05, y * 0.5 + t * 0.06);
      pos[i + 2] = n * 0.04;
    }
    lineMesh.geometry.attributes.position.needsUpdate = true;
  }

  camera.position.x += (pointer.x * 0.3 - camera.position.x) * 0.05 + deviceTilt.y * 0.05;
  camera.position.y += (pointer.y * 0.3 - camera.position.y) * 0.05 + deviceTilt.x * 0.05;
  camera.lookAt(0, 0, 0);

  renderer.clear();
  renderer.render(scene, camera);
}

function onWindowResize() {
  const w = window.innerWidth,
    h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// Start
init();
