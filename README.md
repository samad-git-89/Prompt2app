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
Replace the placeholder class name in that map before training.
