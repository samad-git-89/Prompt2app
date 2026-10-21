import { randomUUID } from 'node:crypto';
import { open, link, lstat, mkdir, realpath, rename, unlink, rmdir } from 'node:fs/promises';
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

    if (segments[0] === 'public' || segments[0] === 'src' || segments[0] === 'api' || segments[0] === 'supabase') {
      targetSegments = segments;
    } else if (file.path === 'vercel.json') {
      targetSegments = segments;
    } else if (segments[0] === 'functions') {
      const backendSegments = segments.slice(1);
      if (backendSegments[0] === 'generated') backendSegments.shift();
      if (backendSegments.length === 0) throw new Error('Backend files must include a filename');
      targetSegments = ['api', ...backendSegments];
    } else if (segments[0] === 'backend' || segments[0].startsWith('backend-')) {
      const backendSegments = segments[0] === 'backend' ? segments.slice(1) : segments;
      if (backendSegments.length === 0) throw new Error('Backend files must include a filename');
      targetSegments = ['api', ...backendSegments];
    } else if (segments[0] === 'web') {
      if (segments.length === 1) throw new Error('Web files must include a filename');
      targetSegments = ['public', ...segments.slice(1)];
    } else {
      targetSegments = ['public', ...segments];
    }

    const target = targetSegments.join('/');
    return { path: file.path, target, content: file.content };
  });

  const targets = new Set();
  for (const file of routed) {
    if (targets.has(file.target)) throw new Error(`Multiple generated files map to ${file.target}`);
    targets.add(file.target);
  }
  return routed;
}

async function inspectDestination(root, target, overwriteTargets) {
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
    const info = await lstat(destination);
    if (!overwriteTargets.has(target)) {
      throw new Error(`Refusing to overwrite existing file: ${target}`);
    }
    if (info.isSymbolicLink() || !info.isFile()) {
      throw new Error(`Refusing to overwrite non-regular file: ${target}`);
    }
    return { destination, existing: info };
  } catch (error) {
    if (error.code === 'ENOENT') return { destination, existing: null };
    throw error;
  }
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

export async function writeGeneratedFiles(
  files,
  { repoRoot = repositoryRoot, backendOnly = false, overwriteTargets = [] } = {},
) {
  if (!Array.isArray(overwriteTargets) || overwriteTargets.some((target) => typeof target !== 'string')) {
    throw new TypeError('overwriteTargets must be an array of target paths');
  }
  const overwriteTargetSet = new Set(overwriteTargets);
  if (overwriteTargetSet.size !== overwriteTargets.length) {
    throw new Error('overwriteTargets must not contain duplicate paths');
  }

  const validationErrors = validateGeneratedFiles(files);
  if (validationErrors.length) {
    throw new Error(`Generated files failed validation:\n${validationErrors.join('\n')}`);
  }

  const allRoutedFiles = routeGeneratedFiles(files);
  const routedFiles = backendOnly
    ? allRoutedFiles.filter(({ path, target }) =>
      target.startsWith('api/') && path.split('/').at(-1).startsWith('backend-'))
    : allRoutedFiles;
  if (backendOnly && routedFiles.length === 0) {
    throw new Error('No backend-prefixed files are available to write');
  }
  const root = await realpath(resolve(repoRoot));
  const destinations = new Map();
  for (const file of routedFiles) {
    destinations.set(
      file.target,
      await inspectDestination(root, file.target, overwriteTargetSet),
    );
  }

  const createdDirectories = [];
  const stagedFiles = [];
  const backups = [];
  const committedFiles = [];

  try {
    for (const file of routedFiles) {
      const { destination } = destinations.get(file.target);
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
      const { destination, existing } = destinations.get(file.target);
      if (existing) {
        const current = await lstat(destination);
        if (
          current.isSymbolicLink()
          || !current.isFile()
          || current.dev !== existing.dev
          || current.ino !== existing.ino
        ) {
          throw new Error(`Destination changed during generation: ${file.target}`);
        }
        const backupPath = resolve(dirname(destination), `.${randomUUID()}.prompt2app-backup`);
        await link(destination, backupPath);
        backups.push({ destination, backupPath });
        await rename(stagedFiles[index], destination);
        committedFiles.push({ destination, backupPath });
      } else {
        await link(stagedFiles[index], destination);
        committedFiles.push({ destination, backupPath: null });
      }
    }
  } catch (error) {
    const rollbackErrors = [];
    for (const { destination, backupPath } of committedFiles.reverse()) {
      try {
        if (backupPath) {
          await rename(backupPath, destination);
        } else {
          await unlink(destination);
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    const committedBackups = new Set(committedFiles.map(({ backupPath }) => backupPath).filter(Boolean));
    for (const { backupPath } of backups) {
      if (committedBackups.has(backupPath)) continue;
      try {
        await unlink(backupPath);
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError);
      }
    }
    try {
      await removeCreatedFiles(stagedFiles);
      await removeCreatedDirectories(createdDirectories);
    } catch (rollbackError) {
      rollbackErrors.push(rollbackError);
    }
    if (rollbackErrors.length) {
      throw new AggregateError(
        [error, ...rollbackErrors],
        'Generated file write failed and rollback was incomplete',
      );
    }
    throw error;
  }

  for (const { backupPath } of backups) await unlink(backupPath);
  await removeCreatedFiles(stagedFiles);
  return routedFiles.map(({ path, target, content }) => ({
    path,
    target,
    bytes: Buffer.byteLength(content, 'utf8'),
  }));
}

export async function runAndWrite(
  prompt,
  {
    writeMode = 'all',
    repoRoot = repositoryRoot,
    requiredTargets = [],
    writeTargets = [],
    overwriteTargets = [],
    overwriteGeneratedFiles = false,
    ...pipelineOptions
  } = {},
) {
  if (!['all', 'backend-only'].includes(writeMode)) {
    throw new Error('writeMode must be "all" or "backend-only"');
  }
  if (!Array.isArray(requiredTargets) || requiredTargets.some((target) => typeof target !== 'string')) {
    throw new TypeError('requiredTargets must be an array of target paths');
  }
  if (!Array.isArray(writeTargets) || writeTargets.some((target) => typeof target !== 'string')) {
    throw new TypeError('writeTargets must be an array of target paths');
  }
  if (typeof overwriteGeneratedFiles !== 'boolean') {
    throw new TypeError('overwriteGeneratedFiles must be a boolean');
  }
  const routedPrompt = [
    prompt,
    'This is an explicitly full-stack application. It MUST include server-side business logic, not only browser-side code.',
    'Generate at least 5 total files and at least one backend JavaScript script whose filename begins with backend- (for example, backend-index.js).',
    'Emit browser assets under public/ or application modules under src/.',
    'Emit Vercel serverless handlers under api/ or as backend-*.js files.',
    'For every AppSpec data model, provide Supabase-compatible PostgreSQL DDL in supabase/schema.sql.',
    'Use the supplied AppSpec schema and preserve the five locked UI component tokens exactly.',
    'Do not generate or replace the pipeline utility at functions/index.js.',
    ...requiredTargets.map((target) => `Include an output file that routes to ${target}.`),
  ].join('\n\n');
  const result = await runPipeline({ prompt: routedPrompt, ...pipelineOptions });
  if (!result.validation.valid) {
    throw new Error(`Pipeline output failed validation:\n${result.validation.errors.join('\n')}`);
  }
  if (result.files.length < 5) throw new Error('Full-stack generation must return at least 5 files');
  if (!result.files.some(({ path }) => path.split('/').at(-1).startsWith('backend-') && path.endsWith('.js'))) {
    throw new Error('Full-stack generation must include a backend-*.js script');
  }
  const routedGeneratedFiles = routeGeneratedFiles(result.files);
  const generatedTargets = new Set(routedGeneratedFiles.map(({ target }) => target));
  const missingTargets = requiredTargets.filter((target) => !generatedTargets.has(target));
  if (missingTargets.length) {
    throw new Error(`Generated files are missing required targets: ${missingTargets.join(', ')}`);
  }
  const missingWriteTargets = writeTargets.filter((target) => !generatedTargets.has(target));
  if (missingWriteTargets.length) {
    throw new Error(`Generated files are missing write targets: ${missingWriteTargets.join(', ')}`);
  }
  const filesToWrite = writeTargets.length
    ? writeTargets.map((target) => {
      const { path, content } = routedGeneratedFiles.find((file) => file.target === target);
      return { path, content };
    })
    : result.files;
  const approvedOverwriteTargets = overwriteGeneratedFiles
    ? [...new Set([
      ...overwriteTargets,
      ...routeGeneratedFiles(filesToWrite).map(({ target }) => target),
    ])]
    : overwriteTargets;
  return {
    result,
    written: await writeGeneratedFiles(filesToWrite, {
      repoRoot,
      backendOnly: writeMode === 'backend-only',
      overwriteTargets: approvedOverwriteTargets,
    }),
  };
}

async function main() {
  const args = process.argv.slice(2);
  const writeMode = args[0] === '--backend-only' ? 'backend-only' : 'all';
  if (writeMode === 'backend-only') args.shift();
  const prompt = args.join(' ').trim();
  if (!prompt) throw new Error('Usage: node functions/file-writer.js "Describe the app to generate"');

  const { result, written } = await runAndWrite(prompt, {
    writeMode,
    overwriteGeneratedFiles: true,
  });
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