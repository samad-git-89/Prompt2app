#!/usr/bin/env python3
"""Train the Phase 6 UI detector with the local YOLOv8 nano checkpoint."""

import argparse
import json
import os
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DATASET_ROOT = REPOSITORY_ROOT / "data" / "ui_dataset"
DATASET_PATH = DATASET_ROOT / "dataset.yaml"
WEIGHTS_PATH = REPOSITORY_ROOT / "training" / "weights" / "yolov8n.pt"
TRAINING_CONFIG = {
    "data": "data/ui_dataset/dataset.yaml",
    "epochs": 50,
    "imgsz": 640,
    "device": "cpu",
    "workers": 4,
    "project": "training/runs",
    "name": "prompt2app_vision_core",
}


def validate_dataset() -> None:
    """Fail with actionable errors when the dataset scaffold is missing."""
    if not DATASET_PATH.is_file():
        raise FileNotFoundError(
            f"Dataset configuration not found: {DATASET_PATH}. "
            "Run training/ingest_ui_data.py first."
        )
    for split in ("train", "val"):
        image_dir = DATASET_ROOT / "images" / split
        label_dir = DATASET_ROOT / "labels" / split
        if not image_dir.is_dir() or not label_dir.is_dir():
            raise FileNotFoundError(
                f"Dataset split directories are incomplete for {split}: "
                f"{image_dir} and {label_dir}"
            )


def train() -> None:
    """Load the repository's local baseline checkpoint and start training."""
    validate_dataset()
    if not WEIGHTS_PATH.is_file():
        raise FileNotFoundError(
            f"YOLOv8 nano checkpoint not found: {WEIGHTS_PATH}. "
            "Download the approved baseline into training/weights/yolov8n.pt first."
        )

    try:
        from ultralytics import YOLO
    except ImportError as error:
        raise RuntimeError(
            "ultralytics is required; install it with "
            "'python -m pip install -r training/requirements.txt'"
        ) from error

    model = YOLO(str(WEIGHTS_PATH))
    model.train(**TRAINING_CONFIG)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate the dataset scaffold and print training parameters without training",
    )
    args = parser.parse_args()
    os.chdir(REPOSITORY_ROOT)
    validate_dataset()

    if args.dry_run:
        print(json.dumps({
            "status": "dry-run",
            "weights": str(WEIGHTS_PATH),
            "weights_available": WEIGHTS_PATH.is_file(),
            "configuration": TRAINING_CONFIG,
        }, indent=2))
        return

    train()


if __name__ == "__main__":
    main()
