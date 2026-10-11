#!/usr/bin/env python3
"""Run UI-component detection over an image directory and export a JSON profile."""

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
DEFAULT_WEIGHTS = REPOSITORY_ROOT / "training" / "runs" / "train" / "weights" / "best.pt"
DEFAULT_OUTPUT = REPOSITORY_ROOT / "data" / "eval" / "inference_results.json"
LOCKED_CLASSES = dataset_pipeline.LOCKED_CLASSES


def validate_model_classes(names: object) -> None:
    """Ensure checkpoint class IDs use the locked dataset order."""
    if isinstance(names, dict):
        ordered_names = []
        for class_id in range(len(names)):
            name = names.get(class_id, names.get(str(class_id)))
            if not isinstance(name, str):
                raise ValueError("checkpoint class names must use contiguous IDs from 0")
            ordered_names.append(name)
    elif isinstance(names, list):
        ordered_names = names
    else:
        raise ValueError("checkpoint class names must be an indexed mapping or list")

    if tuple(ordered_names) != LOCKED_CLASSES:
        raise ValueError(
            "checkpoint class order must match locked classes: "
            f"{', '.join(LOCKED_CLASSES)}; found: {', '.join(map(str, ordered_names))}"
        )


def load_model(weights: Path):
    """Load the custom Ultralytics checkpoint after validating its path."""
    if not weights.is_file():
        raise FileNotFoundError(f"YOLO checkpoint does not exist: {weights}")

    try:
        from ultralytics import YOLO
    except ImportError as error:
        raise RuntimeError(
            "ultralytics is required; install it with "
            "'python -m pip install -r training/requirements.txt'"
        ) from error

    model = YOLO(str(weights))
    validate_model_classes(model.names)
    return model


def extract_detections(result) -> list[dict]:
    """Convert one Ultralytics result into locked classes and pixel xyxy boxes."""
    if result.boxes is None:
        return []

    boxes = result.boxes
    detections = []
    for class_value, confidence, coordinates in zip(
        boxes.cls.tolist(),
        boxes.conf.tolist(),
        boxes.xyxy.tolist(),
    ):
        class_id = int(class_value)
        if class_id not in range(len(LOCKED_CLASSES)):
            raise ValueError(f"checkpoint returned unknown class ID: {class_id}")

        box = [float(value) for value in coordinates]
        confidence = float(confidence)
        if (
            len(box) != 4
            or not all(math.isfinite(value) for value in box)
            or not math.isfinite(confidence)
        ):
            raise ValueError("model returned non-finite confidence or bounding-box coordinates")

        detections.append({
            "class_id": class_id,
            "class_name": LOCKED_CLASSES[class_id],
            "confidence": confidence,
            "bounding_box": {
                "x1": box[0],
                "y1": box[1],
                "x2": box[2],
                "y2": box[3],
                "format": "xyxy",
                "units": "pixels",
            },
        })
    return detections


def evaluate_and_infer(
    image_dir: Path,
    weights: Path = DEFAULT_WEIGHTS,
    output: Path = DEFAULT_OUTPUT,
    confidence: float = 0.25,
    dry_run: bool = False,
) -> dict:
    """Infer every supported image and optionally write its structured profile."""
    if not image_dir.is_dir():
        raise NotADirectoryError(f"input image directory does not exist: {image_dir}")
    if not 0 <= confidence <= 1:
        raise ValueError("confidence must be between 0 and 1")

    images = dataset_pipeline.image_files(image_dir)
    if not images:
        raise ValueError(f"no supported images found in {image_dir}")

    model = load_model(weights)
    profiles = []
    detection_count = 0
    for image in images:
        results = model.predict(source=str(image), conf=confidence, verbose=False)
        if len(results) != 1:
            raise RuntimeError(f"expected one inference result for {image}, got {len(results)}")
        result = results[0]
        detections = extract_detections(result)
        detection_count += len(detections)
        height, width = result.orig_shape
        profiles.append({
            "image": image.relative_to(image_dir).as_posix(),
            "width": int(width),
            "height": int(height),
            "detections": detections,
        })
        logging.info("Processed %s: %d detection(s)", image, len(detections))

    profile = {
        "checkpoint": str(weights.resolve()),
        "confidence_threshold": confidence,
        "classes": [
            {"class_id": class_id, "class_name": class_name}
            for class_id, class_name in enumerate(LOCKED_CLASSES)
        ],
        "bounding_box_format": "xyxy_pixels",
        "images": profiles,
    }
    if dry_run:
        logging.info(
            "Dry run complete: %d image(s), %d detection(s); no profile written",
            len(profiles),
            detection_count,
        )
    else:
        dataset_pipeline.write_with_permissions(
            output,
            json.dumps(profile, indent=2) + "\n",
        )
        logging.info(
            "Wrote %s (%d image(s), %d detection(s), mode 644)",
            output,
            len(profiles),
            detection_count,
        )
    return profile


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--image-dir",
        type=Path,
        required=True,
        help="Directory of raw images to process (searched recursively)",
    )
    parser.add_argument("--weights", type=Path, default=DEFAULT_WEIGHTS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--confidence", type=float, default=0.25)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Load the checkpoint and run inference without writing the JSON profile",
    )
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
    evaluate_and_infer(
        args.image_dir,
        weights=args.weights,
        output=args.output,
        confidence=args.confidence,
        dry_run=args.dry_run,
    )


if __name__ == "__main__":
    main()
