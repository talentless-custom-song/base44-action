// GitHub-style workspace: create folders and files from the dashboard and build them.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import AdmZip from 'adm-zip';
import * as store from './store.js';
import { addDirToZip } from './runner.js';

const ROOT = path.join(store.dataDir(), 'workspace');
const MAX_FILE_BYTES = 512 * 1024;
const MAX_PATH_LENGTH = 200;

export async function initWorkspace() {
  await fsp.mkdir(ROOT, { recursive: true });
}

function resolvePath(relative) {
  const value = String(relative || '').trim();
  if (!value) throw badRequest('A path is required');
  if (value.length > MAX_PATH_LENGTH) throw badRequest('That path is too long');
  if (value.includes('..') || value.startsWith('/') || /^[a-zA-Z]:/.test(value)) {
    throw badRequest('Invalid path');
  }

  const full = path.resolve(ROOT, value);
  if (full !== ROOT && !full.startsWith(`${ROOT}${path.sep}`)) {
    throw badRequest('Invalid path');
  }
  return full;
}

export function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

export async function tree() {
  const entries = [];

  async function walk(dir, prefix) {
    const items = await fsp.readdir(dir, { withFileTypes: true });
    items.sort((a, b) => {
      if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    for (const item of items) {
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      if (item.isDirectory()) {
        entries.push({ path: relative, type: 'dir' });
        await walk(path.join(dir, item.name), relative);
      } else {
        const stats = await fsp.stat(path.join(dir, item.name));
        entries.push({ path: relative, type: 'file', size: stats.size });
      }
    }
  }

  await walk(ROOT, '');
  return entries;
}

export async function readFile(relative) {
  const full = resolvePath(relative);
  const stats = await fsp.stat(full).catch(() => null);
  if (!stats || !stats.isFile()) throw notFound('File not found');
  if (stats.size > MAX_FILE_BYTES) throw badRequest('That file is too large to edit here');
  return fsp.readFile(full, 'utf8');
}

export async function writeFile(relative, content) {
  const full = resolvePath(relative);
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) {
    throw badRequest('That file is too large to edit here');
  }
  await fsp.mkdir(path.dirname(full), { recursive: true });
  await fsp.writeFile(full, content, 'utf8');
  return { path: String(relative).trim(), type: 'file' };
}

export async function createFolder(relative) {
  const full = resolvePath(relative);
  await fsp.mkdir(full, { recursive: true });
  return { path: String(relative).trim(), type: 'dir' };
}

export async function removeEntry(relative) {
  const full = resolvePath(relative);
  const stats = await fsp.stat(full).catch(() => null);
  if (!stats) throw notFound('Path not found');
  await fsp.rm(full, { recursive: true, force: true });
  return { path: String(relative).trim() };
}

export async function hasFiles() {
  const entries = await tree();
  return entries.some((entry) => entry.type === 'file');
}

export async function writeZip(target) {
  const zip = new AdmZip();
  addDirToZip(zip, ROOT, '');
  await fsp.rm(target, { force: true });
  zip.writeZip(target);
  return fs.statSync(target).size;
}

function notFound(message) {
  const error = new Error(message);
  error.status = 404;
  return error;
}

export { ROOT as workspaceRoot };
