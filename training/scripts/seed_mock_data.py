#!/usr/bin/env python3
"""Seed tiny deterministic YOLO image/label pairs for a training smoke test."""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw

if __package__:
    from . import dataset_pipeline
else:
    import dataset_pipeline


REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
DATA_ROOT = REPOSITORY_ROOT / "data"
IMAGE_SIZE = 640
FIXTURES = {
    "synthetic": (
        ((0, (72, 92, 250, 215)),),
        ((1, (135, 110, 465, 195)),),
        ((2, (90, 65, 550, 145)),),
        ((3, (70, 245, 315, 535)), (4, (350, 245, 570, 470))),
    ),
    "gold": (
        ((0, (95, 365, 260, 485)), (4, (330, 125, 555, 310))),
        ((2, (75, 60, 565, 155)), (1, (180, 170, 460, 200)), (3, (110, 215, 520, 510))),
    ),
}
BACKGROUNDS = ((245, 245, 240), (230, 238, 246), (242, 232, 225))
CLASS_COLORS = (
    (208, 72, 62),
    (49, 130, 98),
    (55, 105, 178),
    (204, 143, 45),
    (125, 83, 156),
)


def yolo_line(class_id: int, bounds: tuple[int, int, int, int]) -> str:
    left, top, right, bottom = bounds
    center_x = (left + right) / (2 * IMAGE_SIZE)
    center_y = (top + bottom) / (2 * IMAGE_SIZE)
    width = (right - left) / IMAGE_SIZE
    height = (bottom - top) / IMAGE_SIZE
    return f"{class_id} {center_x:.8f} {center_y:.8f} {width:.8f} {height:.8f}"


def seed_split(category: str, count: int, data_root: Path, force: bool) -> int:
    image_root = data_root / category / "images"
    labels_root = data_root / category / "labels"
    image_root.mkdir(parents=True, exist_ok=True)
    labels_root.mkdir(parents=True, exist_ok=True)

    planned = [
        (image_root / f"mock_{category}_{index:02d}.png",
         labels_root / f"mock_{category}_{index:02d}.txt")
        for index in range(count)
    ]
    existing = [path for pair in planned for path in pair if path.exists()]
    if existing and not force:
        raise FileExistsError(
            "refusing to overwrite existing mock fixture(s): "
            + ", ".join(str(path) for path in existing)
        )

    for index, (image_path, label_path) in enumerate(planned):
        boxes = FIXTURES[category][index]
        image = Image.new("RGB", (IMAGE_SIZE, IMAGE_SIZE), BACKGROUNDS[index % len(BACKGROUNDS)])
        draw = ImageDraw.Draw(image)
        rows = []
        for class_id, bounds in boxes:
            draw.rectangle(bounds, fill=CLASS_COLORS[class_id], outline=(35, 35, 35), width=3)
            rows.append(yolo_line(class_id, bounds))

        label_text = "\n".join(rows) + "\n"
        errors = dataset_pipeline.validate_yolo_labels(label_text)
        if errors:
            raise ValueError(f"invalid generated labels for {image_path}: {'; '.join(errors)}")

        image.save(image_path, format="PNG")
        image_path.chmod(0o644)
        label_path.write_text(label_text, encoding="utf-8")
        label_path.chmod(0o644)
        print(f"Seeded {image_path} with classes {[class_id for class_id, _ in boxes]}")

    return len(planned)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-root", type=Path, default=DATA_ROOT)
    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace existing files with the same mock fixture names",
    )
    args = parser.parse_args()

    total = 0
    for category, fixtures in FIXTURES.items():
        total += seed_split(category, len(fixtures), args.data_root, args.force)
    print(f"Seeded {total} image/label pair(s) across synthetic and gold splits")


if __name__ == "__main__":
    main()