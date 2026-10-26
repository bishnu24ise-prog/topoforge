"""
Wispr Flow API Client & Voice Command Intent Parser for TopoForge
Integrates Wispr Flow speech-to-text API for high-speed voice command detection.
"""

import os
import re
import io
import json
import logging
import urllib.request
import urllib.error
from typing import Dict, Any, Optional

logger = logging.getLogger("topoforge.wispr")

WISPR_FLOW_API_KEY = os.getenv("WISPR_FLOW_API_KEY")
WISPR_API_ENDPOINT = os.getenv("WISPR_FLOW_ENDPOINT", "https://api.wisprflow.ai/v1/transcribe")


def is_wispr_configured() -> bool:
    """Check if Wispr Flow API key is configured."""
    return bool(os.getenv("WISPR_FLOW_API_KEY"))


def transcribe_audio_bytes(audio_bytes: bytes, content_type: str = "audio/webm") -> Dict[str, Any]:
    """
    Send audio bytes to Wispr Flow API for high-accuracy speech-to-text.
    Falls back gracefully if key is not configured or request fails.
    """
    api_key = os.getenv("WISPR_FLOW_API_KEY")
    if not api_key:
        return {
            "success": False,
            "error": "WISPR_FLOW_API_KEY not configured. Set your key in .env",
            "text": ""
        }

    boundary = "----WebKitFormBoundaryTopoForgeWisprFlow"
    body = bytearray()
    
    # Add audio file field
    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(b'Content-Disposition: form-data; name="file"; filename="command.webm"\r\n')
    body.extend(f"Content-Type: {content_type}\r\n\r\n".encode("utf-8"))
    body.extend(audio_bytes)
    body.extend(b"\r\n")
    
    # Add language parameter
    body.extend(f"--{boundary}\r\n".encode("utf-8"))
    body.extend(b'Content-Disposition: form-data; name="language"\r\n\r\n')
    body.extend(b"en\r\n")
    
    body.extend(f"--{boundary}--\r\n".encode("utf-8"))

    req = urllib.request.Request(
        WISPR_API_ENDPOINT,
        data=bytes(body),
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "User-Agent": "TopoForge-VoiceAgent/1.0"
        },
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            result = json.loads(response.read().decode("utf-8"))
            transcript = result.get("text", "") or result.get("transcript", "")
            return {
                "success": True,
                "text": transcript.strip(),
                "raw": result
            }
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        logger.warning(f"Wispr Flow API HTTP {e.code}: {err_msg}")
        return {
            "success": False,
            "error": f"Wispr Flow API error ({e.code})",
            "text": ""
        }
    except Exception as e:
        logger.error(f"Wispr Flow transcription error: {str(e)}")
        return {
            "success": False,
            "error": str(e),
            "text": ""
        }


def parse_voice_command(text: str) -> Dict[str, Any]:
    """
    Parses spoken voice command text into structured TopoForge actions.
    Supports flight navigation, visual styles, elevation, lighting, and map tools.
    """
    t = text.lower().strip()
    # Normalize punctuation and extra spaces
    t = re.sub(r"[^\w\s]", "", t)

    # 1. Flight Controls
    if re.search(r"\b(fly|flight|plane|take off|start flying)\b", t):
        if re.search(r"\b(stop|exit|quit|cancel|orbit)\b", t):
            return {
                "category": "flight",
                "action": "stop_flight",
                "feedback": "Switched back to Orbit Camera mode"
            }
        return {
            "category": "flight",
            "action": "start_flight",
            "feedback": "Engaging flight mode! Use WASD to steer"
        }

    if re.search(r"\b(orbit|rotate|spin|revolve)\b", t):
        if re.search(r"\b(stop|pause|freeze)\b", t):
            return {
                "category": "flight",
                "action": "stop_orbit_rotation",
                "feedback": "Stopped terrain auto-rotation"
            }
        return {
            "category": "flight",
            "action": "orbit_mode",
            "feedback": "Orbit camera active"
        }

    if re.search(r"\b(faster|speed up|accelerate|boost|more speed)\b", t):
        return {
            "category": "flight",
            "action": "speed_up",
            "feedback": "Accelerating flight speed"
        }

    if re.search(r"\b(slower|slow down|decelerate|brake)\b", t):
        return {
            "category": "flight",
            "action": "slow_down",
            "feedback": "Easing flight speed"
        }

    if re.search(r"\b(climb|ascend|fly higher|up|increase altitude)\b", t):
        return {
            "category": "flight",
            "action": "ascend",
            "feedback": "Ascending to higher altitude"
        }

    if re.search(r"\b(dive|descend|fly lower|down|decrease altitude)\b", t):
        return {
            "category": "flight",
            "action": "descend",
            "feedback": "Descending closer to terrain"
        }

    # 2. Visual Texture Styles
    if re.search(r"\b(cyberpunk|neon|synthwave|sci-fi)\b", t):
        return {
            "category": "style",
            "action": "set_style",
            "style": "cyberpunk",
            "feedback": "Applying Cyberpunk Neon preset"
        }

    if re.search(r"\b(vintage|parchment|historical|antique)\b", t):
        return {
            "category": "style",
            "action": "set_style",
            "style": "vintage",
            "feedback": "Applying Vintage Parchment preset"
        }

    if re.search(r"\b(hypsometric|atlas|topographic|relief)\b", t):
        return {
            "category": "style",
            "action": "set_style",
            "style": "hypsometric",
            "feedback": "Applying Hypsometric Atlas preset"
        }

    if re.search(r"\b(emerald|forest|greenery|lush|nature)\b", t):
        return {
            "category": "style",
            "action": "set_style",
            "style": "emerald",
            "feedback": "Applying Emerald Forest preset"
        }

    if re.search(r"\b(volcanic|volcano|lava|magma|wasteland)\b", t):
        return {
            "category": "style",
            "action": "set_style",
            "style": "volcanic",
            "feedback": "Applying Volcanic Wasteland preset"
        }

    if re.search(r"\b(realistic|stylish|clean|default style)\b", t):
        return {
            "category": "style",
            "action": "set_style",
            "style": "realistic",
            "feedback": "Applying Realistic Stylish preset"
        }

    if re.search(r"\b(reset style|original color|natural texture|clean map)\b", t):
        return {
            "category": "style",
            "action": "reset_style",
            "feedback": "Reset texture to original satellite imagery"
        }

    if re.search(r"\b(hybrid|roads|labels|street)\b", t):
        return {
            "category": "style",
            "action": "set_map_type",
            "map_type": "hybrid",
            "feedback": "Toggled Hybrid mode with road overlays"
        }

    if re.search(r"\b(pure satellite|only satellite|hide roads)\b", t):
        return {
            "category": "style",
            "action": "set_map_type",
            "map_type": "satellite",
            "feedback": "Toggled Pure Satellite imagery"
        }

    # 3. Elevation Scale & Exaggeration
    if re.search(r"\b(increase elevation|taller peaks|more relief|higher mountains)\b", t):
        return {
            "category": "elevation",
            "action": "adjust_elevation",
            "delta": 5,
            "feedback": "Increasing elevation vertical scale"
        }

    if re.search(r"\b(decrease elevation|flatter|lower peaks|less relief)\b", t):
        return {
            "category": "elevation",
            "action": "adjust_elevation",
            "delta": -5,
            "feedback": "Decreasing elevation vertical scale"
        }

    # 4. Lighting & Sun Position
    if re.search(r"\b(sunset|golden hour|dusk|evening)\b", t):
        return {
            "category": "lighting",
            "action": "set_lighting",
            "azimuth": 270,
            "elevation": 18,
            "feedback": "Setting lighting to Sunset golden hour"
        }

    if re.search(r"\b(sunrise|dawn|morning)\b", t):
        return {
            "category": "lighting",
            "action": "set_lighting",
            "azimuth": 90,
            "elevation": 22,
            "feedback": "Setting lighting to Sunrise"
        }

    if re.search(r"\b(noon|midday|bright sun|zenith)\b", t):
        return {
            "category": "lighting",
            "action": "set_lighting",
            "azimuth": 180,
            "elevation": 75,
            "feedback": "Setting lighting to High Noon"
        }

    if re.search(r"\b(reset lighting|default sun|normal light)\b", t):
        return {
            "category": "lighting",
            "action": "reset_lighting",
            "feedback": "Reset sun position and lighting"
        }

    # 5. Tour & World Map
    if re.search(r"\b(tour|guide|voice chat|tell me about|what is this)\b", t):
        if re.search(r"\b(stop|mute|quiet|silence)\b", t):
            return {
                "category": "tour",
                "action": "stop_tour",
                "feedback": "Stopping tour guide voice chat"
            }
        return {
            "category": "tour",
            "action": "start_tour",
            "feedback": "Starting real-time AI Tour Guide"
        }

    if re.search(r"\b(pick location|world map|choose area|open map)\b", t):
        return {
            "category": "map",
            "action": "open_map_picker",
            "feedback": "Opening World Map picker"
        }

    # Default fallback
    return {
        "category": "unknown",
        "action": "none",
        "raw_text": text,
        "feedback": f"Recognized: '{text}'. Try 'fly plane', 'cyberpunk', or 'sunset'."
    }
