import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePostgresSchema, runPipeline, validateAppSpec, validateGeneratedFiles } from './index.js';

const validSpec = {
  name: 'Task list',
  description: 'A personal task list',
  auth: 'none',
  pages: [{ route: '/', purpose: 'Manage tasks', components: ['button', 'input', 'header', 'text-block', 'image-container'] }],
  data_models: [{ table: 'tasks', fields: [{ name: 'title', type: 'string', required: true }] }],
};

const safeFiles = [{ path: 'src/main.js', content: 'export {};\n' }];

function jsonResponse(value) {
  return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(value) }] } }] }));
}

test('validates AppSpec against the repository schema', () => {
  assert.deepEqual(validateAppSpec(validSpec), []);
  assert.notDeepEqual(validateAppSpec({ name: 'missing required fields' }), []);
});

test('rejects unsafe paths, embedded credentials, and missing PostgreSQL schema for models', () => {
  const errors = validateGeneratedFiles([
    { path: '../secret.txt', content: 'nope' },
    { path: 'src/key.js', content: 'const key = "AIza123456789012345678901234567890123456";' },
    { path: 'firestore.rules', content: 'legacy' },
  ], { requireDatabaseSchema: true });
  assert.ok(errors.some((error) => error.includes('safe relative path')));
  assert.ok(errors.some((error) => error.includes('PostgreSQL table DDL')));
  assert.ok(errors.some((error) => error.includes('credential')));
  assert.ok(errors.some((error) => error.includes('legacy Firebase configuration')));
});

test('generates deterministic PostgreSQL DDL from AppSpec table models', () => {
  assert.equal(
    generatePostgresSchema(validSpec.data_models),
    'CREATE TABLE IF NOT EXISTS "tasks" (\n'
      + '  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid(),\n'
      + '  "title" text NOT NULL\n'
      + ');\nALTER TABLE "tasks" ENABLE ROW LEVEL SECURITY;\n',
  );
});

test('repairs invalid generated files and returns a validated result', async () => {
  const calls = [];
  const responses = [
    jsonResponse(validSpec),
    jsonResponse({ files: [{ path: '../unsafe.js', content: 'bad' }] }),
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
  assert.equal(result.files.find(({ path }) => path === 'supabase/schema.sql').content, generatePostgresSchema(validSpec.data_models));
  assert.equal(result.spec.pages[0].components.join(','), validSpec.pages[0].components.join(','));
  assert.equal(calls.length, 3);
  assert.equal(calls[0].url.includes('test-key'), false);
  assert.equal(calls[0].headers['x-goog-api-key'], 'test-key');
  assert.match(calls[2].body.contents[0].parts[0].text, /Validation errors to fix/);
});

test('uses a supplied AppSpec directly without making a separate spec request', async () => {
  const calls = [];
  const result = await runPipeline({
    prompt: 'Generate a prototype from the supplied layout',
    appSpec: validSpec,
    apiKey: 'test-key',
    fetchImpl: async (_url, options) => {
      calls.push(JSON.parse(options.body));
      return jsonResponse({ files: safeFiles });
    },
  });

  assert.deepEqual(result.spec, validSpec);
  assert.equal(result.validation.valid, true);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].contents[0].parts[0].text.includes(JSON.stringify(validSpec)));
});

test('rejects an invalid supplied AppSpec before requesting generated files', async () => {
  let calls = 0;
  await assert.rejects(
    runPipeline({
      prompt: 'Generate a prototype',
      appSpec: { name: 'incomplete' },
      apiKey: 'test-key',
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ files: safeFiles });
      },
    }),
    /Provided AppSpec is invalid/,
  );
  assert.equal(calls, 0);
});

test('enforces the five locked component tokens during AppSpec validation', () => {
  assert.deepEqual(validateAppSpec(validSpec), []);
  assert.ok(validateAppSpec({
    ...validSpec,
    pages: [{ ...validSpec.pages[0], components: ['TaskList'] }],
  }).some((error) => error.includes('must be equal to one of the allowed values')));
});

test('rejects legacy collection-based data model specs', () => {
  const legacyModelSpec = {
    ...validSpec,
    data_models: [{ collection: 'tasks', fields: [{ name: 'title', type: 'string' }] }],
  };
  assert.ok(validateAppSpec(legacyModelSpec).length > 0);
});