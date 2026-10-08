# Local Execution Tracker

`tracker.js` captures append-only execution history as JSON Lines under `.local/executions.jsonl`. Records include model parameters, timestamps, validation and repair summaries, prompt hashes, generated-file hashes, and an optional Git commit. Prompt text and generated source are not stored; model parameters are allow-listed to prevent accidental API-key logging. Log files are created with mode `0600`.

```js
import { recordExecution } from './tracker.js';

await recordExecution({
  model: 'gemini-2.5-flash',
  parameters: { temperature: 0.2, maxOutputTokens: 4096 },
  prompt: 'Build a reading list app',
  repairAttempts: 0,
  validation: { valid: true, errors: [] },
  files: [{ path: 'web/index.html', content: '<main>Reading list</main>' }],
  gitCommit: process.env.GIT_COMMIT ?? null,
});
```

Run native checks with `npm test` from this directory. The record shape is described in `tracker.schema.json`.