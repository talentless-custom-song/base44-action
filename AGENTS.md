# AGENTS.md

## What this repo runs

`docker-compose.base44.yml` runs the BuildHub app from the cloned source (two services):

- `web` — Vite dev server, container port 5173, published on host port **3000** (the preview entry point).
- `api` — Express build server on container port 8000. It has **no host port**; the browser reaches it
  only through the Vite dev-server proxy at `/api` (single origin), so no CORS is involved.

Both containers install dependencies on startup (`npm ci` when a lockfile exists, else `npm install`)
because `node_modules` lives in a named volume, not the image.

The root `Dockerfile` builds the dev image both services use (Debian + git/unzip); it deliberately does
not copy application source, which is bind-mounted instead. The root `package.json` only holds
`up`/`down`/`logs`/`ps` shortcuts for `docker compose`.

## Non-obvious behaviour

- **Real builds run inside the `api` container.** Uploaded archives are extracted to `/tmp/buildhub/<buildId>`,
  then: with a root `package.json` → `npm install` + `npm run build` and the first of
  `dist/ build/ out/ public/` becomes the artifact; without one → the upload is packaged as a static site.
  Builds are serialised (one at a time) by a queue in `api/runner.js`.
- **State lives in a named volume** `buildhub_data` mounted at `/app/data` (`db.json`, `logs/`, `uploads/`,
  `artifacts/`). It survives restarts and image changes; `docker compose down -v` wipes it.
- The API marks any `queued`/`running` build as failed on startup (`recoverInterrupted`), so a build that was
  in flight when the container restarted does not hang forever.
- **Workspace (`api/workspace.js`)** is a GitHub-style file tree stored at `/app/data/workspace` in the
  same volume: create folders/files, edit them, and build straight from the workspace. A workspace build
  records `source: 'workspace'`, and the runner therefore does **not** strip the only top-level folder —
  that wrapper handling is only for uploaded archives. Paths are resolved against the workspace root and
  `..`/absolute paths are rejected.
- **GitHub dispatch (`api/github.js`)** is the `base44-functions/startBuild.ts` logic ported to Node and
  exposed as `POST /api/github/builds` + `GET /api/github/config`. It needs `GITHUB_TOKEN`,
  `BUILDER_OWNER`, `BUILDER_REPO` (and `BUILDER_REF`, default `main`) from `/run/base44/app.env`, wired in
  compose with an optional `env_file` so the app still boots without them. Without credentials it returns
  `500 {"error":"GitHub backend configuration is missing"}`. Its workflow-input names must stay in sync
  with `.github/workflows/desktop-build.yml`. `BUILDER_OWNER` / `BUILDER_REPO` may be bare names or a pasted
  `https://github.com/OWNER/REPO` URL — `resolveRepoRef()` in `api/github.js` normalizes both.
- The builder repository must actually contain `.github/workflows/desktop-build.yml`; dispatching to a repo
  without it answers `502` with a 404 hint. `GET /api/github/config` also probes the repository and the
  workflow file, so it reports `reachable` / `workflowPresent` plus an actionable `hint` instead of claiming
  success just because the three variables are set.
- **Real runner panel (`web/src/components/WindowsRunner.jsx`)** shows what happened on the actual machine:
  `GET /api/github/runs` lists recent runs, `GET /api/github/runs/:id` adds jobs, steps and artifacts,
  `.../logs` returns the whole run log as text and `.../artifacts/:artifactId` streams the artifact zip.
  The token never leaves the API: `api/github.js` follows GitHub's 302 to the signed log/artifact URL
  **without** forwarding the `Authorization` header, and expands the log zip with `adm-zip`.
- Job `labels` name the machine a job used (`windows-latest`, `ubuntu-latest`) and the panel shows them, so
  a run is never presented as Windows when it was not.
- **There is no Windows desktop in this sandbox and port 3000 cannot host one.** The host has no `/dev/kvm`
  and no `vmx`/`svm` CPU flags (no nested virtualisation) and ~7 GB RAM, so a Windows VM cannot run here;
  port 3000 is also the app's own preview entry point. The genuine Windows environment this app offers is a
  `windows-latest` job in GitHub Actions.
- `GET /api/sample.zip` serves a generated two-file static project. The UI's "Download sample project" link
  and quick manual testing both use it.
- `BASE44_PREVIEW_MODE=1` only switches Vite's HMR socket to `wss` on port 443, because the preview is served
  over https through a proxy. Unset (any other value) keeps Vite's default HMR config.
- **No authentication.** This is a local development build server, and it executes uploaded code in the
  `api` container. Do not expose it publicly.

## Verifying it works

```bash
curl -s localhost:3000/api/health                       # {"ok":true}
curl -s -o /tmp/s.zip localhost:3000/api/sample.zip
ID=$(curl -s -X POST -F archive=@/tmp/s.zip -F name=smoke localhost:3000/api/builds | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')
curl -s localhost:3000/api/builds/$ID/logs              # runner output
curl -s -o /tmp/a.zip localhost:3000/api/builds/$ID/artifact
curl -s -X DELETE localhost:3000/api/builds/$ID         # clean up test builds

# workspace: create a file, build it, remove it again
curl -s -X POST -H 'Content-Type: application/json' -d '{"path":"site"}' localhost:3000/api/workspace/folder
curl -s -X PUT  -H 'Content-Type: application/json' -d '{"path":"site/index.html","content":"<h1>hi</h1>"}' localhost:3000/api/workspace/file
curl -s localhost:3000/api/workspace
curl -s -X POST -H 'Content-Type: application/json' -d '{"name":"ws"}' localhost:3000/api/workspace/build
curl -s -X DELETE 'localhost:3000/api/workspace/path?path=site'
```

GitHub dispatch cannot be exercised without credentials; with them set, `POST /api/github/builds` with
`{"sourceMode":"repository","repoUrl":"https://github.com/OWNER/REPO","branch":"main","buildTarget":"both"}`
should answer `202`. Its input validation (`api/github.js`) can be checked without network access by
importing the module with dummy env vars and calling `dispatchBuild` with bad input.

The real-runner endpoints are read-only and safe to repeat; they need the GitHub secrets and a builder repo
that actually holds the workflow:

```bash
curl -s localhost:3000/api/github/config                  # reachable / workflowPresent / hint
curl -s localhost:3000/api/github/runs                    # recent runs, newest first
curl -s localhost:3000/api/github/runs/<run id>           # jobs, steps, artifacts
curl -s localhost:3000/api/github/runs/<run id>/logs      # whole run log as text
curl -s -o /tmp/artifact.zip localhost:3000/api/github/runs/<run id>/artifacts/<artifact id>
```

Do not dispatch a workflow just to verify these routes: a dispatch spends the user's Actions minutes and may
start a real build.

Delete any build you create while testing; there is no seeded data.

## Notes

- Images are Debian-based (`node:22-bookworm-slim`) so native build dependencies that uploaded projects
  need keep working; the api healthcheck uses `node -e fetch(...)` because the slim image has no curl.
- There is no test framework in this repo.
- `BASE44_PROMPT.md`, `docs/SETUP.md` and `base44-functions/startBuild.ts` are the original starter-kit
  material (a Base44-platform Deno function that dispatches GitHub Actions). They are **not** part of the
  running app and need a separate runner repository plus `GITHUB_TOKEN`.
