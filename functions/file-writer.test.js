import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeGeneratedFiles, writeGeneratedFiles } from './file-writer.js';

const rules = `rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;

const generatedFiles = [
  { path: 'index.html', content: '<main>Reading list</main>\n' },
  { path: 'style.css', content: 'body { color: #222; }\n' },
  { path: 'firebase-config.js', content: 'export const firebaseConfig = {};\n' },
  { path: 'script.js', content: 'export {};\n' },
  { path: 'firestore.rules', content: rules },
  { path: 'functions/readings.js', content: 'export function listReadings() {}\n' },
  { path: 'backend-index.js', content: 'export function handleRequest() {}\n' },
];

test('routes browser files, backend logic, and root Firestore rules', () => {
  const routed = routeGeneratedFiles(generatedFiles);
  assert.deepEqual(routed.map((file) => file.target), [
    'web/index.html',
    'web/style.css',
    'web/firebase-config.js',
    'web/script.js',
    'firestore.rules',
    'functions/generated/readings.js',
    'functions/generated/backend-index.js',
  ]);
  assert.equal(routeGeneratedFiles([
    { path: 'functions/index.js', content: 'export {};\n' },
    { path: 'firestore.rules', content: rules },
  ])[0].target, 'functions/generated/index.js');
});

test('writes validated files with safe permissions and refuses overwrites', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prompt2app-writer-'));
  try {
    await mkdir(join(root, 'functions'));
    await writeFile(join(root, 'functions', 'index.js'), 'pipeline remains intact\n');

    const written = await writeGeneratedFiles(generatedFiles, { repoRoot: root });
    assert.equal(written.length, generatedFiles.length);
    assert.equal(await readFile(join(root, 'web', 'index.html'), 'utf8'), generatedFiles[0].content);
    assert.equal(await readFile(join(root, 'firestore.rules'), 'utf8'), rules);
    assert.equal(await readFile(join(root, 'functions', 'generated', 'readings.js'), 'utf8'), generatedFiles[5].content);
    assert.equal(await readFile(join(root, 'functions', 'generated', 'backend-index.js'), 'utf8'), generatedFiles[6].content);
    assert.equal(await readFile(join(root, 'functions', 'index.js'), 'utf8'), 'pipeline remains intact\n');
    assert.equal((await stat(join(root, 'web', 'script.js'))).mode & 0o777, 0o644);
    await assert.rejects(writeGeneratedFiles(generatedFiles, { repoRoot: root }), /Refusing to overwrite/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('backend-only mode adds backend scripts without touching existing frontend files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prompt2app-writer-'));
  try {
    await mkdir(join(root, 'web'));
    await writeFile(join(root, 'web', 'index.html'), 'existing frontend\n');

    const written = await writeGeneratedFiles(generatedFiles, { repoRoot: root, backendOnly: true });
    assert.deepEqual(written.map((file) => file.target), ['functions/generated/backend-index.js']);
    assert.equal(await readFile(join(root, 'web', 'index.html'), 'utf8'), 'existing frontend\n');
    assert.equal(await readFile(join(root, 'functions', 'generated', 'backend-index.js'), 'utf8'), generatedFiles[6].content);
    assert.equal((await stat(join(root, 'functions', 'generated', 'backend-index.js'))).mode & 0o777, 0o644);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects unsafe or incomplete target layouts before writing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prompt2app-writer-'));
  try {
    await assert.rejects(
      writeGeneratedFiles([
        { path: '../outside.js', content: 'bad' },
        { path: 'firestore.rules', content: rules },
      ], { repoRoot: root }),
      /safe relative path/,
    );
    await assert.rejects(
      writeGeneratedFiles([{ path: 'index.html', content: 'missing rules' }], { repoRoot: root }),
      /Firestore security rules/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});