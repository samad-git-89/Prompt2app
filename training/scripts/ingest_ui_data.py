#!/usr/bin/env python3
"""Ingest local UI screenshots and YOLO labels into the synthetic dataset."""

import argparse
import math
import tempfile
from pathlib import Path

if __package__:
    from . import dataset_pipeline
else:
    import dataset_pipeline


def normalize_yolo_labels(label_text: str) -> str:
    """Validate YOLO detection rows and clamp box coordinates to [0, 1]."""
    normalized_rows = []
    for line_number, line in enumerate(label_text.splitlines(), start=1):
        fields = line.split()
        if not fields:
            continue
        if len(fields) != 5:
            raise ValueError(
                f"line {line_number}: expected class x_center y_center width height"
            )
        try:
            class_id = int(fields[0])
        except ValueError as error:
            raise ValueError(
                f"line {line_number}: class id must be a non-negative integer"
            ) from error
        if class_id < 0:
            raise ValueError(
                f"line {line_number}: class id must be a non-negative integer"
            )

        try:
            coordinates = [float(value) for value in fields[1:]]
        except ValueError as error:
            raise ValueError(
                f"line {line_number}: bounding-box coordinates must be numbers"
            ) from error
        if not all(math.isfinite(value) for value in coordinates):
            raise ValueError(
                f"line {line_number}: bounding-box coordinates must be finite"
            )
        if coordinates[2] <= 0 or coordinates[3] <= 0:
            raise ValueError(
                f"line {line_number}: bounding-box width and height must be greater than 0"
            )

        clamped = [min(1.0, max(0.0, value)) for value in coordinates]
        normalized_rows.append(
            f"{class_id} " + " ".join(f"{value:.8g}" for value in clamped)
        )

    return "\n".join(normalized_rows) + ("\n" if normalized_rows else "")


def ingest_ui_data(source: Path, labels: Path, data_root: Path) -> int:
    """Route local image/label pairs through the shared dataset pipeline."""
    if not source.is_dir():
        raise NotADirectoryError(f"image source directory does not exist: {source}")
    if not labels.is_dir():
        raise NotADirectoryError(f"label source directory does not exist: {labels}")

    images = dataset_pipeline.image_files(source)
    if not images:
        raise ValueError(f"no supported images found in {source}")

    with tempfile.TemporaryDirectory(prefix="ui-labels-") as temporary_directory:
        normalized_labels = Path(temporary_directory)
        for image in images:
            relative_label = image.relative_to(source).with_suffix(".txt")
            source_label = labels / relative_label
            if not source_label.is_file():
                raise FileNotFoundError(f"missing YOLO label for {image}: {source_label}")
            normalized_text = normalize_yolo_labels(
                source_label.read_text(encoding="utf-8")
            )
            staged_label = normalized_labels / relative_label
            staged_label.parent.mkdir(parents=True, exist_ok=True)
            staged_label.write_text(normalized_text, encoding="utf-8")

        count = dataset_pipeline.route_images(
            source,
            category="synthetic",
            labels_source=normalized_labels,
            data_root=data_root,
        )

    synthetic_root = data_root / "synthetic"
    for image in images:
        relative = image.relative_to(source)
        (synthetic_root / "images" / relative).chmod(0o644)
        (synthetic_root / "labels" / relative.with_suffix(".txt")).chmod(0o644)

    dataset_pipeline.write_with_permissions(
        data_root / "dataset.yaml",
        dataset_pipeline.dataset_yaml(data_root),
    )
    return count


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True, help="Directory containing UI images")
    parser.add_argument("--labels", type=Path, required=True, help="Directory of matching YOLO .txt labels")
    parser.add_argument(
        "--data-root",
        type=Path,
        default=dataset_pipeline.DATA_ROOT,
        help="Dataset root (default: repository data/)",
    )
    args = parser.parse_args()

    count = ingest_ui_data(args.source, args.labels, args.data_root)
    print(f"Ingested {count} UI image(s) into {args.data_root / 'synthetic'}")
    print(f"Updated dataset map at {(args.data_root / 'dataset.yaml').resolve()}")


if __name__ == "__main__":
    main()
