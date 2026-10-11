import { isDeepStrictEqual } from 'node:util';
import { runAndWrite } from './file-writer.js';

const firestoreRules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;

const smokeTestFiles = [
  { path: 'index.html', content: '<!doctype html><main id="app"></main>\n' },
  { path: 'app.js', content: 'document.querySelector("#app").textContent = "UI preview";\n' },
  { path: 'style.css', content: 'body { font-family: sans-serif; }\n' },
  { path: 'backend-api.js', content: 'export function handleRequest() { return { status: 200 }; }\n' },
  { path: 'functions/ui-service.js', content: 'export function listComponents() { return []; }\n' },
  { path: 'firestore.rules', content: firestoreRules },
];

function dryRunFetcher(appSpec, visualProfile) {
  return async (_url, options) => {
    const request = JSON.parse(options.body);
    const prompt = request.contents?.[0]?.parts?.map(({ text }) => text ?? '').join('');
    if (!prompt?.includes(JSON.stringify(appSpec))) {
      throw new Error('Dry-run generator did not receive the transformed AppSpec');
    }
    for (const image of visualProfile.images) {
      for (const detection of image.detections) {
        if (!prompt.includes(detection.class_name)) {
          throw new Error(`Dry-run generator did not receive component token ${detection.class_name}`);
        }
      }
    }
    const payload = {
      candidates: [{
        content: { parts: [{ text: JSON.stringify({ files: smokeTestFiles }) }] },
      }],
    };
    return new Response(JSON.stringify(payload), {
      headers: { 'content-type': 'application/json' },
    });
  };
}

async function readInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function main() {
  const input = await readInput();
  const { appSpec, prompt, outputRoot, dryRun, visualProfile } = input;
  if (!appSpec || typeof prompt !== 'string' || typeof outputRoot !== 'string') {
    throw new TypeError('integration input must include appSpec, prompt, and outputRoot');
  }

  const options = {
    appSpec,
    repoRoot: outputRoot,
  };
  if (dryRun) {
    options.apiKey = 'integration-dry-run';
    options.fetchImpl = dryRunFetcher(appSpec, visualProfile);
  }

  const { result, written } = await runAndWrite(prompt, options);
  if (!isDeepStrictEqual(result.spec, appSpec)) {
    throw new Error('Phase 1 pipeline changed the supplied visual AppSpec');
  }
  console.log(JSON.stringify({
    status: 'complete',
    app_spec: result.spec,
    validation: result.validation,
    repair_attempts: result.repairAttempts,
    written,
  }));
}

main().catch((error) => {
  console.error(`${error.name}: ${error.message}`);
  process.exitCode = 1;
});
