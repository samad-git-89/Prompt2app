#!/usr/bin/env python3
"""Create the Phase 6 UI detection dataset structure and Ultralytics config."""

import argparse
import json
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = REPOSITORY_ROOT / "data" / "ui_dataset"
CLASS_NAMES = ("sidebar", "dashboard_card", "input_field", "action_button", "chat_feed")
SPLIT_PATHS = ("images/train", "images/val", "labels/train", "labels/val")


def create_dataset_layout(data_root: Path = DEFAULT_DATA_ROOT) -> Path:
    """Create the train/validation folders and write the dataset configuration."""
    dataset_root = data_root.resolve()
    for relative_path in SPLIT_PATHS:
        (dataset_root / relative_path).mkdir(parents=True, exist_ok=True)

    dataset_yaml = "\n".join((
        f"path: {json.dumps(str(dataset_root))}",
        "train: images/train",
        "val: images/val",
        f"nc: {len(CLASS_NAMES)}",
        f"names: {json.dumps(list(CLASS_NAMES))}",
        "",
    ))
    config_path = dataset_root / "dataset.yaml"
    config_path.write_text(dataset_yaml, encoding="utf-8")
    config_path.chmod(0o644)
    return config_path


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data-root",
        type=Path,
        default=DEFAULT_DATA_ROOT,
        help="UI dataset root (default: data/ui_dataset)",
    )
    args = parser.parse_args()

    config_path = create_dataset_layout(args.data_root)
    print(f"Created UI dataset layout and config at {config_path}")


if __name__ == "__main__":
    main()
