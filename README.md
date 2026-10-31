# Zetther reCAPTCHA Fake

[![Build, test, and run](https://github.com/zetther/recaptcha/actions/workflows/ci.yml/badge.svg)](https://github.com/zetther/recaptcha/actions/workflows/ci.yml)
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/zetther/recaptcha)

A self-hosted CAPTCHA by **Zetther** with checkbox verification, 3×3 image challenges, and single-use tokens. Includes a playground, embed SDK, and verification API.

## Run on GitHub

1. Click **Open in GitHub Codespaces** above and create a Codespace.
2. Wait for dependency installation. The server starts automatically.
3. Open port **3000** in the **Ports** panel. One URL serves the frontend and backend.
4. Complete a challenge, then submit the demo form to verify its token on the server.

If startup fails, run `npm run dev` in the Codespaces terminal. Automatic startup logs are in `.data/dev-server.log`. Restarting preserves the workspace database; deleting the Codespace removes its local data.

**GitHub Actions** runs tests, builds the app, and checks the production server and Docker image on every push and pull request. Build artifacts are retained for 7 days.

The backend runs while your Codespace is active. Forwarded ports default to private. GitHub Pages cannot host the backend.

## Run locally

Use **Node.js 24** and npm:

```sh
npm ci
npm run dev
```

Open `http://localhost:3000`. SQLite and a random development secret are created in the Git-ignored `.data/` directory.

```sh
npm run check          # typecheck, tests, production build
node scripts/smoke.mjs # start production build and test HTTP responses
npm start              # run the production build
```

Or run `docker compose up --build`. Compose stores SQLite in a named volume and binds the port to loopback. Stop with `docker compose down`; omit `-v` to preserve data.

## Features

- Protected demo form: missing or invalid tokens are rejected by the backend.
- Randomized image challenges featuring buses, cars, bicycles, and trains.
- Server-rendered PNGs with opaque IDs; responses and filenames never expose correct tile indices.
- Challenges expire after 180 seconds, allow three incorrect answers, and are invalidated on refresh.
- Random 256-bit tokens expire after 120 seconds; only their hashes are stored.
- Atomic SQLite redemption, bound to site key, action, and registered origin. The demo also checks the widget session.
- Replay, expiry, wrong-secret, and context-mismatch rejection.
- Iframe SDK: `ZettherCaptcha.render`, `reset`, and `remove`.
- Aggregate activity for 24 hours, without message bodies, IPs, raw tokens, secrets, or answers in activity records.
- Keyboard image selection.

## Configuration

Copy `.env.example` to `.env` if needed. Existing process environment variables take priority.

| Variable          | Purpose                                                                 |
| ----------------- | ----------------------------------------------------------------------- |
| `PORT`            | Server port; default `3000`                                             |
| `HOST`            | Bind address; default `0.0.0.0`                                         |
| `SITE_KEY`        | Public identifier; default `zetther_local_demo`                         |
| `CAPTCHA_SECRET`  | Random private backend secret, at least 32 characters                   |
| `PUBLIC_ORIGIN`   | Exact origin without trailing slash, e.g. `https://captcha.example.com` |
| `ALLOWED_ORIGINS` | Comma-separated origins allowed to embed the widget                     |
| `DATABASE_PATH`   | SQLite location; default `.data/captcha.sqlite`                         |

The HTTPS forwarded-port origin is detected automatically in Codespaces. Localhost and 127.0.0.1 on the configured port remain allowed for development.

The generated development secret is in `.data/development-secret`. Read it locally only when testing external backend integration. Never commit it or put it in browser code. For internet-facing deployment, set `CAPTCHA_SECRET` through your host's secret manager and serve over HTTPS. Rotate by replacing the environment secret and restarting the server.

## Embed the widget

Register your application origin in `ALLOWED_ORIGINS`, then replace the example URL and site key:

```html
<div id="captcha"></div>
<input type="hidden" name="captcha_token" id="captcha-token" />
<script src="https://captcha.example.com/widget.js"></script>
<script>
  const widgetId = ZettherCaptcha.render("#captcha", {
    sitekey: "YOUR_SITE_KEY",
    action: "contact",
    callback: (token) => {
      document.querySelector("#captcha-token").value = token;
    },
    onExpire: () => {
      document.querySelector("#captcha-token").value = "";
    },
    onError: (error) => console.error(error),
  });
  // After your backend consumes a token, clear the hidden input,
  // then call ZettherCaptcha.reset(widgetId) for another verification.
</script>
```

Validate the token in your backend before processing the protected action:

```js
const response = await fetch("https://captcha.example.com/v1/siteverify", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  signal: AbortSignal.timeout(5000),
  body: JSON.stringify({
    secret: process.env.CAPTCHA_SECRET,
    response: submittedToken,
    sitekey: process.env.CAPTCHA_SITE_KEY,
    action: "contact",
    origin: "https://your-app.example",
  }),
});
const result = await response.json();
if (!response.ok || result.success !== true) {
  throw new Error("CAPTCHA verification failed");
}
// Process the protected form or action here.
```

Fail closed on timeout, connection failure, or an invalid response. Successful verification consumes the token. Retrying requires a new challenge or application-level idempotency.

## API

| Endpoint                             | Purpose                                                    |
| ------------------------------------ | ---------------------------------------------------------- |
| `GET /health`                        | Service health                                             |
| `GET /api/config`                    | Public demo configuration                                  |
| `POST /v1/challenges`                | Create challenge: `sitekey`, `action`, `origin`, `session` |
| `GET /v1/challenges/:id/tiles/:tile` | PNG image without answer metadata                          |
| `POST /v1/challenges/:id/solve`      | Check selected image IDs: `selected`, `session`            |
| `POST /v1/siteverify`                | Redeem token with backend secret; JSON or form-urlencoded  |
| `POST /api/demo/submit`              | Protected form: `token`, `session`, `message`              |
| `GET /api/activity`                  | Aggregate statistics and 20 latest demo events             |
| `GET /widget.js`                     | ZettherCaptcha embed SDK                                   |
| `GET /widget`                        | Iframe widget                                              |

`siteverify` returns `{ "success": true, "action": "contact", "hostname": "your-app.example" }` or `{ "success": false, "error": "..." }`. Invalid secrets return HTTP 401, malformed payloads HTTP 400, and rate limits HTTP 429. Check both HTTP status and `success`.

## Source layout

```text
src/                   React playground, widget, integration, activity
server/app.ts          API routes and input validation
server/store.ts        SQLite, challenge/token lifecycle, transactions, retention
server/artwork.ts      Original illustrations and PNG rendering
server/config.ts       Local and Codespaces configuration
public/widget.js       Dependency-free ZettherCaptcha embed SDK
tests/                 Security lifecycle and HTTP tests
scripts/               Codespaces startup and production smoke test
.devcontainer/         GitHub Codespaces configuration
.github/workflows/     GitHub build, test, and runtime checks
```

## Limitations

- The small illustration dataset is suitable for development and can be recognized by vision models. It has not been validated for production bot protection.
- Supports one site configuration on a single host. Multiple instances require shared token storage and rate limiting.
- Browser-supplied origins do not authenticate non-browser clients. Configure trusted proxy forwarding and edge rate limits when deploying behind a proxy.
- The activity page shows public demo aggregates. Multi-site administration and dashboard key management are not implemented.
- Image selection supports keyboard navigation. Audio and other nonvisual challenges are not implemented.

## License

[MIT](LICENSE) · Zetther. DM Sans and Manrope retain their font licenses; Lucide icons use the ISC license. This project is not affiliated with Google.
