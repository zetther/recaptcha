import { spawn } from "node:child_process";
import { mkdirSync, openSync, closeSync } from "node:fs";

const port = process.env.PORT ?? "3000";
try {
  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(1500),
  });
  if (response.ok && (await response.json()).service === "zetther-captcha") {
    console.log(`Zetther reCAPTCHA Fake is already running on port ${port}.`);
    process.exit(0);
  }
} catch {
  /* Start below when no server is listening. */
}
mkdirSync(".data", { recursive: true });
const log = openSync(".data/dev-server.log", "a");
const child = spawn(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "watch", "server/main.ts"],
  { detached: true, stdio: ["ignore", log, log], env: process.env },
);
child.unref();
closeSync(log);
for (let attempt = 0; attempt < 40; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 500));
  try {
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1500),
    });
    if (response.ok && (await response.json()).service === "zetther-captcha") {
      console.log(
        `Zetther reCAPTCHA Fake is ready on port ${port}. Open the forwarded port in the Ports panel.`,
      );
      process.exit(0);
    }
  } catch {
    /* Wait for Vite and SQLite initialization. */
  }
}
console.error(
  "Server did not become ready. Read .data/dev-server.log or run npm run dev in a terminal.",
);
process.exit(1);
