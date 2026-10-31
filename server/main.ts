import { resolve } from "node:path";
import { getConfig } from "./config.js";
import { createApp } from "./app.js";

const production =
  process.argv[1]?.replaceAll("\\", "/").includes("/dist/server/") ?? false;
const config = getConfig(production);
const app = await createApp(config, undefined, true);
if (config.production) {
  const { default: serveStatic } = await import("@fastify/static");
  await app.register(serveStatic, {
    root: resolve("dist/client"),
    wildcard: true,
  });
  app.setNotFoundHandler((req, reply) => {
    if (
      req.method === "GET" &&
      ["/", "/widget", "/integration", "/activity"].includes(
        req.url.split("?")[0],
      )
    )
      return reply.sendFile("index.html");
    return reply.code(404).send({ success: false, error: "not-found" });
  });
} else {
  const { default: middie } = await import("@fastify/middie");
  const { createServer } = await import("vite");
  const { default: react } = await import("@vitejs/plugin-react");
  await app.register(middie);
  const vite = await createServer({
    configFile: false,
    plugins: [react()],
    server: {
      middlewareMode: true,
      hmr: { server: app.server },
      allowedHosts: config.origins.map((o) => new URL(o).hostname),
    },
    appType: "spa",
  });
  app.use((req, res, next) =>
    /^\/(api|v1|health)(\/|\?|$)/.test(req.url ?? "") ||
    req.url === "/widget.js"
      ? next()
      : vite.middlewares(req, res, next),
  );
  app.addHook("onClose", async () => {
    await vite.close();
  });
}
await app.listen({ port: config.port, host: config.host });
console.log(`Zetther reCAPTCHA Fake ready: http://localhost:${config.port}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    void app.close();
  });
