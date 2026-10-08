import { randomUUID } from 'node:crypto';
import { open, link, lstat, mkdir, realpath, unlink, rmdir } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { runPipeline, validateGeneratedFiles } from './index.js';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const fileMode = 0o644;
const restrictedSegments = new Set(['.git', 'node_modules']);

function validateLogicalPath(filePath) {
  if (typeof filePath !== 'string' || filePath.length === 0 || filePath.includes('\\') || filePath.includes(':')) {
    throw new Error('Generated file path must be a non-empty relative path');
  }

  const segments = filePath.split('/');
  if (
    filePath.startsWith('/') ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..') ||
    segments.some((segment) => restrictedSegments.has(segment) || /^\.env(?:\.|$)/i.test(segment))
  ) {
    throw new Error(`Unsafe generated file path: ${filePath}`);
  }
  return segments;
}

export function routeGeneratedFiles(files) {
  if (!Array.isArray(files)) throw new TypeError('files must be an array');

  const routed = files.map((file) => {
    if (!file || typeof file.path !== 'string' || typeof file.content !== 'string') {
      throw new TypeError('Each generated file must have string path and content properties');
    }

    const segments = validateLogicalPath(file.path);
    let targetSegments;

    if (file.path === 'firestore.rules') {
      targetSegments = ['firestore.rules'];
    } else if (segments[0] === 'functions') {
      const backendSegments = segments.slice(1);
      if (backendSegments[0] === 'generated') backendSegments.shift();
      if (backendSegments.length === 0) throw new Error('Backend files must include a filename');
      targetSegments = ['functions', 'generated', ...backendSegments];
    } else if (segments[0] === 'backend' || segments[0].startsWith('backend-')) {
      const backendSegments = segments[0] === 'backend' ? segments.slice(1) : segments;
      if (backendSegments.length === 0) throw new Error('Backend files must include a filename');
      targetSegments = ['functions', 'generated', ...backendSegments];
    } else if (segments[0] === 'web') {
      if (segments.length === 1) throw new Error('Web files must include a filename');
      targetSegments = segments;
    } else {
      targetSegments = ['web', ...segments];
    }

    const target = targetSegments.join('/');
    if (target !== 'firestore.rules' && /\.rules$/i.test(target)) {
      throw new Error('Firestore rules must be supplied at the repository root as firestore.rules');
    }
    return { path: file.path, target, content: file.content };
  });

  const targets = new Set();
  for (const file of routed) {
    if (targets.has(file.target)) throw new Error(`Multiple generated files map to ${file.target}`);
    targets.add(file.target);
  }
  if (!targets.has('firestore.rules')) throw new Error('A root firestore.rules file is required');
  return routed;
}

async function inspectDestination(root, target) {
  const segments = target.split('/');
  let current = root;

  for (const segment of segments.slice(0, -1)) {
    current = resolve(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) {
        throw new Error(`Destination parent must be a real directory: ${relative(root, current)}`);
      }
    } catch (error) {
      if (error.code === 'ENOENT') break;
      throw error;
    }
  }

  const destination = resolve(root, ...segments);
  const destinationRelative = relative(root, destination);
  if (!destinationRelative || destinationRelative.startsWith(`..${sep}`) || isAbsolute(destinationRelative)) {
    throw new Error(`Generated path escapes repository root: ${target}`);
  }

  try {
    await lstat(destination);
    throw new Error(`Refusing to overwrite existing file: ${target}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  return destination;
}

async function ensureDirectories(directory, root, createdDirectories) {
  const directoryRelative = relative(root, directory);
  let current = root;

  for (const segment of directoryRelative.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      await mkdir(current, { mode: 0o755 });
      createdDirectories.push(current);
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }

    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory()) {
      throw new Error(`Destination parent must be a real directory: ${relative(root, current)}`);
    }
  }
}

async function removeCreatedFiles(paths) {
  for (const path of paths.reverse()) {
    await unlink(path).catch(() => {});
  }
}

async function removeCreatedDirectories(paths) {
  for (const path of paths.reverse()) {
    await rmdir(path).catch(() => {});
  }
}

export async function writeGeneratedFiles(files, { repoRoot = repositoryRoot, backendOnly = false } = {}) {
  const validationErrors = validateGeneratedFiles(files);
  if (validationErrors.length) {
    throw new Error(`Generated files failed validation:\n${validationErrors.join('\n')}`);
  }

  const allRoutedFiles = routeGeneratedFiles(files);
  const routedFiles = backendOnly
    ? allRoutedFiles.filter(({ path, target }) =>
      target.startsWith('functions/generated/') && path.split('/').at(-1).startsWith('backend-'))
    : allRoutedFiles;
  if (backendOnly && routedFiles.length === 0) {
    throw new Error('No backend-prefixed files are available to write');
  }
  const root = await realpath(resolve(repoRoot));
  const destinations = new Map();
  for (const file of routedFiles) {
    destinations.set(file.target, await inspectDestination(root, file.target));
  }

  const createdDirectories = [];
  const stagedFiles = [];
  const committedFiles = [];

  try {
    for (const file of routedFiles) {
      const destination = destinations.get(file.target);
      await ensureDirectories(dirname(destination), root, createdDirectories);

      const temporaryPath = resolve(dirname(destination), `.${randomUUID()}.prompt2app-tmp`);
      const handle = await open(temporaryPath, 'wx', fileMode);
      stagedFiles.push(temporaryPath);
      try {
        await handle.writeFile(file.content, 'utf8');
        await handle.chmod(fileMode);
        await handle.sync();
      } finally {
        await handle.close();
      }
    }

    for (let index = 0; index < routedFiles.length; index += 1) {
      const file = routedFiles[index];
      const destination = destinations.get(file.target);
      await link(stagedFiles[index], destination);
      committedFiles.push(destination);
    }

    for (const stagedPath of stagedFiles) await unlink(stagedPath);
    return routedFiles.map(({ path, target, content }) => ({
      path,
      target,
      bytes: Buffer.byteLength(content, 'utf8'),
    }));
  } catch (error) {
    await removeCreatedFiles(committedFiles);
    await removeCreatedFiles(stagedFiles);
    await removeCreatedDirectories(createdDirectories);
    throw error;
  }
}

export async function runAndWrite(prompt, { writeMode = 'all', ...pipelineOptions } = {}) {
  if (!['all', 'backend-only'].includes(writeMode)) {
    throw new Error('writeMode must be "all" or "backend-only"');
  }
  const routedPrompt = [
    prompt,
    'This is an explicitly full-stack application. It MUST include server-side business logic, not only browser-side code.',
    'Generate at least 5 total files and at least one backend JavaScript script whose filename begins with backend- (for example, backend-index.js).',
    'Emit backend-*.js as a top-level generated path so it can be routed into functions/generated/.',
    'Output routing: browser interface files use ordinary relative paths and are written under web/.',
    'Cloud business logic files must use a backend-*.js filename or a backend/ or functions/ path and will be written under functions/generated/.',
    'The AppSpec must conform to the supplied repository schema. Keep every Firestore allow statement false and include the catch-all deny rule.',
    'Return the deny-only Firestore rules as firestore.rules at the repository root.',
    'Do not generate or replace the pipeline utility at functions/index.js.',
  ].join('\n\n');
  const result = await runPipeline({ prompt: routedPrompt, ...pipelineOptions });
  if (!result.validation.valid) {
    throw new Error(`Pipeline output failed validation:\n${result.validation.errors.join('\n')}`);
  }
  if (result.files.length < 5) throw new Error('Full-stack generation must return at least 5 files');
  if (!result.files.some(({ path }) => path.split('/').at(-1).startsWith('backend-') && path.endsWith('.js'))) {
    throw new Error('Full-stack generation must include a backend-*.js script');
  }
  return {
    result,
    written: await writeGeneratedFiles(result.files, { backendOnly: writeMode === 'backend-only' }),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const writeMode = args[0] === '--backend-only' ? 'backend-only' : 'all';
  if (writeMode === 'backend-only') args.shift();
  const prompt = args.join(' ').trim();
  if (!prompt) throw new Error('Usage: node functions/file-writer.js "Describe the app to generate"');

  const { result, written } = await runAndWrite(prompt, { writeMode });
  console.log(JSON.stringify({
    specName: result.spec.name,
    repairAttempts: result.repairAttempts,
    validation: result.validation,
    written,
  }, null, 2));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`${error.name}: ${error.message}`);
    process.exitCode = 1;
  });
}