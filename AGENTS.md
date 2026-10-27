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
  without it answers `502` with a 404 hint. `GET /api/github/config` only reports that the three variables
  are set, not that they resolve to a reachable repo.
- **Remote desktop (`web/src/components/RemoteDesktop.jsx`)** is a real VNC client (noVNC) with one
  profile per Windows image (10 / 10.5 / 11 / 11.2). Each profile's websockify URL and password live in
  `localStorage` (`buildhub.remote.<id>`); nothing about a session is stored server-side. No Windows image
  ships with the repo — a profile only works once it points at a reachable VNC endpoint.
- The browser reaches that endpoint through `api/remoteProxy.js`, which upgrades
  `/api/remote/socket?target=<ws url>` and pipes it to the VNC server; `web/vite.config.js` proxies `/api`
  with `ws: true`. This keeps the session same-origin, because the preview is https and the images expose
  plain `ws://` (mixed content). Frames the client sends before the upstream socket opens are buffered.
- noVNC 1.7 needs top-level await, so `web/vite.config.js` sets `build.target` and
  `optimizeDeps.esbuildOptions.target` to `esnext`; without it the dev server dies on startup.
- noVNC has no public pointer API: `RemoteDesktop` sends keys with `rfb.sendKey(keysym, code, down)` and the
  pointer with the internal `rfb._sendMouse`, converting its framebuffer cursor to view coordinates because
  noVNC maps view pixels onto the framebuffer itself. `VirtualKeyboard` types through X keysyms
  (`web/src/lib/keysyms.js`) and forwards the phone's own keyboard through a hidden input.
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

The remote desktop can be checked without Windows: run a WebSocket echo server on `127.0.0.1:9999` inside the
`api` container and connect to `ws://127.0.0.1:8000/api/remote/socket?target=ws%3A%2F%2F127.0.0.1%3A9999`
(and to the same path through `web:5173`) to prove the proxy pipes frames both ways. Driving the panel itself
needs an RFB peer — a throwaway RFB 3.8 stub that completes the handshake and answers
`FramebufferUpdateRequest` with one raw rectangle is enough to see the session go Live, send keys and pointer
events, and confirm `KeyEvent`/`PointerEvent` frames arrive. Clean up the stub and its `/tmp` files afterwards.

Delete any build you create while testing; there is no seeded data.

## Notes

- Images are Debian-based (`node:22-bookworm-slim`) so native build dependencies that uploaded projects
  need keep working; the api healthcheck uses `node -e fetch(...)` because the slim image has no curl.
- There is no test framework in this repo.
- `BASE44_PROMPT.md`, `docs/SETUP.md` and `base44-functions/startBuild.ts` are the original starter-kit
  material (a Base44-platform Deno function that dispatches GitHub Actions). They are **not** part of the
  running app and need a separate runner repository plus `GITHUB_TOKEN`.
