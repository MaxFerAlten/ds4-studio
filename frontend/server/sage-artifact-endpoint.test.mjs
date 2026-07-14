import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import express from "express";
import {
  mkdtemp,
  mkdir,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile
} from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  diffSageArtifacts,
  listSageArtifacts,
  resolveSageArtifactById,
  sageRunDir,
  sageSessionDir,
  sanitizeSessionId
} from "./agentTools.mjs";

const CONTENT_TYPES = Object.freeze({
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".csv": "text/csv; charset=utf-8",
  ".json": "application/json; charset=utf-8"
});

function buildArtifactHandler(workspaceRoot) {
  return async (req, res) => {
    if (/^sha256:[a-f0-9]{64}$/.test(String(req.params.fileName || ""))) {
      const artifact = await resolveSageArtifactById(
        workspaceRoot,
        req.params.sessionId,
        req.params.fileName
      );
      if (!artifact) {
        res.status(404).json({ error: "artifact not found" });
        return;
      }
      res.setHeader("Content-Type", artifact.mediaType);
      res.setHeader("Cache-Control", "private, max-age=31536000, immutable");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.sendFile(artifact.physicalPath);
      return;
    }

    const sessionId = sanitizeSessionId(req.params.sessionId);
    const fileName = String(req.params.fileName || "");
    if (!fileName || path.basename(fileName) !== fileName ||
        path.win32.basename(fileName) !== fileName) {
      res.status(400).json({ error: "invalid artifact name" });
      return;
    }

    const contentType = CONTENT_TYPES[path.extname(fileName).toLowerCase()];
    if (!contentType) {
      res.status(400).json({ error: "unsupported artifact type" });
      return;
    }

    const artifactDir = sageSessionDir(workspaceRoot, sessionId);
    let realDir;
    let realFile;
    let stats;
    try {
      realDir = await realpath(artifactDir);
      realFile = await realpath(path.join(realDir, fileName));
      const relative = path.relative(realDir, realFile);
      if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
        res.status(400).json({ error: "invalid artifact path" });
        return;
      }
      stats = await stat(realFile);
    } catch {
      res.status(404).json({ error: "artifact not found" });
      return;
    }

    if (!stats.isFile()) {
      res.status(404).json({ error: "artifact not found" });
      return;
    }

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "private, max-age=3600");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(realFile);
  };
}

async function withArtifactServer(workspaceRoot, fn) {
  const app = express();
  app.get("/api/sage/artifacts/:sessionId/:fileName", buildArtifactHandler(workspaceRoot));
  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await fn(baseUrl);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function withWorkspace(fn) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "ds4-sage-artifact-route-"));
  try {
    return await fn(workspace);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
}

test("GET Sage artifact serves a PNG with private caching", async () => {
  await withWorkspace(async (workspace) => {
    const dir = sageSessionDir(workspace, "session-1");
    await mkdir(dir);
    await writeFile(path.join(dir, "plot.png"), Buffer.from("png-data"));

    await withArtifactServer(workspace, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sage/artifacts/session-1/plot.png`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/png");
      assert.equal(response.headers.get("cache-control"), "private, max-age=3600");
      assert.equal(await response.text(), "png-data");
    });
  });
});

test("GET Sage artifact rejects encoded traversal", async () => {
  await withWorkspace(async (workspace) => {
    await mkdir(sageSessionDir(workspace, "session"));
    await withArtifactServer(workspace, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/sage/artifacts/session/..%2Fsecret.png`
      );
      assert.equal(response.status, 400);
    });
  });
});

test("GET Sage artifact rejects encoded slashes in file names", async () => {
  await withWorkspace(async (workspace) => {
    await mkdir(sageSessionDir(workspace, "session"));
    await withArtifactServer(workspace, async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/sage/artifacts/session/nested%2Fplot.png`
      );
      assert.equal(response.status, 400);
    });
  });
});

test("GET Sage artifact rejects unsupported extensions", async () => {
  await withWorkspace(async (workspace) => {
    await mkdir(sageSessionDir(workspace, "session"));
    await withArtifactServer(workspace, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sage/artifacts/session/debug.txt`);
      assert.equal(response.status, 400);
    });
  });
});

test("GET Sage artifact returns 404 for a missing file", async () => {
  await withWorkspace(async (workspace) => {
    await mkdir(sageSessionDir(workspace, "session"));
    await withArtifactServer(workspace, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sage/artifacts/session/missing.png`);
      assert.equal(response.status, 404);
      assert.doesNotMatch(await response.text(), new RegExp(workspace));
    });
  });
});

test("GET Sage artifact sanitizes the session id", async () => {
  await withWorkspace(async (workspace) => {
    const dir = sageSessionDir(workspace, "a/b");
    await mkdir(dir);
    await writeFile(path.join(dir, "plot.json"), "{}");

    await withArtifactServer(workspace, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sage/artifacts/a%2Fb/plot.json`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /^application\/json/);
    });
  });
});

test("GET Sage artifact rejects symlinks escaping the session directory", async () => {
  await withWorkspace(async (workspace) => {
    const dir = sageSessionDir(workspace, "session");
    await mkdir(dir);
    const outside = path.join(workspace, "outside.png");
    await writeFile(outside, "outside");
    await symlink(outside, path.join(dir, "escape.png"));

    await withArtifactServer(workspace, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/sage/artifacts/session/escape.png`);
      assert.equal(response.status, 400);
    });
  });
});

test("authoritative artifact manifest is bound to the current run and content hash", async () => {
  await withWorkspace(async (workspace) => {
    const runId = "run-current";
    const dir = sageRunDir(workspace, runId);
    await mkdir(dir, { recursive: true });
    const bytes = Buffer.from("authoritative-png");
    await writeFile(path.join(dir, "function_plot.png"), bytes);

    const artifacts = await listSageArtifacts(dir, { runId });
    const manifest = artifacts.get("function_plot.png");
    const sha256 = createHash("sha256").update(bytes).digest("hex");

    assert.equal(manifest.runId, runId);
    assert.equal(manifest.kind, "function_plot");
    assert.equal(manifest.sha256, sha256);
    assert.equal(manifest.artifactId, `sha256:${sha256}`);
    assert.equal(manifest.sizeBytes, bytes.length);
    assert.match(manifest.createdAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(
      manifest.url,
      `/api/sage/artifacts/${runId}/${encodeURIComponent(`sha256:${sha256}`)}`
    );
    assert.doesNotMatch(manifest.url, /by-name|latest/);

    await withArtifactServer(workspace, async (baseUrl) => {
      const response = await fetch(`${baseUrl}${manifest.url}`);
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "private, max-age=31536000, immutable");
      assert.equal(await response.text(), bytes.toString());
    });
  });
});

test("pre-existing artifacts are ignored and changed bytes receive a new identity", async () => {
  await withWorkspace(async (workspace) => {
    const runId = "run-diff";
    const dir = sageRunDir(workspace, runId);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, "function_plot.png");
    await writeFile(file, "AAAA");
    const before = await listSageArtifacts(dir, { runId });
    assert.deepEqual(diffSageArtifacts(before, await listSageArtifacts(dir, { runId })), []);

    const priorStats = await stat(file);
    await writeFile(file, "BBBB");
    await utimes(file, priorStats.atime, priorStats.mtime);
    const after = await listSageArtifacts(dir, { runId });
    const changed = diffSageArtifacts(before, after);

    assert.equal(changed.length, 1);
    assert.notEqual(changed[0].artifactId, before.get("function_plot.png").artifactId);
  });
});

test("artifact IDs cannot cross runs and stale hashes stop resolving", async () => {
  await withWorkspace(async (workspace) => {
    const runId = "run-one";
    const dir = sageRunDir(workspace, runId);
    await mkdir(dir, { recursive: true });
    const file = path.join(dir, "function_plot.png");
    await writeFile(file, "first");
    const manifest = (await listSageArtifacts(dir, { runId })).get("function_plot.png");

    assert.equal(await resolveSageArtifactById(workspace, "run-two", manifest.artifactId), null);
    await writeFile(file, "second");
    assert.equal(await resolveSageArtifactById(workspace, runId, manifest.artifactId), null);
  });
});
