import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { CaptchaStore, digest } from "./store.js";
import type { Config } from "./config.js";

const text = (maxLength = 128) => ({ type: "string", minLength: 1, maxLength });
const bodySchema = (
  properties: Record<string, object>,
  required = Object.keys(properties),
) => ({ type: "object", additionalProperties: false, properties, required });
type ChallengeInput = {
  sitekey: string;
  action: string;
  origin: string;
  session: string;
};

export async function createApp(
  config: Config,
  store = new CaptchaStore(config.database),
  logger = false,
) {
  const app = Fastify({ logger, bodyLimit: 8192, trustProxy: false });
  await app.register(rateLimit, { max: 180, timeWindow: "1 minute" });
  app.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body as string)));
    },
  );
  app.addHook("onSend", async (req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "strict-origin-when-cross-origin");
    if (/^\/(api|v1|health)/.test(req.url))
      reply.header("Cache-Control", "no-store");
    reply.header(
      "Content-Security-Policy",
      `frame-ancestors 'self' ${config.origins.join(" ")}`,
    );
  });
  const maintenance = setInterval(() => store.cleanup(), 60_000);
  maintenance.unref();
  app.addHook("onClose", async () => {
    clearInterval(maintenance);
    store.close();
  });
  app.setErrorHandler((error, _req, reply) => {
    const e = error as { statusCode?: number; validation?: unknown };
    const status = e.statusCode && e.statusCode < 500 ? e.statusCode : 500;
    if (status === 500) app.log.error(error);
    reply
      .status(status)
      .send({
        success: false,
        error: e.validation
          ? "invalid-request"
          : status === 429
            ? "rate-limited"
            : status === 500
              ? "service-unavailable"
              : "invalid-request",
      });
  });
  const browserAllowed = (origin: string | undefined) =>
    Boolean(origin && config.origins.includes(origin));
  app.get("/health", async () => ({
    status: "ok",
    service: "zetther-captcha",
    version: "0.1.0",
  }));
  app.get("/api/config", async () => ({
    sitekey: config.sitekey,
    action: "demo_submit",
    tokenTtlSeconds: 120,
    challengeTtlSeconds: 180,
    mode: "self-hosted",
    version: "0.1.0",
  }));
  app.get("/api/activity", async () => store.activity());
  app.post<{ Body: ChallengeInput }>(
    "/v1/challenges",
    {
      config: { rateLimit: { max: 15, timeWindow: "1 minute" } },
      schema: {
        body: bodySchema({
          sitekey: text(),
          action: { ...text(64), pattern: "^[a-zA-Z0-9_/-]+$" },
          origin: text(256),
          session: { ...text(), minLength: 16 },
        }),
      },
    },
    async (req, reply) => {
      if (
        !browserAllowed(req.headers.origin) ||
        !config.origins.includes(req.body.origin)
      )
        return reply
          .code(403)
          .send({ success: false, error: "origin-not-allowed" });
      if (req.body.sitekey !== config.sitekey)
        return reply
          .code(403)
          .send({ success: false, error: "invalid-sitekey" });
      return store.issue(
        req.body.sitekey,
        req.body.action,
        req.body.origin,
        req.body.session,
      );
    },
  );
  app.get<{ Params: { challenge: string; tile: string } }>(
    "/v1/challenges/:challenge/tiles/:tile",
    async (req, reply) => {
      const png = store.image(req.params.challenge, req.params.tile);
      if (!png)
        return reply
          .code(404)
          .send({ success: false, error: "image-unavailable" });
      return reply.type("image/png").send(png);
    },
  );
  app.post<{
    Params: { challenge: string };
    Body: { selected: string[]; session: string };
  }>(
    "/v1/challenges/:challenge/solve",
    {
      config: { rateLimit: { max: 30, timeWindow: "1 minute" } },
      schema: {
        body: bodySchema({
          selected: {
            type: "array",
            items: text(),
            minItems: 1,
            maxItems: 9,
            uniqueItems: true,
          },
          session: { ...text(), minLength: 16 },
        }),
      },
    },
    async (req, reply) => {
      if (!browserAllowed(req.headers.origin))
        return reply
          .code(403)
          .send({ success: false, error: "origin-not-allowed" });
      const result = store.solve(
        req.params.challenge,
        req.body.selected,
        req.body.session,
      );
      return reply.code(result.success ? 200 : 400).send(result);
    },
  );
  app.post<{
    Body: {
      secret: string;
      response: string;
      sitekey: string;
      action: string;
      origin?: string;
    };
  }>(
    "/v1/siteverify",
    {
      schema: {
        body: bodySchema(
          {
            secret: text(256),
            response: text(256),
            sitekey: text(),
            action: text(64),
            origin: text(256),
          },
          ["secret", "response", "sitekey", "action"],
        ),
      },
    },
    async (req, reply) => {
      if (
        !timingSafeEqual(
          Buffer.from(digest(req.body.secret)),
          Buffer.from(digest(config.secret)),
        )
      )
        return reply
          .code(401)
          .send({ success: false, error: "invalid-secret" });
      return store.verify(
        req.body.response,
        req.body.sitekey,
        req.body.action,
        req.body.origin,
      );
    },
  );
  app.post<{ Body: { token: string; session: string; message: string } }>(
    "/api/demo/submit",
    {
      schema: {
        body: bodySchema({
          token: text(256),
          session: { ...text(), minLength: 16 },
          message: { ...text(500), minLength: 3 },
        }),
      },
    },
    async (req, reply) => {
      if (!browserAllowed(req.headers.origin))
        return reply
          .code(403)
          .send({ success: false, error: "origin-not-allowed" });
      const result = store.verify(
        req.body.token,
        config.sitekey,
        "demo_submit",
        req.headers.origin,
        req.body.session,
      );
      if (!result.success) return reply.code(403).send(result);
      // Demo proves server-side gating. No message contents are persisted or logged.
      return {
        success: true,
        message:
          "Request accepted. The server verified your token.",
        receivedAt: new Date().toISOString(),
      };
    },
  );
  app.get("/widget.js", async (_req, reply) =>
    reply
      .type("application/javascript")
      .header("Cache-Control", "no-cache")
      .send(await readFile(resolve("public/widget.js"), "utf8")),
  );
  return app;
}
