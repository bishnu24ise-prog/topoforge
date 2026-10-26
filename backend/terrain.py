"""
Terrain processing - GeoTIFF extraction and heightmap generation
"""

import io
import base64
import numpy as np
from PIL import Image, ImageFilter
from pathlib import Path

# Try rasterio, fall back gracefully
try:
    import rasterio
    from rasterio.warp import transform_bounds
    HAS_RASTERIO = True
except ImportError:
    HAS_RASTERIO = False
    print("Warning: rasterio not installed. GeoTIFF georeferencing disabled.")


def extract_geotiff_data(file_path: str) -> dict:
    """
    Extract bounds and texture from a GeoTIFF file.
    
    Returns:
        {
            "bounds": {"north": ..., "south": ..., "east": ..., "west": ...},
            "texture_b64": "...",  # Base64 JPEG
            "width": ...,
            "height": ...,
        }
    """
    file_path = Path(file_path)
    
    if not HAS_RASTERIO:
        raise RuntimeError("rasterio required for GeoTIFF processing")
    
    with rasterio.open(file_path) as src:
        # Extract bounds in WGS84 (lat/lon)
        wgs84_bounds = transform_bounds(src.crs, 'EPSG:4326', *src.bounds)
        bounds = {
            "west": wgs84_bounds[0],
            "south": wgs84_bounds[1],
            "east": wgs84_bounds[2],
            "north": wgs84_bounds[3]
        }
        
        # Read image data
        data = src.read()  # Shape: (bands, height, width)
        
        # Convert to RGB
        if data.shape[0] >= 3:
            rgb = np.stack([data[0], data[1], data[2]], axis=-1)
        else:
            rgb = np.stack([data[0], data[0], data[0]], axis=-1)
        
        # Create PIL image
        img = Image.fromarray(rgb.astype(np.uint8))
        original_width, original_height = img.size
        
        # Resize for web (max 2048 on longest side)
        max_dim = 2048
        if img.width > max_dim or img.height > max_dim:
            ratio = min(max_dim / img.width, max_dim / img.height)
            new_size = (int(img.width * ratio), int(img.height * ratio))
            img = img.resize(new_size, Image.LANCZOS)
        
        # Encode as base64 JPEG
        buffer = io.BytesIO()
        img.save(buffer, 'JPEG', quality=85)
        buffer.seek(0)
        texture_b64 = base64.b64encode(buffer.read()).decode('utf-8')
        
        return {
            "bounds": bounds,
            "texture_b64": texture_b64,
            "width": img.width,
            "height": img.height,
            "original_width": original_width,
            "original_height": original_height,
        }


def extract_from_image(file_path: str) -> dict:
    """
    Extract texture from a regular image (no georeferencing).
    Bounds must be provided separately.
    
    Returns:
        {
            "texture_b64": "...",
            "width": ...,
            "height": ...,
        }
    """
    img = Image.open(file_path)
    
    # Convert to RGB if necessary
    if img.mode != 'RGB':
        img = img.convert('RGB')
    
    original_width, original_height = img.size
    
    # Resize for web
    max_dim = 2048
    if img.width > max_dim or img.height > max_dim:
        ratio = min(max_dim / img.width, max_dim / img.height)
        new_size = (int(img.width * ratio), int(img.height * ratio))
        img = img.resize(new_size, Image.LANCZOS)
    
    # Encode as base64 JPEG
    buffer = io.BytesIO()
    img.save(buffer, 'JPEG', quality=85)
    buffer.seek(0)
    texture_b64 = base64.b64encode(buffer.read()).decode('utf-8')
    
    return {
        "texture_b64": texture_b64,
        "width": img.width,
        "height": img.height,
        "original_width": original_width,
        "original_height": original_height,
    }


def process_heightmap(file_path: str, target_size: int = 512) -> str:
    """
    Process a heightmap image (e.g., from Gemini) for use in Three.js.
    Returns base64 PNG.
    """
    img = Image.open(file_path).convert('L')  # Grayscale
    
    # Apply slight blur to smooth
    img = img.filter(ImageFilter.GaussianBlur(radius=1))
    
    # Make square (required for displacement mapping)
    w, h = img.size
    max_dim = max(w, h)
    square = Image.new('L', (max_dim, max_dim), 0)
    offset = ((max_dim - w) // 2, (max_dim - h) // 2)
    square.paste(img, offset)
    
    # Resize to target
    final = square.resize((target_size, target_size), Image.LANCZOS)
    
    # Encode as base64 PNG
    buffer = io.BytesIO()
    final.save(buffer, 'PNG')
    buffer.seek(0)
    
    return base64.b64encode(buffer.read()).decode('utf-8')
