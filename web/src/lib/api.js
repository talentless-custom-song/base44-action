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
