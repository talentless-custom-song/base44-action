Build a full-stack web application named BuildHub, a GitHub Actions-style dashboard for building desktop applications for Windows and Linux.

Create:
- Dashboard overview with total/success/failed/running builds.
- New Build form with source mode (GitHub repository or ZIP upload), repository URL, branch, and target (Windows, Linux, or both).
- Build History, Build Details, Artifacts, GitHub Connection, and Settings pages.
- Responsive mobile-first layout with dark/light theme.
- Console-style logs, actual status, timestamps, errors, and artifact download actions.

Use Base44-native authentication, entities, private file storage, and server-side functions where supported. Connect the Build App button to a backend function named `startBuild`; do not simulate builds or use fake success states.

Security:
- Store GitHub tokens only in backend secrets.
- Authenticate all backend calls and check record ownership.
- Do not execute uploaded source code inside Base44.
- Validate repository URLs and uploaded archives.
- Do not expose private source files or credentials in frontend code or logs.
- Do not claim ZIP builds work until private storage and runner transfer are configured and tested.

Create entities:
1. BuildJob: userId, repository, branch, workflowRunId, target, status, createdAt, completedAt, errorSummary.
2. BuildArtifact: buildJobId, artifactId, name, size, expiresAt.
3. ProjectUpload: userId, filename, privateStorageRef, size, status, createdAt.

Implement backend functions:
- `startBuild`: validate the request and dispatch GitHub Actions.
- `getBuildStatus`: retrieve actual run status from GitHub.
- `getBuildArtifacts`: retrieve artifacts for an authorized run and provide an authorized download action.

Prioritize repository-based builds first. Build artifacts using the GitHub Actions runner. Provide setup instructions and actionable errors for missing workflows, permissions, failed builds, and expired artifacts.
