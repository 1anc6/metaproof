"""Upload the backend to the Hugging Face Space. Run by GitHub Actions on pushes to main.

Needs HF_TOKEN (a write token) in the environment. Run from the backend/ folder.
"""

import os
import sys
from pathlib import Path

from huggingface_hub import HfApi

SPACE_ID = os.environ.get("HF_SPACE_ID", "1anc6/metaproof")
BACKEND = Path(__file__).resolve().parent.parent

api = HfApi(token=os.environ["HF_TOKEN"])
commit = os.environ.get("GITHUB_SHA", "local")[:7]

api.upload_folder(
    repo_id=SPACE_ID,
    repo_type="space",
    folder_path=BACKEND,
    allow_patterns=["Dockerfile", "pyproject.toml", "alembic.ini", "app/**", "migrations/**"],
    ignore_patterns=["**/__pycache__/**", "**/*.pyc"],
    # Remove files that were deleted from the repo, but keep the Space's own README.
    delete_patterns=["app/**", "migrations/**"],
    commit_message=f"Deploy {commit} from GitHub",
)
api.upload_file(
    repo_id=SPACE_ID,
    repo_type="space",
    path_or_fileobj=BACKEND / "deploy" / "space-README.md",
    path_in_repo="README.md",
    commit_message=f"Update Space card ({commit})",
)
print(f"Deployed {commit} to https://huggingface.co/spaces/{SPACE_ID}", file=sys.stderr)
