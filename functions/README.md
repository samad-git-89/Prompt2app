# Generation pipeline

The pipeline uses the Gemini API to turn a request into a validated AppSpec, generate starter files, validate the files, and request up to three repairs. PostgreSQL DDL is generated deterministically from `data_models` and written to `supabase/schema.sql`; row-level security is enabled for each generated table. The five locked UI component tokens are validated by the AppSpec schema.

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

The writer routes browser assets to root `public/` (or preserves explicit `src/` paths), server handlers to root `api/`, and database DDL to `supabase/`. It validates all content, refuses existing target paths, and writes every generated file with mode `644`.

For a fresh generation when frontend files already exist, pass `--backend-only` to write only newly generated API files whose basename starts with `backend-`:

```sh
npm --prefix functions run write -- --backend-only "Build a full-stack app with server-side business logic"
```