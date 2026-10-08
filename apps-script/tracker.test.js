import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendExecutionRecord,
  createExecutionRecord,
  recordExecution,
  validateExecutionRecord,
} from './tracker.js';

const sample = {
  runId: 'test-run-1',
  startedAt: '2026-10-08T10:00:00.000Z',
  completedAt: '2026-10-08T10:00:02.000Z',
  model: 'gemini-2.5-flash',
  parameters: { temperature: 0.2, topP: 0.9, maxOutputTokens: 4096, responseMimeType: 'application/json' },
  prompt: 'Build a private app prompt',
  repairAttempts: 1,
  validation: { valid: true, errors: [] },
  files: [{ path: 'web/index.html', content: '<h1>Private generated source</h1>' }],
  gitCommit: 'abc1234',
};

test('creates a metadata-only execution record with model and code hashes', () => {
  const record = createExecutionRecord(sample);
  assert.deepEqual(validateExecutionRecord(record), []);
  assert.equal(record.model.name, 'gemini-2.5-flash');
  assert.equal(record.durationMs, 2000);
  assert.equal(record.generation.fileCount, 1);
  assert.equal(record.generation.repairAttempts, 1);
  assert.equal(record.codeVersion.commit, 'abc1234');
  assert.equal(record.codeVersion.fileHashes[0].path, 'web/index.html');
  assert.equal(JSON.stringify(record).includes(sample.prompt), false);
  assert.equal(JSON.stringify(record).includes(sample.files[0].content), false);
});

test('rejects unapproved model parameters and unsafe generated paths', () => {
  assert.throws(() => createExecutionRecord({ ...sample, parameters: { apiKey: 'do-not-log' } }), /unsupported model parameter/);
  assert.throws(() => createExecutionRecord({ ...sample, files: [{ path: '../outside.js', content: 'x' }] }), /safe relative paths/);
  assert.match(validateExecutionRecord({ ...createExecutionRecord(sample), apiKey: 'do-not-log' }).join(' '), /unsupported property/);
});

test('appends JSONL records with private file permissions and exports recordExecution', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prompt2app-tracker-'));
  const logPath = join(directory, '.local', 'runs.jsonl');
  try {
    const first = createExecutionRecord(sample);
    await appendExecutionRecord(first, { logPath });
    const second = await recordExecution({ ...sample, runId: 'test-run-2' }, { logPath });
    const lines = (await readFile(logPath, 'utf8')).trim().split('\n').map((line) => JSON.parse(line));
    assert.deepEqual(lines.map((record) => record.runId), ['test-run-1', 'test-run-2']);
    assert.equal((await stat(logPath)).mode & 0o777, 0o600);
    assert.equal(second.runId, 'test-run-2');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});