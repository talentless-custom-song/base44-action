// Base44 backend function starter.
// Configure backend secrets/variables:
// GITHUB_TOKEN, BUILDER_OWNER, BUILDER_REPO, ZIP_ALLOWED_HOSTS
//
// This function dispatches the workflow only. It does not persist a BuildJob
// or track the run; implement those separately before production deployment.

import { createClientFromRequest } from "npm:@base44/sdk";

const GITHUB_API = "https://api.github.com";
const API_VERSION = "2022-11-28";

function json(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "POST required" }, 405);

  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return json({ error: "Authentication required" }, 401);

    const token = Deno.env.get("GITHUB_TOKEN");
    const owner = Deno.env.get("BUILDER_OWNER");
    const repo = Deno.env.get("BUILDER_REPO");

    if (!token || !owner || !repo) {
      return json({ error: "GitHub backend configuration is missing" }, 500);
    }

    const body = await req.json();
    const mode = body.sourceMode;
    const target = body.buildTarget;
    const branch = body.branch || "main";

    if (!["repository", "zip"].includes(mode)) {
      return json({ error: "Invalid source mode" }, 400);
    }
    if (!["both", "windows", "linux"].includes(target)) {
      return json({ error: "Invalid build target" }, 400);
    }
    if (
      typeof branch !== "string" ||
      !/^[A-Za-z0-9._/-]{1,200}$/.test(branch) ||
      branch.startsWith("/") ||
      branch.includes("..") ||
      branch.endsWith("/")
    ) {
      return json({ error: "Invalid branch" }, 400);
    }

    const inputs: Record<string, string> = {
      source_mode: mode,
      source_branch: branch,
      build_target: target,
    };

    if (mode === "repository") {
      if (typeof body.repoUrl !== "string") {
        return json({ error: "GitHub repository URL required" }, 400);
      }

      let url: URL;
      try {
        url = new URL(body.repoUrl);
      } catch {
        return json({ error: "Invalid repository URL" }, 400);
      }

      if (
        url.protocol !== "https:" ||
        url.hostname !== "github.com" ||
        url.username ||
        url.password ||
        url.port
      ) {
        return json({ error: "Only github.com URLs are allowed" }, 400);
      }

      const parts = url.pathname.split("/").filter(Boolean);
      if (
        parts.length !== 2 ||
        !parts.every((part) => /^[A-Za-z0-9_.-]+$/.test(part))
      ) {
        return json({ error: "Expected https://github.com/OWNER/REPO" }, 400);
      }

      const repoName = parts[1].replace(/\.git$/, "");
      if (!repoName) return json({ error: "Invalid repository" }, 400);

      inputs.source_repo = `${parts[0]}/${repoName}`;
    } else {
      if (typeof body.zipUrl !== "string") {
        return json({ error: "Upload ZIP before building" }, 400);
      }

      let url: URL;
      try {
        url = new URL(body.zipUrl);
      } catch {
        return json({ error: "Invalid ZIP URL" }, 400);
      }

      const allowedHosts = (Deno.env.get("ZIP_ALLOWED_HOSTS") || "")
        .split(",").map((host) => host.trim()).filter(Boolean);

      if (
        url.protocol !== "https:" ||
        !allowedHosts.includes(url.hostname) ||
        url.username ||
        url.password
      ) {
        return json({ error: "ZIP URL host is not approved" }, 400);
      }

      // Prototype only: URL can be visible in workflow inputs/run metadata.
      // For production, pass an opaque upload ID and authenticate the runner
      // to private storage rather than exposing a signed URL in workflow input.
      inputs.source_zip_url = url.toString();
    }

    const dispatch = await fetch(
      `${GITHUB_API}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/actions/workflows/desktop-build.yml/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": API_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main", inputs }),
      },
    );

    if (!dispatch.ok) {
      return json({
        error: "GitHub rejected the workflow dispatch",
        status: dispatch.status,
        hint: dispatch.status === 404
          ? "Check the builder repository, workflow filename, default branch, and token access."
          : dispatch.status === 401 || dispatch.status === 403
          ? "Check token permissions and Actions access."
          : "Check workflow inputs and repository configuration.",
      }, 502);
    }

    return json({
      ok: true,
      status: "queued",
      message: "GitHub accepted the workflow dispatch request.",
      actionsUrl: `https://github.com/${owner}/${repo}/actions`,
      sourceMode: mode,
      buildTarget: target,
      requestedBy: user.id,
    }, 202);
  } catch {
    return json({ error: "Unexpected backend error" }, 500);
  }
});
