# prompt2app

An AI assistant that helps non-coders build and scale web apps from plain-language prompts.

**Target output stack:** web apps on Firebase (Hosting, Auth, Firestore, Cloud Functions) with Google Apps Script for Workspace automation.

**Models:** Gemini (via Google AI Studio / Gemini API) for planning and generation, with optional open models from Hugging Face as a cheaper tier or fine-tuned specialist.

## Pipeline

prompt -> spec (JSON) -> code generation (file by file) -> validate (lint, build, Firestore rules, secrets scan) -> repair loop (max 3) -> deploy -> iterate with diffs

## Repository layout

| Path | Purpose |
|---|---|
| `web/` | Front-end for the builder UI (Firebase Hosting) |
| `functions/` | Orchestrator: model calls, validation, queueing, key handling |
| `apps-script/` | Apps Script templates and deployment helpers |
| `schemas/` | JSON schemas (app spec, eval case) |
| `data/gold/` | Hand-written gold examples (prompt -> spec -> code) |
| `data/synthetic/` | Model-generated examples that passed build + tests |
| `data/eval/` | Held-out test requests. Never train on these |
| `training/` | YOLO weight/data preparation and later LoRA/QLoRA fine-tuning |
| `eval/` | Evaluation harness: build rate, test pass rate, repair loops |
| `docs/` | Architecture, roadmap, decisions |

## Rules

- Split data by whole app, never by random rows, to avoid leakage.
- API keys live only in environment variables or Secret Manager. Never commit them.
- Generated Firestore rules must default to deny.

See `docs/roadmap.md` for phases.

## YOLO data preparation

Install the optional downloader dependency with `python -m pip install -r training/requirements.txt`.
Set `HF_TOKEN` in the environment, then run `python training/scripts/download_yolo_weights.py`
to download the foundational YOLOv8n weights into the ignored `training/weights/` directory.

Use `python training/scripts/dataset_pipeline.py route --source <images> --category gold`
or `--category synthetic` to copy images into their respective `data/` tier. Pass `--labels
<labels-directory>` to validate and copy matching YOLO detection labels. Run the `scan` command
to validate staged labels, or `write-yaml` to regenerate `data/dataset.yaml` with absolute paths.
The map registers the locked `button`, `input`, `header`, `text-block`, and `image-container`
classes.

For labeled UI screenshots, run
`python training/scripts/ingest_ui_data.py --source <images> --labels <labels-directory>`.
The image and matching `.txt` label paths must have the same relative names. The ingestion
script validates YOLO rows, clamps finite box coordinates to `[0, 1]`, routes pairs into
`data/synthetic/images/` and `data/synthetic/labels/` through the shared dataset pipeline,
sets ingested files and the dataset map to mode `644`, and updates `data/dataset.yaml`.

For assisted predictions, run `python training/scripts/auto_label_images.py` to scan
`data/synthetic/images/` for images without a sibling `.txt` file. Predictions are written
beside each image with mode `644`; `--dry-run` runs inference and logs results without writing.
The default class aliases map selected COCO object classes to the five UI tracking components,
so treat these as review-needed seeds: `yolov8n.pt` is a general-object model, not a UI detector.
Use `--class-map <json-file>` to add or override source class names, mapping each to one of
`button`, `input`, `header`, `text-block`, or `image-container`.

Run `python training/scripts/train_yolo.py --dry-run` to validate the weights, absolute dataset
paths, class map, permissions, and baseline training settings without starting training. Run
`python training/scripts/train_yolo.py` to train for 3 epochs on CPU with batch size 4 and
640-pixel images. Both train and validation splits must contain labeled image/label pairs;
checkpoints and other training artifacts go to the ignored `training/runs/` directory. To seed a
small deterministic smoke-test dataset, run `python training/scripts/seed_mock_data.py`; it creates
four synthetic and two gold image/label pairs and refuses to overwrite existing fixtures. The
launcher verifies `best.pt` and `last.pt`, then runs a post-training validation pass. Pass
`--force` to the seeder to replace its named mock fixtures when refreshing the smoke-test data.
