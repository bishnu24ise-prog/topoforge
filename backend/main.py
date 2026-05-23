"""
TopoForge — FastAPI Backend
"""

import os
import uuid
import shutil
import io
import urllib.request
from pathlib import Path
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

from . import terrain
from . import gemini_client
from . import fal_stylize
from . import database

load_dotenv()

BASE_DIR = Path(__file__).parent.parent
UPLOADS_DIR = BASE_DIR / "uploads"
UPLOADS_DIR.mkdir(exist_ok=True)

app = FastAPI(title="TopoForge", description="Explore Terrain in 3D")

# CORS
allowed_origins = ["http://localhost:8000", "http://localhost:3000"]
frontend_url = os.getenv("FRONTEND_URL")
if frontend_url:
    allowed_origins.append(frontend_url)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve frontend in local dev
frontend_dir = BASE_DIR / "frontend"
if frontend_dir.exists():
    app.mount("/static", StaticFiles(directory=frontend_dir), name="static")


@app.get("/")
async def root():
    index = BASE_DIR / "frontend" / "index.html"
    if index.exists():
        return FileResponse(index)
    return {"status": "TopoForge API running"}


@app.post("/api/upload")
async def upload_map(file: UploadFile = File(...)):
    allowed_extensions = {".tif", ".tiff", ".jpg", ".jpeg", ".png", ".webp"}
    ext = Path(file.filename).suffix.lower()

    if ext not in allowed_extensions:
        raise HTTPException(400, f"Invalid file type. Allowed: {allowed_extensions}")

    file_id = str(uuid.uuid4())[:8]
    save_path = UPLOADS_DIR / f"{file_id}{ext}"

    with open(save_path, "wb") as f:
        shutil.copyfileobj(file.file, f)

    try:
        if ext in {".tif", ".tiff"}:
            data = terrain.extract_geotiff_data(str(save_path))
            bounds = data["bounds"]
            database.save_upload(file_id, file.filename, "geotiff", True, bounds)
            return JSONResponse({
                "success": True,
                "file_id": file_id,
                "bounds": bounds,
                "texture_b64": data["texture_b64"],
                "width": data["width"],
                "height": data["height"],
                "has_bounds": True,
            })
        else:
            data = terrain.extract_from_image(str(save_path))
            database.save_upload(file_id, file.filename, ext.lstrip("."), False)
            return JSONResponse({
                "success": True,
                "file_id": file_id,
                "texture_b64": data["texture_b64"],
                "width": data["width"],
                "height": data["height"],
                "has_bounds": False,
            })
    except Exception as e:
        raise HTTPException(500, f"Processing error: {str(e)}")


@app.post("/api/extract-bounds")
async def extract_bounds(file_id: str):
    files = list(UPLOADS_DIR.glob(f"{file_id}.*"))
    if not files:
        raise HTTPException(404, "File not found")

    try:
        bounds = await gemini_client.extract_bounds_from_image(str(files[0]))
        return JSONResponse({"success": True, "bounds": bounds})
    except Exception as e:
        raise HTTPException(500, f"AI error: {str(e)}")


@app.post("/api/narrate")
async def narrate(location_info: dict, features: list[str] = []):
    try:
        narration = await gemini_client.generate_narration(location_info, features)
        return JSONResponse({"success": True, "narration": narration})
    except Exception as e:
        raise HTTPException(500, f"AI error: {str(e)}")


@app.post("/api/stylize")
async def stylize(file_id: str):
    files = list(UPLOADS_DIR.glob(f"{file_id}.*"))
    if not files:
        raise HTTPException(404, "File not found")

    try:
        database.increment_view(file_id)
        stylized_url = fal_stylize.stylize_texture(str(files[0]))
        return JSONResponse({"success": True, "stylized_url": stylized_url})
    except Exception as e:
        raise HTTPException(500, f"Stylization error: {str(e)}")


@app.post("/api/voice-session")
async def log_voice_session(file_id: str, duration_seconds: int = 0):
    """Log a completed voice tour session to the database."""
    database.save_voice_session(file_id, duration_seconds)
    return JSONResponse({"success": True})


@app.get("/api/recent")
async def recent_maps():
    """Return recently uploaded maps from the database."""
    maps = database.get_recent_uploads(limit=10)
    return JSONResponse({"success": True, "maps": maps})


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "ai": gemini_client.HAS_GEMINI,
        "db": database.get_client() is not None,
    }


@app.get("/api/dem-tile")
def get_dem_tile(z: int, x: int, y: int):
    """Proxy AWS S3 elevation tiles to bypass browser CORS / COEP restrictions."""
    url = f"https://elevation-tiles-prod.s3.amazonaws.com/terrarium/{z}/{x}/{y}.png"
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0"}
        )
        with urllib.request.urlopen(req, timeout=8) as response:
            if response.status == 200:
                return StreamingResponse(io.BytesIO(response.read()), media_type="image/png")
            else:
                raise HTTPException(response.status, "Failed to fetch tile from S3")
    except urllib.error.HTTPError as e:
        raise HTTPException(e.code, f"S3 tile not found or forbidden: {e.reason}")
    except Exception as e:
        raise HTTPException(500, f"Proxy error: {str(e)}")


@app.get("/api/gemini-key")
async def get_gemini_key():
    key = os.getenv("GEMINI_API_KEY")
    if not key:
        raise HTTPException(500, "GEMINI_API_KEY not configured")
    return {"key": key}
