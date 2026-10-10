#!/usr/bin/env python3
"""Download foundational YOLO weights from Hugging Face Hub."""

import argparse
import os
import shutil
import tempfile
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_REPO_ID = "Ultralytics/YOLOv8"
DEFAULT_FILENAME = "yolov8n.pt"


def download_weights(repo_id: str, filename: str, output_dir: Path, force: bool = False) -> Path:
    try:
        from huggingface_hub import hf_hub_download
    except ImportError as error:
        raise RuntimeError(
            "huggingface_hub is required; install it with "
            "'python -m pip install -r training/requirements.txt'"
        ) from error

    token = os.environ.get("HF_TOKEN")
    if not token:
        raise RuntimeError("HF_TOKEN must be set in the environment before downloading weights")
    if filename in {".", ".."} or Path(filename).name != filename or not filename:
        raise ValueError("filename must be a file name, not a path")

    destination = output_dir / filename
    if destination.exists() and not force:
        raise FileExistsError(f"{destination} already exists; pass --force to replace it")

    cached_file = hf_hub_download(
        repo_id=repo_id,
        filename=filename,
        token=token,
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=f".{filename}.", dir=output_dir)
    os.close(descriptor)
    temporary_file = Path(temporary_name)
    try:
        shutil.copyfile(cached_file, temporary_file)
        temporary_file.chmod(0o644)
        temporary_file.replace(destination)
    finally:
        temporary_file.unlink(missing_ok=True)

    return destination


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-id", default=DEFAULT_REPO_ID, help="Hugging Face model repository")
    parser.add_argument("--filename", default=DEFAULT_FILENAME, help="Weight file in the model repository")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=REPOSITORY_ROOT / "training" / "weights",
        help="Local destination directory (default: training/weights)",
    )
    parser.add_argument("--force", action="store_true", help="Replace an existing local weight file")
    args = parser.parse_args()

    destination = download_weights(args.repo_id, args.filename, args.output_dir, args.force)
    print(f"Downloaded {args.repo_id}/{args.filename} to {destination}")


if __name__ == "__main__":
    main()
