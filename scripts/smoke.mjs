import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

const directory = await mkdtemp(join(tmpdir(), "recaptcha-smoke-"));
const port = 3198;
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ["dist/server/main.js"], {
  env: {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    PUBLIC_ORIGIN: base,
    DATABASE_PATH: join(directory, "captcha.sqlite"),
    CAPTCHA_SECRET: randomBytes(32).toString("hex"),
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let logs = "";
child.stdout.on("data", (data) => {
  logs += data;
});
child.stderr.on("data", (data) => {
  logs += data;
});
const exited = new Promise((resolve) => child.on("exit", resolve));
try {
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    if (child.exitCode !== null)
      throw new Error("Production server exited before becoming ready.");
    try {
      ready = (await fetch(`${base}/health`)).ok;
      if (ready) break;
    } catch {
      /* Wait for initialization. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.ok(ready, "Server must start");
  for (const route of [
    "/",
    "/integration",
    "/activity",
    "/widget?sitekey=zetther_local_demo",
  ]) {
    const response = await fetch(`${base}${route}`);
    assert.equal(response.status, 200, route);
    assert.match(await response.text(), /Zetther reCAPTCHA Fake/);
  }
  const html = await (await fetch(base)).text();
  const asset = html.match(/src="([^"]+\.js)"/)[1];
  const script = await fetch(`${base}${asset}`);
  assert.equal(script.status, 200);
  assert.match(script.headers.get("content-type"), /javascript/);
  const sdk = await fetch(`${base}/widget.js`);
  assert.match(await sdk.text(), /ZettherCaptcha/);
  const publicConfig = await (await fetch(`${base}/api/config`)).json();
  assert.ok(publicConfig.sitekey);
  const issued = await fetch(`${base}/v1/challenges`, {
    method: "POST",
    headers: { Origin: base, "Content-Type": "application/json" },
    body: JSON.stringify({
      sitekey: publicConfig.sitekey,
      action: "demo_submit",
      origin: base,
      session: randomBytes(16).toString("hex"),
    }),
  });
  assert.equal(issued.status, 200);
  const challenge = await issued.json();
  const image = await fetch(`${base}${challenge.tiles[0].url}`);
  assert.equal(image.status, 200);
  assert.equal(image.headers.get("content-type"), "image/png");
  assert.equal((await fetch(`${base}/.env`)).status, 404);
  assert.equal((await fetch(`${base}/.data/captcha.sqlite`)).status, 404);
  assert.equal(
    (
      await fetch(`${base}/v1/siteverify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      })
    ).status,
    400,
  );
  console.log(
    "Production smoke passed: pages, assets, SDK, PNG challenge, API validation, private file isolation.",
  );
} catch (error) {
  console.error(logs);
  throw error;
} finally {
  if (child.exitCode === null) child.kill("SIGTERM");
  await exited;
  // Only this exact directory, created by mkdtemp above, is removed.
  await rm(directory, { recursive: true, force: true });
}
