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
            model="gemini-2.0-flash",          # Fastest model — no thinking overhead
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

    # Parse JSON from response
    import json
    text = response.text.strip()

    # Strip any accidental markdown fences
    if text.startswith("```"):
        text = text.split("```")[1]
        if text.startswith("json"):
            text = text[4:]

    return json.loads(text.strip())


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
