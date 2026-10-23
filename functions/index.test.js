import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import {
  generatePostgresSchema,
  runPipeline,
  runVisionInference,
  validateAppSpec,
  validateGeneratedFiles,
} from './index.js';
import backendApi from '../api/backend-api.js';
import uiService from '../api/ui-service.js';

const validSpec = {
  name: 'Task list',
  description: 'A personal task list',
  auth: 'none',
  pages: [{ route: '/', purpose: 'Manage tasks', components: ['button', 'input', 'header', 'text-block', 'image-container'] }],
  data_models: [{ table: 'tasks', fields: [{ name: 'title', type: 'string', required: true }] }],
};

const safeFiles = [
  { path: 'src/main.js', content: 'export {};\n' },
  { path: 'public/index.html', content: '<!doctype html><html><body><main>App</main></body></html>\n' },
];

const visionResult = {
  status: 'ok',
  image: 'dashboard.png',
  width: 960,
  height: 640,
  classes: ['sidebar', 'dashboard_card', 'input_field', 'action_button', 'chat_feed']
    .map((class_name, class_id) => ({ class_id, class_name })),
  bounding_box_format: 'xyxy_pixels',
  detections: [{
    class_id: 0,
    class_name: 'sidebar',
    confidence_percent: 98.2,
    bounding_box: {
      x1: 0,
      y1: 0,
      x2: 190,
      y2: 640,
      format: 'xyxy',
      units: 'pixels',
    },
  }],
};

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

test('vision child process receives the image path as an argument and returns validated JSON', async () => {
  let command;
  let args;
  let options;
  const result = await runVisionInference('/tmp/dashboard.png', {
    spawnImpl: (spawnCommand, spawnArgs, spawnOptions) => {
      command = spawnCommand;
      args = spawnArgs;
      options = spawnOptions;
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.kill = () => true;
      setImmediate(() => {
        child.stdout.end(JSON.stringify(visionResult));
        child.stderr.end();
        setImmediate(() => child.emit('close', 0, null));
      });
      return child;
    },
  });

  assert.equal(command, 'python3');
  assert.deepEqual(args.slice(-2), ['--image', '/tmp/dashboard.png']);
  assert.equal(args[0].endsWith('/training/inference_pipeline.py'), true);
  assert.equal(options.cwd.replace(/\/$/, '').endsWith('/Prompt2app'), true);
  assert.deepEqual(result, visionResult);
});

test('pipeline injects validated vision layout JSON into Gemini system context', async () => {
  let requestBody;
  const result = await runPipeline({
    prompt: 'Recreate this dashboard',
    appSpec: validSpec,
    imagePath: '/tmp/dashboard.png',
    apiKey: 'test-key',
    visionInference: async (imagePath) => {
      assert.equal(imagePath, '/tmp/dashboard.png');
      return visionResult;
    },
    fetchImpl: async (_url, options) => {
      requestBody = JSON.parse(options.body);
      return functionCallResponse('generate_app_files', { files: safeFiles });
    },
  });

  assert.equal(result.validation.valid, true);
  const systemInstruction = requestBody.systemInstruction.parts[0].text;
  assert.match(systemInstruction, /high-confidence structured UI layout context/);
  assert.match(systemInstruction, /exact absolute pixel bounding-box coordinates/);
  assert.match(systemInstruction, /premium slate\/charcoal dashboard CSS views/);
  assert.match(systemInstruction, /"x2":190/);
  assert.match(systemInstruction, /"y2":640/);
});

test('pipeline continues with text-only Gemini generation when vision inference fails', async () => {
  let requestBody;
  const warnings = [];
  const previousWarn = console.warn;
  console.warn = (...args) => warnings.push(args);

  try {
    const result = await runPipeline({
      prompt: 'Recreate this dashboard from the text description',
      appSpec: validSpec,
      imagePath: '/vercel/path/to/dashboard.png',
      apiKey: 'test-key',
      visionInference: async () => {
        throw new Error('Unable to start vision inference: spawn python3 ENOENT');
      },
      fetchImpl: async (_url, options) => {
        requestBody = JSON.parse(options.body);
        return functionCallResponse('generate_app_files', { files: safeFiles });
      },
    });

    assert.equal(result.validation.valid, true);
    const systemInstruction = requestBody.systemInstruction.parts[0].text;
    assert.doesNotMatch(systemInstruction, /high-confidence structured UI layout context/);
    assert.match(requestBody.contents[0].parts[0].text, /Recreate this dashboard from the text description/);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0][0], /continuing with text prompt only/);
    assert.match(warnings[0][1].message, /ENOENT/);
  } finally {
    console.warn = previousWarn;
  }
});

test('rejects unsafe paths, embedded credentials, and missing PostgreSQL schema for models', () => {
  assert.ok(validateGeneratedFiles(
    [{ path: 'src/main.js', content: 'export {};\n' }],
    { requireApplicationEntryPoint: true },
  ).some((error) => error.includes('public/index.html')));
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
  const schema = generatePostgresSchema(validSpec.data_models);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.app_versions/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.app_files/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.app_file_versions/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\."tasks"/);
  assert.match(schema, /"owner_id" uuid NOT NULL REFERENCES auth\.users\(id\) ON DELETE CASCADE/);
  assert.match(schema, /ALTER TABLE public\."tasks" ENABLE ROW LEVEL SECURITY/);
  assert.match(schema, /FOR SELECT TO authenticated USING \(\(select auth\.uid\(\)\) = "owner_id"\)/);
  assert.match(schema, /FOR UPDATE TO authenticated .*WITH CHECK \(\(select auth\.uid\(\)\) = "owner_id"\)/);
  assert.match(schema, /REVOKE ALL ON TABLE public\."tasks" FROM PUBLIC, anon, authenticated/);
  assert.match(schema, /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public\."tasks" TO authenticated/);
});

test('always creates a secure PostgreSQL version schema when the AppSpec has no models', () => {
  const schema = generatePostgresSchema([]);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.app_versions/);
  assert.match(schema, /CREATE TABLE IF NOT EXISTS public\.app_file_versions/);
  assert.match(schema, /ALTER TABLE public\.app_file_versions ENABLE ROW LEVEL SECURITY/);
  assert.match(schema, /CREATE POLICY app_file_versions_owner_insert/);
  assert.doesNotMatch(schema, /\bTO anon\b/);
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
  assert.ok(result.files.some(({ path }) => path === 'public/index.html'));
  assert.equal(result.repairAttempts, 1);
  assert.equal(result.files.find(({ path }) => path === 'supabase/schema.sql').content, generatePostgresSchema(validSpec.data_models));
  assert.match(result.files.find(({ path }) => path === 'vercel.json').content, /"source": "\/api\/\(\.\*\)"/);
  const appMetadata = JSON.parse(result.files.find(({ path }) => path === 'app.metadata.json').content);
  assert.deepEqual(appMetadata, {
    schemaVersion: 1,
    appVersion: '1.0.0',
    appName: validSpec.name,
    changeSummary: 'Initial generated release',
    versionHistory: {
      storage: 'supabase.app_versions',
      fileSnapshots: 'supabase.app_file_versions',
      iterativeEdits: true,
    },
  });
  assert.match(calls[0].body.contents[0].parts[0].text, /Do not ask the user clarifying questions/);
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
    assert.match(systemInstruction, /detailed Web Application component specification.*compile it into the requested application files immediately/);
    assert.match(systemInstruction, /complete public\/index\.html entry point and supabase\/schema\.sql/);
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
  assert.match(generationPrompt, /Do not ask follow-up questions/);
  assert.match(generationPrompt, /Do not wait for or require keywords such as “proceed”, “build”, or “start”/);
  assert.match(generationPrompt, /Do not put terminal commands, shell scripts, local CLI instructions/);
  assert.match(generationPrompt, /detailed component specification as an implementation contract.*complete application files, not a text summary/);
  assert.match(generationPrompt, /complete, functional public\/index\.html application entry point/);
  assert.match(generationPrompt, /timestamp, category, severity, source, message, and feedback/);
  assert.match(generationPrompt, /dashboard feed ordered newest-first/);
  assert.match(generationPrompt, /interactive trend line charts with selectable time ranges/);
  assert.match(generationPrompt, /“Export Log” action that downloads the visible log data as correctly escaped CSV/);
  assert.match(generationPrompt, /Always include the generated app database asset at supabase\/schema\.sql, even when the AppSpec has no custom data models/);
  assert.match(generationPrompt, /per-operation policies scoped to auth\.uid\(\) ownership/);
  assert.match(generationPrompt, /valid vercel\.json with same-origin rewrites/);
  assert.match(generationPrompt, /immutable version snapshots/);
  assert.match(generationPrompt, /Generate all four end-user capabilities by default/);
  assert.match(generationPrompt, /file metadata, version records, and versioned file snapshots/);
  assert.match(generationPrompt, /explicit storage\.objects policies/);
  assert.match(generationPrompt, /viewing version history, comparing change summaries, and restoring/);
  assert.match(generationPrompt, /same-origin rewrites/);
  assert.match(generationPrompt, /clean relative URLs such as \/api\/<handler>/);
  assert.match(generationPrompt, /require custom routing\/build configuration beyond the generated files/);
  assert.match(generationPrompt, /app\.metadata\.json release manifest/);
  assert.match(generationPrompt, /metadata comment to public\/index\.html and backend entry files/);
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

test('public page sends chat messages to the same-origin backend and safely handles non-JSON errors', async () => {
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
  assert.doesNotMatch(html, /\bisBuildIntent\b|const isBuildIntent\s*=/);
  assert.match(html, /document\.body\.dataset\.uxState = currentUXState/);
  assert.doesNotMatch(html, /ChatBuilder|Welcome to ChatBuilder|prototype of the Chat-Builder Zoho UI/);
  assert.match(html, /fetch\(['"]\/api\/backend-api['"]/);
  assert.match(html, /method:\s*'POST'/);
  assert.match(html, /body:\s*JSON\.stringify\(\{\s*message:\s*buildConversationPrompt\(\)\s*\}\)/);
  assert.doesNotMatch(html, /fetch\(['"]\/api\/ui-service\.js['"]/);
  assert.match(html, /const responseText = await response\.text\(\)/);
  assert.match(html, /data = JSON\.parse\(responseText\)/);
  assert.match(html, /The app server returned an unexpected response\. Please try again later\./);
  assert.match(html, /data\.error \|\| data\.response \|\| `Request failed/);
  assert.doesNotMatch(html, /dbClient|saveUserMessage|\.from\(|\.insert\(/);
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
  assert.match(html, /id="chat-input"/);
  assert.match(html, /getElementById\('chat-input'\)/);
  assert.match(html, /id="send-btn"/);
  assert.match(html, /getElementById\('send-btn'\)/);
  assert.match(html, /chatComposer\.addEventListener\('submit'/);
  assert.match(html, /event\.preventDefault\(\);\s*void sendMessage\(undefined, chatInput, sendButton\)/);
  assert.match(html, /followupComposer\.addEventListener\('submit'/);
  assert.match(html, /void sendMessage\(undefined, followupInput, followupSubmit\)/);
  assert.doesNotMatch(html, /\blet supabase\b|\bsupabase\.auth/);
});

test('backend route sends chat requests to Gemini using a server-side key', async () => {
  const previousApiKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  let request;
  globalThis.fetch = async (url, options) => {
    const requestData = url instanceof Request ? url : new Request(url, options);
    request = {
      url: requestData.url,
      headers: Object.fromEntries(requestData.headers.entries()),
      body: JSON.parse(await requestData.clone().text()),
    };
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
    assert.match(request.url, /generativelanguage\.googleapis\.com\/.*models\/gemini-2\.5-flash:generateContent/);
    assert.match(JSON.stringify(request.headers), /test-gemini-key/);
    assert.match(JSON.stringify(request.body), /Build a dashboard/);
    assert.match(JSON.stringify(request.body), /friendly, professional AI product collaborator/);
    assert.equal(request.body.generationConfig.maxOutputTokens, 1536);
    assert.equal(request.body.generationConfig.temperature, 0.7);
    assert.equal(request.body.generationConfig.topP, 0.9);
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousApiKey;
  }
});

test('backend handles detailed app requests with its local Gemini SDK dependency', async () => {
  const previousApiKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const requestData = url instanceof Request ? url : new Request(url, options);
    requests.push({
      url: requestData.url,
      body: JSON.parse(await requestData.clone().text()),
      headers: Object.fromEntries(requestData.headers.entries()),
    });
    return new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: 'A tailored app plan.' }] } }],
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
  const message = [
    'Build a web application with these components:',
    '- Log fields for timestamp, category, severity, source, and message',
    '- A chronological feedback dashboard feed',
    '- Interactive trend line charts',
    '- An Export Log action',
  ].join('\n');

  try {
    await backendApi({ method: 'POST', body: { message } }, response);
    assert.equal(response.statusCode, 200);
    assert.equal(requests.length, 1);
    assert.match(requests[0].url, /models\/gemini-2\.5-flash:generateContent/);
    assert.match(JSON.stringify(requests[0].body), /Log fields for timestamp/);
    assert.deepEqual(response.body, { response: 'A tailored app plan.' });
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
    assert.deepEqual(missingKeyResponse.body, {
      response: 'The serverless proxy encountered an error connecting to the generative AI engine. Please verify your environment variable configs.',
    });
  } finally {
    if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousApiKey;
  }
});

test('backend route returns structured JSON when the Gemini connection fails', async () => {
  const previousApiKey = process.env.GEMINI_API_KEY;
  const previousFetch = globalThis.fetch;
  process.env.GEMINI_API_KEY = 'test-gemini-key';
  globalThis.fetch = async () => {
    throw new Error('Connection refused');
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
    await backendApi({ method: 'POST', body: { message: 'Hello' } }, response);
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.body, {
      response: 'The serverless proxy encountered an error connecting to the generative AI engine. Please verify your environment variable configs.',
    });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousApiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = previousApiKey;
  }
});

test('chat message schema restricts anonymous users to validated inserts', async () => {
  const schema = await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8');
  assert.match(schema, /create table if not exists public\.chat_messages/i);
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