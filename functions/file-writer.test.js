import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { routeGeneratedFiles, runAndWrite, writeGeneratedFiles } from './file-writer.js';

const schema = 'CREATE TABLE IF NOT EXISTS "readings" ("id" uuid PRIMARY KEY);\n';

const generatedFiles = [
  { path: 'index.html', content: '<main>Reading list</main>\n' },
  { path: 'style.css', content: 'body { color: #222; }\n' },
  { path: 'vercel.json', content: '{}\n' },
  { path: 'script.js', content: 'export {};\n' },
  { path: 'supabase/schema.sql', content: schema },
  { path: 'functions/readings.js', content: 'export function listReadings() {}\n' },
  { path: 'backend-index.js', content: 'export function handleRequest() {}\n' },
];

test('routes browser assets, Vercel handlers, and Supabase schema', () => {
  const routed = routeGeneratedFiles(generatedFiles);
  assert.deepEqual(routed.map((file) => file.target), [
    'public/index.html',
    'public/style.css',
    'vercel.json',
    'public/script.js',
    'supabase/schema.sql',
    'api/readings.js',
    'api/backend-index.js',
  ]);
  assert.equal(routeGeneratedFiles([
    { path: 'functions/index.js', content: 'export {};\n' },
  ])[0].target, 'api/index.js');
  assert.equal(routeGeneratedFiles([
    { path: 'web/index.html', content: '<main></main>\n' },
  ])[0].target, 'public/index.html');
  assert.equal(routeGeneratedFiles([
    { path: 'src/main.js', content: 'export {};\n' },
  ])[0].target, 'src/main.js');
});

test('writes validated files with safe permissions and refuses overwrites', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prompt2app-writer-'));
  try {
    await mkdir(join(root, 'functions'));
    await writeFile(join(root, 'functions', 'index.js'), 'pipeline remains intact\n');

    const written = await writeGeneratedFiles(generatedFiles, { repoRoot: root });
    assert.equal(written.length, generatedFiles.length);
    assert.equal(await readFile(join(root, 'public', 'index.html'), 'utf8'), generatedFiles[0].content);
    assert.equal(await readFile(join(root, 'supabase', 'schema.sql'), 'utf8'), schema);
    assert.equal(await readFile(join(root, 'api', 'readings.js'), 'utf8'), generatedFiles[5].content);
    assert.equal(await readFile(join(root, 'api', 'backend-index.js'), 'utf8'), generatedFiles[6].content);
    assert.equal(await readFile(join(root, 'functions', 'index.js'), 'utf8'), 'pipeline remains intact\n');
    assert.equal((await stat(join(root, 'public', 'script.js'))).mode & 0o777, 0o644);
    assert.equal((await stat(join(root, 'api', 'readings.js'))).mode & 0o777, 0o644);
    await assert.rejects(writeGeneratedFiles(generatedFiles, { repoRoot: root }), /Refusing to overwrite/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('overwrites only explicitly approved regular-file targets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prompt2app-writer-'));
  try {
    await mkdir(join(root, 'public'));
    await mkdir(join(root, 'api'));
    await mkdir(join(root, 'supabase'));
    await writeFile(join(root, 'public', 'index.html'), 'old frontend\n');
    await writeFile(join(root, 'vercel.json'), 'old config\n');
    await writeFile(join(root, 'supabase', 'schema.sql'), 'old schema\n');
    await writeFile(join(root, 'api', 'backend-api.js'), 'old backend\n');

    const files = [
      { path: 'index.html', content: '<main>Updated</main>\n' },
      { path: 'backend-api.js', content: 'export function handleRequest() { return "updated"; }\n' },
      { path: 'supabase/schema.sql', content: schema },
      { path: 'vercel.json', content: '{"outputDirectory":"public"}\n' },
    ];
    const written = await writeGeneratedFiles(files, {
      repoRoot: root,
      overwriteTargets: [
        'public/index.html',
        'api/backend-api.js',
        'supabase/schema.sql',
        'vercel.json',
      ],
    });

    assert.equal(written.length, 4);
    assert.equal(await readFile(join(root, 'public', 'index.html'), 'utf8'), files[0].content);
    assert.equal(await readFile(join(root, 'api', 'backend-api.js'), 'utf8'), files[1].content);
    assert.equal(await readFile(join(root, 'supabase', 'schema.sql'), 'utf8'), schema);
    assert.equal(await readFile(join(root, 'vercel.json'), 'utf8'), files[3].content);
    for (const path of [
      join(root, 'public', 'index.html'),
      join(root, 'vercel.json'),
      join(root, 'api', 'backend-api.js'),
      join(root, 'supabase', 'schema.sql'),
    ]) {
      assert.equal((await stat(path)).mode & 0o777, 0o644);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('records incremental file versions and snapshots prior non-secret contents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prompt2app-writer-'));
  const firstVersion = [
    { path: 'index.html', content: '<main>Version one</main>\n' },
    { path: 'script.js', content: 'export const version = 1;\n' },
  ];
  const secondVersion = [
    { path: 'index.html', content: '<main>Version two</main>\n' },
    { path: 'script.js', content: 'export const version = 2;\n' },
  ];
  try {
    await writeGeneratedFiles(firstVersion, { repoRoot: root });
    await writeGeneratedFiles(secondVersion, {
      repoRoot: root,
      overwriteTargets: ['public/index.html', 'public/script.js'],
    });

    const manifestPath = join(root, '.prompt2app', 'version-history.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    assert.equal(manifest.formatVersion, 1);
    assert.equal(manifest.versions.length, 2);
    assert.deepEqual(
      manifest.versions[1].files.map(({ target, action }) => [target, action]),
      [['public/index.html', 'updated'], ['public/script.js', 'updated']],
    );
    for (const entry of manifest.versions[1].files) {
      const snapshotPath = join(root, ...entry.snapshot.split('/'));
      assert.ok(entry.beforeSha256);
      assert.ok(entry.afterSha256);
      assert.equal((await readFile(snapshotPath, 'utf8')), firstVersion.find(
        ({ path }) => `public/${path}` === entry.target,
      ).content);
      assert.equal((await stat(snapshotPath)).mode & 0o777, 0o644);
    }
    assert.equal((await stat(manifestPath)).mode & 0o777, 0o644);
    assert.equal(await readFile(join(root, 'public', 'index.html'), 'utf8'), secondVersion[0].content);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('keeps credential-like preexisting contents out of version snapshots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prompt2app-writer-'));
  try {
    await mkdir(join(root, 'public'));
    await writeFile(
      join(root, 'public', 'script.js'),
      'const API_KEY = "sk-123456789012345678901234";\n',
    );
    await writeGeneratedFiles(
      [{ path: 'script.js', content: 'export const ready = true;\n' }],
      { repoRoot: root, overwriteTargets: ['public/script.js'] },
    );

    const manifest = JSON.parse(await readFile(
      join(root, '.prompt2app', 'version-history.json'),
      'utf8',
    ));
    assert.equal(manifest.versions[0].files[0].beforeSha256.length, 64);
    assert.equal(manifest.versions[0].files[0].snapshot, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('unsafe generated files are rejected before overwriting any existing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prompt2app-writer-'));
  try {
    await mkdir(join(root, 'public'));
    await writeFile(join(root, 'public', 'index.html'), 'existing frontend\n');

    await assert.rejects(
      writeGeneratedFiles([
        { path: 'index.html', content: '<main>Should not write</main>\n' },
        { path: '../escape.js', content: 'unsafe' },
      ], {
        repoRoot: root,
        overwriteTargets: ['public/index.html'],
      }),
      /safe relative path/,
    );
    assert.equal(await readFile(join(root, 'public', 'index.html'), 'utf8'), 'existing frontend\n');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('integration target selection leaves unrelated generated destinations untouched', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prompt2app-writer-'));
  const protectedPackage = '{"name":"do-not-replace"}\n';
  try {
    await mkdir(join(root, 'functions', 'generated'), { recursive: true });
    await writeFile(join(root, 'functions', 'generated', 'package.json'), protectedPackage);
    const files = [
      { path: 'index.html', content: '<main>Generated UI</main>\n' },
      { path: 'backend-api.js', content: 'export function handleRequest() {}\n' },
      { path: 'supabase/schema.sql', content: schema },
      { path: 'vercel.json', content: '{"outputDirectory":"public"}\n' },
      { path: 'functions/package.json', content: '{"name":"generated"}\n' },
    ];
    const fetchImpl = async () => new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ functionCall: { name: 'generate_app_files', args: { files } } }] },
      }],
    }));
    const targets = [
      'supabase/schema.sql',
      'public/index.html',
      'api/backend-api.js',
      'vercel.json',
    ];

    const { written } = await runAndWrite('Build the supplied UI', {
      apiKey: 'test-key',
      appSpec: {
        name: 'Test UI',
        description: 'Integration writer test',
        auth: 'none',
        pages: [{ route: '/', purpose: 'Render UI', components: ['button'] }],
        data_models: [],
      },
      fetchImpl,
      repoRoot: root,
      requiredTargets: targets,
      writeTargets: targets,
      overwriteTargets: targets,
    });

    assert.deepEqual(written.map(({ target }) => target), targets);
    assert.equal(
      await readFile(join(root, 'functions', 'generated', 'package.json'), 'utf8'),
      protectedPackage,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('local generation safely replaces generated files and preserves 644 permissions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prompt2app-writer-'));
  const files = [
    { path: 'index.html', content: '<main>Updated UI</main>\n' },
    { path: 'style.css', content: 'body { color: white; }\n' },
    { path: 'script.js', content: 'export const ready = true;\n' },
    { path: 'backend-api.js', content: 'export function handleRequest() { return "updated"; }\n' },
    { path: 'supabase/schema.sql', content: schema },
  ];
  try {
    await mkdir(join(root, 'public'), { recursive: true });
    await mkdir(join(root, 'api'), { recursive: true });
    await mkdir(join(root, 'supabase'), { recursive: true });
    await writeFile(join(root, 'public', 'index.html'), '<main>Old UI</main>\n');
    await writeFile(join(root, 'public', 'style.css'), 'body { color: black; }\n');
    await writeFile(join(root, 'api', 'backend-api.js'), 'export function oldHandler() {}\n');
    await writeFile(join(root, 'supabase', 'schema.sql'), 'old schema\n');
    await writeFile(join(root, 'public', 'keep.txt'), 'preserve this file\n');

    const fetchImpl = async () => new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ functionCall: { name: 'generate_app_files', args: { files } } }] },
      }],
    }));
    const { result, written } = await runAndWrite('Update the app', {
      apiKey: 'test-key',
      appSpec: {
        name: 'Test UI',
        description: 'Overwrite integration test',
        auth: 'none',
        pages: [{ route: '/', purpose: 'Render UI', components: ['button'] }],
        data_models: [],
      },
      fetchImpl,
      repoRoot: root,
      overwriteGeneratedFiles: true,
    });

    assert.equal(written.length, files.length + 2);
    assert.ok(written.some(({ target }) => target === 'vercel.json'));
    assert.ok(written.some(({ target }) => target === 'public/app.metadata.json'));
    assert.equal(await readFile(join(root, 'public', 'index.html'), 'utf8'), files[0].content);
    assert.equal(await readFile(join(root, 'public', 'style.css'), 'utf8'), files[1].content);
    assert.equal(await readFile(join(root, 'api', 'backend-api.js'), 'utf8'), files[3].content);
    assert.equal(
      await readFile(join(root, 'supabase', 'schema.sql'), 'utf8'),
      result.files.find(({ path }) => path === 'supabase/schema.sql').content,
    );
    assert.equal(await readFile(join(root, 'public', 'keep.txt'), 'utf8'), 'preserve this file\n');
    for (const target of [
      'public/index.html',
      'public/style.css',
      'api/backend-api.js',
      'supabase/schema.sql',
      'vercel.json',
      'public/app.metadata.json',
    ]) {
      assert.equal((await stat(join(root, target))).mode & 0o777, 0o644);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('backend-only mode adds backend scripts without touching existing frontend files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'prompt2app-writer-'));
  try {
    await mkdir(join(root, 'public'));
    await writeFile(join(root, 'public', 'index.html'), 'existing frontend\n');

    const written = await writeGeneratedFiles(generatedFiles, { repoRoot: root, backendOnly: true });
    assert.deepEqual(written.map((file) => file.target), ['api/backend-index.js']);
    assert.equal(await readFile(join(root, 'public', 'index.html'), 'utf8'), 'existing frontend\n');
    assert.equal(await readFile(join(root, 'api', 'backend-index.js'), 'utf8'), generatedFiles[6].content);
    assert.equal((await stat(join(root, 'api', 'backend-index.js'))).mode & 0o777, 0o644);
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
      ], { repoRoot: root }),
      /safe relative path/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});