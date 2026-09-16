import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import test from "node:test";

const port = 4189;

test("development server rejects sibling-prefix traversal", async () => {
  const server = spawn(process.execPath, ["serve.mjs"], {
    cwd: process.cwd(),
    env: { ...process.env, PORT: String(port) },
    stdio: "ignore"
  });
  try {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const response = await fetch(`http://127.0.0.1:${port}/../Default%20Project-private/secret.txt`);
    assert.equal(response.status, 404);
  } finally {
    server.kill();
  }
});
