// Build runner: extracts an uploaded archive and really builds it, then packages
// the output as a downloadable artifact. One build runs at a time.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import * as store from './store.js';

const WORK_ROOT = process.env.BUILD_WORKDIR || '/tmp/buildhub';
const BUILD_TIMEOUT_MS = Number(process.env.BUILD_TIMEOUT_MS || 600000);
const OUTPUT_CANDIDATES = ['dist', 'build', 'out', 'public'];

const queue = [];
let active = null;

export async function recoverInterrupted() {
  for (const build of store.list()) {
    if (build.status === 'queued' || build.status === 'running') {
      await store.patch(build.id, {
        status: 'failed',
        finishedAt: Date.now(),
        errorSummary: 'Build was interrupted by a server restart.',
      });
    }
  }
}

export function enqueue(id) {
  queue.push(id);
  pump();
}

async function pump() {
  if (active) return;
  const id = queue.shift();
  if (!id) return;
  active = id;
  try {
    await execute(id);
  } catch (err) {
    await finishFailed(id, err);
  } finally {
    active = null;
    pump();
  }
}

function appendLog(id, chunk) {
  const text = String(chunk).replace(/\r/g, '');
  if (!text) return;
  try {
    fs.appendFileSync(store.logPath(id), text.endsWith('\n') ? text : `${text}\n`);
  } catch {
    // Logging must never break a build.
  }
}

function run(id, command, cwd) {
  return new Promise((resolve, reject) => {
    appendLog(id, `$ ${command}`);
    const child = spawn(command, {
      shell: true,
      cwd,
      env: { ...process.env, CI: '1', npm_config_fund: 'false', npm_config_audit: 'false' },
    });

    const timer = setTimeout(() => {
      appendLog(id, `Build timed out after ${Math.round(BUILD_TIMEOUT_MS / 1000)}s`);
      child.kill('SIGKILL');
    }, BUILD_TIMEOUT_MS);

    child.stdout.on('data', (data) => appendLog(id, data.toString()));
    child.stderr.on('data', (data) => appendLog(id, data.toString()));
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`"${command}" exited with code ${code}`));
    });
  });
}

async function execute(id) {
  const build = store.get(id);
  if (!build) return;

  const startedAt = Date.now();
  await store.patch(id, { status: 'running', startedAt });
  appendLog(id, `BuildHub runner — starting "${build.name}"`);

  const work = path.join(WORK_ROOT, id);
  await fsp.rm(work, { recursive: true, force: true });
  await fsp.mkdir(work, { recursive: true });

  const zip = new AdmZip(store.archivePath(id));
  const entries = zip.getEntries();
  for (const entry of entries) {
    const name = entry.entryName;
    if (name.startsWith('/') || name.includes('..') || /^[a-zA-Z]:/.test(name)) {
      throw new Error(`Archive contains an unsafe path: ${name}`);
    }
  }
  zip.extractAllTo(work, true);
  appendLog(id, `Extracted ${entries.length} entries from ${build.archiveName}`);

  const root = await projectRoot(work);
  let outputDir = root;

  const pkgPath = path.join(root, 'package.json');
  if (fs.existsSync(pkgPath)) {
    appendLog(id, 'Detected a Node.js project (package.json at the archive root)');
    let pkg = {};
    try {
      pkg = JSON.parse(await fsp.readFile(pkgPath, 'utf8'));
    } catch {
      throw new Error('package.json is not valid JSON');
    }

    await run(id, 'npm install --no-audit --no-fund --loglevel=error', root);

    if (pkg.scripts && pkg.scripts.build) {
      await run(id, 'npm run build', root);
      const found = OUTPUT_CANDIDATES.map((name) => path.join(root, name)).find(
        (candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isDirectory(),
      );
      if (!found) {
        throw new Error(`The build finished but produced no ${OUTPUT_CANDIDATES.join('/, ')} directory.`);
      }
      outputDir = found;
    } else {
      appendLog(id, 'No "build" script in package.json — packaging the project as-is');
    }
  } else {
    appendLog(id, 'No package.json found — packaging the upload as a static site');
  }

  const fileCount = countFiles(outputDir);
  if (!fileCount) throw new Error('Nothing to package: the output directory is empty.');

  const artifactFile = store.artifactPath(id);
  const outputZip = new AdmZip();
  addDirToZip(outputZip, outputDir, '');
  await fsp.rm(artifactFile, { force: true });
  outputZip.writeZip(artifactFile);
  const size = fs.statSync(artifactFile).size;

  const finishedAt = Date.now();
  await store.patch(id, {
    status: 'success',
    finishedAt,
    durationMs: finishedAt - startedAt,
    errorSummary: null,
    artifact: {
      name: `${slugify(build.name)}-${id.slice(0, 8)}.zip`,
      size,
      files: fileCount,
    },
  });
  appendLog(id, `Build succeeded — ${fileCount} file(s), ${size} bytes packaged.`);
}

async function finishFailed(id, err) {
  const message = err && err.message ? err.message : 'Unknown error';
  appendLog(id, `Build failed: ${message}`);
  const build = store.get(id);
  const startedAt = (build && build.startedAt) || Date.now();
  const finishedAt = Date.now();
  await store.patch(id, {
    status: 'failed',
    finishedAt,
    durationMs: finishedAt - startedAt,
    errorSummary: message.slice(0, 500),
  });
}

async function projectRoot(dir) {
  const entries = (await fsp.readdir(dir, { withFileTypes: true })).filter(
    (entry) => entry.name !== '__MACOSX' && entry.name !== '.DS_Store',
  );
  if (entries.length === 1 && entries[0].isDirectory()) {
    return path.join(dir, entries[0].name);
  }
  return dir;
}

function addDirToZip(zip, dir, prefix) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) addDirToZip(zip, full, relative);
    else if (entry.isFile()) zip.addFile(relative, fs.readFileSync(full));
  }
}

function countFiles(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += countFiles(full);
    else if (entry.isFile()) total += 1;
  }
  return total;
}

function slugify(value) {
  const slug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'build';
}

// A tiny dependency-free project so anyone can try a build straight away.
export function sampleZipBuffer() {
  const zip = new AdmZip();
  zip.addFile(
    'index.html',
    Buffer.from(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Built by BuildHub</title>
    <link rel="stylesheet" href="assets/style.css" />
  </head>
  <body>
    <main>
      <h1>Hello from BuildHub</h1>
      <p>This page was packaged by a real build run.</p>
    </main>
  </body>
</html>
`),
  );
  zip.addFile(
    'assets/style.css',
    Buffer.from(`:root { color-scheme: dark; }
body {
  margin: 0;
  min-height: 100vh;
  display: grid;
  place-items: center;
  background: #0d1117;
  color: #e6edf3;
  font-family: ui-sans-serif, system-ui, sans-serif;
}
main { text-align: center; }
h1 { margin: 0 0 8px; font-size: 2rem; }
p { margin: 0; color: #8b949e; }
`),
  );
  return zip.toBuffer();
}
