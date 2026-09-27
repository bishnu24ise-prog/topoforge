"""
Gemini API client for heightmap generation and narration
"""

import os
import asyncio
import base64
import logging
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


def get_client():
    """Get configured Gemini client."""
    if not HAS_GEMINI:
        raise RuntimeError("google-genai package required")

    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise RuntimeError("GEMINI_API_KEY not set in environment")

    return genai.Client(api_key=api_key)


async def _call_with_retry(coro_fn, max_retries: int = 4, base_delay: float = 2.0):
    """
    Call an async coroutine function with exponential backoff retry.

    Retries on transient errors:
      - 503 UNAVAILABLE  (high demand / overload)
      - 429 RESOURCE_EXHAUSTED (quota / rate limit)

    Args:
        coro_fn:      A zero-argument async callable that returns a coroutine.
        max_retries:  Maximum number of retry attempts (default 4).
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

    Returns: {"north": float, "south": float, "east": float, "west": float}
    """
    client = get_client()

    with open(image_path, "rb") as f:
        image_data = f.read()

    ext = Path(image_path).suffix.lower()
    mime_type = "image/jpeg" if ext in [".jpg", ".jpeg"] else "image/png"

    prompt = """Analyze this topographic map and extract the geographic bounding box.

Look for:
- Latitude/longitude markings on the map borders
- Graticule lines (grid lines showing coordinates)
- Any coordinate text visible on the map

Return ONLY a JSON object in this exact format, no other text:
{"north": 22.5, "south": 21.5, "east": -159.0, "west": -160.0}

Use decimal degrees. West longitudes are negative. Be as precise as possible."""

    response = await _call_with_retry(
        lambda: client.aio.models.generate_content(
            model="gemini-2.5-flash",
            contents=[
                types.Part.from_bytes(data=image_data, mime_type=mime_type),
                prompt
            ]
        )
    )

    # Parse JSON from response
    import json
    text = response.text.strip()

    # Handle markdown code blocks
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
