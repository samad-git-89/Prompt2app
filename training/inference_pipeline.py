"""Run the Phase 7 UI component detector and return JSON-serializable results."""

import argparse
import json
import math
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, UnidentifiedImageError


WEIGHTS_PATH = Path(__file__).resolve().parent / "weights" / "best.pt"
CLASS_NAMES = {
    0: "sidebar",
    1: "dashboard_card",
    2: "input_field",
    3: "action_button",
    4: "chat_feed",
}
SUPPORTED_IMAGE_EXTENSIONS = {".bmp", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"}

_MODEL: Any | None = None


class _UnsupportedImageFormatError(ValueError):
    pass


class _BlankImageError(ValueError):
    pass


def _error(code: str, message: str, *, stage: str) -> dict[str, Any]:
    return {
        "status": "error",
        "error": {
            "code": code,
            "message": message,
            "stage": stage,
        },
    }


def _load_image(image_path: Path) -> Image.Image:
    """Load a supported image fully and reject empty or uniform canvases."""
    if image_path.suffix.lower() not in SUPPORTED_IMAGE_EXTENSIONS:
        raise _UnsupportedImageFormatError(
            f"unsupported image format: {image_path.suffix or '(no extension)'}"
        )

    with Image.open(image_path) as source:
        source.load()
        image = source.convert("RGB")

    if image.width <= 0 or image.height <= 0:
        raise ValueError("image has no pixels")

    background = Image.new("RGB", image.size, image.getpixel((0, 0)))
    if ImageChops.difference(image, background).getbbox() is None:
        raise _BlankImageError("image is blank")
    return image


def _load_model() -> Any:
    """Load and cache the verified local Ultralytics checkpoint."""
    global _MODEL
    if _MODEL is None:
        if not WEIGHTS_PATH.is_file():
            raise FileNotFoundError(f"YOLO checkpoint does not exist: {WEIGHTS_PATH}")
        try:
            from ultralytics import YOLO
        except ImportError as error:
            raise RuntimeError(
                "ultralytics is required; install it with "
                "'python -m pip install -r training/requirements.txt'"
            ) from error
        _MODEL = YOLO(str(WEIGHTS_PATH))
    return _MODEL


def _extract_detections(result: Any) -> list[dict[str, Any]]:
    boxes = result.boxes
    if boxes is None:
        return []

    detections = []
    for class_value, confidence_value, coordinates in zip(
        boxes.cls.tolist(),
        boxes.conf.tolist(),
        boxes.xyxy.tolist(),
    ):
        class_id = int(class_value)
        if class_id not in CLASS_NAMES:
            raise ValueError(f"model returned unknown class ID: {class_id}")

        box = [float(value) for value in coordinates]
        confidence = float(confidence_value)
        if (
            len(box) != 4
            or not all(math.isfinite(value) for value in box)
            or not math.isfinite(confidence)
            or not 0 <= confidence <= 1
        ):
            raise ValueError("model returned invalid confidence or bounding-box coordinates")

        detections.append({
            "class_id": class_id,
            "class_name": CLASS_NAMES[class_id],
            "confidence_percent": round(confidence * 100, 2),
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


def run_ui_inference(
    image_path: str | Path,
    confidence_threshold: float = 0.25,
) -> dict[str, Any]:
    """Return detections or a structured error as a JSON-serializable object."""
    try:
        path = Path(image_path).expanduser()
    except (TypeError, ValueError, OSError) as error:
        return _error("invalid_image_path", str(error), stage="validation")

    if (
        isinstance(confidence_threshold, bool)
        or not isinstance(confidence_threshold, (int, float))
        or not math.isfinite(confidence_threshold)
        or not 0 <= confidence_threshold <= 1
    ):
        return _error(
            "invalid_confidence_threshold",
            "confidence_threshold must be between 0 and 1",
            stage="validation",
        )

    try:
        image = _load_image(path)
    except UnidentifiedImageError as error:
        return _error("unsupported_image_format", str(error), stage="image_loading")
    except _UnsupportedImageFormatError as error:
        return _error("unsupported_image_format", str(error), stage="image_loading")
    except _BlankImageError as error:
        return _error("blank_image", str(error), stage="image_loading")
    except (OSError, ValueError, Image.DecompressionBombError) as error:
        return _error("image_load_failed", str(error), stage="image_loading")

    try:
        model = _load_model()
        results = model.predict(
            source=image,
            conf=confidence_threshold,
            verbose=False,
        )
        if len(results) != 1:
            raise RuntimeError(f"expected one inference result, got {len(results)}")

        result = results[0]
        height, width = result.orig_shape
        detections = _extract_detections(result)
    except Exception as error:
        return _error("inference_failed", str(error), stage="inference")

    return {
        "status": "ok",
        "image": path.name,
        "width": int(width),
        "height": int(height),
        "classes": [
            {"class_id": class_id, "class_name": class_name}
            for class_id, class_name in CLASS_NAMES.items()
        ],
        "bounding_box_format": "xyxy_pixels",
        "detections": detections,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", required=True, help="Path to the UI wireframe image")
    args = parser.parse_args()
    print(json.dumps(run_ui_inference(args.image), separators=(",", ":")))


if __name__ == "__main__":
    main()
