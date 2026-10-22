#!/usr/bin/env python3
"""Generate labeled Phase 6 UI wireframe fixtures and an Ultralytics config."""

import argparse
import json
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DATA_ROOT = REPOSITORY_ROOT / "data" / "ui_dataset"
IMAGE_SIZE = (960, 640)
CLASS_NAMES = ("sidebar", "dashboard_card", "input_field", "action_button", "chat_feed")
SPLITS = {"train": 40, "val": 10}
PALETTES = (
    {
        "background": "#f4f6fa", "surface": "#ffffff", "sidebar": "#18243a",
        "accent": "#5478e8", "text": "#202b3c", "muted": "#8792a5",
        "border": "#e3e8f0", "soft": "#edf1ff",
    },
    {
        "background": "#f5f4f1", "surface": "#ffffff", "sidebar": "#273b36",
        "accent": "#4e9b7e", "text": "#26342f", "muted": "#899690",
        "border": "#e5e9e5", "soft": "#eaf5ef",
    },
    {
        "background": "#f3f5f8", "surface": "#ffffff", "sidebar": "#302b43",
        "accent": "#8a68d5", "text": "#2c2938", "muted": "#918da0",
        "border": "#e7e4ee", "soft": "#f1edfb",
    },
    {
        "background": "#f7f4f1", "surface": "#ffffff", "sidebar": "#3d3030",
        "accent": "#d17a57", "text": "#342b29", "muted": "#9a8e89",
        "border": "#ece4df", "soft": "#fbefe8",
    },
)


def yolo_line(class_id: int, bounds: tuple[int, int, int, int]) -> str:
    """Convert pixel-space left, top, right, bottom bounds to a YOLO row."""
    left, top, right, bottom = bounds
    image_width, image_height = IMAGE_SIZE
    center_x = (left + right) / (2 * image_width)
    center_y = (top + bottom) / (2 * image_height)
    width = (right - left) / image_width
    height = (bottom - top) / image_height
    return f"{class_id} {center_x:.8f} {center_y:.8f} {width:.8f} {height:.8f}"


def validate_labels(rows: list[tuple[int, tuple[int, int, int, int]]]) -> None:
    """Reject malformed, out-of-frame, or incomplete generated annotations."""
    class_ids = {class_id for class_id, _ in rows}
    if class_ids != set(range(len(CLASS_NAMES))):
        raise ValueError(f"generated fixture is missing classes: {class_ids}")
    for class_id, (left, top, right, bottom) in rows:
        if not 0 <= class_id < len(CLASS_NAMES):
            raise ValueError(f"generated class id is out of range: {class_id}")
        if not (0 <= left < right <= IMAGE_SIZE[0] and 0 <= top < bottom <= IMAGE_SIZE[1]):
            raise ValueError(f"generated bounds are outside the image: {(left, top, right, bottom)}")
        values = (
            (left + right) / (2 * IMAGE_SIZE[0]),
            (top + bottom) / (2 * IMAGE_SIZE[1]),
            (right - left) / IMAGE_SIZE[0],
            (bottom - top) / IMAGE_SIZE[1],
        )
        if not all(0 < value <= 1 for value in values):
            raise ValueError(f"generated YOLO coordinates are invalid: {values}")


def draw_fixture(index: int, seed: int, output_path: Path) -> list[tuple[int, tuple[int, int, int, int]]]:
    """Draw a varied dashboard wireframe and return its labeled component bounds."""
    rng = random.Random(seed)
    palette = PALETTES[(index + seed) % len(PALETTES)]
    image = Image.new("RGB", IMAGE_SIZE, palette["background"])
    draw = ImageDraw.Draw(image)
    title_font = ImageFont.load_default(size=18)
    body_font = ImageFont.load_default(size=14)
    small_font = ImageFont.load_default(size=12)

    sidebar = (0, 0, 190, 640)
    draw.rectangle(sidebar, fill=palette["sidebar"])
    draw.rounded_rectangle((24, 25, 55, 56), radius=9, fill=palette["accent"])
    draw.line((33, 40, 39, 46, 48, 34), fill="#ffffff", width=3)
    draw.text((67, 32), "NORTHSTAR", font=body_font, fill="#ffffff")
    draw.text((25, 91), "WORKSPACE", font=small_font, fill="#aab5c7")
    for row, label in enumerate(("Overview", "Analytics", "Projects", "Messages", "Settings")):
        y = 118 + row * 49
        if row == index % 5:
            draw.rounded_rectangle((14, y - 8, 176, y + 31), radius=8, fill="#34445e")
        draw.ellipse((27, y + 2, 39, y + 14), outline="#aebbd0", width=2)
        draw.text((51, y), label, font=body_font, fill="#ffffff" if row == index % 5 else "#c1cada")
    draw.line((23, 390, 167, 390), fill="#405069", width=1)
    draw.ellipse((26, 414, 54, 442), fill=palette["accent"])
    draw.text((64, 414), "Morgan Lee", font=small_font, fill="#ffffff")
    draw.text((64, 431), "Team admin", font=small_font, fill="#aab5c7")

    input_field = (222, 28, 684, 76)
    draw.rounded_rectangle(input_field, radius=10, fill=palette["surface"], outline=palette["border"], width=2)
    draw.ellipse((241, 43, 255, 57), outline=palette["muted"], width=2)
    draw.line((253, 55, 260, 62), fill=palette["muted"], width=2)
    draw.text((272, 43), ("Search reports", "Find anything", "Search workspace")[index % 3],
              font=body_font, fill=palette["muted"])

    action_button = (811, 28, 930, 76)
    draw.rounded_rectangle(action_button, radius=10, fill=palette["accent"])
    draw.text((832, 44), ("＋ New report", "＋ Add project", "＋ Create")[index % 3],
              font=small_font, fill="#ffffff")
    draw.rounded_rectangle((714, 37, 762, 67), radius=15, fill=palette["soft"])
    draw.ellipse((730, 43, 746, 59), fill=palette["accent"])
    draw.ellipse((777, 39, 801, 63), fill="#d9c8b5")

    card_one = (222, 112, 554, 294)
    card_two = (572, 112, 930, 294)
    draw.rounded_rectangle(card_one, radius=12, fill=palette["surface"], outline=palette["border"], width=2)
    draw.rounded_rectangle(card_two, radius=12, fill=palette["surface"], outline=palette["border"], width=2)
    draw.text((244, 132), ("Active users", "Monthly growth", "Total revenue")[index % 3],
              font=body_font, fill=palette["muted"])
    metric = f"{(index + 1) * 137 + rng.randint(400, 900):,}"
    draw.text((244, 160), metric, font=ImageFont.load_default(size=30), fill=palette["text"])
    draw.text((245, 204), f"+{rng.randint(4, 28)}.{rng.randint(0, 9)}%  vs. last month",
              font=small_font, fill="#39896b")
    draw.line((245, 264, 525, 264), fill=palette["border"], width=1)
    for tick in range(1, 6):
        x = 245 + tick * 46
        draw.line((x, 255, x, 272), fill=palette["border"], width=1)

    draw.text((594, 132), ("Weekly activity", "Traffic overview", "Conversion rate")[index % 3],
              font=body_font, fill=palette["text"])
    chart_points = []
    for point in range(8):
        x = 600 + point * 42
        y = 246 - rng.randint(12, 80)
        chart_points.append((x, y))
    draw.line(chart_points, fill=palette["accent"], width=4, joint="curve")
    for x, y in chart_points:
        draw.ellipse((x - 4, y - 4, x + 4, y + 4), fill=palette["surface"], outline=palette["accent"], width=2)
    for y in (180, 210, 240, 270):
        draw.line((595, y, 908, y), fill=palette["border"], width=1)

    chat_feed = (222, 314, 930, 612)
    draw.rounded_rectangle(chat_feed, radius=12, fill=palette["surface"], outline=palette["border"], width=2)
    draw.text((244, 334), "Team activity", font=title_font, fill=palette["text"])
    draw.text((808, 338), "View all  →", font=small_font, fill=palette["accent"])
    draw.line((243, 369, 908, 369), fill=palette["border"], width=1)
    messages = (
        ("ML", "Morgan Lee", "Shared the latest dashboard with the team", "2 min ago"),
        ("AJ", "Alex Johnson", "Updated the Q3 performance metrics", "18 min ago"),
        ("SK", "Sam Kim", "Added a new project to the workspace", "1 hour ago"),
    )
    avatar_colors = ("#e3eaff", "#e4f4ec", "#f4e8df")
    for row, (initials, name, message, timestamp) in enumerate(messages):
        y = 386 + row * 66
        draw.ellipse((245, y, 281, y + 36), fill=avatar_colors[row])
        draw.text((252, y + 11), initials, font=small_font, fill=palette["accent"])
        draw.text((294, y + 1), name, font=body_font, fill=palette["text"])
        draw.text((294, y + 22), message, font=small_font, fill=palette["muted"])
        draw.text((812, y + 9), timestamp, font=small_font, fill=palette["muted"])
        if row < len(messages) - 1:
            draw.line((294, y + 53, 908, y + 53), fill=palette["border"], width=1)

    boxes = [
        (0, sidebar),
        (1, card_one),
        (1, card_two),
        (2, input_field),
        (3, action_button),
        (4, chat_feed),
    ]
    validate_labels(boxes)
    image.save(output_path, format="PNG", optimize=True)
    output_path.chmod(0o644)
    return boxes


def write_dataset_yaml(dataset_root: Path) -> Path:
    """Write a host-independent Ultralytics dataset manifest."""
    yaml_text = "\n".join((
        "path: .",
        "train: images/train",
        "val: images/val",
        f"nc: {len(CLASS_NAMES)}",
        f"names: {json.dumps(list(CLASS_NAMES))}",
        "",
    ))
    config_path = dataset_root / "dataset.yaml"
    config_path.write_text(yaml_text, encoding="utf-8")
    config_path.chmod(0o644)
    return config_path


def generate_split(dataset_root: Path, split: str, count: int, force: bool) -> int:
    image_root = dataset_root / "images" / split
    label_root = dataset_root / "labels" / split
    image_root.mkdir(parents=True, exist_ok=True)
    label_root.mkdir(parents=True, exist_ok=True)

    planned = [
        (image_root / f"ui_{split}_{index:03d}.png",
         label_root / f"ui_{split}_{index:03d}.txt")
        for index in range(1, count + 1)
    ]
    existing = [path for pair in planned for path in pair if path.exists()]
    if existing and not force:
        raise FileExistsError(
            "refusing to overwrite existing generated fixture(s); pass --force to replace: "
            + ", ".join(str(path) for path in existing)
        )

    for index, (image_path, label_path) in enumerate(planned, start=1):
        seed = index if split == "train" else 10_000 + index
        boxes = draw_fixture(index, seed, image_path)
        validate_labels(boxes)
        label_text = "\n".join(yolo_line(class_id, bounds) for class_id, bounds in boxes) + "\n"
        if not label_text.strip():
            raise ValueError(f"generated labels are blank: {label_path}")
        label_path.write_text(label_text, encoding="utf-8")
        label_path.chmod(0o644)

    return len(planned)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data-root",
        type=Path,
        default=DEFAULT_DATA_ROOT,
        help="UI dataset root (default: data/ui_dataset)",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Replace fixtures with this script's generated filenames",
    )
    args = parser.parse_args()

    dataset_root = args.data_root.resolve()
    dataset_root.mkdir(parents=True, exist_ok=True)
    if not args.force:
        existing = [
            path
            for split, count in SPLITS.items()
            for index in range(1, count + 1)
            for path in (
                dataset_root / "images" / split / f"ui_{split}_{index:03d}.png",
                dataset_root / "labels" / split / f"ui_{split}_{index:03d}.txt",
            )
            if path.exists()
        ]
        if existing:
            raise FileExistsError(
                "refusing to overwrite existing generated fixture(s); pass --force to replace: "
                + ", ".join(str(path) for path in existing)
            )
    total = sum(
        generate_split(dataset_root, split, count, args.force)
        for split, count in SPLITS.items()
    )
    config_path = write_dataset_yaml(dataset_root)
    print(f"Generated {total} UI image/label pair(s) at {dataset_root}")
    print(f"Updated relative-path dataset config at {config_path}")


if __name__ == "__main__":
    main()
