// See the Invisible Web — Advanced
// Three.js + GPU-assisted particle field with lines & pulses
import * as THREE from 'three';

// Globals
let renderer, scene, camera;
let video, videoTexture;
let particleSystem, lineMesh;
let simplex;
let clock = new THREE.Clock();
let pulseUniforms = { time: { value: 0 }, pulses: { value: [] } };

// Config (tweak for performance)
const CONFIG = {
  particles: 6000,
  lines: 1200,
  particleSize: 3.0,
  area: 2.2,            // world units for spread
  speed: 0.6,
  pulseDecay: 1.6
};

// Device/mouse
let pointer = new THREE.Vector2(0,0);
let deviceTilt = { x:0, y:0 };

// init app
async function init(){
  // setup DOM
  video = document.getElementById('camera');
  const canvas = document.getElementById('three-canvas');

  // renderer
  renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(window.devicePixelRatio || 1);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  renderer.autoClear = false;

  // scene & camera
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.01, 100);
  camera.position.z = 1.5;

  // video texture background
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    video.srcObject = stream;
    await video.play();
    videoTexture = new THREE.VideoTexture(video);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;
    videoTexture.format = THREE.RGBFormat;
    setupBackground(videoTexture);
  } catch (err) {
    console.warn('camera failed', err);
    setupFallbackBackground();
  }

  // noise
  simplex = new SimplexNoise();

  // particle system
  createParticles();

  // line mesh
  createLines();

  // events
  window.addEventListener('resize', onWindowResize);
  window.addEventListener('mousemove', (e)=>{ pointer.x = (e.clientX / window.innerWidth) * 2 - 1; pointer.y = - (e.clientY / window.innerHeight) * 2 + 1; });
  window.addEventListener('touchmove', (e)=>{ if(e.touches[0]){ pointer.x = (e.touches[0].clientX / window.innerWidth) * 2 -1; pointer.y = - (e.touches[0].clientY / window.innerHeight) * 2 +1; } }, {passive:true});
  if(window.DeviceOrientationEvent && typeof DeviceOrientationEvent.requestPermission === 'function'){
    // iOS permission-flow
    window.addEventListener('click', async ()=> {
      try {
        const p = await DeviceOrientationEvent.requestPermission();
        if(p === 'granted') {
          window.addEventListener('deviceorientation', (ev)=> {
            deviceTilt.x = (ev.beta || 0) / 90;
            deviceTilt.y = (ev.gamma || 0) / 90;
          });
        }
      } catch(e){}
    }, { once:true });
  } else if(window.DeviceOrientationEvent){
    window.addEventListener('deviceorientation', (ev)=> {
      deviceTilt.x = (ev.beta || 0) / 90;
      deviceTilt.y = (ev.gamma || 0) / 90;
    });
  }

  // controls
  document.getElementById('pulseBtn').addEventListener('click', emitPulse);
  document.getElementById('screenshot').addEventListener('click', takeSnapshot);
  document.getElementById('quality').addEventListener('change', onQualityChange);

  animate();
}

// background plane using the video texture
function setupBackground(tex){
  const bgScene = new THREE.Scene();
  const bgCamera = new THREE.OrthographicCamera(-1,1,1,-1,0,1);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTex: { value: tex }, opacity: { value: 1.0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position,1.0); }`,
    fragmentShader: `uniform sampler2D uTex; varying vec2 vUv; void main(){ vec4 c = texture2D(uTex, vUv); // subtle dim\n        c.rgb *= 0.95; gl_FragColor = c; }`,
    depthWrite: false
  });
  const geom = new THREE.PlaneGeometry(2,2);
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = -1;
  scene.add(mesh);
}

// fallback
function setupFallbackBackground(){
  const color = new THREE.Color(0x03040a);
  scene.background = color;
}

// create particle system (points)
function createParticles(){
  const count = CONFIG.particles;
  const positions = new Float32Array(count*3);
  const seeds = new Float32Array(count);
  for(let i=0;i<count;i++){
    const idx = i*3;
    // random spread in a flat-ish ellipsoid
    positions[idx] = (Math.random()*2-1) * CONFIG.area;
    positions[idx+1] = (Math.random()*2-1) * CONFIG.area * 0.6;
    positions[idx+2] = (Math.random()*2-1) * 0.2; // slight depth
    seeds[i] = Math.random()*10;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions,3));
  geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds,1));

  const material = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: {
      uTime: { value: 0 },
      uPixelRatio: { value: window.devicePixelRatio || 1 },
      uSize: { value: CONFIG.particleSize },
      uPointer: { value: new THREE.Vector2(0,0) },
      uTilt: { value: new THREE.Vector2(0,0) }
    },
    vertexShader: `
      attribute float aSeed;
      uniform float uTime;
      uniform vec2 uPointer;
      uniform vec2 uTilt;
      uniform float uSize;
      varying float vAlpha;
      // 2D noise (simple)
      float snoise(vec2 v){
        return (sin(v.x*12.9898+v.y*78.233) * 43758.5453) - floor(sin(v.x*12.9898+v.y*78.233) * 43758.5453);
      }
      void main(){
        vec3 pos = position;
        float seed = aSeed;
        // wobble with noise and time
        float n = snoise(vec2(pos.x*0.5+uTime*0.1+seed, pos.y*0.5+uTime*0.12));
        pos.x += (n-0.5) * 0.25;
        pos.y += (n-0.5) * 0.25;
        // respond to pointer and tilt
        pos.x += uPointer.x * 0.6 + uTilt.x * 0.6;
        pos.y += uPointer.y * 0.6 + uTilt.y * 0.6;
        vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = uSize * (uPixelRatio) * (1.0 / -mvPosition.z);
        vAlpha = 0.4 + abs(n)*0.6;
      }
    `,
    fragmentShader: `
      varying float vAlpha;
      void main(){
        float d = length(gl_PointCoord - vec2(0.5));
        float alpha = smoothstep(0.5, 0.0, d) * vAlpha;
        gl_FragColor = vec4(0.6, 0.95, 1.0, alpha);
      }
    `
  });

  particleSystem = new THREE.Points(geometry, material);
  scene.add(particleSystem);
}

// create line segments (web-like tendrils)
function createLines(){
  const count = CONFIG.lines;
  const positions = new Float32Array(count * 2 * 3); // pairs
  let idx = 0;
  for(let i=0;i<count;i++){
    const x1 = (Math.random()*2-1) * CONFIG.area;
    const y1 = (Math.random()*2-1) * CONFIG.area * 0.6;
    const z1 = (Math.random()*2-1) * 0.1;
    const angle = Math.random()*Math.PI*2;
    const len = 0.05 + Math.random()*0.6;
    const x2 = x1 + Math.cos(angle) * len;
    const y2 = y1 + Math.sin(angle) * len * 0.6;
    const z2 = z1 + (Math.random()*0.02 - 0.01);
    positions[idx++] = x1; positions[idx++] = y1; positions[idx++] = z1;
    positions[idx++] = x2; positions[idx++] = y2; positions[idx++] = z2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions,3));
  const material = new THREE.LineBasicMaterial({ color: 0x6ee7ff, transparent:true, opacity:0.08, blending: THREE.AdditiveBlending });
  lineMesh = new THREE.LineSegments(geometry, material);
  scene.add(lineMesh);
}

// emit a visual pulse
function emitPulse(){
  pulseUniforms.time.value = 0;
  // simple approach: animate material scale / temporarily boost particle size
  const mat = particleSystem.material;
  const orig = mat.uniforms.uSize.value;
  const tl = 0.0;
  // transient grow
  let t0 = performance.now();
  const dur = 800;
  function step(){
    const now = performance.now();
    const p = Math.min(1,(now - t0) / dur);
    mat.uniforms.uSize.value = orig * (1 + Math.sin(p*Math.PI)*3.0);
    if(p < 1) requestAnimationFrame(step);
    else mat.uniforms.uSize.value = orig;
  }
  step();
}

// take snapshot of canvas + video combined
function takeSnapshot(){
  const canvas = renderer.domElement;
  // draw video frame onto separate canvas to combine
  const temp = document.createElement('canvas');
  temp.width = canvas.width;
  temp.height = canvas.height;
  const ctx = temp.getContext('2d');
  try {
    // draw video
    if(video && video.readyState >= 2){
      ctx.drawImage(video, 0, 0, temp.width, temp.height);
    } else {
      ctx.fillStyle = '#02030a';
      ctx.fillRect(0,0,temp.width,temp.height);
    }
    // draw three canvas on top
    ctx.drawImage(canvas, 0, 0);
    const data = temp.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = data;
    a.download = 'invisible-web.png';
    a.click();
  } catch(e){
    console.warn('snapshot failed', e);
  }
}

function onQualityChange(e){
  const q = e.target.value;
  if(q === 'low'){ CONFIG.particles = 1500; CONFIG.lines = 600; CONFIG.particleSize = 2.0; }
  else if(q === 'medium'){ CONFIG.particles = 4000; CONFIG.lines = 1000; CONFIG.particleSize = 2.8; }
  else { CONFIG.particles = 9000; CONFIG.lines = 1600; CONFIG.particleSize = 3.2; }
  // rebuild systems (simple approach: remove and recreate)
  if(particleSystem){ scene.remove(particleSystem); particleSystem.geometry.dispose(); particleSystem.material.dispose(); particleSystem = null; }
  if(lineMesh){ scene.remove(lineMesh); lineMesh.geometry.dispose(); lineMesh.material.dispose(); lineMesh = null; }
  createParticles(); createLines();
}

// main loop
function animate(){
  requestAnimationFrame(animate);
  const t = clock.getElapsedTime();
  // update uniforms
  if(particleSystem && particleSystem.material && particleSystem.material.uniforms){
    particleSystem.material.uniforms.uTime.value = t * CONFIG.speed;
    particleSystem.material.uniforms.uPointer.value.set(pointer.x * 0.8, pointer.y * 0.8);
    particleSystem.material.uniforms.uTilt.value.set(deviceTilt.x * 0.9, deviceTilt.y * 0.9);
    particleSystem.material.uniforms.uPixelRatio.value = window.devicePixelRatio || 1;
  }
  // subtle motion on lines using simple noise
  if(lineMesh){
    const pos = lineMesh.geometry.attributes.position.array;
    for(let i=0;i<pos.length;i+=3){
      const x = pos[i], y = pos[i+1];
      const n = simplex.noise2D(x * 0.5 + t*0.05, y*0.5 + t*0.06);
      pos[i+2] = n * 0.04;
    }
    lineMesh.geometry.attributes.position.needsUpdate = true;
  }
  // slight camera movement for parallax
  camera.position.x += (pointer.x * 0.3 - camera.position.x) * 0.05 + deviceTilt.y*0.05;
  camera.position.y += (pointer.y * 0.3 - camera.position.y) * 0.05 + deviceTilt.x*0.05;
  camera.lookAt(0,0,0);

  renderer.clear();
  renderer.render(scene, camera);
}

// resize
function onWindowResize(){
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w,h,false);
  camera.aspect = w/h;
  camera.updateProjectionMatrix();
}

// start
init();
