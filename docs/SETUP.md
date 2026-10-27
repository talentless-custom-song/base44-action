# Setup guide

## 1. Create the GitHub runner repository
Create a repository such as `buildhub-runner`. Put `.github/workflows/desktop-build.yml` on the repository's default branch. GitHub requires `workflow_dispatch` to be present on the default branch for manual dispatch.

## 2. Configure Base44 backend
Create backend function `startBuild` from `base44-functions/startBuild.ts` using Base44's supported backend function editor. Confirm the SDK import and secret API against the current Base44 environment.

Configure:
- `GITHUB_TOKEN`: fine-grained token with Actions read/write for the runner repository. Add only permissions required by the workflow.
- `BUILDER_OWNER`: runner repository owner.
- `BUILDER_REPO`: runner repository name.
- `ZIP_ALLOWED_HOSTS`: comma-separated exact hostname allowlist for your private object storage.

Never put the GitHub token in frontend code or a normal database field.

## 3. Test repository-based builds
Use a test Electron repository containing:
- `package.json`
- `package-lock.json`
- electron-builder dependency/configuration
- a valid build script if needed

The workflow expects `package.json` at the source root and outputs in `dist/`. Public source repositories are the easiest test. Private repositories need separately configured read access; the runner repository's default GITHUB_TOKEN does not automatically grant access to arbitrary private repositories.

## 4. ZIP upload is not production-ready by default
The workflow's ZIP input is a prototype. Configure private object storage with short-lived signed URLs, a strict hostname allowlist, file size limits, archive validation, and expiry checks. A URL supplied as a workflow input may appear in workflow run metadata. For production, pass an opaque upload ID and have the runner authenticate to storage using a dedicated secret or identity mechanism.

Never execute the uploaded source in Base44 itself. Use isolated GitHub-hosted or self-hosted runners, and consider untrusted repositories as untrusted code.

## 5. Add run tracking
The starter `startBuild` function only dispatches a workflow. Implement `getBuildStatus` to query:
GET /repos/{owner}/{repo}/actions/runs?event=workflow_dispatch&per_page=20

Correlate the run to the request using a persisted BuildJob record and a unique run identifier. Dispatch API responses do not provide a completed run result; do not mark a build successful from the dispatch response alone.

Implement artifact retrieval:
GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts

Download through the backend after checking that the signed-in user owns the BuildJob. Artifact download URLs expire; fetch a fresh URL when needed.

## 6. Production checklist
- Add persistent BuildJob, BuildArtifact, and ProjectUpload entities with per-user access controls.
- Add rate limiting and duplicate-submission protection.
- Validate branch and repository access server-side.
- Restrict ZIP size and reject path traversal or suspicious archive entries.
- Pin third-party Actions to verified full commit SHAs.
- Avoid logging secrets, signed URLs, or private source contents.
- Test Windows and Linux artifacts on real runs.
