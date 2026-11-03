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


def train(configuration: dict | None = None, export_onnx: bool = False) -> None:
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
    selected_config = {**TRAINING_CONFIG, **(configuration or {})}
    model.train(**selected_config)
    if export_onnx:
        training_dir = Path(model.trainer.save_dir)
        best_checkpoint = training_dir / "weights" / "best.pt"
        if not best_checkpoint.is_file():
            raise FileNotFoundError(
                f"training completed without the best checkpoint: {best_checkpoint}"
            )
        trained_model = YOLO(str(best_checkpoint))
        trained_model.export(
            format="onnx",
            imgsz=selected_config["imgsz"],
        )
        onnx_path = best_checkpoint.with_suffix(".onnx")
        if not onnx_path.is_file():
            raise FileNotFoundError(f"ONNX export was not created: {onnx_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate the dataset scaffold and print training parameters without training",
    )
    parser.add_argument("--epochs", type=int, default=50, help="Training epochs (default: 50)")
    parser.add_argument("--imgsz", type=int, default=640, help="Training image size (default: 640)")
    parser.add_argument("--batch", type=int, default=16, help="Training batch size (default: 16)")
    parser.add_argument("--device", default="cpu", help='Training device (default: "cpu")')
    cache_group = parser.add_mutually_exclusive_group()
    cache_group.add_argument(
        "--cache", action="store_true", help="Enable Ultralytics dataset caching"
    )
    cache_group.add_argument(
        "--cache-ram", action="store_true", help='Cache the dataset in RAM ("ram")'
    )
    parser.add_argument(
        "--export-onnx",
        action="store_true",
        help="Export the trained best.pt checkpoint to best.onnx",
    )
    args = parser.parse_args()
    if args.epochs < 1 or args.imgsz < 1 or args.batch < 1:
        parser.error("--epochs, --imgsz, and --batch must be positive integers")
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

    training_overrides = {
        "epochs": args.epochs,
        "imgsz": args.imgsz,
        "batch": args.batch,
        "device": args.device,
        "cache": "ram" if args.cache_ram else args.cache,
    }
    train(training_overrides, export_onnx=args.export_onnx)


if __name__ == "__main__":
    main()
