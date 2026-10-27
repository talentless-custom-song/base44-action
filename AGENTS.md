# AGENTS.md

## What this repo runs

`docker-compose.base44.yml` runs the BuildHub app from the cloned source (two services):

- `web` — Vite dev server, container port 5173, published on host port **3000** (the preview entry point).
- `api` — Express build server on container port 8000. It has **no host port**; the browser reaches it
  only through the Vite dev-server proxy at `/api` (single origin), so no CORS is involved.

Both containers install dependencies on startup (`npm ci` when a lockfile exists, else `npm install`)
because `node_modules` lives in a named volume, not the image.

## Non-obvious behaviour

- **Real builds run inside the `api` container.** Uploaded archives are extracted to `/tmp/buildhub/<buildId>`,
  then: with a root `package.json` → `npm install` + `npm run build` and the first of
  `dist/ build/ out/ public/` becomes the artifact; without one → the upload is packaged as a static site.
  Builds are serialised (one at a time) by a queue in `api/runner.js`.
- **State lives in a named volume** `buildhub_data` mounted at `/app/data` (`db.json`, `logs/`, `uploads/`,
  `artifacts/`). It survives restarts and image changes; `docker compose down -v` wipes it.
- The API marks any `queued`/`running` build as failed on startup (`recoverInterrupted`), so a build that was
  in flight when the container restarted does not hang forever.
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
```

Delete any build you create while testing; there is no seeded data.

## Notes

- Images are Debian-based (`node:22-bookworm-slim`) so native build dependencies that uploaded projects
  need keep working; the api healthcheck uses `node -e fetch(...)` because the slim image has no curl.
- There is no test framework in this repo.
- `BASE44_PROMPT.md`, `docs/SETUP.md` and `base44-functions/startBuild.ts` are the original starter-kit
  material (a Base44-platform Deno function that dispatches GitHub Actions). They are **not** part of the
  running app and need a separate runner repository plus `GITHUB_TOKEN`.
