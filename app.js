// Configuration
const CONFIG = {
    waveSpeed: 0.5,
    waveAmplitude: 60,
    waveFrequency: 0.015,
    motionSensitivity: 0.3,
    targetFPS: 60
};

// State
let canvas, ctx, video;
let time = 0;
let mouseX = 0, mouseY = 0;
let orientation = { x: 0, y: 0 };
let colorMode = 'dark';
let cameraActive = false;

// Perlin noise implementation (lightweight)
class PerlinNoise {
    constructor() {
        this.permutation = this.buildPermutation();
    }

    buildPermutation() {
        const p = [];
        for (let i = 0; i < 256; i++) p[i] = i;

        // Shuffle
        for (let i = 255; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [p[i], p[j]] = [p[j], p[i]];
        }

        // Duplicate
        return [...p, ...p];
    }

    fade(t) {
        return t * t * t * (t * (t * 6 - 15) + 10);
    }

    lerp(t, a, b) {
        return a + t * (b - a);
    }

    grad(hash, x, y) {
        const h = hash & 15;
        const u = h < 8 ? x : y;
        const v = h < 4 ? y : h === 12 || h === 14 ? x : 0;
        return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
    }

    noise(x, y) {
        const X = Math.floor(x) & 255;
        const Y = Math.floor(y) & 255;

        x -= Math.floor(x);
        y -= Math.floor(y);

        const u = this.fade(x);
        const v = this.fade(y);

        const a = this.permutation[X] + Y;
        const b = this.permutation[X + 1] + Y;

        return this.lerp(v,
            this.lerp(u,
                this.grad(this.permutation[a], x, y),
                this.grad(this.permutation[b], x - 1, y)
            ),
            this.lerp(u,
                this.grad(this.permutation[a + 1], x, y - 1),
                this.grad(this.permutation[b + 1], x - 1, y - 1)
            )
        );
    }
}

const perlin = new PerlinNoise();

// Initialize camera
async function initCamera() {
    video = document.getElementById('camera');

    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'environment',
                width: { ideal: 1920 },
                height: { ideal: 1080 }
            }
        });

        video.srcObject = stream;
        cameraActive = true;
        document.getElementById('errorMsg').classList.add('hidden');
    } catch (err) {
        console.error('Camera access denied:', err);
        video.style.display = 'none';
        document.getElementById('errorMsg').classList.remove('hidden');
        showFallbackBackground();
    }
}

// Fallback gradient background
function showFallbackBackground() {
    document.body.style.background = 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #0a0a0a 100%)';
}

// Initialize canvas
function initCanvas() {
    canvas = document.getElementById('waves');
    ctx = canvas.getContext('2d', { alpha: true });

    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
}

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

// Input tracking
function initInputTracking() {
    // Mouse/touch tracking
    document.addEventListener('mousemove', (e) => {
        mouseX = e.clientX / window.innerWidth;
        mouseY = e.clientY / window.innerHeight;
    });

    document.addEventListener('touchmove', (e) => {
        if (e.touches.length > 0) {
            mouseX = e.touches[0].clientX / window.innerWidth;
            mouseY = e.touches[0].clientY / window.innerHeight;
        }
    });

    // Device orientation (mobile)
    if (window.DeviceOrientationEvent) {
        window.addEventListener('deviceorientation', (e) => {
            orientation.x = (e.beta || 0) / 180; // -1 to 1
            orientation.y = (e.gamma || 0) / 90; // -1 to 1
        });
    }
}

// Color mode toggle
function initColorModeToggle() {
    const toggle = document.getElementById('toggleMode');
    document.body.classList.add('dark-mode');

    toggle.addEventListener('click', () => {
        colorMode = colorMode === 'dark' ? 'light' : 'dark';
        document.body.classList.toggle('dark-mode');
        document.body.classList.toggle('light-mode');
    });
}

// Draw waves
function drawWaves() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const layers = 3;
    const colors = colorMode === 'dark' 
        ? ['rgba(0, 255, 255, 0.15)', 'rgba(138, 43, 226, 0.15)', 'rgba(255, 255, 255, 0.1)']
        : ['rgba(255, 100, 100, 0.2)', 'rgba(255, 200, 50, 0.2)', 'rgba(100, 150, 255, 0.15)'];

    for (let layer = 0; layer < layers; layer++) {
        ctx.beginPath();
        ctx.strokeStyle = colors[layer];
        ctx.lineWidth = 3 - layer * 0.5;

        const layerOffset = layer * 0.3;
        const speedMultiplier = 1 + layer * 0.3;

        // Motion influence
        const motionX = (mouseX - 0.5) * CONFIG.motionSensitivity + orientation.y * 0.2;
        const motionY = (mouseY - 0.5) * CONFIG.motionSensitivity + orientation.x * 0.2;

        // Draw horizontal waves
        for (let x = 0; x < canvas.width; x += 2) {
            const noiseValue = perlin.noise(
                x * CONFIG.waveFrequency + time * speedMultiplier + layerOffset,
                layer * 2 + motionY * 5
            );

            const y = canvas.height / 2 + 
                     Math.sin(x * 0.01 + time * speedMultiplier) * CONFIG.waveAmplitude +
                     noiseValue * CONFIG.waveAmplitude * 1.5 +
                     motionY * 100;

            if (x === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        ctx.stroke();

        // Draw vertical waves
        ctx.beginPath();
        for (let y = 0; y < canvas.height; y += 2) {
            const noiseValue = perlin.noise(
                layer * 2 + motionX * 5,
                y * CONFIG.waveFrequency + time * speedMultiplier * 0.8 + layerOffset
            );

            const x = canvas.width / 2 + 
                     Math.sin(y * 0.01 + time * speedMultiplier * 0.8) * CONFIG.waveAmplitude * 0.7 +
                     noiseValue * CONFIG.waveAmplitude +
                     motionX * 100;

            if (y === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }
        }

        ctx.stroke();

        // Add radial pulses
        const pulseCount = 2 + layer;
        for (let i = 0; i < pulseCount; i++) {
            const angle = (time * 0.5 + i * Math.PI * 2 / pulseCount) % (Math.PI * 2);
            const radius = 100 + layer * 50 + Math.sin(time + i) * 30;
            const cx = canvas.width / 2 + Math.cos(angle) * 200 + motionX * 150;
            const cy = canvas.height / 2 + Math.sin(angle) * 200 + motionY * 150;

            ctx.beginPath();
            ctx.arc(cx, cy, radius, 0, Math.PI * 2);
            ctx.strokeStyle = colors[layer];
            ctx.lineWidth = 2;
            ctx.stroke();
        }
    }
}

// Animation loop
function animate() {
    time += CONFIG.waveSpeed * 0.016; // Normalized to ~60 FPS
    drawWaves();
    requestAnimationFrame(animate);
}

// Initialize everything
async function init() {
    await initCamera();
    initCanvas();
    initInputTracking();
    initColorModeToggle();
    animate();
}

// Start on load
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}