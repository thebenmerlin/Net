# See the Invisible Web

An AR-style web app that visualizes invisible network waves over your camera feed.

## Usage

1. Open `index.html` in a modern browser (Chrome/Safari)
2. Allow camera access when prompted
3. Move your phone or mouse — waves shimmer with your motion
4. Toggle color modes with the button (bottom-right)

## Deploy

Zip the folder and upload to Vercel static hosting, or serve with any static file host.

## Tech

- Pure HTML/CSS/JS (no frameworks)
- Perlin noise + sine waves for smooth animation
- getUserMedia API for camera feed
- Device orientation + mouse tracking for parallax

**Privacy**: No network data accessed. All visuals are simulated.