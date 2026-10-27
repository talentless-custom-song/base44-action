// Port of base44-functions/startBuild.ts so the same dispatch runs from this app.
// Credentials come from the environment (GITHUB_TOKEN, BUILDER_OWNER, BUILDER_REPO,
// optional ZIP_ALLOWED_HOSTS) and are never exposed to the browser.
const GITHUB_API = 'https://api.github.com';
const API_VERSION = '2022-11-28';
const WORKFLOW_FILE = 'desktop-build.yml';
const DISPATCH_REF = process.env.BUILDER_REF || 'main';

// BUILDER_OWNER / BUILDER_REPO are often pasted from the browser as
// "https://github.com/OWNER/REPO", so accept a bare name, "owner/repo" or a URL.
function splitRef(value) {
  return (value || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\.git$/i, '')
    .split(/[/?#]/)
    .filter(Boolean)
    .filter((part, index) => index > 0 || part.toLowerCase() !== 'github.com')
    .map((part) => decodeURIComponent(part));
}

function resolveRepoRef() {
  const ownerParts = splitRef(process.env.BUILDER_OWNER);
  const repoParts = splitRef(process.env.BUILDER_REPO);
  const valid = (part) => /^[A-Za-z0-9_.-]+$/.test(part);

  // A full "owner/repo" reference is the most specific, from either variable.
  const pair = repoParts.length >= 2 ? repoParts : ownerParts.length >= 2 ? ownerParts : null;
  if (pair && valid(pair[0]) && valid(pair[1])) return { owner: pair[0], repo: pair[1] };

  const owner = ownerParts[0] || '';
  const repo = repoParts[0] || '';
  return {
    owner: valid(owner) ? owner : '',
    repo: valid(repo) ? repo : '',
  };
}

export function githubConfig() {
  return {
    token: (process.env.GITHUB_TOKEN || '').trim(),
    ...resolveRepoRef(),
  };
}

export function isGithubConfigured() {
  const { token, owner, repo } = githubConfig();
  return Boolean(token && owner && repo);
}

function failure(status, body) {
  const error = new Error(body.error);
  error.status = status;
  error.body = body;
  return error;
}

export async function dispatchBuild(body = {}) {
  const { token, owner, repo } = githubConfig();
  if (!token || !owner || !repo) {
    throw failure(500, { error: 'GitHub backend configuration is missing' });
  }

  const mode = body.sourceMode;
  const target = body.buildTarget;
  const branch = body.branch || 'main';

  if (!['repository', 'zip'].includes(mode)) {
    throw failure(400, { error: 'Invalid source mode' });
  }
  if (!['both', 'windows', 'linux'].includes(target)) {
    throw failure(400, { error: 'Invalid build target' });
  }
  if (
    typeof branch !== 'string' ||
    !/^[A-Za-z0-9._/-]{1,200}$/.test(branch) ||
    branch.startsWith('/') ||
    branch.includes('..') ||
    branch.endsWith('/')
  ) {
    throw failure(400, { error: 'Invalid branch' });
  }

  const inputs = { source_mode: mode, source_branch: branch, build_target: target };

  if (mode === 'repository') {
    if (typeof body.repoUrl !== 'string') {
      throw failure(400, { error: 'GitHub repository URL required' });
    }

    let url;
    try {
      url = new URL(body.repoUrl);
    } catch {
      throw failure(400, { error: 'Invalid repository URL' });
    }

    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'github.com' ||
      url.username ||
      url.password ||
      url.port
    ) {
      throw failure(400, { error: 'Only github.com URLs are allowed' });
    }

    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 2 || !parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part))) {
      throw failure(400, { error: 'Expected https://github.com/OWNER/REPO' });
    }

    const repoName = parts[1].replace(/\.git$/, '');
    if (!repoName) throw failure(400, { error: 'Invalid repository' });
    inputs.source_repo = `${parts[0]}/${repoName}`;
  } else {
    if (typeof body.zipUrl !== 'string') {
      throw failure(400, { error: 'Upload ZIP before building' });
    }

    let url;
    try {
      url = new URL(body.zipUrl);
    } catch {
      throw failure(400, { error: 'Invalid ZIP URL' });
    }

    const allowedHosts = (process.env.ZIP_ALLOWED_HOSTS || '')
      .split(',')
      .map((host) => host.trim())
      .filter(Boolean);

    if (
      url.protocol !== 'https:' ||
      !allowedHosts.includes(url.hostname) ||
      url.username ||
      url.password
    ) {
      throw failure(400, { error: 'ZIP URL host is not approved' });
    }

    inputs.source_zip_url = url.toString();
  }

  const dispatch = await fetch(
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: DISPATCH_REF, inputs }),
    },
  );

  if (!dispatch.ok) {
    throw failure(502, {
      error: 'GitHub rejected the workflow dispatch',
      githubStatus: dispatch.status,
      hint:
        dispatch.status === 404
          ? 'Check the builder repository, workflow filename, default branch, and token access.'
          : dispatch.status === 401 || dispatch.status === 403
            ? 'Check token permissions and Actions access.'
            : 'Check workflow inputs and repository configuration.',
    });
  }

  return {
    ok: true,
    status: 'queued',
    message: 'GitHub accepted the workflow dispatch request.',
    actionsUrl: `https://github.com/${owner}/${repo}/actions`,
    sourceMode: mode,
    buildTarget: target,
    repository: inputs.source_repo || null,
  };
}
