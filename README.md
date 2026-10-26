# TopoForge ðŸŒ â€” AI 3D Terrain Explorer

> **Turn any 2D map or satellite tile into a highly detailed, interactive 3D terrain with real-time AI Voice narration and premium visual styles.**

TopoForge is a full-stack, professional-grade 3D geographic visualization application. It combines high-fidelity **Three.js** rendering, real-time **Gemini AI voice interactions**, dynamic elevation mapping, and custom **local image stylization presets** to let you explore the Earth like never before.

---

## ðŸŒŸ Premium Features

### 1. ðŸ”ï¸ High-Density 3D Terrain Engine
* **Razor-Sharp organic peaks:** Quadrupled vertex grid density (512Ã—512 segments) for extreme micro-relief detail.
* **Georeferenced Map support:** Directly upload GeoTIFF `.tif`/`.tiff` files or standard `.jpg`/`.png`/`.webp` images.
* **Dynamic Lighting & Shadows:** Adjustable Sun Azimuth and Elevation controls with real-time soft shadow mapping (PCFSoftShadowMap) to simulate sunrise, noon, and sunset.

### 2. ðŸŽ¨ Premium "Realistic Stylish" Texturing (Local & 100% Free)
Instead of expensive external cloud APIs, TopoForge performs high-performance local image styling in under **0.5 seconds** using PIL and NumPy. 
* **âœ¨ Realistic Stylish (Default):** Sharpens satellite tiles using an advanced local `UnsharpMask` and blends a subtle 15% elevation ramp (Sapphire ocean â†’ Emerald lowlands â†’ Snowy peaks) with contrast and saturation boosts.
* **ðŸŽ¨ 5 Stunning Visual Presets:**
  1. `ðŸ—ºï¸ Hypsometric Relief`: Classic scientific geographic atlas styling.
  2. `ðŸ“œ Vintage Parchment`: Historical paper look, sepia values, sienna mountains.
  3. `ðŸŒŒ Cyberpunk Neon`: Sci-fi deep indigo valleys, neon cyan slopes, glowing magenta peaks.
  4. `ðŸŒ² Emerald Forest`: Lush, saturated nature greens and deep teal waterways.
  5. `ðŸ”¥ Volcanic Wasteland`: Scorched black basalt lowlands with glowing molten orange lava.
* **â†º Instant Reset:** Reverts to clean, original satellite/hybrid imagery in under 50ms without hitting the backend.

### 3. âœˆï¸ Interactive flight Simulation Mode
* **WASD flight Controls:** Switch from Orbit Camera to direct flight controls. Steer, dive, soar, and climb over the terrain mesh.
* **Immersive flight Engine Audio:** Realistic looping engine noise (`plane.mp3`) that matches your exploration.

### 4. ðŸŽ¤ Real-Time Gemini AI Voice Guide
* **Real-time 2-way Voice Chat:** Start a conversation with an AI guide powered by the Gemini Live API.
* **Lag-Free Voice streaming:** Advanced client-side audio processing (VAD noise gate and optimized queue buffers) to support natural interruptions and smooth playback.
* **Location-Aware Narration:** The guide automatically knows the bounds of the terrain you are viewing and narrates its real-world history, geography, and ecology as you fly.

### 5. ðŸ—ºï¸ World Map Area Picker
* **Interactive Leaflet Map Modal:** Click anywhere on Earth to pick a custom area to explore.
* **Dynamic Scale controls:** Slider to scale your exploration box from a local **City** (~0.1Â°) to a larger **Region** or **Country** (~2.0Â°).
* **Automatic DEM Fetching:** Automatically queries AWS Terrain Tiles to reconstruct the elevation map of your chosen coordinates on-the-fly.

---

## ðŸ› ï¸ Tech Stack

* **Frontend:** HTML5, Vanilla JavaScript, CSS3 (Premium dark-mode glassmorphism), Three.js (WebGL), GLTFLoader, Leaflet Maps + OpenStreetMap tiles (free, no API key).
* **Backend:** FastAPI, Python 3.13, Pillow (PIL), NumPy, rasterio (for GeoTIFF geospatial parsing).
* **AI Engine:** Google Gemini Live API & Vision Models (`gemini-2.5-flash` with exponential backoff retry).
* **Database & Storage:** Supabase (PostgreSQL session tracking and database views).
* **Hosting Configuration:** Optimized for rapid deployments on **Vercel** (Frontend) and **Render** (FastAPI Backend).

---

## ðŸš€ Quick Start

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

## ðŸŽ® Interface & Navigation Controls

| Camera Mode | Keyboard / Mouse Input | Action |
| :--- | :--- | :--- |
| **Orbit** | Left-Click & Drag | Rotate around terrain |
| **Orbit** | Scroll Wheel | Zoom camera in and out |
| **Flight** | Mouse Movement | Look around (Yaw & Pitch) |
| **Flight** | `W` / `S` | Speed up / Slow down |
| **Flight** | `A` / `D` | Turn left / Turn right |
| **Flight** | Space / C | Ascend / Descend |
| **Any** | V / Mic HUD | Voice Command (Wispr Flow) |

---

## ðŸ”§ Recent Fixes & Improvements

### ðŸ—ºï¸ Map Picker â€” No API Key Required
The interactive "Pick a Location" map now uses **OpenStreetMap** tiles exclusively â€” completely free, no account or API key needed. A CSS `invert + hue-rotate` filter gives it a sleek dark theme matching the app UI, with no third-party authentication.

> **Previously:** CARTO and Stadia Maps tiles both required API keys, causing `401 Invalid Authentication` and `API KEY REQUIRED` watermarks.

### âš¡ Gemini Bounds Extraction â€” ~5s Response Time
The "Extract with Gemini" feature was optimised for speed with three changes:
| Optimisation | Detail |
| :--- | :--- |
| **Faster model** | Switched to `gemini-2.5-flash` (no thinking overhead) |
| **Image compression** | Resized to â‰¤512px JPEG before sending (3â€“5Ã— smaller payload) |
| **Token cap** | `max_output_tokens=60` â€” bounds JSON is ~50 tokens, returns instantly |
| **Hard timeout** | `asyncio.wait_for(timeout=8.0)` â€” never hangs indefinitely |

### ðŸ” Gemini 503 / 429 Auto-Retry
All Gemini API calls now automatically retry on transient server errors with **exponential backoff**:

```
Attempt 1 â†’ wait 1.5s â†’ Attempt 2 â†’ wait 3s â†’ Attempt 3 â†’ wait 6s â†’ raise
```

Handles `503 UNAVAILABLE` (high demand) and `429 RESOURCE_EXHAUSTED` (rate limit) gracefully â€” non-retryable errors (auth, bad request) fail immediately without wasting time.

### ðŸ·ï¸ Model Updated to `gemini-2.5-flash`
`gemini-2.0-flash` was retired by Google (`404 NOT_FOUND`). All API calls now use `gemini-2.5-flash`, the current recommended fast model.

---

## ðŸ“ License

Distributed under the MIT License. See `LICENSE` for more information.

