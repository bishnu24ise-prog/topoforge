#!/usr/bin/env python3
"""TopoForge — Entry point"""

import uvicorn

if __name__ == "__main__":
    print("\n🌍 TopoForge")
    print("=" * 40)
    print("Open http://localhost:8000")
    print("=" * 40 + "\n")

    uvicorn.run(
        "backend.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )
