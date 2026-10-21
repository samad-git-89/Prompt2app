import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { generatePostgresSchema, runPipeline, validateAppSpec, validateGeneratedFiles } from './index.js';
import backendApi from '../api/backend-api.js';
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

function functionCallResponse(name, args) {
  return new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ functionCall: { name, args } }] } }],
  }));
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
    functionCallResponse('generate_app_files', { files: [{ path: '../unsafe.js', content: 'bad' }] }),
    functionCallResponse('generate_app_files', { files: safeFiles }),
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
  assert.equal(calls[0].body.tools, undefined);
  assert.equal(calls[1].body.tools[0].functionDeclarations[0].name, 'generate_app_files');
  assert.equal(calls[1].body.toolConfig.functionCallingConfig.mode, 'ANY');
  assert.deepEqual(
    calls[1].body.tools[0].functionDeclarations[0].parameters.properties.files.items.required,
    ['path', 'content'],
  );
  for (const call of calls) {
    const systemInstruction = call.body.systemInstruction.parts[0].text;
    assert.match(systemInstruction, /friendly, professional AI product collaborator/);
    assert.match(systemInstruction, /only a valid JSON object/);
    assert.match(systemInstruction, /internal machine data/);
    assert.match(systemInstruction, /never a user-facing chat response/);
    assert.match(systemInstruction, /Keep user-facing copy natural/);
    assert.match(systemInstruction, /responsive grid and flexbox layouts/);
    assert.match(systemInstruction, /#0B0F19/);
    assert.match(systemInstruction, /#a5b4fc and #38bdf8/);
    assert.match(systemInstruction, /centered hero banner/);
    assert.match(systemInstruction, /Site, SaaS, and API/);
    assert.match(systemInstruction, /prefers-reduced-motion/);
    assert.match(systemInstruction, /use a dbClient variable/);
    assert.match(systemInstruction, /Never expose secret or service-role keys/);
  }
  assert.match(calls[2].body.contents[0].parts[0].text, /Validation errors to fix/);
  assert.match(calls[1].body.contents[0].parts[0].text, /\/api\/backend-api/);
  const generationPrompt = calls[1].body.contents[0].parts[0].text;
  assert.match(generationPrompt, /const SUPABASE_URL = "https:\/\/dlnsgydsevubdbsfpipg\.supabase\.co"/);
  assert.match(generationPrompt, /const SUPABASE_ANON_KEY = "sb_publishable_PHJsJon2xr4yeXPWxBBaIg_76jD8Op-"/);
  assert.match(generationPrompt, /window\.supabase\.createClient\(SUPABASE_URL, SUPABASE_ANON_KEY\)/);
  assert.match(generationPrompt, /do not fetch \/api\/ui-service\.js for Supabase configuration/);
  assert.match(generationPrompt, /dashboard shell with a persistent navigation sidebar/);
  assert.match(generationPrompt, /premium dark SaaS aesthetic/);
  assert.match(generationPrompt, /centered hero banner flowing into a responsive workspace grid/);
  assert.match(generationPrompt, /category tags named Site, SaaS, and API/);
  assert.match(generationPrompt, /original, high-quality SaaS compositions/);
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
      return functionCallResponse('generate_app_files', { files: safeFiles });
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

test('public page sends chat messages to the same-origin backend route', async () => {
  const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  assert.match(html, /What are we <span class="headline-accent">building\?<\/span>/);
  assert.match(html, /prompt2app/);
  assert.match(html, /data-category="Site"/);
  assert.match(html, /data-category="SaaS"/);
  assert.match(html, /data-category="API"/);
  assert.match(html, /data-prompt=/);
  assert.match(html, /data-category="Site" data-prompt=/);
  assert.match(html, /category-tag\[data-category="\$\{button\.dataset\.category\}"\]/);
  assert.match(html, /let currentUXState = 'idle'/);
  assert.match(html, /currentUXState = nextState/);
  assert.match(html, /document\.body\.dataset\.uxState = currentUXState/);
  assert.match(html, /conversation-panel/);
  assert.match(html, /clarification-pane/);
  assert.match(html, /quick-reply/);
  assert.match(html, /followup-composer/);
  assert.match(html, /setUXState\('gathering_specs'\)/);
  assert.match(html, /document\.body\.dataset\.uxState = currentUXState/);
  assert.match(html, /void saveUserMessage\(`Interaction: selected \$\{selectedCategory\}`\)/);
  assert.doesNotMatch(html, /ChatBuilder|Welcome to ChatBuilder|prototype of the Chat-Builder Zoho UI/);
  assert.match(html, /fetch\(['"]\/api\/backend-api['"]/);
  assert.match(html, /method:\s*'POST'/);
  assert.doesNotMatch(html, /mode:\s*['"]cors['"]/);
  assert.match(html, /body:\s*JSON\.stringify\(\{\s*message:\s*buildConversationPrompt\(\)\s*\}\)/);
  assert.doesNotMatch(html, /fetch\(['"]\/api\/ui-service\.js['"]/);
  assert.doesNotMatch(html, /effective-space-orbit-jj4q4pwgw9wrf4gq-5001\.app\.github\.dev/);
  assert.match(html, /const SUPABASE_URL = "https:\/\/dlnsgydsevubdbsfpipg\.supabase\.co"/);
  assert.match(html, /const SUPABASE_ANON_KEY = "sb_publishable_PHJsJon2xr4yeXPWxBBaIg_76jD8Op-"/);
  assert.match(html, /window\.supabase\.createClient\(SUPABASE_URL, SUPABASE_ANON_KEY\)/);
  assert.match(html, /let dbClient;/);
  assert.match(html, /dbClient = window\.supabase\.createClient\(SUPABASE_URL, SUPABASE_ANON_KEY\)/);
  assert.match(html, /responseBubble\.textContent = data\.response/);
  assert.match(html, /class="chat-feed" id="chat-feed"[^>]*aria-live="polite"/);
  assert.match(html, /background: #2563eb/);
  assert.match(html, /ai-message-row/);
  assert.match(html, /user-avatar/);
  assert.match(html, /ai-avatar/);
  assert.match(html, /Copy text/);
  assert.match(html, /Thumbs Up/);
  assert.match(html, /Thumbs Down/);
  assert.match(html, /chatFeed\.scrollTo\(\{\s*top:\s*chatFeed\.scrollHeight,\s*behavior:\s*'smooth'\s*\}\)/);
  assert.match(html, /addResponseUtilities\(assistantMessage\.messageContent, data\.response\)/);
  assert.match(html, /responseBubble\.textContent = `Sorry, I couldn't get a response just now\. \$\{error\.message\}`/);
  assert.match(html, /from\('chat_messages'\)[\s\S]*?insert\(\{\s*content:\s*message\s*\}\)/);
  assert.match(html, /void saveUserMessage\(message\)/);
  assert.match(html, /id="chat-input"/);
  assert.match(html, /getElementById\('chat-input'\)/);
  assert.match(html, /id="send-btn"/);
  assert.match(html, /getElementById\('send-btn'\)/);
  assert.match(html, /chatComposer\.addEventListener\('submit'/);
  assert.match(html, /event\.preventDefault\(\);\s*void sendMessage\(undefined, chatInput, sendButton\)/);
  assert.match(html, /followupComposer\.addEventListener\('submit'/);
  assert.match(html, /void sendMessage\(undefined, followupInput, followupSubmit\)/);
  assert.match(html, /void saveUserMessage\(message\)/);
  assert.match(html, /void saveUserMessage\(`Feedback: \$\{label\}`\)/);
  assert.doesNotMatch(html, /\blet supabase\b|\bsupabase\.auth/);
  assert.doesNotMatch(html, /YOUR_SUPABASE_(?:URL|ANON_KEY)/);
});

test('backend route sends chat requests to Gemini using a server-side key', async () => {
  const previousApiKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url: String(url), headers: options.headers, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'Structured response' }] } }],
    }), { headers: { 'content-type': 'application/json' } });
  };

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
    await backendApi({ method: 'POST', body: { message: 'Build a dashboard' } }, response);
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body, { response: 'Structured response' });
    assert.equal(request.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent');
    assert.equal(request.headers['x-goog-api-key'], 'test-gemini-key');
    assert.equal(request.body.contents[0].parts[0].text, 'Build a dashboard');
    assert.match(request.body.systemInstruction.parts[0].text, /friendly, professional AI product collaborator/);
    assert.match(request.body.systemInstruction.parts[0].text, /Do not show code blocks, raw JSON, YAML/);
    assert.equal(request.body.generationConfig.maxOutputTokens, 1536);
    assert.equal(request.body.generationConfig.temperature, 0.7);
    assert.equal(request.body.generationConfig.topP, 0.9);
    assert.equal(request.body.generationConfig.responseMimeType, 'text/plain');
    assert.match(request.body.systemInstruction.parts[0].text, /public chat endpoint has no workspace file tools/);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousApiKey;
  }
});

test('pipeline rejects unrequested Gemini function calls', async () => {
  await assert.rejects(
    runPipeline({
      prompt: 'Build a task app',
      appSpec: validSpec,
      apiKey: 'test-key',
      fetchImpl: async () => functionCallResponse('write_workspace_code', { files: safeFiles }),
    }),
    /did not call the required generate_app_files function/,
  );
});

test('pipeline rejects malformed Gemini function-call arguments', async () => {
  await assert.rejects(
    runPipeline({
      prompt: 'Build a task app',
      appSpec: validSpec,
      apiKey: 'test-key',
      fetchImpl: async () => functionCallResponse('generate_app_files', []),
    }),
    /invalid arguments for generate_app_files/,
  );
});

test('backend route rejects invalid messages and reports missing Gemini configuration', async () => {
  const previousApiKey = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;

  function makeResponse() {
    return {
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        this.body = body;
        return this;
      },
    };
  }

  try {
    const invalidResponse = makeResponse();
    await backendApi({ method: 'POST', body: { message: '  ' } }, invalidResponse);
    assert.equal(invalidResponse.statusCode, 400);

    const missingKeyResponse = makeResponse();
    await backendApi({ method: 'POST', body: { message: 'Hello' } }, missingKeyResponse);
    assert.equal(missingKeyResponse.statusCode, 500);
    assert.deepEqual(missingKeyResponse.body, { error: 'AI service is not configured.' });
  } finally {
    if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousApiKey;
  }
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