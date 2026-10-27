// Tiny JSON file store: builds, logs and artifacts live under DATA_DIR.
import fs from 'node:fs/promises';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const DB_FILE = path.join(DATA_DIR, 'db.json');

let cache = { builds: [] };
let writeChain = Promise.resolve();

export function dataDir() {
  return DATA_DIR;
}

export function logPath(id) {
  return path.join(DATA_DIR, 'logs', `${id}.log`);
}

export function archivePath(id) {
  return path.join(DATA_DIR, 'uploads', `${id}.zip`);
}

export function artifactPath(id) {
  return path.join(DATA_DIR, 'artifacts', `${id}.zip`);
}

export async function init() {
  for (const dir of ['', 'logs', 'uploads', 'artifacts']) {
    await fs.mkdir(path.join(DATA_DIR, dir), { recursive: true });
  }
  try {
    const parsed = JSON.parse(await fs.readFile(DB_FILE, 'utf8'));
    if (parsed && Array.isArray(parsed.builds)) cache = parsed;
  } catch {
    // First run: no database yet.
  }
}

export function list() {
  return [...cache.builds].sort((a, b) => b.createdAt - a.createdAt);
}

export function get(id) {
  return cache.builds.find((build) => build.id === id);
}

function persist() {
  const snapshot = JSON.stringify(cache, null, 2);
  writeChain = writeChain.then(() => fs.writeFile(DB_FILE, snapshot)).catch(() => {});
  return writeChain;
}

export async function insert(build) {
  cache.builds.push(build);
  await persist();
  return build;
}

export async function patch(id, fields) {
  const build = get(id);
  if (!build) return null;
  Object.assign(build, fields);
  await persist();
  return build;
}

export async function remove(id) {
  const index = cache.builds.findIndex((build) => build.id === id);
  if (index >= 0) cache.builds.splice(index, 1);
  await persist();
}
