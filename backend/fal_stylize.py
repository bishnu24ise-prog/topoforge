"""
Free-tier texture stylization using canvas-based hypsometric tinting.
Uses local PIL-based hypsometric tinting. No external API needed.
No API key or cost required.
"""

import os
import base64
from pathlib import Path
from io import BytesIO
from PIL import Image, ImageEnhance, ImageFilter

HAS_FAL = False  # Always False — we use local processing


def stylize_texture(image_path: str) -> str:
    """
    Apply hypsometric-style tinting locally using PIL.
    Returns a base64 PNG data URI.
    Works identically from the frontend's perspective.
    """
    ext = Path(image_path).suffix.lower()

    img = Image.open(image_path).convert("RGB")

    # Resize to max 2048px
    max_size = 2048
    if img.width > max_size or img.height > max_size:
        img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

    # Apply hypsometric tinting via pixel manipulation
    img = _apply_hypsometric_tint(img)

    # Encode as PNG data URI
    buffer = BytesIO()
    img.save(buffer, format="PNG", optimize=True)
    b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64}"


def _apply_hypsometric_tint(img: Image.Image) -> Image.Image:
    """
    Apply elevation-based color tinting by mapping pixel brightness
    to hypsometric colors (green lowlands → yellow → brown highlands → white peaks).
    """
    import numpy as np

    arr = np.array(img, dtype=np.float32)

    # Compute luminance (proxy for elevation on topo maps)
    lum = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
    lum_norm = lum / 255.0  # 0.0 (dark) → 1.0 (bright)

    # Define hypsometric color ramp (elevation low → high)
    # Format: (threshold, R, G, B)
    ramp = [
        (0.00,  30,  80, 160),   # Deep water: dark blue
        (0.18,  70, 130, 180),   # Shallow water: steel blue
        (0.25, 180, 210, 140),   # Coastal lowland: pale green
        (0.38, 120, 180,  80),   # Low elevation: green
        (0.52, 200, 185,  80),   # Mid elevation: golden yellow
        (0.65, 180, 130,  60),   # Higher: warm ochre/tan
        (0.78, 150,  80,  40),   # High: rusty brown
        (0.90, 110,  50,  25),   # Very high: dark sienna
        (1.00, 240, 235, 230),   # Peaks: near-white snow
    ]

    # Interpolate color for each pixel
    out = np.zeros_like(arr)
    for i in range(len(ramp) - 1):
        t0, r0, g0, b0 = ramp[i]
        t1, r1, g1, b1 = ramp[i + 1]
        mask = (lum_norm >= t0) & (lum_norm < t1)
        if not np.any(mask):
            continue
        alpha = (lum_norm[mask] - t0) / (t1 - t0)
        out[mask, 0] = r0 + alpha * (r1 - r0)
        out[mask, 1] = g0 + alpha * (g1 - g0)
        out[mask, 2] = b0 + alpha * (b1 - b0)

    # Handle the last bucket (lum_norm == 1.0)
    mask = lum_norm >= ramp[-1][0]
    out[mask] = ramp[-1][1:]

    # Blend tint 60% with original for a natural look
    blended = 0.60 * out + 0.40 * arr
    blended = np.clip(blended, 0, 255).astype(np.uint8)

    result = Image.fromarray(blended, "RGB")

    # Slight contrast boost to make it pop
    result = ImageEnhance.Contrast(result).enhance(1.15)
    result = ImageEnhance.Saturation(result).enhance(1.25)

    return result
