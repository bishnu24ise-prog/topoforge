"""
Gemini API client for heightmap generation and narration
"""

import os
import asyncio
import base64
import logging
import io
from pathlib import Path

logger = logging.getLogger(__name__)

# Try to import Gemini SDK
try:
    from google import genai
    from google.genai import types
    HAS_GEMINI = True
except ImportError:
    HAS_GEMINI = False
    print("Warning: google-genai not installed. Gemini features disabled.")

# Try Pillow for fast image resizing before sending to Gemini
try:
    from PIL import Image as PILImage
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


def get_client():
    """Get configured Gemini client."""
    if not HAS_GEMINI:
        raise RuntimeError("google-genai package required")

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set in environment")

    return genai.Client(api_key=api_key)


def _compress_image(image_path: str, max_size: int = 512) -> tuple[bytes, str]:
    """
    Resize and JPEG-compress an image to max_size px on longest side.
    Returns (bytes, mime_type).  Falls back to raw file if PIL unavailable.
    """
    if not HAS_PIL:
        with open(image_path, "rb") as f:
            data = f.read()
        ext = Path(image_path).suffix.lower()
        mime = "image/jpeg" if ext in (".jpg", ".jpeg") else "image/png"
        return data, mime

    img = PILImage.open(image_path).convert("RGB")
    # Resize so longest side ≤ max_size
    ratio = max_size / max(img.width, img.height)
    if ratio < 1.0:
        new_w = int(img.width * ratio)
        new_h = int(img.height * ratio)
        img = img.resize((new_w, new_h), PILImage.LANCZOS)

    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=80, optimize=True)
    return buf.getvalue(), "image/jpeg"


async def _call_with_retry(coro_fn, max_retries: int = 3, base_delay: float = 1.5):
    """
    Call an async coroutine function with exponential backoff retry.

    Retries on transient errors:
      - 503 UNAVAILABLE  (high demand / overload)
      - 429 RESOURCE_EXHAUSTED (quota / rate limit)

    Args:
        coro_fn:      A zero-argument async callable that returns a coroutine.
        max_retries:  Maximum number of retry attempts (default 3).
        base_delay:   Initial backoff delay in seconds (doubles each attempt).

    Returns: The successful response from the Gemini API.
    Raises:  The last exception if all retries are exhausted.
    """
    last_exc = None
    for attempt in range(max_retries + 1):
        try:
            return await coro_fn()
        except Exception as exc:
            err_str = str(exc)
            # Retry only on transient server-side errors
            if any(code in err_str for code in ("503", "UNAVAILABLE", "429", "RESOURCE_EXHAUSTED")):
                last_exc = exc
                if attempt < max_retries:
                    delay = base_delay * (2 ** attempt)
                    logger.warning(
                        "Gemini transient error (attempt %d/%d): %s — retrying in %.1fs",
                        attempt + 1, max_retries, err_str[:120], delay
                    )
                    await asyncio.sleep(delay)
                    continue
            # Non-retryable error — raise immediately
            raise
    raise last_exc


async def extract_bounds_from_image(image_path: str) -> dict:
    """
    Use Gemini to extract geographic bounds from a map image.
    Optimised for speed: compressed image + fast model + 8s timeout.

    Returns: {"north": float, "south": float, "east": float, "west": float}
    """
    client = get_client()

    # Compress image to ≤512px JPEG before sending — 3-5x smaller payload
    image_data, mime_type = _compress_image(image_path, max_size=512)

    # Ultra-short, precise prompt — fewer tokens = faster response
    prompt = (
        "Look at this map image. Extract the geographic bounding box. "
        "Reply with ONLY valid JSON, no markdown, no explanation:\n"
        '{"north": <float>, "south": <float>, "east": <float>, "west": <float>}\n'
        "Use decimal degrees. West/South are negative where applicable."
    )

    async def _call():
        return await client.aio.models.generate_content(
            model="gemini-2.5-flash",          # Fast model — no thinking overhead
            contents=[
                types.Part.from_bytes(data=image_data, mime_type=mime_type),
                prompt
            ],
            config=types.GenerateContentConfig(
                temperature=0,                  # Deterministic — no randomness needed
                max_output_tokens=60,           # Bounds JSON is ~50 tokens max
            )
        )

    # Hard 8-second timeout so it never hangs
    try:
        response = await asyncio.wait_for(
            _call_with_retry(_call),
            timeout=8.0
        )
    except asyncio.TimeoutError:
        raise RuntimeError("Gemini timed out after 8s — please try again")

    return _parse_bounds_json(response.text)


def _parse_bounds_json(raw: str) -> dict:
    """
    Robustly extract a bounds dict from Gemini's raw text response.

    Tries three strategies in order:
      1. Regex — grab the first {...} block and parse it.
      2. Markdown strip — remove ```json fences then parse.
      3. Float scan — find exactly 4 numbers in north/south/east/west order.

    Raises ValueError with the raw text on total failure.
    """
    import json, re

    text = raw.strip()

    # ── Strategy 1: extract first JSON object with regex ──────────────────
    m = re.search(r'\{[^{}]*\}', text, re.DOTALL)
    if m:
        try:
            data = json.loads(m.group())
            return _validate_bounds(data)
        except Exception:
            pass

    # ── Strategy 2: strip markdown fences ────────────────────────────────
    clean = re.sub(r'```(?:json)?', '', text).replace('```', '').strip()
    try:
        data = json.loads(clean)
        return _validate_bounds(data)
    except Exception:
        pass

    # ── Strategy 3: scan for 4 floats labelled north/south/east/west ─────
    keys   = ["north", "south", "east", "west"]
    values = {}
    for key in keys:
        match = re.search(rf'"{key}"\s*:\s*(-?\d+(?:\.\d+)?)', text, re.IGNORECASE)
        if match:
            values[key] = float(match.group(1))

    if len(values) == 4:
        return _validate_bounds(values)

    # All strategies failed — log and raise
    logger.error("Gemini bounds parse failed. Raw response:\n%s", text)
    raise ValueError(
        f"Could not parse bounds from Gemini response. "
        f"Raw text: {text[:200]!r}"
    )


def _validate_bounds(data: dict) -> dict:
    """Ensure all four bound keys exist and are numeric."""
    required = {"north", "south", "east", "west"}
    missing = required - set(data.keys())
    if missing:
        raise ValueError(f"Missing bound keys: {missing}")
    return {k: float(data[k]) for k in required}



async def generate_narration(location_info: dict, visible_features: list[str]) -> str:
    """
    Generate a short narration for the current view during flyover.

    Args:
        location_info: {"lat": float, "lon": float, "elevation": float}
        visible_features: List of feature names visible in current view

    Returns: Narration text (1-2 sentences)
    """
    client = get_client()

    prompt = f"""You are a knowledgeable tour guide narrating a scenic flyover.

Current position: {location_info.get('lat', 'unknown')}°N, {location_info.get('lon', 'unknown')}°W
Elevation: {location_info.get('elevation', 'unknown')}m
Visible features: {', '.join(visible_features) if visible_features else 'general terrain'}

Generate a brief, engaging narration (1-2 sentences) about what the viewer is seeing.
Focus on interesting geographic, historical, or natural facts.
Be conversational and enthusiastic but not over the top."""

    response = await _call_with_retry(
        lambda: client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=[prompt]
        )
    )

    return response.text.strip()
