# Deploying TopoForge — Vercel (frontend) + Render (backend)

## Overview

```
Browser → Vercel (frontend HTML/JS/CSS)
              ↓ /api/* rewrites
         Render (FastAPI backend, Python)
```

Vercel proxies all `/api/` calls to Render, so the frontend never needs to know the backend URL — and CORS isn't an issue.

---

## Step 1 — Deploy Backend to Render

1. Push your code to GitHub (or GitLab)
2. Go to https://render.com → **New → Web Service**
3. Connect your repo
4. Set these in Render:
   - **Runtime**: Python 3
   - **Build Command**: `pip install uv && uv sync`
   - **Start Command**: `uv run uvicorn backend.main:app --host 0.0.0.0 --port $PORT`
5. Add **Environment Variables** in Render dashboard:
   - `GEMINI_API_KEY` → your key from aistudio.google.com
   - `FRONTEND_URL` → (leave blank for now, fill in after Vercel deploy)
6. Deploy — note the URL, e.g. `https://topoforge-backend.onrender.com`

---

## Step 2 — Update vercel.json with your Render URL

Edit `frontend/vercel.json` — replace the placeholder:

```json
{ "source": "/api/(.*)", "destination": "https://YOUR-RENDER-URL.onrender.com/api/$1" }
```

---

## Step 3 — Deploy Frontend to Vercel

1. Go to https://vercel.com → **New Project**
2. Connect your repo
3. Set **Root Directory** to `frontend`
4. Leave all other settings as default (no build command needed — it's vanilla JS)
5. Deploy — note your Vercel URL, e.g. `https://topoforge.vercel.app`

---

## Step 4 — Add FRONTEND_URL to Render

Go back to Render → your service → Environment:
- Set `FRONTEND_URL` = `https://topoforge.vercel.app` (your actual Vercel URL)
- Render will redeploy automatically

---

## Free tier limits

| Service | Free limit |
|---------|-----------|
| Render | 750 hrs/month, spins down after 15min inactivity (cold start ~30s) |
| Vercel | Unlimited static, 100GB bandwidth/month |
| Gemini API | 15 req/min, 1M tokens/day |
| AWS Terrain Tiles | Free, no key needed |

## Local dev (unchanged)

```bash
cp .env.example .env
# add GEMINI_API_KEY
uv sync
uv run python run.py
# open http://localhost:8000
```
