#!/usr/bin/env python3
"""
Walks your frontend and backend folders and writes every source file into
one big, clearly-labeled text file in ~/Downloads — easy to paste into a
chat or read top to bottom.

USAGE:
    python3 dump_code.py

Edit FRONTEND_DIR and BACKEND_DIR below to match your actual folder names.
"""

import os
from pathlib import Path
from datetime import datetime

# ---- EDIT THESE TO MATCH YOUR REPO LAYOUT ----
PROJECT_ROOT = Path.cwd()          # run this script from your project root
FRONTEND_DIR = PROJECT_ROOT / "frontend"
BACKEND_DIR = PROJECT_ROOT / "server"
# ------------------------------------------------

OUTPUT_PATH = Path.home() / "Downloads" / "tsadie_full_code_dump.txt"

# Folders to skip entirely
SKIP_DIRS = {
    "node_modules", ".git", "dist", "build", ".vite", ".next",
    "__pycache__", ".turbo", "coverage", ".vscode", ".idea", "instance",
}

# Only include files with these extensions (add more if needed)
INCLUDE_EXTENSIONS = {
    ".ts", ".tsx", ".js", ".jsx", ".json", ".css", ".html",
    ".py", ".md", ".env.example", ".sql",
}

# Files to skip even if the extension matches
SKIP_FILES = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml"}


def collect_files(root: Path):
    collected = []

    if not root.exists():
        return collected

    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = [d for d in dirnames if d not in SKIP_DIRS]

        for filename in filenames:
            if filename in SKIP_FILES:
                continue

            file_path = Path(dirpath) / filename

            if file_path.suffix in INCLUDE_EXTENSIONS:
                collected.append(file_path)

    return sorted(collected)


def write_section(out, title: str, root: Path, files: list[Path]):
    out.write("\n\n")
    out.write("#" * 80 + "\n")
    out.write(f"# {title.upper()}\n")
    out.write(f"# root: {root}\n")
    out.write(f"# files: {len(files)}\n")
    out.write("#" * 80 + "\n")

    if not files:
        out.write("\n(no files found — check the folder path at the top of this script)\n")
        return

    for file_path in files:
        rel_path = file_path.relative_to(root)
        out.write("\n\n" + "=" * 80 + "\n")
        out.write(f"FILE: {title}/{rel_path}\n")
        out.write("=" * 80 + "\n")

        try:
            content = file_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            out.write("[skipped: could not decode as text]\n")
            continue
        except Exception as error:
            out.write(f"[skipped: {error}]\n")
            continue

        out.write(content)

        if not content.endswith("\n"):
            out.write("\n")


def main():
    frontend_files = collect_files(FRONTEND_DIR)
    backend_files = collect_files(BACKEND_DIR)

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)

    with open(OUTPUT_PATH, "w", encoding="utf-8") as out:
        out.write(f"TSADIE FULL CODE DUMP\n")
        out.write(f"generated: {datetime.now().isoformat()}\n")
        out.write(f"frontend files: {len(frontend_files)}\n")
        out.write(f"backend files: {len(backend_files)}\n")

        write_section(out, "FRONTEND", FRONTEND_DIR, frontend_files)
        write_section(out, "BACKEND", BACKEND_DIR, backend_files)

    print(f"Done. Wrote {len(frontend_files) + len(backend_files)} files to:")
    print(OUTPUT_PATH)


if __name__ == "__main__":
    main()