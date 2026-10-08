# Phase 1 Functions

The prompt-only pipeline uses the Gemini API to turn a request into an AppSpec, generate starter files, validate the files, and request up to three repairs. It returns generated files in memory; it does not write them to disk or execute them.

Set `GEMINI_API_KEY` in the process environment. For local development, add it to the ignored repository-root `.env` file based on `.env.example`.

Run the pipeline from this directory:

```sh
node --env-file=../.env --input-type=module -e "import { runPipeline } from './index.js'; const result = await runPipeline({ prompt: 'Build a simple task list' }); console.log(JSON.stringify(result, null, 2));"
```

Run the tests without calling Gemini:

```sh
npm ci
npm test
```

Generated Firestore rules are required to contain a catch-all deny rule, and every `allow` statement must remain `false` in this phase.

Generate and write files from the repository root:

```sh
npm --prefix functions run write -- "Build a simple task list"
```

The writer routes browser files to `web/`, `functions/` or `backend/` files to `functions/generated/`, and `firestore.rules` to the repository root. It validates all content, refuses existing target paths, and creates source files without execute permissions.

For a fresh generation when frontend files already exist, pass `--backend-only` to write only newly generated files whose basename starts with `backend-`:

```sh
npm --prefix functions run write -- --backend-only "Build a full-stack app with server-side business logic"
```