// Port of base44-functions/startBuild.ts so the same dispatch runs from this app.
// Credentials come from the environment (GITHUB_TOKEN, BUILDER_OWNER, BUILDER_REPO,
// optional ZIP_ALLOWED_HOSTS) and are never exposed to the browser.
import AdmZip from 'adm-zip';

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

/* ---------- Windows runner introspection ----------
 * The workflow's windows job runs on a real Windows machine (windows-latest).
 * These helpers let the UI show what happened on that machine — runs, jobs,
 * steps, logs and installer artifacts — without exposing the token.
 */

const LOG_TAIL_BYTES = 200000;

function githubHint(status) {
  if (status === 401) return 'The GitHub token is invalid or has expired.';
  if (status === 403) return 'The token lacks Actions read access for this repository.';
  if (status === 404) {
    return 'The token cannot see this repository, or the workflow/run no longer exists.';
  }
  if (status === 410) return 'That artifact has expired on GitHub.';
  return 'Check the builder repository, workflow filename and token permissions.';
}

async function ghFetch(pathname, init = {}) {
  const { token, owner, repo } = githubConfig();
  if (!token || !owner || !repo) {
    throw failure(500, { error: 'GitHub backend configuration is missing' });
  }

  return fetch(
    `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${pathname}`,
    {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': API_VERSION,
        ...(init.headers || {}),
      },
    },
  );
}

async function ghJson(pathname) {
  const res = await ghFetch(pathname);
  if (!res.ok) {
    throw failure(502, {
      error: 'GitHub API request failed',
      githubStatus: res.status,
      hint: githubHint(res.status),
    });
  }
  return res.json();
}

// The three variables can all be set while pointing at a repo the token cannot
// read, so report reachability instead of claiming the setup works.
export async function githubStatus() {
  const { token, owner, repo } = githubConfig();
  const base = {
    configured: Boolean(token && owner && repo),
    owner: owner || null,
    repo: repo || null,
    workflow: WORKFLOW_FILE,
  };

  if (!base.configured) {
    return {
      ...base,
      reachable: false,
      workflowPresent: false,
      hint: "Add GITHUB_TOKEN, BUILDER_OWNER and BUILDER_REPO to this app's secrets.",
    };
  }

  const repoRes = await ghFetch('');
  if (!repoRes.ok) {
    return {
      ...base,
      reachable: false,
      workflowPresent: false,
      hint: `${owner}/${repo}: ${githubHint(repoRes.status)}`,
    };
  }

  const workflowRes = await ghFetch(`/actions/workflows/${WORKFLOW_FILE}`);
  return {
    ...base,
    reachable: true,
    workflowPresent: workflowRes.ok,
    hint: workflowRes.ok
      ? null
      : `${owner}/${repo} has no .github/workflows/${WORKFLOW_FILE}. Copy this repository's workflow file into it.`,
  };
}

function toRun(run) {
  return {
    id: run.id,
    name: run.name || 'Workflow run',
    title: run.display_title || '',
    status: run.status,
    conclusion: run.conclusion,
    branch: run.head_branch || '',
    event: run.event,
    createdAt: run.created_at,
    updatedAt: run.updated_at,
    htmlUrl: run.html_url,
  };
}

export async function listRuns(limit = 8) {
  const perPage = Math.min(Math.max(Number(limit) || 8, 1), 20);
  const data = await ghJson(`/actions/runs?per_page=${perPage}`);
  return (data.workflow_runs || []).map(toRun);
}

export async function getRun(runId) {
  const [run, jobs, artifacts] = await Promise.all([
    ghJson(`/actions/runs/${runId}`),
    ghJson(`/actions/runs/${runId}/jobs`),
    ghJson(`/actions/runs/${runId}/artifacts`),
  ]);

  return {
    run: toRun(run),
    jobs: (jobs.jobs || []).map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      conclusion: job.conclusion,
      runner: job.runner_name || null,
      labels: job.labels || [],
      startedAt: job.started_at,
      completedAt: job.completed_at,
      steps: (job.steps || []).map((step) => ({
        number: step.number,
        name: step.name,
        status: step.status,
        conclusion: step.conclusion,
      })),
    })),
    artifacts: (artifacts.artifacts || []).map((artifact) => ({
      id: artifact.id,
      name: artifact.name,
      sizeInBytes: artifact.size_in_bytes,
      expired: artifact.expired,
      downloadUrl: `/api/github/runs/${runId}/artifacts/${artifact.id}`,
    })),
  };
}

// GitHub answers the logs endpoint with a redirect to a signed URL; the token is
// never forwarded there, and the zip is expanded into one readable text blob.
export async function runLogs(runId) {
  const res = await ghFetch(`/actions/runs/${runId}/logs`, { redirect: 'manual' });

  if (res.status === 404) {
    throw failure(409, {
      error: 'Logs are not available yet',
      hint: 'GitHub publishes a run log after the job starts producing output.',
    });
  }

  let zipResponse = res;
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    if (!location) throw failure(502, { error: 'GitHub did not return a log download URL' });
    zipResponse = await fetch(location);
  }
  if (!zipResponse.ok) {
    throw failure(502, {
      error: 'GitHub rejected the log request',
      githubStatus: zipResponse.status,
      hint: githubHint(zipResponse.status),
    });
  }

  const zip = new AdmZip(Buffer.from(await zipResponse.arrayBuffer()));
  const text = zip
    .getEntries()
    .filter((entry) => !entry.isDirectory)
    .map((entry) => `===== ${entry.entryName} =====\n${entry.getData().toString('utf8')}`)
    .join('\n\n');

  return text.length > LOG_TAIL_BYTES
    ? `…(earlier output trimmed)\n${text.slice(-LOG_TAIL_BYTES)}`
    : text;
}

// Streams an artifact zip so a large installer is never buffered in memory.
export async function openArtifact(runId, artifactId) {
  const res = await ghFetch(`/actions/artifacts/${artifactId}/zip`, { redirect: 'manual' });

  let upstream = res;
  if (res.status >= 300 && res.status < 400) {
    const location = res.headers.get('location');
    if (!location) throw failure(502, { error: 'GitHub did not return an artifact URL' });
    upstream = await fetch(location);
  }
  if (!upstream.ok || !upstream.body) {
    throw failure(502, {
      error: 'GitHub artifact download failed',
      githubStatus: upstream.status,
      hint: githubHint(upstream.status),
    });
  }

  return upstream;
}
