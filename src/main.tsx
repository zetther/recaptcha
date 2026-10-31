import React, { useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  ArrowRight,
  ArrowUpRight,
  Braces,
  Check,
  CircleHelp,
  Code2,
  Copy,
  Database,
  Github,
  Globe2,
  LayoutGrid,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
  Server,
  ShieldCheck,
  Sparkles,
  Terminal,
  Waypoints,
  X,
} from "lucide-react";
import { Captcha, type Status } from "./Captcha";
import { api, type Activity, type Token } from "./api";
import "./styles.css";

const repo = "https://github.com/zetther/recaptcha";
type Config = { sitekey: string; action: string; version: string };
type View = "playground" | "integration" | "activity";
const eventNames: Record<string, string> = {
  challenge_created: "New challenge issued",
  challenge_solved: "Challenge completed",
  answer_rejected: "Challenge answer rejected",
  request_accepted: "Token accepted by the server",
  request_rejected: "Token rejected by the server",
};

function CodeBlock({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setCopyError(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError(true);
    }
  }
  return (
    <div className="code-block">
      <div className="code-title">
        <span>
          <Code2 size={15} />
          {title}
        </span>
        <button onClick={copy}>
          {copied ? <Check size={14} /> : <Copy size={14} />}{" "}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
      {copyError && (
        <p role="alert">
          Please copy the code manually; clipboard access is unavailable.
        </p>
      )}
    </div>
  );
}

function App() {
  const [view, setView] = useState<View>(
    location.pathname === "/integration"
      ? "integration"
      : location.pathname === "/activity"
        ? "activity"
        : "playground",
  );
  const [config, setConfig] = useState<Config | null>(null);
  const [loadError, setLoadError] = useState("");
  const [activity, setActivity] = useState<Activity | null>(null);
  const [activityError, setActivityError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [session] = useState(() => crypto.randomUUID());
  const [status, setStatus] = useState<Status>("idle");
  const [token, setToken] = useState<Token | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [message, setMessage] = useState(
    "Hello! I would like to try self-hosted verification.",
  );
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<"accepted" | "rejected" | null>(null);
  const [submitError, setSubmitError] = useState("");
  const [help, setHelp] = useState(false);
  const onToken = useCallback((next: Token | null) => {
    setToken(next);
  }, []);
  const onStatus = useCallback((next: Status) => setStatus(next), []);
  const refreshActivity = useCallback(async () => {
    setRefreshing(true);
    try {
      setActivity(await api<Activity>("/api/activity"));
      setActivityError("");
    } catch {
      setActivityError("Activity could not be loaded. Please try again.");
    } finally {
      setRefreshing(false);
    }
  }, []);
  const load = useCallback(async () => {
    setLoadError("");
    try {
      setConfig(await api<Config>("/api/config"));
    } catch {
      setLoadError(
        "Backend unavailable. Make sure the server is running, then try again.",
      );
    }
  }, []);
  useEffect(() => {
    void load();
    void refreshActivity();
  }, [load, refreshActivity]);
  useEffect(() => {
    if (status === "verified" || result) void refreshActivity();
  }, [status, result, refreshActivity]);
  useEffect(() => {
    const fn = () =>
      setView(
        location.pathname === "/integration"
          ? "integration"
          : location.pathname === "/activity"
            ? "activity"
            : "playground",
      );
    window.addEventListener("popstate", fn);
    return () => window.removeEventListener("popstate", fn);
  }, []);
  useEffect(() => {
    if (!help) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = document.querySelector<HTMLElement>(".help-card");
    panel?.querySelector<HTMLElement>("button")?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHelp(false);
      if (event.key !== "Tab" || !panel) return;
      const focusable = [
        ...panel.querySelectorAll<HTMLElement>("button, a[href]"),
      ];
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", keyboard);
    return () => {
      document.removeEventListener("keydown", keyboard);
      previous?.focus();
    };
  }, [help]);
  function navigate(next: View) {
    setView(next);
    history.pushState(null, "", next === "playground" ? "/" : `/${next}`);
    if (next === "activity") void refreshActivity();
  }
  function reset() {
    setResetKey((key) => key + 1);
    setToken(null);
    setResult(null);
    setSubmitError("");
  }
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!token) return;
    setSubmitting(true);
    setSubmitError("");
    try {
      await api("/api/demo/submit", { token: token.value, session, message });
      setResult("accepted");
    } catch (e) {
      setResult("rejected");
      setSubmitError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setSubmitting(false);
      setToken(null);
    }
  }
  const stage =
    result === "accepted" ? 4 : token ? 3 : status === "challenge" ? 1 : 0;
  const frontendCode = `<div id="captcha"></div>\n<script src="${location.origin}/widget.js"></script>\n<script>\n  ZettherCaptcha.render('#captcha', {\n    sitekey: '${config?.sitekey ?? "YOUR_SITE_KEY"}',\n    action: 'contact',\n    callback: token => {\n      // Send the token with your form to your backend.\n      document.querySelector('[name="captcha_token"]').value = token;\n    },\n    onExpire: () => {\n      document.querySelector('[name="captcha_token"]').value = '';\n    }\n  });\n</script>\n<input type="hidden" name="captcha_token">`;
  const backendCode = `// Run this code only in your application backend.\nconst response = await fetch('${location.origin}/v1/siteverify', {\n  method: 'POST',\n  headers: { 'Content-Type': 'application/json' },\n  body: JSON.stringify({\n    secret: process.env.CAPTCHA_SECRET,\n    sitekey: '${config?.sitekey ?? "YOUR_SITE_KEY"}',\n    response: submittedToken,\n    action: 'contact',\n    origin: 'https://your-app.example'\n  })\n});\nconst verification = await response.json();\nif (!response.ok || verification.success !== true) {\n  throw new Error('CAPTCHA verification failed');\n}\n// Process the form after verification succeeds.`;
  return (
    <div className="app-shell">
      <header className="topbar">
        <a
          className="wordmark"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("playground");
          }}
        >
          <span className="brand-symbol">
            <img src="/favicon.svg" width="35" height="35" alt="Zetther" />
          </span>
          <strong>
            Zetther<span>reCAPTCHA Fake</span>
          </strong>
        </a>
        <div className="top-actions">
          <span className="environment">
            <span className={config ? "online-dot" : "offline-dot"} />
            {config ? "Self-hosted" : "Connecting"}
          </span>
          <a
            className="github-link"
            href={repo}
            target="_blank"
            rel="noreferrer"
          >
            <Github size={17} />
            <span>Repository</span>
            <ArrowUpRight size={13} />
          </a>
        </div>
      </header>
      <div className="workspace">
        <aside className="sidebar">
          <p className="nav-label">WORKSPACE</p>
          <nav aria-label="Main navigation">
            {(
              [
                { id: "playground", label: "Playground", Icon: LayoutGrid },
                { id: "integration", label: "Integration", Icon: Code2 },
                { id: "activity", label: "Activity", Icon: Waypoints },
              ] as const
            ).map(({ id, label, Icon }) => (
              <button
                key={id}
                className={view === id ? "nav-item active" : "nav-item"}
                aria-current={view === id ? "page" : undefined}
                onClick={() => navigate(id)}
              >
                <Icon size={18} />
                {label}
                {id === "playground" && <span className="nav-indicator" />}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="project-card">
              <div className="project-card-icon">
                <Braces size={19} />
              </div>
              <span>Zetther CAPTCHA</span>
              <span className="tiny-dot" />
            </div>
            <button className="help-link" onClick={() => setHelp(true)}>
              <CircleHelp size={16} /> About this project{" "}
              <ArrowUpRight size={13} />
            </button>
          </div>
        </aside>
        <main className="main">
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <strong>
              {view === "playground"
                ? "Playground"
                : view === "integration"
                  ? "Integration"
                  : "Activity"}
            </strong>
          </div>
          <section className="page-heading">
            <div>
              <div className="eyebrow">
                <span /> YOUR CAPTCHA. YOUR SERVER.
              </div>
              <h1>
                {view === "playground" ? (
                  <>
                    A little interaction.
                    <br />
                    <span>Real verification.</span>
                  </>
                ) : view === "integration" ? (
                  <>
                    Integrate once.
                    <br />
                    <span>Verify anywhere.</span>
                  </>
                ) : (
                  <>
                    Every attempt.
                    <br />
                    <span>Clearly recorded.</span>
                  </>
                )}
              </h1>
              <p>
                {view === "playground"
                  ? "Try the complete flow, from image selection to server verification."
                  : view === "integration"
                    ? "Add the widget to your website and verify tokens in your backend."
                    : "Explore verification activity on this server over the last 24 hours."}
              </p>
            </div>
            <div className="hero-mark" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="hero-check">
                <Check size={42} strokeWidth={2} />
              </div>
              <span className="orbit-label">HUMAN VERIFIED</span>
              <span className="orbit-spark">✳</span>
            </div>
          </section>
          {loadError && (
            <div className="alert" role="alert">
              {loadError}
              <button onClick={load}>Try again</button>
            </div>
          )}
          {view === "playground" && (
            <>
              <div className="section-bar">
                <div className="section-title">
                  <span className="section-number">01</span>
                  <h2>Try verification</h2>
                  <span className="pill">Checkbox + images</span>
                </div>
                <button
                  className="text-button"
                  onClick={reset}
                  disabled={submitting}
                >
                  <RefreshCw size={14} /> Reset demo
                </button>
              </div>
              <div className="playground-grid">
                <section className="demo-card">
                  <div className="browser-bar">
                    <span className="browser-dots">
                      <i />
                      <i />
                      <i />
                    </span>
                    <span>
                      <LockKeyhole size={11} /> demo.local / contact
                    </span>
                    <ArrowUpRight size={13} />
                  </div>
                  <div className="form-area">
                    <div className="form-badge">
                      <Sparkles size={18} />
                    </div>
                    <h3>Let’s connect.</h3>
                    <p>A simple form to try the verification flow.</p>
                    <form onSubmit={submit}>
                      <label htmlFor="message">
                        Your message <span>DEMO</span>
                      </label>
                      <textarea
                        id="message"
                        minLength={3}
                        maxLength={500}
                        required
                        value={message}
                        onChange={(event) => setMessage(event.target.value)}
                        disabled={submitting || result === "accepted"}
                      />
                      <div className="widget-area">
                        {config ? (
                          <Captcha
                            sitekey={config.sitekey}
                            action={config.action}
                            origin={location.origin}
                            session={session}
                            resetKey={resetKey}
                            consumed={result !== null}
                            onToken={onToken}
                            onStatus={onStatus}
                          />
                        ) : (
                          <div className="loading-widget">
                            <LoaderCircle className="spin" size={18} />{" "}
                            Connecting to the widget…
                          </div>
                        )}
                      </div>
                      <button
                        className={`submit-button ${result === "accepted" ? "accepted" : ""}`}
                        type="submit"
                        disabled={!token || submitting || result === "accepted"}
                      >
                        {submitting ? (
                          <LoaderCircle className="spin" size={17} />
                        ) : result === "accepted" ? (
                          <Check size={18} />
                        ) : null}
                        {result === "accepted"
                          ? "Message verified"
                          : submitting
                            ? "Verifying token…"
                            : "Send message"}
                        {!submitting && result !== "accepted" && (
                          <ArrowRight size={17} />
                        )}
                      </button>
                      {submitError && (
                        <p role="alert" className="error-text">
                          {submitError}
                        </p>
                      )}
                      <p className="form-note">
                        <LockKeyhole size={11} />
                        {result === "accepted"
                          ? "Token consumed. Reset the demo to try again."
                          : "Demo message contents are never stored."}
                      </p>
                    </form>
                  </div>
                </section>
                <section className="flow-card">
                  <div className="flow-header">
                    <span className="icon-tile">
                      <Waypoints size={19} />
                    </span>
                    <div>
                      <h3>Behind the verification</h3>
                      <p>Follow your request, step by step.</p>
                    </div>
                    <span className="live-label">
                      <span />
                      LIVE
                    </span>
                  </div>
                  <div className="steps">
                    {[
                      {
                        title: "Challenge created",
                        body: "The server prepares 9 randomized images.",
                        Icon: LayoutGrid,
                      },
                      {
                        title: "Answer checked",
                        body: "Your selections are checked in the backend.",
                        Icon: ShieldCheck,
                      },
                      {
                        title: "Token issued",
                        body: "Valid for 120 seconds and a single use.",
                        Icon: Braces,
                      },
                      {
                        title: "Server verifies",
                        body: "A valid token unlocks the form submission.",
                        Icon: Server,
                      },
                    ].map((step, i) => (
                      <div
                        key={step.title}
                        className={`step ${stage > i ? "done" : stage === i ? "current" : ""}`}
                      >
                        <span className="step-node">
                          {stage > i ? (
                            <Check size={15} />
                          ) : (
                            <step.Icon size={16} />
                          )}
                        </span>
                        <div>
                          <h4>
                            {step.title}
                            {stage > i && <span>Done</span>}
                          </h4>
                          <p>{step.body}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div
                    className={`response-box ${result === "accepted" ? "success" : ""}`}
                  >
                    <div>
                      <span className="response-dot" />
                      {result === "accepted"
                        ? "Request accepted"
                        : token
                          ? "Ready to send to the server"
                          : "Waiting for verification"}
                      <code>{result === "accepted" ? "200 OK" : "—"}</code>
                    </div>
                    <pre>
                      {result === "accepted"
                        ? '{ "success": true,\n  "action": "demo_submit" }'
                        : token
                          ? '{ "token": "••••••••",\n  "status": "ready" }'
                          : '{ "token": null,\n  "status": "pending" }'}
                    </pre>
                  </div>
                  <p className="flow-footnote">
                    <ShieldCheck size={14} /> Keputusan akhir selalu dibuat oleh
                    server.
                  </p>
                </section>
              </div>
              <div className="feature-strip">
                <div>
                  <span>
                    <LockKeyhole size={17} />
                  </span>
                  <strong>
                    Single use
                    <small>Used tokens are rejected automatically</small>
                  </strong>
                </div>
                <div>
                  <span>
                    <Database size={17} />
                  </span>
                  <strong>
                    Your data, your rules
                    <small>Challenges stay on your own server</small>
                  </strong>
                </div>
                <div>
                  <span>
                    <Globe2 size={17} />
                  </span>
                  <strong>
                    Ready to integrate
                    <small>Embed widget + verification endpoint</small>
                  </strong>
                </div>
              </div>
            </>
          )}
          {view === "integration" && (
            <div className="integration-content">
              <div className="integration-note">
                <Terminal size={21} />
                <div>
                  <strong>Two steps to get started.</strong>
                  <p>
                    Add your application domain to <code>ALLOWED_ORIGINS</code>.
                    Keep your secret in the backend only.
                  </p>
                </div>
              </div>
              <CodeBlock
                title="01 · Frontend — widget embed"
                code={frontendCode}
              />
              <CodeBlock
                title="02 · Backend — token verification"
                code={backendCode}
              />
              <div className="info-card">
                <Github size={21} />
                <div>
                  <h3>Run in GitHub Codespaces</h3>
                  <p>
                    Open the repository → Code → Codespaces. Port 3000 serves
                    the frontend and backend together.
                  </p>
                </div>
                <a
                  href={`${repo}/blob/main/README.md`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Guide <ArrowUpRight size={15} />
                </a>
              </div>
            </div>
          )}
          {view === "activity" && (
            <>
              <div className="section-bar">
                <div className="section-title">
                  <span className="section-number">24H</span>
                  <h2>Server overview</h2>
                </div>
                <button
                  className="text-button"
                  disabled={refreshing}
                  onClick={refreshActivity}
                >
                  <RefreshCw size={14} className={refreshing ? "spin" : ""} />{" "}
                  Refresh
                </button>
              </div>
              {activityError && (
                <p role="alert" className="alert">
                  {activityError}
                </p>
              )}
              <div className="metrics-grid">
                {[
                  { label: "Challenge created", value: activity?.created },
                  {
                    label: "Accepted verifications",
                    value: activity?.accepted,
                  },
                  { label: "Rejected attempts", value: activity?.rejected },
                  {
                    label: "Average solve time",
                    value:
                      activity?.averageMs != null
                        ? `${(activity.averageMs / 1000).toFixed(1)} sec`
                        : "—",
                  },
                ].map((item) => (
                  <div className="metric-card" key={item.label}>
                    <span>{item.label}</span>
                    <strong>{item.value ?? "—"}</strong>
                    <small>Last 24 hours</small>
                  </div>
                ))}
              </div>
              <div className="activity-card">
                <div className="activity-heading">
                  <h3>Recent activity</h3>
                  <span>Latest 20 events</span>
                </div>
                {activity?.events.length ? (
                  <div className="event-list">
                    {activity.events.map((event) => (
                      <div className="event-row" key={event.id}>
                        <span
                          className={`event-icon ${event.kind.includes("rejected") ? "rejected" : ""}`}
                        >
                          {event.kind.includes("rejected") ? (
                            <X size={16} />
                          ) : (
                            <Check size={16} />
                          )}
                        </span>
                        <span>
                          {eventNames[event.kind] ?? event.kind}
                          <small>
                            {event.duration
                              ? `Completed in ${(event.duration / 1000).toFixed(1)} seconds`
                              : "Recorded by the backend"}
                          </small>
                        </span>
                        <time dateTime={new Date(event.at).toISOString()}>
                          {new Date(event.at).toLocaleTimeString("en-US")}
                        </time>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <Waypoints size={32} />
                    <h3>No activity yet.</h3>
                    <p>Complete your first verification in the Playground.</p>
                    <button
                      className="text-button"
                      onClick={() => navigate("playground")}
                    >
                      Open Playground <ArrowRight size={15} />
                    </button>
                  </div>
                )}
              </div>
            </>
          )}
          <footer>
            <span>
              <span className="tiny-dot" /> Zetther reCAPTCHA Fake{" "}
              <span className="footer-version">v0.1.0</span>
            </span>
            <button onClick={() => setHelp(true)}>
              About this project <ArrowUpRight size={12} />
            </button>
          </footer>
        </main>
      </div>
      {help && (
        <div className="help-overlay" onClick={() => setHelp(false)}>
          <section
            className="help-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="about-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="icon-button help-close"
              aria-label="Close information"
              onClick={() => setHelp(false)}
            >
              <X size={20} />
            </button>
            <ShieldCheck size={30} />
            <h2 id="about-title">Zetther reCAPTCHA Fake</h2>
            <p>
              Complete an image challenge in the Playground, connect the widget
              from Integration, or review recent requests in Activity.
            </p>
            <p>
              The demo dataset is for development. Production bot protection and
              nonvisual challenges are not supported.
            </p>
            <a
              className="submit-button"
              href={repo}
              target="_blank"
              rel="noreferrer"
            >
              View source code <ArrowUpRight size={17} />
            </a>
          </section>
        </div>
      )}
    </div>
  );
}

function EmbeddedWidget() {
  const params = new URLSearchParams(location.search);
  const [session] = useState(() => crypto.randomUUID());
  const [resetKey, setResetKey] = useState(0);
  const origin = params.get("origin") ?? location.origin;
  const id = params.get("id") ?? "";
  const post = useCallback(
    (type: string, extra: object = {}) => {
      try {
        parent.postMessage(
          { source: "zetther-captcha", type, id, ...extra },
          origin,
        );
      } catch {
        /* Invalid embed origins are rejected by the API. */
      }
    },
    [id, origin],
  );
  const onToken = useCallback(
    (token: Token | null) => {
      if (token) post("success", { token: token.value });
    },
    [post],
  );
  const onStatus = useCallback(
    (status: Status) => {
      post("resize", { height: status === "challenge" ? 650 : 115 });
      if (status === "expired") post("expired");
    },
    [post],
  );
  const onError = useCallback(
    (error: string) => post("error", { error }),
    [post],
  );
  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (
        event.origin === origin &&
        event.source === parent &&
        event.data?.source === "zetther-captcha" &&
        event.data?.id === id &&
        event.data?.type === "reset"
      )
        setResetKey((key) => key + 1);
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [id, origin]);
  return (
    <Captcha
      embedded
      sitekey={params.get("sitekey") ?? ""}
      action={params.get("action") ?? "submit"}
      origin={origin}
      session={session}
      resetKey={resetKey}
      onToken={onToken}
      onStatus={onStatus}
      onError={onError}
    />
  );
}
const embedded = location.pathname === "/widget";
if (embedded) document.body.classList.add("widget-body");
createRoot(document.getElementById("root")!).render(
  embedded ? <EmbeddedWidget /> : <App />,
);
