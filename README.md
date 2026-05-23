# TopoForge 🌍

**Upload any topographic map. Explore the terrain in 3D with an AI tour guide.**

Upload a GeoTIFF or JPG map, fetch real elevation data, and fly over the terrain while an AI narrates what you're seeing.

## Features

- **📤 Upload any map** — GeoTIFF (auto-extracts bounds) or JPG/PNG (AI-extracted bounds)
- **🗺️ Real elevation data** — Fetches DEM tiles from AWS Terrain Tiles
- **🎮 Fly mode** — WASD + mouse to soar over terrain
- **🎤 Voice tour** — Ask the AI guide questions while you fly
- **🌄 Dynamic lighting** — Adjustable sun position
- **🎨 Texture stylization** — Hypsometric tinting by elevation
- **🗄️ Upload history** — All sessions stored in database

## Quick Start

```bash
cp .env.example .env
# Fill in GEMINI_API_KEY and SUPABASE_URL + SUPABASE_ANON_KEY
uv sync
uv run python run.py
```

Open http://localhost:8000

## Tech Stack

- **Frontend**: Vanilla JS + Three.js
- **Backend**: FastAPI + Python 3.13
- **Database**: Supabase (PostgreSQL, free tier)
- **Elevation**: AWS Terrain Tiles (free)
- **AI**: Gemini 2.0 Flash + Live API (free tier)

## Controls

| Mode | Control | Action |
|------|---------|--------|
| Orbit | Drag | Rotate |
| Orbit | Scroll | Zoom |
| Fly | WASD | Pitch and turn |

## License

MIT
