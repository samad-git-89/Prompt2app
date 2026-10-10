#!/usr/bin/env python3
"""Scan, validate, and route YOLO images and labels into project data tiers."""

import argparse
import json
import math
import shutil
from pathlib import Path


DATA_ROOT = Path(__file__).resolve().parents[2] / "data"
IMAGE_EXTENSIONS = {".bmp", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"}
CATEGORIES = ("gold", "synthetic")


def validate_yolo_labels(label_text: str) -> list[str]:
    """Return errors for malformed YOLO detection label rows."""
    errors = []
    for line_number, line in enumerate(label_text.splitlines(), start=1):
        fields = line.split()
        if not fields:
            continue
        if len(fields) != 5:
            errors.append(f"line {line_number}: expected class x_center y_center width height")
            continue
        try:
            class_id = int(fields[0])
        except ValueError:
            errors.append(f"line {line_number}: class id must be a non-negative integer")
            continue
        if class_id < 0:
            errors.append(f"line {line_number}: class id must be a non-negative integer")
            continue

        try:
            coordinates = [float(value) for value in fields[1:]]
        except ValueError:
            errors.append(f"line {line_number}: bounding-box coordinates must be numbers")
            continue
        if not all(math.isfinite(value) and 0 <= value <= 1 for value in coordinates):
            errors.append(f"line {line_number}: coordinates must be finite normalized values from 0 to 1")
            continue
        if coordinates[2] == 0 or coordinates[3] == 0:
            errors.append(f"line {line_number}: bounding-box width and height must be greater than 0")
    return errors


def image_files(root: Path) -> list[Path]:
    return sorted(
        path for path in root.rglob("*")
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )


def write_with_permissions(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(0o644)


def write_log(log_file: Path, message: str) -> None:
    log_file.parent.mkdir(parents=True, exist_ok=True)
    with log_file.open("a", encoding="utf-8") as stream:
        stream.write(message.rstrip() + "\n")
    log_file.chmod(0o644)


def scan_data(data_root: Path) -> dict:
    result = {"images": 0, "labeled": 0, "missing_labels": 0, "invalid_labels": []}
    for category in CATEGORIES:
        images_root = data_root / category / "images"
        labels_root = data_root / category / "labels"
        if not images_root.exists():
            continue
        for image in image_files(images_root):
            result["images"] += 1
            label = labels_root / image.relative_to(images_root).with_suffix(".txt")
            if not label.is_file():
                result["missing_labels"] += 1
                continue
            result["labeled"] += 1
            errors = validate_yolo_labels(label.read_text(encoding="utf-8"))
            result["invalid_labels"].extend(
                {"file": str(label), "error": error} for error in errors
            )
    return result


def route_images(source: Path, category: str, labels_source: Path | None, data_root: Path) -> int:
    if category not in CATEGORIES:
        raise ValueError(f"category must be one of: {', '.join(CATEGORIES)}")
    if not source.is_dir():
        raise NotADirectoryError(f"image source directory does not exist: {source}")
    images = image_files(source)
    if not images:
        raise ValueError(f"no supported images found in {source}")

    destination_root = data_root / category
    planned = []
    planned_destinations = set()
    for image in images:
        relative = image.relative_to(source)
        destination_image = destination_root / "images" / relative
        if destination_image.exists() or destination_image in planned_destinations:
            raise FileExistsError(f"refusing to overwrite existing image: {destination_image}")
        planned_destinations.add(destination_image)

        source_label = None
        destination_label = None
        if labels_source is not None:
            source_label = labels_source / relative.with_suffix(".txt")
            if not source_label.is_file():
                raise FileNotFoundError(f"missing YOLO label for {image}: {source_label}")
            errors = validate_yolo_labels(source_label.read_text(encoding="utf-8"))
            if errors:
                details = "; ".join(errors)
                raise ValueError(f"invalid YOLO labels in {source_label}: {details}")
            destination_label = destination_root / "labels" / relative.with_suffix(".txt")
            if destination_label.exists() or destination_label in planned_destinations:
                raise FileExistsError(f"refusing to overwrite existing label: {destination_label}")
            planned_destinations.add(destination_label)
        planned.append((image, destination_image, source_label, destination_label))

    for image, destination_image, source_label, destination_label in planned:
        destination_image.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(image, destination_image)
        if source_label is not None and destination_label is not None:
            destination_label.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source_label, destination_label)
    return len(planned)


def dataset_yaml(data_root: Path) -> str:
    data_root = data_root.resolve()
    return (
        f"path: {json.dumps(str(data_root))}\n"
        f"train: {json.dumps(str(data_root / 'synthetic' / 'images'))}\n"
        f"val: {json.dumps(str(data_root / 'gold' / 'images'))}\n"
        "names: [replace-with-class-name]\n"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    scan_parser = subparsers.add_parser("scan", help="Scan gold/synthetic images and validate available labels")
    scan_parser.add_argument("--data-root", type=Path, default=DATA_ROOT)
    scan_parser.add_argument("--report", type=Path, help="Optional JSON report path")
    scan_parser.add_argument("--log-file", type=Path, default=DATA_ROOT / "dataset-pipeline.log")

    route_parser = subparsers.add_parser("route", help="Copy images and optional YOLO labels into a data tier")
    route_parser.add_argument("--source", type=Path, required=True, help="Directory containing images")
    route_parser.add_argument("--labels", type=Path, help="Directory of matching YOLO .txt label files")
    route_parser.add_argument("--category", choices=CATEGORIES, required=True)
    route_parser.add_argument("--data-root", type=Path, default=DATA_ROOT)
    route_parser.add_argument("--log-file", type=Path, default=DATA_ROOT / "dataset-pipeline.log")

    yaml_parser = subparsers.add_parser("write-yaml", help="Write an absolute-path YOLO dataset map")
    yaml_parser.add_argument("--data-root", type=Path, default=DATA_ROOT)
    yaml_parser.add_argument("--output", type=Path, default=DATA_ROOT / "dataset.yaml")

    args = parser.parse_args()
    if args.command == "scan":
        result = scan_data(args.data_root)
        output = json.dumps(result, indent=2)
        print(output)
        write_log(args.log_file, output)
        if args.report:
            write_with_permissions(args.report, output + "\n")
        if result["invalid_labels"]:
            raise SystemExit(1)
    elif args.command == "route":
        count = route_images(args.source, args.category, args.labels, args.data_root)
        message = f"Routed {count} image(s) to {args.data_root / args.category}"
        print(message)
        write_log(args.log_file, message)
    else:
        write_with_permissions(args.output, dataset_yaml(args.data_root))
        print(f"Wrote YOLO dataset map to {args.output.resolve()}")


if __name__ == "__main__":
    main()
