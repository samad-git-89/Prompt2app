#!/usr/bin/env python3
"""Train the UI component detector with the guarded baseline configuration."""

import argparse
import json
import os
from pathlib import Path

import yaml

if __package__:
    from . import dataset_pipeline
else:
    import dataset_pipeline


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
WEIGHTS_PATH = REPOSITORY_ROOT / "training" / "weights" / "yolov8n.pt"
DATASET_PATH = REPOSITORY_ROOT / "data" / "dataset.yaml"
TRAINING_CONFIG = {
    "epochs": 3,
    "imgsz": 640,
    "batch": 4,
    "device": "cpu",
    "project": "training/runs",
}


def check_readable_file(path: Path, description: str) -> None:
    if not path.is_file():
        raise FileNotFoundError(f"{description} does not exist: {path}")
    if not os.access(path, os.R_OK):
        raise PermissionError(f"{description} is not readable: {path}")


def class_names_from_config(names) -> list[str]:
    if isinstance(names, dict):
        try:
            return [names[index] for index in range(len(names))]
        except KeyError as error:
            raise ValueError("dataset class IDs must be contiguous from 0") from error
    if isinstance(names, list):
        return names
    raise ValueError("dataset.yaml must define class names as a list or indexed mapping")


def validate_configuration() -> tuple[dict, dict[str, int]]:
    check_readable_file(WEIGHTS_PATH, "YOLO weights")
    check_readable_file(DATASET_PATH, "dataset configuration")
    if not os.access(REPOSITORY_ROOT / "training", os.W_OK | os.X_OK):
        raise PermissionError(f"training directory is not writable: {REPOSITORY_ROOT / 'training'}")

    dataset = yaml.safe_load(DATASET_PATH.read_text(encoding="utf-8"))
    if not isinstance(dataset, dict):
        raise ValueError("dataset.yaml must contain a YAML mapping")
    names = class_names_from_config(dataset.get("names"))
    if names != list(dataset_pipeline.LOCKED_CLASSES):
        raise ValueError(
            "dataset.yaml classes must match locked order: "
            + ", ".join(dataset_pipeline.LOCKED_CLASSES)
        )

    split_counts = {}
    for split in ("train", "val"):
        split_value = dataset.get(split)
        if not isinstance(split_value, str) or not Path(split_value).is_absolute():
            raise ValueError(f"dataset.yaml {split!r} path must be absolute")
        image_dir = Path(split_value)
        if not image_dir.is_dir():
            raise NotADirectoryError(f"dataset {split} image directory does not exist: {image_dir}")
        if not os.access(image_dir, os.R_OK | os.X_OK):
            raise PermissionError(f"dataset {split} image directory is not readable: {image_dir}")

        labels_dir = image_dir.parent.parent / "labels"
        image_count = len(dataset_pipeline.image_files(image_dir))
        labeled_count = sum(
            (labels_dir / image.relative_to(image_dir).with_suffix(".txt")).is_file()
            for image in dataset_pipeline.image_files(image_dir)
        )
        split_counts[split] = {"images": image_count, "labeled_images": labeled_count}

    return dataset, split_counts


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate paths and classes, load weights, and print settings without training",
    )
    args = parser.parse_args()

    dataset, split_counts = validate_configuration()
    from ultralytics import YOLO

    model = YOLO(str(WEIGHTS_PATH))
    configuration = {
        "weights": str(WEIGHTS_PATH),
        "data": str(DATASET_PATH),
        **TRAINING_CONFIG,
    }
    if args.dry_run:
        print(json.dumps({
            "status": "dry-run",
            "configuration": configuration,
            "classes": class_names_from_config(dataset["names"]),
            "splits": split_counts,
            "weights_loaded": True,
        }, indent=2))
        return

    empty_splits = [
        split for split, counts in split_counts.items()
        if counts["labeled_images"] == 0
    ]
    if empty_splits:
        raise SystemExit(
            "Training requires labeled image/label pairs in both splits; "
            f"none found for: {', '.join(empty_splits)}. "
            "Run the data ingestion workflow first."
        )

    model.train(data=str(DATASET_PATH), **TRAINING_CONFIG)


if __name__ == "__main__":
    main()
