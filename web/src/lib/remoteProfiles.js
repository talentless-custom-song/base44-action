// One entry per Windows image the build server can drive over VNC.
// Each profile keeps its own endpoint, so a session can point at the VM that
// runs that Windows version.
export const REMOTE_PROFILES = [
  { id: 'win10', label: 'Windows 10', hint: '1909 / 22H2 image' },
  { id: 'win105', label: 'Windows 10.5', hint: 'Windows 10.5 image' },
  { id: 'win11', label: 'Windows 11', hint: '23H2 image' },
  { id: 'win112', label: 'Windows 11.2', hint: 'Windows 11.2 image' },
];

const STORAGE_PREFIX = 'buildhub.remote.';

export function loadProfileSettings(id) {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return { url: '', password: '' };
    const parsed = JSON.parse(raw);
    return { url: parsed.url || '', password: parsed.password || '' };
  } catch {
    return { url: '', password: '' };
  }
}

export function saveProfileSettings(id, settings) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(settings));
  } catch {
    /* private browsing — the session still works, it just is not remembered */
  }
}

// ws://localhost:6080/websockify — websockify's port for the profile's VNC server.
export function toSocketUrl(url, { throughApp }) {
  const trimmed = (url || '').trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') return null;
  if (!throughApp) return parsed.toString();
  const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${window.location.host}/api/remote/socket?target=${encodeURIComponent(parsed.toString())}`;
}
