import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generatePostgresSchema, runPipeline, validateAppSpec, validateGeneratedFiles } from './index.js';
import uiService from '../api/ui-service.js';

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
  for (const call of calls) {
    const systemInstruction = call.body.systemInstruction.parts[0].text;
    assert.match(systemInstruction, /elite Full-Stack Code Authoring Engine/);
    assert.match(systemInstruction, /only a valid JSON object/);
    assert.match(systemInstruction, /responsive grid and flexbox layouts/);
    assert.match(systemInstruction, /use a dbClient variable/);
    assert.match(systemInstruction, /Never expose secret or service-role keys/);
  }
  assert.match(calls[2].body.contents[0].parts[0].text, /Validation errors to fix/);
  assert.match(calls[1].body.contents[0].parts[0].text, /\/api\/backend-api\.js/);
  const generationPrompt = calls[1].body.contents[0].parts[0].text;
  assert.match(generationPrompt, /const SUPABASE_URL = "https:\/\/dlnsgydsevubdbsfpipg\.supabase\.co"/);
  assert.match(generationPrompt, /const SUPABASE_ANON_KEY = "sb_publishable_PHJsJon2xr4yeXPWxBBaIg_76jD8Op-"/);
  assert.match(generationPrompt, /window\.supabase\.createClient\(SUPABASE_URL, SUPABASE_ANON_KEY\)/);
  assert.match(generationPrompt, /do not fetch \/api\/ui-service\.js for Supabase configuration/);
  assert.match(generationPrompt, /dashboard shell with a persistent navigation sidebar/);
  assert.match(generationPrompt, /dedicated, interactive chat-feed panel/);
  assert.match(generationPrompt, /8px-or-greater corner radii.*box-shadows.*0\.2s ease/);
  assert.match(generationPrompt, /fluid flexbox-based layout sizing.*desktop and laptop/);
  assert.match(generationPrompt, /user message in its own user bubble.*assistant response tokens.*AI response block/);
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

test('UI service returns the environment-backed browser Supabase configuration', async () => {
  const previousUrl = process.env.SUPABASE_URL;
  const previousAnonKey = process.env.SUPABASE_ANON_KEY;
  const previousFallbackUrl = process.env.NEXT_PUBLIC_SUPABASE_URL_LIVE;
  const previousFallbackAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_LIVE;
  process.env.SUPABASE_URL = 'https://project.example.supabase.co';
  process.env.SUPABASE_ANON_KEY = 'test-anon-key';
  delete process.env.NEXT_PUBLIC_SUPABASE_URL_LIVE;
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_LIVE;

  const response = {
    headers: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  try {
    await uiService({ method: 'GET' }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.supabaseConfig, {
      url: 'https://project.example.supabase.co',
      anonKey: 'test-anon-key',
    });
  } finally {
    if (previousUrl === undefined) delete process.env.SUPABASE_URL;
    else process.env.SUPABASE_URL = previousUrl;
    if (previousAnonKey === undefined) delete process.env.SUPABASE_ANON_KEY;
    else process.env.SUPABASE_ANON_KEY = previousAnonKey;
    if (previousFallbackUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL_LIVE;
    else process.env.NEXT_PUBLIC_SUPABASE_URL_LIVE = previousFallbackUrl;
    if (previousFallbackAnonKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_LIVE;
    else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_LIVE = previousFallbackAnonKey;
  }
});

test('UI service falls back to valid Supabase alias variables when primary values are invalid', async () => {
  const envNames = [
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY',
    'NEXT_PUBLIC_SUPABASE_URL_LIVE',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY_LIVE',
  ];
  const previousValues = new Map(envNames.map((name) => [name, process.env[name]]));
  process.env.SUPABASE_URL = 'not-a-url';
  process.env.SUPABASE_ANON_KEY = '  ';
  process.env.NEXT_PUBLIC_SUPABASE_URL_LIVE = 'https://fallback-project.supabase.co';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_LIVE = 'fallback-anon-key';

  const response = {
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  try {
    await uiService({ method: 'GET' }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.supabaseConfig, {
      url: 'https://fallback-project.supabase.co',
      anonKey: 'fallback-anon-key',
    });
  } finally {
    for (const [name, value] of previousValues) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test('public page persists chat messages directly through the Supabase browser client', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.doesNotMatch(html, /fetch\(['"]\/api\/backend-api\.js['"]/);
  assert.doesNotMatch(html, /fetch\(['"]\/api\/ui-service\.js['"]/);
  assert.match(html, /const SUPABASE_URL = "https:\/\/dlnsgydsevubdbsfpipg\.supabase\.co"/);
  assert.match(html, /const SUPABASE_ANON_KEY = "sb_publishable_PHJsJon2xr4yeXPWxBBaIg_76jD8Op-"/);
  assert.match(html, /window\.supabase\.createClient\(SUPABASE_URL, SUPABASE_ANON_KEY\)/);
  assert.match(html, /let dbClient;/);
  assert.match(html, /dbClient = window\.supabase\.createClient\(SUPABASE_URL, SUPABASE_ANON_KEY\)/);
  assert.match(html, /dbClient\s*\.from\('chat_messages'\)\s*\.insert\(\{\s*content: message\s*\}\)/);
  assert.match(html, /Message processed successfully\. Client-side handshake complete on live database partition!/);
  assert.match(html, /id="chat-input"/);
  assert.match(html, /getElementById\('chat-input'\)/);
  assert.match(html, /id="send-btn"/);
  assert.match(html, /getElementById\('send-btn'\)/);
  assert.match(html, /sendButton\.addEventListener\('click', handleSendClick\)/);
  assert.match(html, /chatInput\.addEventListener\('keydown'/);
  assert.match(html, /e\.key === 'Enter'[\s\S]*?sendButton\.click\(\)/);
  assert.match(html, /console\.log\('User submitted message:', message\)/);
  assert.match(html, /chatComposer\.addEventListener\('submit'/);
  assert.match(html, /responseBubble\.textContent = 'Message processed successfully\. Client-side handshake complete on live database partition!'/);
  assert.doesNotMatch(html, /\blet supabase\b|\bsupabase\.auth/);
  assert.doesNotMatch(html, /YOUR_SUPABASE_(?:URL|ANON_KEY)/);
});

test('chat message schema restricts anonymous users to validated inserts', async () => {
  const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  assert.match(schema, /create table if not exists public\.chat_messages/);
  assert.match(schema, /enable row level security/i);
  assert.match(schema, /revoke all on table public\.chat_messages from public, anon, authenticated/i);
  assert.match(schema, /grant insert on table public\.chat_messages to anon/i);
  assert.match(schema, /for insert\s+to anon\s+with check \(char_length\(btrim\(content\)\) between 1 and 4000\)/i);
});

test('rejects legacy collection-based data model specs', () => {
  const legacyModelSpec = {
    ...validSpec,
    data_models: [{ collection: 'tasks', fields: [{ name: 'title', type: 'string' }] }],
  };
  assert.ok(validateAppSpec(legacyModelSpec).length > 0);
});