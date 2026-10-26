#!/usr/bin/env python3
"""
TopoForge — AI 3D Terrain Explorer
Full-stack development runner
"""

import uvicorn

if __name__ == "__main__":
    print("\n" + "=" * 50)
    print("🌍 TopoForge — AI 3D Terrain Explorer (v2.1)")
    print("🎙️ Wispr Flow & Gemini Live Voice Agents Active")
    print("🚀 Local Server: http://localhost:8000")
    print("=" * 50 + "\n")

    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
