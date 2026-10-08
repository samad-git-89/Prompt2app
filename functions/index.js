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

export function validateAppSpec(spec) {
  if (validateSpec(spec)) return [];
  return (validateSpec.errors ?? []).map((error) => `${error.instancePath || '/'} ${error.message}`);
}

export function validateGeneratedFiles(files) {
  const errors = [];

  if (!Array.isArray(files) || files.length === 0 || files.length > maxFileCount) {
    return [`files must contain between 1 and ${maxFileCount} entries`];
  }

  const seenPaths = new Set();
  let totalSize = 0;
  let foundRules = false;

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

    const size = Buffer.byteLength(file.content, 'utf8');
    totalSize += size;
    if (size > maxFileSize) errors.push(`${file.path} exceeds the 1 MiB file limit`);

    if (/AIza[0-9A-Za-z_-]{30,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(file.content)) {
      errors.push(`${file.path} appears to contain a credential`);
    }

    if (/(?:^|\/)firestore\.rules$/i.test(file.path) || /\.rules$/i.test(file.path)) {
      foundRules = true;
      const hasDenyAll = /match\s*\/\{document=\*\*\}[\s\S]*?allow\s+read\s*,\s*write\s*:\s*if\s+false\s*;/i.test(file.content);
      const allowStatements = file.content.match(/\ballow\s+[^;]+;/gi) ?? [];
      if (!hasDenyAll) errors.push(`${file.path} must include a catch-all read/write deny rule`);
      if (allowStatements.some((statement) => !/:\s*if\s+false\s*;$/i.test(statement))) {
        errors.push(`${file.path} must keep every Firestore allow rule set to false during Phase 1`);
      }
    }
  }

  if (!foundRules) errors.push('generated files must include Firestore security rules with a deny-all fallback');
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

  const specResult = await requestJson({
    apiKey,
    model,
    fetchImpl,
    prompt: [
      'Convert the user request into one AppSpec JSON object matching this schema exactly.',
      'Return JSON only. Do not invent integrations that the request does not need.',
      `AppSpec JSON schema:\n${JSON.stringify(appSpecSchema)}`,
      `User request:\n${prompt.trim()}`,
    ].join('\n\n'),
  });
  const specErrors = validateAppSpec(specResult);
  if (specErrors.length) {
    throw new Error(`Gemini generated an invalid AppSpec:\n${formatValidationErrors(specErrors)}`);
  }

  let files;
  let validationErrors = [];
  let repairAttempts = 0;

  while (repairAttempts <= maxRepairs) {
    const generationPrompt = [
      'Generate the complete starter code for this app, one file per entry.',
      'Return a JSON object with exactly this shape: {"files":[{"path":"relative/path","content":"file contents"}]}.',
      'Include Firestore security rules in a file named firestore.rules, with a catch-all read/write deny rule.',
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
    validationErrors = validateGeneratedFiles(files);
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
