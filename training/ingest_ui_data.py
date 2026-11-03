#!/usr/bin/env python3
"""Generate labeled Phase 6 UI wireframe fixtures and an Ultralytics config."""

import argparse
from concurrent.futures import ThreadPoolExecutor
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
    {
        "background": "#0b0f19", "surface": "#141b2a", "sidebar": "#090d15",
        "accent": "#5b8cff", "text": "#e6edf7", "muted": "#8995a8",
        "border": "#293447", "soft": "#1a2942",
    },
    {
        "background": "#141b2a", "surface": "#1c2638", "sidebar": "#101725",
        "accent": "#4dd4ac", "text": "#e8eef6", "muted": "#9aa9bd",
        "border": "#344257", "soft": "#203c3b",
    },
    {
        "background": "#0f172a", "surface": "#182338", "sidebar": "#0b1222",
        "accent": "#a78bfa", "text": "#eef2ff", "muted": "#9aa7c2",
        "border": "#303e59", "soft": "#2b2649",
    },
    {
        "background": "#18181b", "surface": "#232326", "sidebar": "#111113",
        "accent": "#fb923c", "text": "#f4f4f5", "muted": "#a1a1aa",
        "border": "#3f3f46", "soft": "#3b2b20",
    },
    {
        "background": "#ffffff", "surface": "#ffffff", "sidebar": "#ffffff",
        "accent": "#000000", "text": "#000000", "muted": "#333333",
        "border": "#000000", "soft": "#eeeeee",
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
    for row_index, (class_id, (left, top, right, bottom)) in enumerate(rows):
        if not 0 <= class_id < len(CLASS_NAMES):
            raise ValueError(f"generated class id is out of range: {class_id}")
        if not (0 <= left < right <= IMAGE_SIZE[0] and 0 <= top < bottom <= IMAGE_SIZE[1]):
            raise ValueError(f"generated bounds are outside the image: {(left, top, right, bottom)}")
        for _, (other_left, other_top, other_right, other_bottom) in rows[:row_index]:
            if left < other_right and other_left < right and top < other_bottom and other_top < bottom:
                raise ValueError(f"generated bounds overlap: {(left, top, right, bottom)}")
        values = (
            (left + right) / (2 * IMAGE_SIZE[0]),
            (top + bottom) / (2 * IMAGE_SIZE[1]),
            (right - left) / IMAGE_SIZE[0],
            (bottom - top) / IMAGE_SIZE[1],
        )
        if not all(0 < value <= 1 for value in values):
            raise ValueError(f"generated YOLO coordinates are invalid: {values}")


def _draw_baseline_fixture(
    index: int, seed: int, output_path: Path
) -> list[tuple[int, tuple[int, int, int, int]]]:
    """Keep the original first fixture geometry as a stable baseline."""
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


def _draw_sidebar(draw: ImageDraw.ImageDraw, palette: dict, bounds: tuple[int, int, int, int],
                  active_row: int, body_font: ImageFont.ImageFont,
                  small_font: ImageFont.ImageFont) -> None:
    left, top, right, bottom = bounds
    width = right - left
    draw.rectangle(bounds, fill=palette["sidebar"], outline=palette["border"], width=2)
    draw.rounded_rectangle((left + 18, top + 22, left + 49, top + 53),
                           radius=8, fill=palette["accent"])
    draw.line((left + 26, top + 37, left + 32, top + 43, left + 41, top + 31),
              fill="#ffffff", width=3)
    draw.text((left + 59, top + 29), "NORTHSTAR", font=small_font, fill=palette["text"])
    draw.text((left + 20, top + 82), "WORKSPACE", font=small_font, fill=palette["muted"])
    for row, label in enumerate(("Overview", "Analytics", "Projects", "Messages", "Settings")):
        y = top + 111 + row * 48
        if row == active_row:
            draw.rounded_rectangle((left + 10, y - 7, right - 10, y + 31),
                                   radius=8, fill=palette["soft"])
        draw.ellipse((left + 22, y + 2, left + 34, y + 14),
                     outline=palette["muted"], width=2)
        if width >= 185:
            draw.text((left + 45, y), label, font=body_font,
                      fill=palette["text"] if row == active_row else palette["muted"])
    draw.line((left + 18, top + 390, right - 18, top + 390),
              fill=palette["border"], width=1)
    draw.ellipse((left + 21, top + 414, left + 49, top + 442), fill=palette["accent"])
    if width >= 200:
        draw.text((left + 58, top + 414), "Morgan Lee", font=small_font, fill=palette["text"])
        draw.text((left + 58, top + 431), "Team admin", font=small_font, fill=palette["muted"])


def _draw_card(draw: ImageDraw.ImageDraw, palette: dict,
               bounds: tuple[int, int, int, int], title: str, kind: str,
               rng: random.Random, body_font: ImageFont.ImageFont,
               small_font: ImageFont.ImageFont) -> None:
    left, top, right, bottom = bounds
    draw.rounded_rectangle(bounds, radius=10, fill=palette["surface"],
                           outline=palette["border"], width=2)
    draw.text((left + 12, top + 13), title, font=small_font, fill=palette["muted"])
    if kind == "metric":
        draw.text((left + 12, top + 37), f"{rng.randint(2, 98)},{rng.randint(100, 999)}",
                  font=body_font, fill=palette["text"])
        draw.text((left + 12, top + 65), f"+{rng.randint(2, 28)}% this month",
                  font=small_font, fill=palette["accent"])
        draw.line((left + 12, bottom - 20, right - 12, bottom - 20),
                  fill=palette["border"], width=2)
    else:
        chart_top = top + 44
        chart_bottom = bottom - 18
        points = []
        for step in range(6):
            x = left + 15 + step * max(1, (right - left - 30) // 5)
            y = rng.randint(chart_top, max(chart_top, chart_bottom))
            points.append((x, y))
        if len(points) > 1:
            draw.line(points, fill=palette["accent"], width=3, joint="curve")
        for y in range(chart_top + 15, chart_bottom, 30):
            draw.line((left + 12, y, right - 12, y), fill=palette["border"], width=1)


def _draw_input(draw: ImageDraw.ImageDraw, palette: dict,
                bounds: tuple[int, int, int, int], text: str,
                small_font: ImageFont.ImageFont) -> None:
    left, top, right, bottom = bounds
    draw.rounded_rectangle(bounds, radius=9, fill=palette["surface"],
                           outline=palette["border"], width=2)
    draw.ellipse((left + 12, top + 13, left + 25, top + 26),
                 outline=palette["muted"], width=2)
    draw.line((left + 24, top + 25, left + 30, top + 31),
              fill=palette["muted"], width=2)
    draw.text((left + 38, top + 14), text, font=small_font, fill=palette["muted"])


def _draw_button(draw: ImageDraw.ImageDraw, palette: dict,
                 bounds: tuple[int, int, int, int], small_font: ImageFont.ImageFont) -> None:
    left, top, right, bottom = bounds
    draw.rounded_rectangle(bounds, radius=9, fill=palette["accent"])
    draw.text((left + 10, top + 14), "＋ Create", font=small_font, fill="#ffffff")


def _draw_feed(draw: ImageDraw.ImageDraw, palette: dict,
               bounds: tuple[int, int, int, int], title_font: ImageFont.ImageFont,
               body_font: ImageFont.ImageFont, small_font: ImageFont.ImageFont) -> None:
    left, top, right, bottom = bounds
    draw.rounded_rectangle(bounds, radius=11, fill=palette["surface"],
                           outline=palette["border"], width=2)
    draw.text((left + 16, top + 15), "Team activity", font=title_font, fill=palette["text"])
    draw.line((left + 14, top + 49, right - 14, top + 49),
              fill=palette["border"], width=1)
    row_height = max(42, min(66, (bottom - top - 60) // 3))
    for row, (name, message) in enumerate((
        ("Morgan Lee", "Shared a dashboard with the team"),
        ("Alex Johnson", "Updated the performance metrics"),
        ("Sam Kim", "Added a new workspace project"),
    )):
        y = top + 62 + row * row_height
        if y + 34 >= bottom:
            break
        draw.ellipse((left + 15, y, left + 43, y + 28), fill=palette["soft"])
        draw.text((left + 52, y), name, font=body_font, fill=palette["text"])
        if right - left > 310:
            draw.text((left + 52, y + 19), message, font=small_font, fill=palette["muted"])
        if row < 2:
            draw.line((left + 52, y + row_height - 5, right - 14, y + row_height - 5),
                      fill=palette["border"], width=1)


def _control_bounds(rng: random.Random, x0: int, x1: int, y: int,
                    height: int) -> tuple[tuple[int, int, int, int], tuple[int, int, int, int]]:
    margin = 24
    gap = 12
    available = x1 - x0 - 2 * margin
    button_width = rng.randint(95, 160)
    max_input_width = min(520, available - button_width - gap)
    if max_input_width < 180:
        button_width = min(95, max(80, available - 180 - gap))
        max_input_width = available - button_width - gap
    input_width = rng.randint(180, max(180, max_input_width))
    start = x0 + margin
    return (
        (start, y, start + input_width, y + height),
        (start + input_width + gap, y, start + input_width + gap + button_width, y + height),
    )


def _partition_widths(rng: random.Random, total: int, count: int) -> list[int]:
    gap = 14
    available = total - gap * (count - 1)
    base = available // count
    widths = [base + rng.randint(-18, 18) for _ in range(count - 1)]
    widths.append(available - sum(widths))
    return widths


def draw_fixture(index: int, seed: int, output_path: Path) -> list[tuple[int, tuple[int, int, int, int]]]:
    """Draw a deterministic procedural UI archetype and its component bounds."""
    if index == 1:
        return _draw_baseline_fixture(index, seed, output_path)

    rng = random.Random(seed)
    palette = PALETTES[rng.randrange(len(PALETTES))]
    image = Image.new("RGB", IMAGE_SIZE, palette["background"])
    draw = ImageDraw.Draw(image)
    title_font = ImageFont.load_default(size=18)
    body_font = ImageFont.load_default(size=14)
    small_font = ImageFont.load_default(size=12)

    sidebar_width = rng.randint(160, 250)
    dock_left = bool(rng.getrandbits(1))
    sidebar = ((0, 0, sidebar_width, IMAGE_SIZE[1]) if dock_left else
               (IMAGE_SIZE[0] - sidebar_width, 0, IMAGE_SIZE[0], IMAGE_SIZE[1]))
    content_left = sidebar_width if dock_left else 0
    content_right = IMAGE_SIZE[0] if dock_left else IMAGE_SIZE[0] - sidebar_width
    content_width = content_right - content_left
    _draw_sidebar(draw, palette, sidebar, rng.randrange(5), body_font, small_font)

    archetype = rng.choice(("dashboard", "split_studio", "center_feed"))
    control_mode = rng.choice(("top_bar", "filter_bar", "composer"))
    controls_y = {"top_bar": 24, "filter_bar": 92, "composer": 552}[control_mode]
    split_feed_width = None
    controls_right = content_right
    if archetype == "split_studio":
        split_feed_width = int(content_width * rng.uniform(0.38, 0.44))
        controls_right = content_right - split_feed_width - 16
    input_box, button_box = _control_bounds(
        rng, content_left, controls_right, controls_y, 48
    )
    control_boxes = [(2, input_box), (3, button_box)]
    boxes: list[tuple[int, tuple[int, int, int, int]]] = [(0, sidebar)]
    boxes.extend(control_boxes)

    if archetype == "dashboard":
        card_layout = rng.choice(("two_column", "three_column", "stacked"))
        cards_left = content_left + 24
        cards_right = content_right - 24
        cards_width = cards_right - cards_left
        if control_mode == "top_bar":
            cards_top = 102
        elif control_mode == "filter_bar":
            cards_top = 154
        else:
            cards_top = 26

        if card_layout == "stacked":
            chat_bottom = 536 if control_mode == "composer" else 614
            height_limit = max(140, min(230, (chat_bottom - cards_top - 26 - 140) // 2))
            card_heights = (rng.randint(140, height_limit), rng.randint(140, height_limit))
            first = (cards_left, cards_top, cards_right, cards_top + card_heights[0])
            second_top = first[3] + 12
            second = (cards_left, second_top, cards_right, second_top + card_heights[1])
            card_boxes = [first, second]
            feed_top = second[3] + 12
        else:
            count = 2 if card_layout == "two_column" else 3
            widths = _partition_widths(rng, cards_width, count)
            card_height = rng.randint(140, 230)
            card_boxes = []
            x = cards_left
            for position, width in enumerate(widths):
                card_boxes.append((x, cards_top, x + width, cards_top + card_height))
                x += width + 14
            feed_top = cards_top + card_height + 14
        feed_bottom = 536 if control_mode == "composer" else 614
        feed_box = (cards_left, feed_top, cards_right, feed_bottom)
        if feed_box[3] - feed_box[1] < 40:
            raise ValueError("generated dashboard leaves insufficient space for its activity feed")
        for position, card_box in enumerate(card_boxes):
            kind = "metric" if position % 2 == 0 else "chart"
            title = ("Active users", "Weekly activity", "Conversion rate")[position % 3]
            _draw_card(draw, palette, card_box, title, kind, rng, body_font, small_font)
            boxes.append((1, card_box))
    elif archetype == "split_studio":
        if split_feed_width is None:
            raise RuntimeError("split-studio layout is missing its feed width")
        feed_width = split_feed_width
        feed_left = content_right - 24 - feed_width
        feed_box = (feed_left, 24, content_right - 24, 614)
        left_edge = content_left + 24
        left_width = feed_left - 16 - left_edge
        layout = rng.choice(("two_column", "stacked"))
        if layout == "two_column":
            widths = _partition_widths(rng, left_width, 2)
            card_height = rng.randint(140, 230)
            card_boxes = []
            x = left_edge
            for width in widths:
                card_boxes.append((x, 154, x + width, 154 + card_height))
                x += width + 14
        else:
            first_height = rng.randint(140, 190)
            second_height = rng.randint(140, 190)
            card_boxes = [
                (left_edge, 154, left_edge + left_width, 154 + first_height),
                (left_edge, 166 + first_height, left_edge + left_width,
                 166 + first_height + second_height),
            ]
        for position, card_box in enumerate(card_boxes):
            _draw_card(draw, palette, card_box,
                       ("Active users", "Weekly activity")[position],
                       "metric" if position == 0 else "chart", rng, body_font, small_font)
            boxes.append((1, card_box))
    else:
        feed_width = int(content_width * rng.uniform(0.38, 0.44))
        feed_left = content_left + (content_width - feed_width) // 2
        feed_right = feed_left + feed_width
        if control_mode == "top_bar":
            feed_top = 92
        elif control_mode == "composer":
            feed_top = 24
        else:
            feed_top = 154
        feed_bottom = 614 if control_mode != "composer" else 536
        feed_box = (feed_left, feed_top, feed_right, feed_bottom)
        side_regions = (
            (content_left + 12, feed_left - 12),
            (feed_right + 12, content_right - 12),
        )
        card_boxes = []
        for region_left, region_right in side_regions:
            card_width = region_right - region_left
            card_height = rng.randint(140, min(230, 220))
            card_top = rng.randint(max(84, feed_top + 12), min(180, feed_bottom - card_height))
            card_boxes.append((region_left, card_top, region_right, card_top + card_height))
        for position, card_box in enumerate(card_boxes):
            _draw_card(draw, palette, card_box,
                       ("Active users", "Weekly activity")[position],
                       "metric" if position == 0 else "chart", rng, body_font, small_font)
            boxes.append((1, card_box))

    _draw_input(draw, palette, input_box,
                rng.choice(("Search workspace", "Filter activity", "Ask anything")),
                small_font)
    _draw_button(draw, palette, button_box, small_font)
    _draw_feed(draw, palette, feed_box, title_font, body_font, small_font)
    boxes.append((4, feed_box))
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


def generate_split(dataset_root: Path, split: str, count: int, force: bool,
                   workers: int = 1) -> int:
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

    def generate_fixture(item: tuple[int, tuple[Path, Path]]) -> None:
        index, (image_path, label_path) = item
        seed = index if split == "train" else 10_000 + index
        boxes = draw_fixture(index, seed, image_path)
        validate_labels(boxes)
        label_text = "\n".join(yolo_line(class_id, bounds) for class_id, bounds in boxes) + "\n"
        if not label_text.strip():
            raise ValueError(f"generated labels are blank: {label_path}")
        label_path.write_text(label_text, encoding="utf-8")
        label_path.chmod(0o644)

    indexed_planned = list(enumerate(planned, start=1))
    if workers == 1:
        for item in indexed_planned:
            generate_fixture(item)
    else:
        with ThreadPoolExecutor(max_workers=workers) as executor:
            list(executor.map(generate_fixture, indexed_planned))

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
    parser.add_argument("--train-count", type=int, default=SPLITS["train"],
                        help="Number of training fixtures to generate (default: 40)")
    parser.add_argument("--val-count", type=int, default=SPLITS["val"],
                        help="Number of validation fixtures to generate (default: 10)")
    parser.add_argument("--workers", type=int, default=1,
                        help="Number of fixture-generation workers (default: 1)")
    args = parser.parse_args()
    if args.train_count < 0 or args.val_count < 0:
        parser.error("--train-count and --val-count must be non-negative")
    if args.workers < 1:
        parser.error("--workers must be at least 1")

    dataset_root = args.data_root.resolve()
    dataset_root.mkdir(parents=True, exist_ok=True)
    splits = {"train": args.train_count, "val": args.val_count}
    if not args.force:
        existing = [
            path
            for split, count in splits.items()
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
        generate_split(dataset_root, split, count, args.force, args.workers)
        for split, count in splits.items()
    )
    config_path = write_dataset_yaml(dataset_root)
    print(f"Generated {total} UI image/label pair(s) at {dataset_root}")
    print(f"Updated relative-path dataset config at {config_path}")


if __name__ == "__main__":
    main()
