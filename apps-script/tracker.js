import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultLogPath = fileURLToPath(new URL('./.local/executions.jsonl', import.meta.url));
const parameterRules = {
  temperature: (value) => typeof value === 'number' && value >= 0 && value <= 2,
  topP: (value) => typeof value === 'number' && value >= 0 && value <= 1,
  topK: (value) => Number.isInteger(value) && value >= 1,
  maxOutputTokens: (value) => Number.isInteger(value) && value >= 1,
  candidateCount: (value) => Number.isInteger(value) && value >= 1 && value <= 8,
  thinkingBudget: (value) => Number.isInteger(value) && value >= 0,
  responseMimeType: (value) => typeof value === 'string' && ['application/json', 'text/plain'].includes(value),
};

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function normalizeTimestamp(value, name) {
  const date = value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(date.valueOf())) throw new TypeError(`${name} must be a valid timestamp`);
  return date.toISOString();
}

function validateFilePath(path) {
  return typeof path === 'string' &&
    path.length > 0 &&
    !path.startsWith('/') &&
    !path.includes('\\') &&
    !path.includes(':') &&
    path.split('/').every((part) => part && part !== '.' && part !== '..');
}

function rejectUnknownKeys(value, allowedKeys, location, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) errors.push(`${location} contains unsupported property: ${key}`);
  }
}

export function validateExecutionRecord(record) {
  const errors = [];
  if (!record || typeof record !== 'object' || Array.isArray(record)) return ['record must be an object'];
  rejectUnknownKeys(record, [
    'schemaVersion', 'runId', 'startedAt', 'completedAt', 'durationMs', 'model',
    'parameters', 'generation', 'codeVersion', 'outcome',
  ], 'record', errors);
  if (record.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (typeof record.runId !== 'string' || record.runId.length === 0) errors.push('runId is required');
  if (Number.isNaN(Date.parse(record.startedAt))) errors.push('startedAt must be a valid timestamp');
  if (Number.isNaN(Date.parse(record.completedAt))) errors.push('completedAt must be a valid timestamp');
  if (!Number.isFinite(record.durationMs) || record.durationMs < 0) errors.push('durationMs must be non-negative');
  rejectUnknownKeys(record.model, ['provider', 'name'], 'model', errors);
  if (record.model?.provider !== 'gemini' || typeof record.model?.name !== 'string' || !record.model.name) {
    errors.push('model must identify a Gemini model');
  }

  rejectUnknownKeys(record.parameters, Object.keys(parameterRules), 'parameters', errors);
  if (!record.parameters || typeof record.parameters !== 'object' || Array.isArray(record.parameters)) {
    errors.push('parameters must be an object');
  } else {
    for (const [name, value] of Object.entries(record.parameters)) {
      if (!parameterRules[name]) errors.push(`unsupported model parameter: ${name}`);
      else if (!parameterRules[name](value)) errors.push(`invalid model parameter: ${name}`);
    }
  }

  rejectUnknownKeys(record.generation, ['promptSha256', 'repairAttempts', 'fileCount', 'validation'], 'generation', errors);
  rejectUnknownKeys(record.generation?.validation, ['valid', 'errorCount'], 'generation.validation', errors);
  if (!/^[a-f0-9]{64}$/.test(record.generation?.promptSha256 ?? '')) errors.push('generation.promptSha256 must be a SHA-256 digest');
  if (!Number.isInteger(record.generation?.repairAttempts) || record.generation.repairAttempts < 0 || record.generation.repairAttempts > 3) {
    errors.push('generation.repairAttempts must be an integer from 0 to 3');
  }
  if (!Number.isInteger(record.generation?.fileCount) || record.generation.fileCount < 0) errors.push('generation.fileCount must be non-negative');
  if (typeof record.generation?.validation?.valid !== 'boolean') errors.push('generation.validation.valid must be boolean');
  if (!Number.isInteger(record.generation?.validation?.errorCount) || record.generation.validation.errorCount < 0) {
    errors.push('generation.validation.errorCount must be non-negative');
  }

  rejectUnknownKeys(record.codeVersion, ['commit', 'fileHashes'], 'codeVersion', errors);
  if (record.codeVersion?.commit !== null && typeof record.codeVersion?.commit !== 'string') {
    errors.push('codeVersion.commit must be a string or null');
  }
  if (!Array.isArray(record.codeVersion?.fileHashes)) errors.push('codeVersion.fileHashes must be an array');
  else {
    for (const [index, file] of record.codeVersion.fileHashes.entries()) {
      rejectUnknownKeys(file, ['path', 'sha256', 'bytes'], `codeVersion.fileHashes[${index}]`, errors);
      if (!validateFilePath(file?.path) || !/^[a-f0-9]{64}$/.test(file?.sha256 ?? '') || !Number.isInteger(file?.bytes) || file.bytes < 0) {
        errors.push(`codeVersion.fileHashes[${index}] is invalid`);
      }
    }
  }

  rejectUnknownKeys(record.outcome, ['status', 'errorCode'], 'outcome', errors);
  if (!['success', 'failed'].includes(record.outcome?.status)) errors.push('outcome.status must be success or failed');
  if (record.outcome?.errorCode !== undefined && !/^[A-Z0-9_]{1,64}$/.test(record.outcome.errorCode)) {
    errors.push('outcome.errorCode must be an uppercase error code');
  }
  return errors;
}

export function createExecutionRecord({
  runId = randomUUID(),
  startedAt,
  completedAt,
  model,
  parameters = {},
  prompt = '',
  repairAttempts = 0,
  validation = { valid: false, errors: [] },
  files = [],
  gitCommit = null,
  errorCode,
} = {}) {
  if (typeof prompt !== 'string') throw new TypeError('prompt must be a string');
  if (typeof model !== 'string' || model.length === 0) throw new TypeError('model must be a non-empty string');
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) throw new TypeError('parameters must be an object');
  if (!Array.isArray(files)) throw new TypeError('files must be an array');

  const started = normalizeTimestamp(startedAt, 'startedAt');
  const completed = normalizeTimestamp(completedAt ?? started, 'completedAt');
  const durationMs = Date.parse(completed) - Date.parse(started);
  const validationErrors = Array.isArray(validation?.errors) ? validation.errors : [];
  const record = {
    schemaVersion: 1,
    runId,
    startedAt: started,
    completedAt: completed,
    durationMs,
    model: { provider: 'gemini', name: model },
    parameters: { ...parameters },
    generation: {
      promptSha256: sha256(prompt),
      repairAttempts,
      fileCount: files.length,
      validation: {
        valid: validation?.valid === true,
        errorCount: validationErrors.length,
      },
    },
    codeVersion: {
      commit: gitCommit,
      fileHashes: files.map((file) => {
        if (!file || !validateFilePath(file.path) || typeof file.content !== 'string') {
          throw new TypeError('generated files must have safe relative paths and string contents');
        }
        return {
          path: file.path,
          sha256: sha256(file.content),
          bytes: Buffer.byteLength(file.content, 'utf8'),
        };
      }),
    },
    outcome: {
      status: validation?.valid === true ? 'success' : 'failed',
      ...(errorCode === undefined ? {} : { errorCode }),
    },
  };

  const errors = validateExecutionRecord(record);
  if (errors.length) throw new TypeError(`invalid execution record: ${errors.join('; ')}`);
  return record;
}

export async function appendExecutionRecord(record, { logPath = defaultLogPath } = {}) {
  const errors = validateExecutionRecord(record);
  if (errors.length) throw new TypeError(`invalid execution record: ${errors.join('; ')}`);

  const path = resolve(logPath);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const handle = await open(path, 'a', 0o600);
  try {
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(record)}\n`, 'utf8');
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function recordExecution(input, options) {
  const record = createExecutionRecord(input);
  await appendExecutionRecord(record, options);
  return record;
}