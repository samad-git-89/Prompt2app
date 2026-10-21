# Generation pipeline

The pipeline uses the Gemini API to turn a request into a validated AppSpec, generate starter files through a forced `generate_app_files` function call, validate the files, and request up to three repairs. It does not ask follow-up questions: it infers conventional defaults and builds immediately. Tool calls return structured file data only; the separate local writer validates paths and contents before writing. The public chat endpoint cannot access this local writer or the workspace.

PostgreSQL DDL is generated deterministically for every app, including apps with no custom data models. It includes owner-scoped `app_versions`, `app_files`, and `app_file_versions` tables; custom data-model tables also receive an `auth.users` owner, RLS, per-operation owner policies, and authenticated-only grants. Generated apps that persist private data must use Supabase Auth. The pipeline also supplies a Vercel rewrite configuration for `public/` assets and `api/` handlers; this makes the output deployment-ready but does not deploy it.

Set `GEMINI_API_KEY` in the process environment. For local development, copy the placeholders from the repository-root `.env.example` into the ignored `.env` file and fill in the credentials required for the task.

Run the pipeline from this directory:

```sh
node --env-file=../.env --input-type=module -e "import { runPipeline } from './index.js'; const result = await runPipeline({ prompt: 'Build a simple task list' }); console.log(JSON.stringify(result, null, 2));"
```

Run the tests without calling Gemini:

```sh
npm ci
npm test
```

Generate and write files from the repository root:

```sh
npm --prefix functions run write -- "Build a simple task list"
```

The writer routes browser assets to root `public/` (or preserves explicit `src/` paths), server handlers to root `api/`, and database DDL to `supabase/`. It validates all content, refuses existing target paths by default, and writes every generated file with mode `644`. The local `npm run write` command explicitly approves atomic replacement of files included in that generation; unrelated existing files remain untouched. Each successful write transaction records a hash/change matrix in the ignored `.prompt2app/version-history.json`; previous non-secret files are snapshotted under `.prompt2app/versions/` for local recovery. The internal history directory is reserved and generated app files cannot target it.

For a fresh generation when frontend files already exist, pass `--backend-only` to write only newly generated API files whose basename starts with `backend-`:

```sh
npm --prefix functions run write -- --backend-only "Build a full-stack app with server-side business logic"
```