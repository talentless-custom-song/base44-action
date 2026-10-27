// BuildHub API: upload an archive, start a real build, follow the logs, grab the artifact.
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import AdmZip from 'adm-zip';
import * as store from './store.js';
import { enqueue, recoverInterrupted, sampleZipBuffer } from './runner.js';

const PORT = Number(process.env.PORT || 8000);
const MAX_UPLOAD_BYTES = Number(process.env.MAX_UPLOAD_BYTES || 50 * 1024 * 1024);
const WORK_ROOT = process.env.BUILD_WORKDIR || '/tmp/buildhub';
const LOG_TAIL_BYTES = 200000;

await store.init();
await recoverInterrupted();

const app = express();
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_BYTES },
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true });
});

app.get('/api/sample.zip', (req, res) => {
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', 'attachment; filename="buildhub-sample.zip"');
  res.send(sampleZipBuffer());
});

app.get('/api/builds', (req, res) => {
  res.json({ builds: store.list() });
});

app.get('/api/builds/:id', (req, res) => {
  const build = store.get(req.params.id);
  if (!build) return res.status(404).json({ error: 'Build not found' });
  return res.json({ build });
});

app.get('/api/builds/:id/logs', async (req, res) => {
  const build = store.get(req.params.id);
  if (!build) return res.status(404).json({ error: 'Build not found' });

  let logs = '';
  try {
    logs = await fsp.readFile(store.logPath(build.id), 'utf8');
  } catch {
    logs = '';
  }
  if (logs.length > LOG_TAIL_BYTES) {
    logs = `…(earlier output trimmed)\n${logs.slice(-LOG_TAIL_BYTES)}`;
  }
  return res.json({ logs, status: build.status });
});

app.post('/api/builds', upload.single('archive'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Choose a .zip archive to build' });
  if (!/\.zip$/i.test(req.file.originalname)) {
    return res.status(400).json({ error: 'Only .zip archives are supported' });
  }

  let entryCount = 0;
  try {
    entryCount = new AdmZip(req.file.buffer).getEntries().length;
  } catch {
    return res.status(400).json({ error: 'That file is not a readable ZIP archive' });
  }
  if (!entryCount) return res.status(400).json({ error: 'The ZIP archive is empty' });

  const id = crypto.randomUUID();
  const fallbackName = req.file.originalname.replace(/\.zip$/i, '');
  const name = String(req.body.name || '').trim().slice(0, 120) || fallbackName;

  await fsp.writeFile(store.archivePath(id), req.file.buffer);
  await store.insert({
    id,
    name,
    status: 'queued',
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    durationMs: null,
    archiveName: req.file.originalname,
    archiveSize: req.file.size,
    errorSummary: null,
    artifact: null,
  });

  enqueue(id);
  return res.status(201).json({ build: store.get(id) });
});

app.get('/api/builds/:id/artifact', (req, res) => {
  const build = store.get(req.params.id);
  if (!build) return res.status(404).json({ error: 'Build not found' });
  if (!build.artifact) return res.status(409).json({ error: 'This build has no artifact yet' });

  const artifactFile = store.artifactPath(build.id);
  if (!fs.existsSync(artifactFile)) {
    return res.status(410).json({ error: 'The artifact file is no longer on disk' });
  }
  return res.download(artifactFile, build.artifact.name);
});

app.delete('/api/builds/:id', async (req, res) => {
  const build = store.get(req.params.id);
  if (!build) return res.status(404).json({ error: 'Build not found' });

  await store.remove(build.id);
  for (const file of [
    store.logPath(build.id),
    store.archivePath(build.id),
    store.artifactPath(build.id),
  ]) {
    await fsp.rm(file, { force: true });
  }
  await fsp.rm(path.join(WORK_ROOT, build.id), { recursive: true, force: true });
  return res.json({ ok: true });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`BuildHub API listening on ${PORT}`);
});
