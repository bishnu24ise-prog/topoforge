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


def stylize_texture(image_path: str, style: str = "realistic") -> str:
    """
    Apply preset-based texture stylization locally using PIL.
    Returns a base64 PNG data URI.
    Works identically from the frontend's perspective.
    """
    ext = Path(image_path).suffix.lower()

    img = Image.open(image_path).convert("RGB")

    # Resize to max 2048px
    max_size = 2048
    if img.width > max_size or img.height > max_size:
        img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

    # Apply selected style via pixel manipulation
    img = _apply_preset_tint(img, style)

    # Encode as PNG data URI
    buffer = BytesIO()
    img.save(buffer, format="PNG", optimize=True)
    b64 = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{b64}"


def _apply_preset_tint(img: Image.Image, style: str) -> Image.Image:
    """
    Apply elevation-based color tinting using various custom palettes and styling presets.
    Uses PIL UnsharpMask to sharpen natural details and blends custom elevation ramps.
    """
    import numpy as np

    # Define preset style parameters
    # Format: (ramp, blend_alpha, contrast_factor, saturation_factor, apply_sharpen)
    
    # 1. Realistic: Emerald/Sapphire rich colors, low blend (15%), heavy sharpening to keep details sharp
    ramp_realistic = [
        (0.00,  30,  70, 150),   # Deep water: rich sapphire blue
        (0.18,  60, 120, 170),   # Shallow water: soft cyan
        (0.25, 170, 200, 140),   # Lowlands: healthy pale green
        (0.50, 110, 170,  70),   # Midlands: deep lush green
        (0.72, 190, 175,  90),   # Highlands: warm sand/stone
        (0.85, 140,  90,  60),   # Mountains: mountain brown
        (1.00, 245, 245, 250),   # Peaks: clean snow white
    ]

    # 2. Hypsometric: Classic scientific atlas styling, high blend (60%)
    ramp_hypsometric = [
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

    # 3. Vintage: Earthy old-world parchment sepia styling, extremely high blend (90%)
    ramp_vintage = [
        (0.00, 215, 190, 150),   # Lowlands: aged dark parchment
        (0.30, 230, 210, 175),   # Lower hills: classic warm cream
        (0.60, 195, 165, 125),   # Higher hills: soft tea-stain tan
        (0.85, 155, 120,  85),   # Mountains: vintage wood brown
        (1.00,  95,  65,  40),   # Peaks: deep sienna/burnt umber
    ]

    # 4. Cyberpunk: Glowing neon indigo, cyan and bright magenta style (85% blend)
    ramp_cyberpunk = [
        (0.00,  15,   5,  35),   # Abyssal valleys: deep midnight indigo
        (0.20,  45,  10,  85),   # Lowlands: glowing dark violet
        (0.45,   0, 120, 240),   # Midlands: electric blue
        (0.70,   0, 240, 240),   # Highlands: neon cyan
        (0.92, 255,   0, 160),   # Peaks: hot neon pink
        (1.00, 255, 255, 255),   # Tips: laser white
    ]

    # 5. Emerald: Vivid lush nature and teals (50% blend)
    ramp_emerald = [
        (0.00,  15,  55,  85),   # Deep water: dark teal-blue
        (0.18,  30, 105, 115),   # Shallow: rich turquoise
        (0.30,  40, 130,  85),   # Valley: lush jungle green
        (0.55,  75, 185, 100),   # Midlands: vibrant meadow green
        (0.80, 155, 220, 140),   # Highlands: bright mint
        (1.00, 240, 250, 245),   # Peaks: misty alpine white
    ]

    # 6. Volcanic: Obsidian gray and molten lava style (75% blend)
    ramp_volcanic = [
        (0.00,  10,  10,  12),   # Valleys: basalt black
        (0.25,  35,  30,  32),   # Lowlands: volcanic ash gray
        (0.50, 195,  35,   0),   # Slopes: molten red lava
        (0.75, 255,  95,   0),   # High ridges: glowing orange ember
        (0.92, 255, 190,   0),   # Peaks: bright yellow magma
        (1.00, 255, 255, 200),   # Tips: incandescent white heat
    ]

    # Select preset parameters
    if style == "hypsometric":
        ramp, blend_alpha, contrast_factor, saturation_factor, apply_sharpen = (ramp_hypsometric, 0.60, 1.15, 1.25, False)
    elif style == "vintage":
        ramp, blend_alpha, contrast_factor, saturation_factor, apply_sharpen = (ramp_vintage, 0.90, 1.20, 0.85, True)
    elif style == "cyberpunk":
        ramp, blend_alpha, contrast_factor, saturation_factor, apply_sharpen = (ramp_cyberpunk, 0.85, 1.35, 1.45, True)
    elif style == "emerald":
        ramp, blend_alpha, contrast_factor, saturation_factor, apply_sharpen = (ramp_emerald, 0.50, 1.20, 1.30, True)
    elif style == "volcanic":
        ramp, blend_alpha, contrast_factor, saturation_factor, apply_sharpen = (ramp_volcanic, 0.75, 1.25, 1.40, True)
    else:  # "realistic" (default)
        ramp, blend_alpha, contrast_factor, saturation_factor, apply_sharpen = (ramp_realistic, 0.15, 1.25, 1.35, True)

    # Optional pre-sharpen to maximize detail before processing
    if apply_sharpen:
        img = img.filter(ImageFilter.UnsharpMask(radius=2, percent=140, threshold=2))

    arr = np.array(img, dtype=np.float32)

    # Compute luminance (proxy for elevation on topo maps)
    lum = 0.299 * arr[:, :, 0] + 0.587 * arr[:, :, 1] + 0.114 * arr[:, :, 2]
    lum_norm = lum / 255.0  # 0.0 (dark) → 1.0 (bright)

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

    # Handle the last bucket (lum_norm >= 1.0)
    mask = lum_norm >= ramp[-1][0]
    out[mask] = ramp[-1][1:]

    # Blend tint with original image
    blended = blend_alpha * out + (1.0 - blend_alpha) * arr
    blended = np.clip(blended, 0, 255).astype(np.uint8)

    result = Image.fromarray(blended, "RGB")

    # Polish enhancements
    if contrast_factor != 1.0:
        result = ImageEnhance.Contrast(result).enhance(contrast_factor)
    if saturation_factor != 1.0:
        result = ImageEnhance.Color(result).enhance(saturation_factor)

    return result
