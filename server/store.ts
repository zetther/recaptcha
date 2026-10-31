import { DatabaseSync } from "node:sqlite";
import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { labels, renderTile, type Subject } from "./artwork.js";

export const CHALLENGE_TTL = 180_000;
export const TOKEN_TTL = 120_000;
export const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
type ChallengeRow = {
  id: string;
  sitekey: string;
  action: string;
  origin: string;
  session: string;
  answer: string;
  expires: number;
  created: number;
  attempts: number;
  status: string;
};
type TokenRow = {
  hash: string;
  sitekey: string;
  action: string;
  origin: string;
  session: string;
  created: number;
  expires: number;
  consumed: number;
};
export type Result = {
  success: boolean;
  error?: string;
  token?: string;
  expiresAt?: number;
  action?: string;
  hostname?: string;
};

export class CaptchaStore {
  readonly db: DatabaseSync;
  constructor(
    path = ":memory:",
    private readonly now = Date.now,
  ) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS challenges (id TEXT PRIMARY KEY, sitekey TEXT NOT NULL, action TEXT NOT NULL,
        origin TEXT NOT NULL, session TEXT NOT NULL, answer TEXT NOT NULL, expires INTEGER NOT NULL,
        created INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'pending');
      CREATE TABLE IF NOT EXISTS tiles (id TEXT PRIMARY KEY, challenge_id TEXT NOT NULL REFERENCES challenges(id) ON DELETE CASCADE, png BLOB NOT NULL);
      CREATE TABLE IF NOT EXISTS tokens (hash TEXT PRIMARY KEY, sitekey TEXT NOT NULL, action TEXT NOT NULL,
        origin TEXT NOT NULL, session TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, consumed INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, at INTEGER NOT NULL, duration INTEGER);
      CREATE INDEX IF NOT EXISTS challenge_expiry ON challenges(expires);
      CREATE INDEX IF NOT EXISTS token_expiry ON tokens(expires);
      CREATE INDEX IF NOT EXISTS event_time ON events(at);`);
  }
  close() {
    this.db.close();
  }
  cleanup() {
    this.db
      .prepare("DELETE FROM challenges WHERE expires < ? OR status != ?")
      .run(this.now(), "pending");
    this.db.prepare("DELETE FROM tokens WHERE expires < ?").run(this.now());
    this.db
      .prepare("DELETE FROM events WHERE at < ?")
      .run(this.now() - 86_400_000);
  }
  event(kind: string, duration: number | null = null) {
    this.db
      .prepare("INSERT INTO events(kind, at, duration) VALUES (?, ?, ?)")
      .run(kind, this.now(), duration);
  }
  async issue(
    sitekey: string,
    action: string,
    origin: string,
    session: string,
  ) {
    this.cleanup();
    const subjects: Subject[] = ["bus", "car", "bicycle", "train"];
    const target = subjects[randomInt(subjects.length)];
    const targetCount = randomInt(3, 5);
    const others = subjects.filter((s) => s !== target);
    const choices = Array.from({ length: 9 }, (_, i) =>
      i < targetCount ? target : others[randomInt(others.length)],
    );
    for (let i = choices.length - 1; i > 0; i--) {
      const j = randomInt(i + 1);
      [choices[i], choices[j]] = [choices[j], choices[i]];
    }
    const tiles = await Promise.all(
      choices.map(async (subject) => ({
        id: randomUUID(),
        subject,
        png: await renderTile(subject),
      })),
    );
    const id = randomUUID();
    const expiresAt = this.now() + CHALLENGE_TTL;
    this.db.exec("BEGIN IMMEDIATE");
    try {
      // Replacing a challenge invalidates older challenges in this widget session.
      this.db
        .prepare("DELETE FROM challenges WHERE session = ? AND sitekey = ?")
        .run(digest(session), sitekey);
      this.db
        .prepare(
          "INSERT INTO challenges(id, sitekey, action, origin, session, answer, expires, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .run(
          id,
          sitekey,
          action,
          origin,
          digest(session),
          JSON.stringify(
            tiles
              .filter((t) => t.subject === target)
              .map((t) => t.id)
              .sort(),
          ),
          expiresAt,
          this.now(),
        );
      const insert = this.db.prepare(
        "INSERT INTO tiles(id, challenge_id, png) VALUES (?, ?, ?)",
      );
      for (const tile of tiles) insert.run(tile.id, id, tile.png);
      this.event("challenge_created");
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return {
      id,
      prompt: `Select all images with ${labels[target]}`,
      target: labels[target],
      expiresAt,
      tiles: tiles.map((t) => ({
        id: t.id,
        url: `/v1/challenges/${id}/tiles/${t.id}`,
      })),
    };
  }
  image(challengeId: string, tileId: string): Buffer | undefined {
    const row = this.db
      .prepare(
        `SELECT png FROM tiles JOIN challenges ON challenges.id=tiles.challenge_id
      WHERE tiles.id=? AND challenge_id=? AND challenges.expires>? AND challenges.status='pending'`,
      )
      .get(tileId, challengeId, this.now()) as { png: Uint8Array } | undefined;
    return row ? Buffer.from(row.png) : undefined;
  }
  solve(id: string, selected: string[], session: string): Result {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT * FROM challenges WHERE id=?")
        .get(id) as ChallengeRow | undefined;
      let result: Result;
      if (!row || row.session !== digest(session))
        result = { success: false, error: "invalid-challenge" };
      else if (row.expires <= this.now() || row.status !== "pending")
        result = { success: false, error: "expired-or-used-challenge" };
      else if (row.attempts >= 3)
        result = { success: false, error: "attempts-exhausted" };
      else if (
        JSON.stringify([...new Set(selected)].sort()) !== row.answer ||
        selected.length !== new Set(selected).size
      ) {
        this.db
          .prepare("UPDATE challenges SET attempts=attempts+1 WHERE id=?")
          .run(id);
        this.event("answer_rejected");
        result = {
          success: false,
          error: row.attempts >= 2 ? "attempts-exhausted" : "incorrect-answer",
        };
      } else {
        const token = randomBytes(32).toString("base64url");
        const expiresAt = this.now() + TOKEN_TTL;
        this.db
          .prepare("UPDATE challenges SET status=? WHERE id=?")
          .run("solved", id);
        this.db
          .prepare(
            "INSERT INTO tokens(hash,sitekey,action,origin,session,created,expires) VALUES (?,?,?,?,?,?,?)",
          )
          .run(
            digest(token),
            row.sitekey,
            row.action,
            row.origin,
            row.session,
            this.now(),
            expiresAt,
          );
        this.event("challenge_solved", this.now() - row.created);
        result = { success: true, token, expiresAt };
      }
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  verify(
    token: string,
    sitekey: string,
    action: string,
    expectedOrigin?: string,
    session?: string,
  ): Result {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.db
        .prepare("SELECT * FROM tokens WHERE hash=?")
        .get(digest(token)) as TokenRow | undefined;
      let result: Result;
      if (!row) result = { success: false, error: "invalid-response" };
      else if (row.consumed || row.expires <= this.now())
        result = { success: false, error: "timeout-or-duplicate" };
      else if (
        row.sitekey !== sitekey ||
        row.action !== action ||
        (expectedOrigin && row.origin !== expectedOrigin) ||
        (session && row.session !== digest(session))
      )
        result = { success: false, error: "context-mismatch" };
      else {
        this.db
          .prepare("UPDATE tokens SET consumed=1 WHERE hash=? AND consumed=0")
          .run(row.hash);
        result = {
          success: true,
          action: row.action,
          hostname: new URL(row.origin).hostname,
        };
      }
      this.event(result.success ? "request_accepted" : "request_rejected");
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  activity() {
    const since = this.now() - 86_400_000;
    const rows = this.db
      .prepare(
        "SELECT kind, COUNT(*) AS count FROM events WHERE at>=? GROUP BY kind",
      )
      .all(since) as { kind: string; count: number }[];
    const counts = Object.fromEntries(rows.map((r) => [r.kind, r.count]));
    const avg = this.db
      .prepare(
        "SELECT AVG(duration) AS ms FROM events WHERE kind='challenge_solved' AND at>=?",
      )
      .get(since) as { ms: number | null };
    return {
      created: counts.challenge_created ?? 0,
      solved: counts.challenge_solved ?? 0,
      accepted: counts.request_accepted ?? 0,
      rejected: (counts.request_rejected ?? 0) + (counts.answer_rejected ?? 0),
      averageMs: avg.ms === null ? null : Math.round(avg.ms),
      events: this.db
        .prepare(
          "SELECT id,kind,at,duration FROM events WHERE at>=? ORDER BY id DESC LIMIT 20",
        )
        .all(since),
    };
  }
}
