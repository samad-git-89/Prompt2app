# Architecture (draft)

User (web UI, Firebase Hosting)
  -> Cloud Functions orchestrator (holds all keys)
     -> Gemini API (planner + generator)
     -> Optional Hugging Face endpoint (cheap tier / fine-tuned specialist)
     -> Validator (lint, build, Firestore rules check, secrets scan)
     -> Firestore (projects, versions, specs, logs)
     -> Apps Script API (Workspace automation deploy)

Long jobs run asynchronously (queue) and the UI listens to Firestore for progress.
