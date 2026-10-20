import 'dotenv/config';
import Ajv2020 from 'ajv/dist/2020.js';
import { readFile } from 'node:fs/promises';

const schemaPath = new URL('../schemas/app_spec.schema.json', import.meta.url);
const appSpecSchema = JSON.parse(await readFile(schemaPath, 'utf8'));
const validateSpec = new Ajv2020({ allErrors: true, strict: false }).compile(appSpecSchema);
const defaultModel = 'gemini-2.5-flash';
const maxFileCount = 100;
const maxFileSize = 1024 * 1024;
const maxTotalSize = 5 * 1024 * 1024;
const postgresTypes = {
  string: 'text',
  integer: 'integer',
  number: 'double precision',
  boolean: 'boolean',
  date: 'date',
  datetime: 'timestamptz',
  uuid: 'uuid',
  json: 'jsonb',
};

export function validateAppSpec(spec) {
  if (validateSpec(spec)) return [];
  return (validateSpec.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`);
}

export function generatePostgresSchema(dataModels) {
  if (!Array.isArray(dataModels)) throw new TypeError('dataModels must be an array');

  const tables = new Set();
  const statements = dataModels.map(({ table, fields }) => {
    if (!/^[a-z][a-z0-9_]*$/.test(table) || !Array.isArray(fields)) {
      throw new TypeError('Each data model must have a valid PostgreSQL table name and fields');
    }
    if (tables.has(table)) throw new TypeError(`Duplicate PostgreSQL table name: ${table}`);
    tables.add(table);
    const fieldNames = new Set();
    const columns = fields.map(({ name, type, required }) => {
      const postgresType = postgresTypes[type];
      if (!/^[a-z][a-z0-9_]*$/.test(name) || !postgresType || fieldNames.has(name)) {
        throw new TypeError(`Invalid PostgreSQL field definition in table ${table}`);
      }
      fieldNames.add(name);
      const primaryKey = name === 'id' ? ' PRIMARY KEY' : '';
      const notNull = required || name === 'id' ? ' NOT NULL' : '';
      return `  "${name}" ${postgresType}${notNull}${primaryKey}`;
    });
    if (!fields.some(({ name }) => name === 'id')) {
      columns.unshift('  "id" uuid NOT NULL PRIMARY KEY DEFAULT gen_random_uuid()');
    }
    return `CREATE TABLE IF NOT EXISTS "${table}" (\n${columns.join(',\n')}\n);\n`
      + `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;`;
  });

  return `${statements.join('\n\n')}\n`;
}

export function validateGeneratedFiles(files, { requireDatabaseSchema = false } = {}) {
  const errors = [];

  if (!Array.isArray(files) || files.length === 0 || files.length > maxFileCount) {
    return [`files must contain between 1 and ${maxFileCount} entries`];
  }

  const seenPaths = new Set();
  let totalSize = 0;
  let foundDatabaseSchema = false;

  for (const [index, file] of files.entries()) {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
      errors.push(`files[${index}] must have string path and content properties`);
      continue;
    }

    const segments = file.path.split('/');
    if (
      file.path.length === 0 ||
      file.path.startsWith('/') ||
      file.path.includes('\\') ||
      segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
      file.path.includes(':')
    ) {
      errors.push(`files[${index}].path must be a safe relative path`);
      continue;
    }

    if (seenPaths.has(file.path)) errors.push(`duplicate file path: ${file.path}`);
    seenPaths.add(file.path);
    if (/(?:^|\/)(?:firestore\.rules|firebase\.json)$/i.test(file.path)) {
      errors.push(`${file.path} is a legacy Firebase configuration and is not supported`);
    }

    const size = Buffer.byteLength(file.content, 'utf8');
    totalSize += size;
    if (size > maxFileSize) errors.push(`${file.path} exceeds the 1 MiB file limit`);

    if (/AIza[0-9A-Za-z_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(file.content)) {
      errors.push(`${file.path} appears to contain a credential`);
    }

    if (file.path === 'supabase/schema.sql' && /\bCREATE\s+TABLE\b/i.test(file.content)) {
      foundDatabaseSchema = true;
    }
  }

  if (requireDatabaseSchema && !foundDatabaseSchema) {
    errors.push('generated files must include PostgreSQL table DDL at supabase/schema.sql');
  }
  if (totalSize > maxTotalSize) errors.push('generated files exceed the 5 MiB total size limit');
  return errors;
}

async function requestJson({ prompt, apiKey, model, fetchImpl }) {
  const endpoint = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
  );

  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { responseMimeType: 'application/json' },
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!response.ok) {
    const details = (await response.text()).slice(0, 500).replaceAll(apiKey, '[redacted]');
    throw new Error(`Gemini request failed (${response.status}): ${details}`);
  }

  const payload = await response.json();
  const text = payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('');
  if (!text) throw new Error('Gemini returned no candidate text');

  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
  } catch {
    throw new Error('Gemini returned invalid JSON');
  }
}

function formatValidationErrors(errors) {
  return errors.map((error) => `- ${error}`).join('\n');
}

export async function runPipeline({
  prompt,
  appSpec,
  apiKey = process.env.GEMINI_API_KEY,
  model = defaultModel,
  maxRepairs = 3,
  fetchImpl = fetch,
} = {}) {
  if (typeof prompt !== 'string' || prompt.trim().length === 0) {
    throw new TypeError('prompt must be a non-empty string');
  }
  if (!apiKey) throw new Error('GEMINI_API_KEY is required');
  if (!Number.isInteger(maxRepairs) || maxRepairs < 0 || maxRepairs > 3) {
    throw new RangeError('maxRepairs must be an integer from 0 to 3');
  }

  const specResult = appSpec === undefined
    ? await requestJson({
      apiKey,
      model,
      fetchImpl,
      prompt: [
        'Convert the user request into one AppSpec JSON object matching this schema exactly.',
        'Return JSON only. Do not invent integrations that the request does not need.',
        `AppSpec JSON schema:\n${JSON.stringify(appSpecSchema)}`,
        `User request:\n${prompt.trim()}`,
      ].join('\n\n'),
    })
    : appSpec;
  const specErrors = validateAppSpec(specResult);
  if (specErrors.length) {
    const source = appSpec === undefined ? 'Gemini generated' : 'Provided';
    throw new Error(`${source} AppSpec is invalid:\n${formatValidationErrors(specErrors)}`);
  }

  let files;
  let validationErrors = [];
  let repairAttempts = 0;

  while (repairAttempts <= maxRepairs) {
    const generationPrompt = [
      'Generate the complete starter code for this app, one file per entry.',
      'Return a JSON object with exactly this shape: {"files":[{"path":"relative/path","content":"file contents"}]}.',
      'For every AppSpec data model, include PostgreSQL DDL in supabase/schema.sql and use the Supabase JavaScript client for database access.',
      'Initialize Supabase directly in the browser for Supabase-backed UI components: define const SUPABASE_URL = "https://dlnsgydsevubdbsfpipg.supabase.co" and const SUPABASE_ANON_KEY = "sb_publishable_PHJsJon2xr4yeXPWxBBaIg_76jD8Op-", then call window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY). Load the Supabase JavaScript client before this code; do not fetch /api/ui-service.js for Supabase configuration, and never expose secret or service-role keys.',
      'Use the explicit .js backend route /api/backend-api.js for browser requests that require the server-side API.',
      'Always build the app page inside a clean dashboard shell with a persistent navigation sidebar and a flexible main-content area; use semantic, clearly separated layout containers rather than a single flat panel.',
      'Place conversational features in a dedicated, interactive chat-feed panel within the main area, with distinct message rows and a composer; do not render chat as an oversized flat blue box.',
      'Author a cohesive, production-quality CSS design system: use dark charcoal or soft neutral slate backgrounds instead of raw solid primary-color fills, clear typographic hierarchy, readable contrast, 8px-or-greater corner radii, subtle professional box-shadows, and all 0.2s ease transitions for interactive states.',
      'Use fluid flexbox-based layout sizing and responsive breakpoints so the sidebar, dashboard content, cards, and chat feed resize cleanly across desktop and laptop aspect ratios without overflow.',
      'Wire chat event listeners to render each submitted user message in its own user bubble and assistant response tokens in a separate AI response block, preserving readable whitespace and token order and scrolling the feed to the latest message. Render generated/user text as text, not injected HTML.',
      'Do not generate Firebase or Firestore configuration, rules, or collection access.',
      'Use only the locked UI component tokens in the AppSpec; preserve each token exactly.',
      'Do not include secrets, absolute paths, parent-directory segments, markdown fences, or explanations.',
      `Original user request:\n${prompt.trim()}`,
      `Validated AppSpec:\n${JSON.stringify(specResult)}`,
    ];

    if (validationErrors.length) {
      generationPrompt.push(
        `Validation errors to fix:\n${formatValidationErrors(validationErrors)}`,
        `Previous files:\n${JSON.stringify(files)}`,
      );
    }

    const generated = await requestJson({
      apiKey,
      model,
      fetchImpl,
      prompt: generationPrompt.join('\n\n'),
    });
    files = generated?.files;
    if (Array.isArray(files) && specResult.data_models.length > 0) {
      const schemaIndex = files.findIndex((file) => file?.path === 'supabase/schema.sql');
      const schemaFile = {
        path: 'supabase/schema.sql',
        content: generatePostgresSchema(specResult.data_models),
      };
      if (schemaIndex === -1) {
        files.push(schemaFile);
      } else {
        files[schemaIndex] = schemaFile;
      }
    }
    validationErrors = validateGeneratedFiles(files, {
      requireDatabaseSchema: specResult.data_models.length > 0,
    });
    if (validationErrors.length === 0) {
      return { spec: specResult, files, validation: { valid: true, errors: [] }, repairAttempts };
    }
    if (repairAttempts === maxRepairs) break;
    repairAttempts += 1;
  }

  return {
    spec: specResult,
    files: Array.isArray(files) ? files : [],
    validation: { valid: false, errors: validationErrors },
    repairAttempts,
  };
}
