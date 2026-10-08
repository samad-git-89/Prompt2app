import test from 'node:test';
import assert from 'node:assert/strict';
import { runPipeline, validateAppSpec, validateGeneratedFiles } from './index.js';

const validSpec = {
  name: 'Task list',
  description: 'A personal task list',
  auth: 'none',
  pages: [{ route: '/', purpose: 'Manage tasks', components: ['TaskList'] }],
  data_models: [{ collection: 'tasks', fields: [{ name: 'title', type: 'string', required: true }] }],
};

const safeRules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;

const safeFiles = [{ path: 'firestore.rules', content: safeRules }, { path: 'src/main.js', content: 'export {};\n' }];

function jsonResponse(value) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }));
}

test('validates AppSpec against the repository schema', () => {
  assert.deepEqual(validateAppSpec(validSpec), []);
  assert.notDeepEqual(validateAppSpec({ name: 'missing required fields' }), []);
});

test('rejects unsafe paths, embedded credentials, and missing deny-all rules', () => {
  const errors = validateGeneratedFiles([
    { path: '../secret.txt', content: 'nope' },
    {
      path: 'firestore.rules',
      content: 'match /{document=**} { allow read, write: if false; allow read: if request.auth != null; }',
    },
    { path: 'src/key.js', content: 'const key = "AIza123456789012345678901234567890123456";' },
  ]);
  assert.ok(errors.some((error) => error.includes('safe relative path')));
  assert.ok(errors.some((error) => error.includes('every Firestore allow rule')));
  assert.ok(errors.some((error) => error.includes('credential')));
});

test('repairs invalid generated files and returns a validated result', async () => {
  const calls = [];
  const responses = [
    jsonResponse(validSpec),
    jsonResponse({ files: [{ path: 'firestore.rules', content: 'allow read, write: if true;' }] }),
    jsonResponse({ files: safeFiles }),
  ];

  const result = await runPipeline({
    prompt: 'Build a simple task list',
    apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      calls.push({ url: String(_url), headers: options.headers, body: JSON.parse(options.body) });
      return responses.shift();
    },
  });

  assert.equal(result.validation.valid, true);
  assert.equal(result.repairAttempts, 1);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url.includes('test-key'), false);
  assert.equal(calls[0].headers['x-goog-api-key'], 'test-key');
  assert.match(calls[2].body.contents[0].parts[0].text, /Validation errors to fix/);
});