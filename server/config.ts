import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export type Config = {
  port: number;
  host: string;
  sitekey: string;
  secret: string;
  origins: string[];
  database: string;
  production: boolean;
};
export function getConfig(
  production = process.env.NODE_ENV === "production",
): Config {
  if (existsSync(".env")) process.loadEnvFile(".env");
  const port = Number(process.env.PORT ?? 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("PORT must be an integer between 1 and 65535.");
  const codespaceOrigin = process.env.CODESPACE_NAME
    ? `https://${process.env.CODESPACE_NAME}-${port}.${process.env.GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN ?? "app.github.dev"}`
    : undefined;
  const publicOrigin = process.env.PUBLIC_ORIGIN ?? codespaceOrigin;
  const normalize = (value: string) => {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== value ||
      url.username ||
      url.password
    )
      throw new Error(
        "Allowed origins must be exact HTTP(S) origins without a trailing slash.",
      );
    return url.origin;
  };
  const origins = [
    ...new Set([
      `http://localhost:${port}`,
      `http://127.0.0.1:${port}`,
      ...(publicOrigin ? [normalize(publicOrigin)] : []),
      ...(process.env.ALLOWED_ORIGINS?.split(",").map((s) =>
        normalize(s.trim()),
      ) ?? []),
    ]),
  ];
  let secret = process.env.CAPTCHA_SECRET;
  if (secret && secret.length < 32)
    throw new Error("CAPTCHA_SECRET must be at least 32 characters.");
  if (!secret) {
    const path = resolve(".data/development-secret");
    mkdirSync(".data", { recursive: true });
    if (!existsSync(path))
      writeFileSync(path, randomBytes(32).toString("base64url"), {
        mode: 0o600,
        flag: "wx",
      });
    secret = readFileSync(path, "utf8").trim();
  }
  return {
    port,
    host: process.env.HOST ?? "0.0.0.0",
    sitekey: process.env.SITE_KEY ?? "zetther_local_demo",
    secret,
    origins,
    database: process.env.DATABASE_PATH ?? ".data/captcha.sqlite",
    production,
  };
}
