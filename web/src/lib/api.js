async function toJson(res) {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const fetchBuilds = () => fetch('/api/builds').then(toJson).then((d) => d.builds);
export const fetchBuild = (id) => fetch(`/api/builds/${id}`).then(toJson).then((d) => d.build);
export const fetchLogs = (id) => fetch(`/api/builds/${id}/logs`).then(toJson);
export const deleteBuild = (id) => fetch(`/api/builds/${id}`, { method: 'DELETE' }).then(toJson);

export function createBuild(file, name) {
  const form = new FormData();
  form.append('archive', file);
  if (name) form.append('name', name);
  return fetch('/api/builds', { method: 'POST', body: form }).then(toJson).then((d) => d.build);
}

export const artifactUrl = (id) => `/api/builds/${id}/artifact`;

/* ---------- workspace ---------- */

export const fetchWorkspace = () => fetch('/api/workspace').then(toJson).then((d) => d.files);

export const readWorkspaceFile = (filePath) =>
  fetch(`/api/workspace/file?path=${encodeURIComponent(filePath)}`)
    .then(toJson)
    .then((d) => d.content);

const jsonRequest = (url, method, payload) =>
  fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).then(toJson);

export const writeWorkspaceFile = (filePath, content) =>
  jsonRequest('/api/workspace/file', 'PUT', { path: filePath, content });

export const createWorkspaceFolder = (folderPath) =>
  jsonRequest('/api/workspace/folder', 'POST', { path: folderPath });

export const deleteWorkspacePath = (entryPath) =>
  fetch(`/api/workspace/path?path=${encodeURIComponent(entryPath)}`, { method: 'DELETE' }).then(
    toJson,
  );

export const buildWorkspace = (name) =>
  jsonRequest('/api/workspace/build', 'POST', { name }).then((d) => d.build);

/* ---------- GitHub Actions dispatch ---------- */

export const fetchGithubConfig = () => fetch('/api/github/config').then(toJson);

export const dispatchGithubBuild = (payload) =>
  jsonRequest('/api/github/builds', 'POST', payload);
