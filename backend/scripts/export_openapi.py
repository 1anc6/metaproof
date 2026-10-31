"""Write the API's OpenAPI schema to backend/openapi.json, the contract the frontend's types are
generated from (cd frontend && npm run gen:api). CI fails when the committed file is stale.

    python scripts/export_openapi.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.main import app

OUT = Path(__file__).resolve().parent.parent / "openapi.json"

if __name__ == "__main__":
    OUT.write_bytes((json.dumps(app.openapi(), indent=2, ensure_ascii=False) + "\n").encode())
    print(f"wrote {OUT}")
