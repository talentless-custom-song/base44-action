# BuildHub — Base44 + GitHub Actions starter

This ZIP is a **starter kit**, not a directly importable Base44 application. Use the prompt and setup guide to create the UI in Base44, then configure the backend function and GitHub Actions workflow.

## Running BuildHub locally

The repository now also contains a working BuildHub app you can run and preview:

```bash
docker compose -f docker-compose.base44.yml up -d --build
```

Then open port 3000. You get a dashboard with build stats, a drop zone for a project `.zip`, a **Build**
button, a live build console, and downloadable artifacts.

- Upload a `.zip` of a project. If the archive root has a `package.json`, the runner does a real
  `npm install` + `npm run build` and packages `dist/` (or `build/`, `out/`, `public/`). Otherwise the
  upload is packaged as a static site.
- Builds run in the `api` container, one at a time, with logs streamed back to the dashboard.
- "Download sample project" gives you a tiny archive to try the flow immediately.
- No credentials are needed for this local runner. Repository-based builds on GitHub Actions are the
  separate `base44-functions/startBuild.ts` path described below, which requires a runner repository,
  `GITHUB_TOKEN`, `BUILDER_OWNER` and `BUILDER_REPO`.
- There is no authentication: this is a development build server and it executes uploaded code, so do not
  expose it publicly.

## Included
- `BASE44_PROMPT.md` — prompt to paste into the Base44 AI builder.
- `.github/workflows/desktop-build.yml` — example Electron build workflow for Windows and Linux.
- `base44-functions/startBuild.ts` — starter Base44 backend function to dispatch the workflow.
- `docs/SETUP.md` — setup and security notes.

## Important limitations
- The example build workflow expects a Node.js/Electron project with `package.json`, `package-lock.json`, and an electron-builder-compatible configuration.
- Public GitHub repositories are the simplest starting point. Private source repositories need separately configured read access.
- ZIP builds are **not enabled end-to-end by default**. You must configure private object storage, short-lived signed URLs, and runner access. Avoid putting long-lived credentials in workflow inputs.
- The `startBuild` function dispatches a workflow but does not yet persist build records or poll run status. Add those functions/entities in Base44 before calling the app production-ready.
- Review and pin third-party GitHub Actions to verified full commit SHAs before production use.
