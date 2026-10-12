# Architecture (draft)

User (web UI, Vercel)
  -> Vercel API handlers / orchestrator (holds all keys)
     -> Gemini API (planner + generator)
     -> Optional Hugging Face endpoint (cheap tier / fine-tuned specialist)
     -> Validator (lint, build, PostgreSQL schema check, secrets scan)
     -> Supabase (PostgreSQL, Auth, REST)
     -> Apps Script API (Workspace automation deploy)

Generated browser assets are written under `public/` or `src/`, server handlers under `api/`,
and PostgreSQL table definitions under `supabase/schema.sql`. Generated tables enable row-level
security by default.

Long jobs run asynchronously (queue) and the UI listens to Supabase for progress.
