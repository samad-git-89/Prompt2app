#!/usr/bin/env python3
"""Orchestrate UI image inference, AppSpec transformation, code generation, and writing."""

import argparse
import json
import math
import subprocess
import sys
import tempfile
from pathlib import Path

from training.scripts.dataset_pipeline import IMAGE_EXTENSIONS, LOCKED_CLASSES


REPOSITORY_ROOT = Path(__file__).resolve().parent
INFERENCE_SCRIPT = REPOSITORY_ROOT / "training" / "scripts" / "evaluate_and_infer.py"
NODE_RUNNER = REPOSITORY_ROOT / "functions" / "integration-runner.js"
DEFAULT_WEIGHTS = REPOSITORY_ROOT / "training" / "runs" / "train" / "weights" / "best.pt"


def transform_profile(profile: dict, image_name: str) -> dict:
    """Validate the detector profile and transform its boxes into locked AppSpec tokens."""
    if not isinstance(profile, dict):
        raise ValueError("inference profile must be a JSON object")
    expected_classes = [
        {"class_id": class_id, "class_name": class_name}
        for class_id, class_name in enumerate(LOCKED_CLASSES)
    ]
    if profile.get("classes") != expected_classes:
        raise ValueError("inference profile does not use the locked class ID/name mapping")
    if profile.get("bounding_box_format") != "xyxy_pixels":
        raise ValueError("inference profile bounding boxes must use pixel xyxy coordinates")

    images = profile.get("images")
    if not isinstance(images, list) or len(images) != 1:
        raise ValueError("inference profile must contain exactly the requested image")
    image_profile = images[0]
    if not isinstance(image_profile, dict):
        raise ValueError("inference profile image entry must be a JSON object")
    if image_profile.get("image") != image_name:
        raise ValueError("inference profile image does not match the requested image")

    width = image_profile.get("width")
    height = image_profile.get("height")
    if type(width) is not int or type(height) is not int or width <= 0 or height <= 0:
        raise ValueError("inference profile must contain positive integer image dimensions")

    detections = image_profile.get("detections")
    if not isinstance(detections, list):
        raise ValueError("inference profile detections must be a list")

    component_tokens = []
    layout_details = []
    for detection in detections:
        if not isinstance(detection, dict):
            raise ValueError("inference profile detections must be JSON objects")
        class_id = detection.get("class_id")
        if type(class_id) is not int or class_id not in range(len(LOCKED_CLASSES)):
            raise ValueError(f"inference profile contains invalid class ID: {class_id!r}")
        class_name = LOCKED_CLASSES[class_id]
        if detection.get("class_name") != class_name:
            raise ValueError(f"class ID {class_id} does not map to {class_name!r}")

        confidence = detection.get("confidence")
        box = detection.get("bounding_box")
        if (
            isinstance(confidence, bool)
            or not isinstance(confidence, (int, float))
            or not math.isfinite(confidence)
            or not 0 <= confidence <= 1
        ):
            raise ValueError(f"invalid confidence for {class_name} detection")
        if not isinstance(box, dict) or box.get("format") != "xyxy" or box.get("units") != "pixels":
            raise ValueError(f"{class_name} detection must contain a pixel xyxy bounding box")

        coordinates = [box.get(key) for key in ("x1", "y1", "x2", "y2")]
        if (
            any(isinstance(value, bool) or not isinstance(value, (int, float)) for value in coordinates)
            or not all(math.isfinite(value) for value in coordinates)
        ):
            raise ValueError(f"{class_name} detection has invalid bounding-box coordinates")
        x1, y1, x2, y2 = coordinates
        if x1 < 0 or y1 < 0 or x2 <= x1 or y2 <= y1 or x2 > width or y2 > height:
            raise ValueError(f"{class_name} detection bounding box is outside image bounds")

        component_tokens.append(class_name)
        layout_details.append({
            "component": class_name,
            "confidence": round(float(confidence), 6),
            "bounding_box": {
                "x1": float(x1),
                "y1": float(y1),
                "x2": float(x2),
                "y2": float(y2),
            },
        })

    if layout_details:
        page_purpose = (
            "Recreate the detected UI layout using the listed components and pixel positions: "
            + json.dumps(layout_details, separators=(",", ":"))
        )
    else:
        page_purpose = (
            "Create a neutral starter page. The detector found no locked UI components; "
            "do not invent tracked components."
        )

    app_name = Path(image_name).stem.replace("_", " ").strip().title() or "UI Layout"
    return {
        "name": f"{app_name} UI",
        "description": (
            f"Frontend reconstructed from {image_name}; detected UI components are represented "
            "using the locked tracking tokens."
        ),
        "auth": "none",
        "pages": [{
            "route": "/",
            "purpose": page_purpose,
            "components": component_tokens,
        }],
        "data_models": [],
    }


def run_command(command: list[str], *, input_text: str | None = None) -> str:
    """Run a child process and surface its output and errors without hiding failures."""
    result = subprocess.run(
        command,
        cwd=REPOSITORY_ROOT,
        input=input_text,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.stdout:
        sys.stdout.write(result.stdout)
        if not result.stdout.endswith("\n"):
            sys.stdout.write("\n")
    if result.stderr:
        sys.stderr.write(result.stderr)
        if not result.stderr.endswith("\n"):
            sys.stderr.write("\n")
    if result.returncode != 0:
        raise RuntimeError(
            f"command failed with exit code {result.returncode}: {' '.join(command)}"
        )
    return result.stdout


def run_integration(
    image: Path,
    *,
    weights: Path = DEFAULT_WEIGHTS,
    confidence: float = 0.25,
    dry_run: bool = False,
    output_root: Path = REPOSITORY_ROOT,
) -> dict:
    image = image.expanduser().resolve(strict=True)
    weights = weights.expanduser().resolve(strict=True)
    output_root = output_root.expanduser().resolve(strict=True) if not dry_run else output_root
    if not image.is_file():
        raise FileNotFoundError(f"input image is not a file: {image}")
    if image.suffix.lower() not in IMAGE_EXTENSIONS:
        raise ValueError(f"unsupported input image extension: {image.suffix}")
    if not 0 <= confidence <= 1:
        raise ValueError("confidence must be between 0 and 1")
    if not dry_run and not output_root.is_dir():
        raise NotADirectoryError(f"output root does not exist: {output_root}")

    with tempfile.TemporaryDirectory(prefix="prompt2app-integration-") as temporary:
        temporary_root = Path(temporary)
        image_dir = temporary_root / "images"
        image_dir.mkdir()
        (image_dir / image.name).symlink_to(image)
        profile_path = temporary_root / "profile.json"

        print("[1/5] Vision extraction: loading custom checkpoint and detecting components", flush=True)
        run_command([
            sys.executable,
            str(INFERENCE_SCRIPT),
            "--image-dir",
            str(image_dir),
            "--weights",
            str(weights),
            "--output",
            str(profile_path),
            "--confidence",
            str(confidence),
        ])
        profile = json.loads(profile_path.read_text(encoding="utf-8"))

        print("[2/5] Schema transformation: validating boxes and mapping locked component tokens", flush=True)
        app_spec = transform_profile(profile, image.name)
        component_tokens = app_spec["pages"][0]["components"]
        print(f"AppSpec components: {json.dumps(component_tokens)}", flush=True)

        if dry_run:
            generation_root = temporary_root / "generated"
            generation_root.mkdir()
        else:
            generation_root = output_root
        prompt = (
            "Generate a complete full-stack UI prototype from the supplied visual profile and "
            "validated AppSpec. Preserve the detected pixel positions in the layout. Use only "
            "the locked component tokens already present in the AppSpec and do not invent "
            "additional tracked components. Include a frontend and backend."
        )
        node_input = json.dumps({
            "appSpec": app_spec,
            "prompt": prompt,
            "outputRoot": str(generation_root),
            "dryRun": dry_run,
            "visualProfile": profile,
        })

        print("[3/5] Generative execution: passing the AppSpec directly into functions/index.js", flush=True)
        print("[4/5] Output validation: checking complete frontend/backend generation", flush=True)
        output = run_command(
            ["node", str(NODE_RUNNER)],
            input_text=node_input,
        )
        result = json.loads(output)
        if result.get("status") != "complete" or not result.get("validation", {}).get("valid"):
            raise RuntimeError("integration runner returned without validated generated output")
        print("[5/5] Physical writing: generated files flushed by functions/file-writer.js", flush=True)
        print(json.dumps({
            "status": result["status"],
            "spec_name": result["app_spec"]["name"],
            "component_tokens": component_tokens,
            "repair_attempts": result["repair_attempts"],
            "written": result["written"],
            "dry_run": dry_run,
            "output_root": str(generation_root),
        }, indent=2))
        return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--image", type=Path, required=True, help="Path to a raw UI layout image")
    parser.add_argument("--weights", type=Path, default=DEFAULT_WEIGHTS)
    parser.add_argument("--confidence", type=float, default=0.25)
    parser.add_argument(
        "--output-root",
        type=Path,
        default=REPOSITORY_ROOT,
        help="Existing root directory where generated files are routed (default: repository root)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Use mock generation and a temporary writer destination; do not change repository files",
    )
    args = parser.parse_args()

    try:
        run_integration(
            args.image,
            weights=args.weights,
            confidence=args.confidence,
            dry_run=args.dry_run,
            output_root=args.output_root,
        )
    except (FileNotFoundError, NotADirectoryError, PermissionError, ValueError, RuntimeError) as error:
        parser.exit(1, f"Integration failed: {error}\n")


if __name__ == "__main__":
    main()
