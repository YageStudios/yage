import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Starts the examples Vite dev server for the e2e suite on a dedicated port
 * (5273) so it can never collide with - or silently target - an unrelated
 * dev server that happens to be running on the conventional 5173. Reuses an
 * already-serving instance (e.g. a parallel test run) instead of spawning a
 * duplicate; only the process that spawned the server tears it down.
 *
 * Returns the base URL the tests should target.
 */
const E2E_PORT = 5273;
const E2E_BASE_URL = `http://localhost:${E2E_PORT}`;

const isServing = async () => {
  try {
    const response = await fetch(E2E_BASE_URL);
    return response.ok;
  } catch {
    return false;
  }
};

const waitForServer = async (timeoutMs = 30000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServing()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
};

export const startE2eDevServer = async () => {
  if (process.env.YAGE_E2E_BASE_URL) {
    // The caller owns the server (e.g. pointing at a specific instance).
    return process.env.YAGE_E2E_BASE_URL;
  }

  if (await isServing()) {
    // Another e2e run already owns this server; do not spawn or tear it down.
    return E2E_BASE_URL;
  }

  const repoRoot = fileURLToPath(new URL("../..", import.meta.url));
  const child = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--config", "examples/vite.config.js", "--port", String(E2E_PORT), "--strictPort"], {
    cwd: repoRoot,
    stdio: "ignore",
  });

  const ready = await waitForServer();
  if (!ready) {
    child.kill("SIGTERM");
    throw new Error(`[e2e] dev server failed to start on ${E2E_BASE_URL} within 30s`);
  }

  // Keep the child's process handle from holding the test runner's event
  // loop open during shutdown; the exit hooks below still own its lifetime.
  child.unref();

  process.once("exit", () => child.kill("SIGTERM"));
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      child.kill("SIGTERM");
      process.exit(0);
    });
  }

  return E2E_BASE_URL;
};
