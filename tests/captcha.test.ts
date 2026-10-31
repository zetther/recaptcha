import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { CaptchaStore, CHALLENGE_TTL, TOKEN_TTL } from "../server/store.js";
import { createApp } from "../server/app.js";
import type { Config } from "../server/config.js";

const origin = "http://localhost:3000";
const config: Config = {
  port: 3000,
  host: "127.0.0.1",
  sitekey: "test_site",
  secret: "test-secret-with-at-least-thirty-two-characters",
  origins: [origin],
  database: ":memory:",
  production: false,
};
function answer(store: CaptchaStore, id: string): string[] {
  // Test-only access to database fixtures. No answer/debug endpoint exists in the app.
  const row = store.db
    .prepare("SELECT answer FROM challenges WHERE id=?")
    .get(id) as { answer: string };
  return JSON.parse(row.answer);
}
async function solved(store: CaptchaStore, session = randomUUID()) {
  const challenge = await store.issue(
    config.sitekey,
    "demo_submit",
    origin,
    session,
  );
  const result = store.solve(
    challenge.id,
    answer(store, challenge.id),
    session,
  );
  assert.equal(result.success, true);
  return { token: result.token!, session, challenge };
}

test("challenge exposes only opaque tile IDs and raster images, never correct tile indices", async (t) => {
  const store = new CaptchaStore();
  t.after(() => store.close());
  const challenge = await store.issue(
    config.sitekey,
    "demo_submit",
    origin,
    randomUUID(),
  );
  assert.equal(challenge.tiles.length, 9);
  assert.deepEqual(Object.keys(challenge).sort(), [
    "expiresAt",
    "id",
    "prompt",
    "target",
    "tiles",
  ]);
  for (const tile of challenge.tiles) {
    assert.deepEqual(Object.keys(tile).sort(), ["id", "url"]);
    const png = store.image(challenge.id, tile.id)!;
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.ok(png.length > 1000);
  }
  assert.equal(store.image(randomUUID(), challenge.tiles[0].id), undefined);
});

test("correct selection creates an opaque token which can be redeemed exactly once", async (t) => {
  const store = new CaptchaStore();
  t.after(() => store.close());
  const { token, session, challenge } = await solved(store);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(
    store.solve(challenge.id, answer(store, challenge.id), session).success,
    false,
  );
  assert.deepEqual(
    store.verify(token, config.sitekey, "demo_submit", origin, session),
    { success: true, action: "demo_submit", hostname: "localhost" },
  );
  assert.equal(
    store.verify(token, config.sitekey, "demo_submit").error,
    "timeout-or-duplicate",
  );
});

test("incorrect answers, duplicate selections, and attempts after the third failure are rejected", async (t) => {
  const store = new CaptchaStore();
  t.after(() => store.close());
  const session = randomUUID();
  const challenge = await store.issue(
    config.sitekey,
    "demo_submit",
    origin,
    session,
  );
  const correct = answer(store, challenge.id);
  assert.equal(
    store.solve(challenge.id, [...correct, correct[0]], session).error,
    "incorrect-answer",
  );
  assert.equal(
    store.solve(challenge.id, [randomUUID()], session).error,
    "incorrect-answer",
  );
  assert.equal(
    store.solve(challenge.id, [], session).error,
    "attempts-exhausted",
  );
  assert.equal(
    store.solve(challenge.id, correct, session).error,
    "attempts-exhausted",
  );
});

test("expired challenges, expired tokens, and forged tokens fail", async (t) => {
  let now = 1_000_000;
  const store = new CaptchaStore(":memory:", () => now);
  t.after(() => store.close());
  const session = randomUUID();
  const challenge = await store.issue(
    config.sitekey,
    "demo_submit",
    origin,
    session,
  );
  const correct = answer(store, challenge.id);
  now += CHALLENGE_TTL;
  assert.equal(
    store.solve(challenge.id, correct, session).error,
    "expired-or-used-challenge",
  );
  assert.equal(store.image(challenge.id, challenge.tiles[0].id), undefined);
  const { token } = await solved(store);
  now += TOKEN_TTL;
  assert.equal(
    store.verify(token, config.sitekey, "demo_submit").error,
    "timeout-or-duplicate",
  );
  assert.equal(
    store.verify("forged-token", config.sitekey, "demo_submit").error,
    "invalid-response",
  );
});

test("refresh invalidates the previous challenge and sessions cannot solve each other’s challenge", async (t) => {
  const store = new CaptchaStore();
  t.after(() => store.close());
  const session = randomUUID();
  const first = await store.issue(
    config.sitekey,
    "demo_submit",
    origin,
    session,
  );
  const firstAnswer = answer(store, first.id);
  const second = await store.issue(
    config.sitekey,
    "demo_submit",
    origin,
    session,
  );
  assert.equal(
    store.solve(first.id, firstAnswer, session).error,
    "invalid-challenge",
  );
  assert.equal(
    store.solve(second.id, answer(store, second.id), randomUUID()).error,
    "invalid-challenge",
  );
  assert.equal(
    store.solve(second.id, answer(store, second.id), session).success,
    true,
  );
});

test("site, action, origin, and session mismatches do not consume a valid token", async (t) => {
  const store = new CaptchaStore();
  t.after(() => store.close());
  const { token, session } = await solved(store);
  assert.equal(
    store.verify(token, "other-site", "demo_submit").error,
    "context-mismatch",
  );
  assert.equal(
    store.verify(token, config.sitekey, "login").error,
    "context-mismatch",
  );
  assert.equal(
    store.verify(token, config.sitekey, "demo_submit", "https://other.example")
      .error,
    "context-mismatch",
  );
  assert.equal(
    store.verify(token, config.sitekey, "demo_submit", origin, randomUUID())
      .error,
    "context-mismatch",
  );
  assert.equal(
    store.verify(token, config.sitekey, "demo_submit", origin, session).success,
    true,
  );
});

test("concurrent redemption across database connections accepts one request; spent state survives restart", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "recaptcha-test-"));
  const path = join(directory, "captcha.sqlite");
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const a = new CaptchaStore(path);
  const { token } = await solved(a);
  const b = new CaptchaStore(path);
  const results = await Promise.all([
    Promise.resolve().then(() =>
      a.verify(token, config.sitekey, "demo_submit"),
    ),
    Promise.resolve().then(() =>
      b.verify(token, config.sitekey, "demo_submit"),
    ),
  ]);
  assert.equal(results.filter((result) => result.success).length, 1);
  a.close();
  b.close();
  const c = new CaptchaStore(path);
  assert.equal(
    c.verify(token, config.sitekey, "demo_submit").error,
    "timeout-or-duplicate",
  );
  c.close();
});

test("HTTP lifecycle verifies through server secret; bad secrets cannot consume tokens", async (t) => {
  const store = new CaptchaStore();
  const app = await createApp(config, store);
  t.after(() => app.close());
  const session = randomUUID();
  const issued = await app.inject({
    method: "POST",
    url: "/v1/challenges",
    headers: { origin },
    payload: {
      sitekey: config.sitekey,
      action: "demo_submit",
      origin,
      session,
    },
  });
  assert.equal(issued.statusCode, 200);
  assert.equal(issued.headers["cache-control"], "no-store");
  const challenge = issued.json();
  const solvedResponse = await app.inject({
    method: "POST",
    url: `/v1/challenges/${challenge.id}/solve`,
    headers: { origin },
    payload: { selected: answer(store, challenge.id), session },
  });
  assert.equal(solvedResponse.statusCode, 200);
  const response = solvedResponse.json().token;
  const payload = {
    secret: "invalid",
    response,
    sitekey: config.sitekey,
    action: "demo_submit",
    origin,
  };
  const wrong = await app.inject({
    method: "POST",
    url: "/v1/siteverify",
    payload,
  });
  assert.equal(wrong.statusCode, 401);
  const verified = await app.inject({
    method: "POST",
    url: "/v1/siteverify",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({
      ...payload,
      secret: config.secret,
    }).toString(),
  });
  assert.equal(verified.json().success, true);
  const replay = await app.inject({
    method: "POST",
    url: "/v1/siteverify",
    payload: { ...payload, secret: config.secret },
  });
  assert.equal(replay.json().error, "timeout-or-duplicate");
});

test("unknown origins and sitekeys cannot issue challenges; invalid payloads fail closed", async (t) => {
  const app = await createApp(config);
  t.after(() => app.close());
  const payload = {
    sitekey: config.sitekey,
    action: "demo_submit",
    origin,
    session: randomUUID(),
  };
  for (const headers of [{}, { origin: "https://evil.example" }]) {
    assert.equal(
      (
        await app.inject({
          method: "POST",
          url: "/v1/challenges",
          headers,
          payload,
        })
      ).statusCode,
      403,
    );
  }
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/challenges",
        headers: { origin },
        payload: { ...payload, origin: "https://evil.example" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/challenges",
        headers: { origin },
        payload: { ...payload, sitekey: "bad" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/challenges",
        headers: { origin },
        payload: { ...payload, session: "short" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (await app.inject({ method: "POST", url: "/v1/siteverify", payload: {} }))
      .statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/v1/siteverify",
        payload: { secret: "x".repeat(9000) },
      })
    ).statusCode,
    413,
  );
});

test("protected form rejects missing or invalid tokens and accepts a valid token once", async (t) => {
  const store = new CaptchaStore();
  const app = await createApp(config, store);
  t.after(() => app.close());
  const { token, session } = await solved(store);
  const payload = {
    token,
    session,
    message: "This private demo message must never be persisted.",
  };
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/demo/submit",
        headers: { origin },
        payload: { ...payload, token: "" },
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/demo/submit",
        headers: { origin },
        payload: { ...payload, token: "fake" },
      })
    ).statusCode,
    403,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/demo/submit",
        headers: { origin },
        payload,
      })
    ).json().success,
    true,
  );
  assert.equal(
    (
      await app.inject({
        method: "POST",
        url: "/api/demo/submit",
        headers: { origin },
        payload,
      })
    ).statusCode,
    403,
  );
  const activity = await app.inject({ url: "/api/activity" });
  assert.equal(activity.json().accepted, 1);
  assert.equal(activity.body.includes(payload.message), false);
  assert.equal(activity.body.includes(token), false);
});

test("public configuration does not expose secret or answers and rate limiting is enforced", async (t) => {
  const app = await createApp(config);
  t.after(() => app.close());
  const response = await app.inject({ url: "/api/config" });
  assert.equal(response.body.includes(config.secret), false);
  assert.equal(response.headers["x-content-type-options"], "nosniff");
  assert.equal(
    (await app.inject({ url: "/api/debug/answers" })).statusCode,
    404,
  );
  const results = await Promise.all(
    Array.from({ length: 181 }, () => app.inject({ url: "/health" })),
  );
  assert.ok(results.some((result) => result.statusCode === 429));
});

test("expired assets and old audit events are removed by cleanup", async (t) => {
  let now = 1_000_000;
  const store = new CaptchaStore(":memory:", () => now);
  t.after(() => store.close());
  const { token, challenge } = await solved(store);
  now += 86_400_001;
  store.cleanup();
  assert.equal(store.image(challenge.id, challenge.tiles[0].id), undefined);
  assert.equal(store.activity().events.length, 0);
  assert.equal(
    store.verify(token, config.sitekey, "demo_submit").success,
    false,
  );
});
