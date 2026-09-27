# TopoForge 🌍 — AI 3D Terrain Explorer

> **Turn any 2D map or satellite tile into a highly detailed, interactive 3D terrain with real-time AI Voice narration and premium visual styles.**

TopoForge is a full-stack, professional-grade 3D geographic visualization application. It combines high-fidelity **Three.js** rendering, real-time **Gemini AI voice interactions**, dynamic elevation mapping, and custom **local image stylization presets** to let you explore the Earth like never before.

---

## 🌟 Premium Features

### 1. 🏔️ High-Density 3D Terrain Engine
* **Razor-Sharp organic peaks:** Quadrupled vertex grid density (512×512 segments) for extreme micro-relief detail.
* **Georeferenced Map support:** Directly upload GeoTIFF `.tif`/`.tiff` files or standard `.jpg`/`.png`/`.webp` images.
* **Dynamic Lighting & Shadows:** Adjustable Sun Azimuth and Elevation controls with real-time soft shadow mapping (PCFSoftShadowMap) to simulate sunrise, noon, and sunset.

### 2. 🎨 Premium "Realistic Stylish" Texturing (Local & 100% Free)
Instead of expensive external cloud APIs, TopoForge performs high-performance local image styling in under **0.5 seconds** using PIL and NumPy. 
* **✨ Realistic Stylish (Default):** Sharpens satellite tiles using an advanced local `UnsharpMask` and blends a subtle 15% elevation ramp (Sapphire ocean → Emerald lowlands → Snowy peaks) with contrast and saturation boosts.
* **🎨 5 Stunning Visual Presets:**
  1. `🗺️ Hypsometric Relief`: Classic scientific geographic atlas styling.
  2. `📜 Vintage Parchment`: Historical paper look, sepia values, sienna mountains.
  3. `🌌 Cyberpunk Neon`: Sci-fi deep indigo valleys, neon cyan slopes, glowing magenta peaks.
  4. `🌲 Emerald Forest`: Lush, saturated nature greens and deep teal waterways.
  5. `🔥 Volcanic Wasteland`: Scorched black basalt lowlands with glowing molten orange lava.
* **↺ Instant Reset:** Reverts to clean, original satellite/hybrid imagery in under 50ms without hitting the backend.

### 3. ✈️ Interactive flight Simulation Mode
* **WASD flight Controls:** Switch from Orbit Camera to direct flight controls. Steer, dive, soar, and climb over the terrain mesh.
* **Immersive flight Engine Audio:** Realistic looping engine noise (`plane.mp3`) that matches your exploration.

### 4. 🎤 Real-Time Gemini AI Voice Guide
* **Real-time 2-way Voice Chat:** Start a conversation with an AI guide powered by the Gemini Live API.
* **Lag-Free Voice streaming:** Advanced client-side audio processing (VAD noise gate and optimized queue buffers) to support natural interruptions and smooth playback.
* **Location-Aware Narration:** The guide automatically knows the bounds of the terrain you are viewing and narrates its real-world history, geography, and ecology as you fly.

### 5. 🗺️ World Map Area Picker
* **Interactive Leaflet Map Modal:** Click anywhere on Earth to pick a custom area to explore.
* **Dynamic Scale controls:** Slider to scale your exploration box from a local **City** (~0.1°) to a larger **Region** or **Country** (~2.0°).
* **Automatic DEM Fetching:** Automatically queries AWS Terrain Tiles to reconstruct the elevation map of your chosen coordinates on-the-fly.

---

## 🛠️ Tech Stack

* **Frontend:** HTML5, Vanilla JavaScript, CSS3 (Premium dark-mode glassmorphism), Three.js (WebGL), GLTFLoader, Leaflet Maps + OpenStreetMap tiles (free, no API key).
* **Backend:** FastAPI, Python 3.13, Pillow (PIL), NumPy, rasterio (for GeoTIFF geospatial parsing).
* **AI Engine:** Google Gemini Live API & Vision Models (`gemini-2.5-flash` with exponential backoff retry).
* **Database & Storage:** Supabase (PostgreSQL session tracking and database views).
* **Hosting Configuration:** Optimized for rapid deployments on **Vercel** (Frontend) and **Render** (FastAPI Backend).

---

## 🚀 Quick Start

### 1. Configure Environment Variables
Copy `.env.example` to `.env` in the root directory:
```bash
cp .env.example .env
```
Fill in the following details:
```ini
# Free Gemini API key from Google AI Studio
GEMINI_API_KEY=your_gemini_api_key_here

# Supabase database config
SUPABASE_URL=https://xxxxxxxxxxxx.supabase.co
SUPABASE_ANON_KEY=your_anon_key_here
```

### 2. Run Locally
Using the `uv` tool or standard python packaging:
```bash
# Sync dependencies
uv sync

# Start the full-stack server
uv run python run.py
```
Open **`http://localhost:8000`** in your browser.

---

## 🎮 Interface & Navigation Controls

| Camera Mode | Keyboard / Mouse Input | Action |
| :--- | :--- | :--- |
| **Orbit** | Left-Click & Drag | Rotate around terrain |
| **Orbit** | Scroll Wheel | Zoom camera in and out |
| **Flight** | Mouse Movement | Look around (Yaw & Pitch) |
| **Flight** | `W` / `S` | Speed up / Slow down |
| **Flight** | `A` / `D` | Turn left / Turn right |
| **Flight** | `Space` / `C` | Ascend / Descend |

---

## 🔧 Recent Fixes & Improvements

### 🗺️ Map Picker — No API Key Required
The interactive "Pick a Location" map now uses **OpenStreetMap** tiles exclusively — completely free, no account or API key needed. A CSS `invert + hue-rotate` filter gives it a sleek dark theme matching the app UI, with no third-party authentication.

> **Previously:** CARTO and Stadia Maps tiles both required API keys, causing `401 Invalid Authentication` and `API KEY REQUIRED` watermarks.

### ⚡ Gemini Bounds Extraction — ~5s Response Time
The "Extract with Gemini" feature was optimised for speed with three changes:
| Optimisation | Detail |
| :--- | :--- |
| **Faster model** | Switched to `gemini-2.5-flash` (no thinking overhead) |
| **Image compression** | Resized to ≤512px JPEG before sending (3–5× smaller payload) |
| **Token cap** | `max_output_tokens=60` — bounds JSON is ~50 tokens, returns instantly |
| **Hard timeout** | `asyncio.wait_for(timeout=8.0)` — never hangs indefinitely |

### 🔁 Gemini 503 / 429 Auto-Retry
All Gemini API calls now automatically retry on transient server errors with **exponential backoff**:

```
Attempt 1 → wait 1.5s → Attempt 2 → wait 3s → Attempt 3 → wait 6s → raise
```

Handles `503 UNAVAILABLE` (high demand) and `429 RESOURCE_EXHAUSTED` (rate limit) gracefully — non-retryable errors (auth, bad request) fail immediately without wasting time.

### 🏷️ Model Updated to `gemini-2.5-flash`
`gemini-2.0-flash` was retired by Google (`404 NOT_FOUND`). All API calls now use `gemini-2.5-flash`, the current recommended fast model.

---

## 📝 License

Distributed under the MIT License. See `LICENSE` for more information.
