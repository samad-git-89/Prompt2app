#!/usr/bin/env python3
"""Generate assisted YOLO labels for images without a matching label file."""

import argparse
import json
import logging
import math
from pathlib import Path

if __package__:
    from . import dataset_pipeline
else:
    import dataset_pipeline


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_IMAGE_DIR = REPOSITORY_ROOT / "data" / "synthetic" / "images"
DEFAULT_WEIGHTS = REPOSITORY_ROOT / "training" / "weights" / "yolov8n.pt"
COMPONENT_IDS = {
    "button": 0,
    "input": 1,
    "header": 2,
    "text-block": 3,
    "image-container": 4,
}
DEFAULT_CLASS_MAP = {
    "button": "button",
    "remote": "button",
    "mouse": "button",
    "input": "input",
    "keyboard": "input",
    "header": "header",
    "text": "text-block",
    "text-block": "text-block",
    "text_block": "text-block",
    "book": "text-block",
    "newspaper": "text-block",
    "image": "image-container",
    "image-container": "image-container",
    "image_container": "image-container",
    "tv": "image-container",
    "laptop": "image-container",
    "cell phone": "image-container",
}


def normalized_class_name(name: str) -> str:
    return name.strip().lower().replace("_", " ")


def load_class_map(path: Path | None) -> dict[str, int]:
    """Load optional source-name aliases, retaining only the five locked targets."""
    aliases = {
        normalized_class_name(source): COMPONENT_IDS[target]
        for source, target in DEFAULT_CLASS_MAP.items()
    }
    if path is None:
        return aliases

    custom_map = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(custom_map, dict):
        raise ValueError("class map must be a JSON object of source names to target names")
    for source, target in custom_map.items():
        if not isinstance(source, str) or not source.strip():
            raise ValueError("class map source names must be non-empty strings")
        if target not in COMPONENT_IDS:
            raise ValueError(
                f"class map target for {source!r} must be one of: "
                f"{', '.join(COMPONENT_IDS)}"
            )
        aliases[normalized_class_name(source)] = COMPONENT_IDS[target]
    return aliases


def yolo_rows(result, model_names: dict[int, str], class_map: dict[str, int]) -> tuple[list[str], int]:
    """Convert mapped Ultralytics boxes to normalized YOLO rows."""
    boxes = result.boxes
    if boxes is None:
        return [], 0

    rows = []
    ignored = 0
    for class_value, coordinates in zip(boxes.cls.tolist(), boxes.xywhn.tolist()):
        class_name = normalized_class_name(model_names[int(class_value)])
        target_id = class_map.get(class_name)
        if target_id is None:
            ignored += 1
            continue

        values = [float(value) for value in coordinates]
        if len(values) != 4 or not all(math.isfinite(value) for value in values):
            ignored += 1
            continue
        x_center, y_center, width, height = values
        if width <= 0 or height <= 0:
            ignored += 1
            continue
        values = [min(1.0, max(0.0, value)) for value in values]
        rows.append(f"{target_id} " + " ".join(f"{value:.8g}" for value in values))
    return rows, ignored


def auto_label_images(
    image_dir: Path,
    weights: Path,
    confidence: float = 0.25,
    class_map_path: Path | None = None,
    dry_run: bool = False,
) -> int:
    """Infer labels for images missing a sibling YOLO text file."""
    if not image_dir.is_dir():
        raise NotADirectoryError(f"image directory does not exist: {image_dir}")
    if not weights.is_file():
        raise FileNotFoundError(f"YOLO weights file does not exist: {weights}")
    if not 0 <= confidence <= 1:
        raise ValueError("confidence must be between 0 and 1")

    candidates = [
        image for image in dataset_pipeline.image_files(image_dir)
        if not image.with_suffix(".txt").is_file()
    ]
    if not candidates:
        logging.info("No unlabeled images found in %s", image_dir)
        return 0

    try:
        from ultralytics import YOLO
    except ImportError as error:
        raise RuntimeError(
            "ultralytics is required; install it with "
            "'python -m pip install -r training/requirements.txt'"
        ) from error

    model = YOLO(str(weights))
    class_map = load_class_map(class_map_path)
    processed = 0
    for image in candidates:
        predictions = model.predict(source=str(image), conf=confidence, verbose=False)
        rows, ignored = yolo_rows(predictions[0], model.names, class_map)
        if not dry_run:
            label_path = image.with_suffix(".txt")
            label_path.write_text("\n".join(rows) + ("\n" if rows else ""), encoding="utf-8")
            label_path.chmod(0o644)
        action = "Would write" if dry_run else "Wrote"
        logging.info(
            "%s %s: %d mapped prediction(s), %d unmapped prediction(s)",
            action,
            image,
            len(rows),
            ignored,
        )
        processed += 1
    return processed


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image-dir", type=Path, default=DEFAULT_IMAGE_DIR)
    parser.add_argument("--weights", type=Path, default=DEFAULT_WEIGHTS)
    parser.add_argument("--confidence", type=float, default=0.25)
    parser.add_argument(
        "--class-map",
        type=Path,
        help="Optional JSON object mapping model class names to locked component names",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run inference and log mapped detections without writing label files",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")

    count = auto_label_images(
        args.image_dir,
        args.weights,
        confidence=args.confidence,
        class_map_path=args.class_map,
        dry_run=args.dry_run,
    )
    logging.info("Processed %d unlabeled image(s)", count)


if __name__ == "__main__":
    main()
