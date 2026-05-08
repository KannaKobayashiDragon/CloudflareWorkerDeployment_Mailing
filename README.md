# Secure Contact Form — Cloudflare Worker + Turnstile

A drop-in reference for a contact form that's protected against bots, spam, header injection, and common rendering attacks. All defenses run server-side; the client component is intentionally minimal.

## What you get

| File | Purpose |
|---|---|
| `worker.js` | Cloudflare Worker — receives form POSTs, verifies Turnstile token, sanitizes input, sends email |
| `Form.html` | Plain HTML + vanilla JS — renders form + Turnstile widget, submits to the Worker |
| `Form.css` | Minimal neutral styles for the form (no framework dependency) |

## Architecture

```
   Browser                                Cloudflare
   ─────────                              ──────────────────────────────
   User fills form                                     
        │
        │  Turnstile widget (managed mode)              ← embedded iframe
        ▼
   Click "Send"
        │
        │  POST { name, email, message, turnstileToken }
        ▼
   ────────────────────────────────────►  Cloudflare Worker
                                            ├─ CORS / Origin check
                                            ├─ Content-Type 415 gate
                                            ├─ Turnstile siteverify    (network call)
                                            ├─ Sanitize + validate
                                            ├─ env.SE_EMAIL.send()     (email binding)
                                            └─ Return JSON status
                                              │
                                              ▼
                                          Verified destination inbox
```

## Defenses

| Layer | Mitigates |
|---|---|
| Origin allow-list | Casual cross-site requests |
| Content-Type 415 | Lazy attackers / misconfigured clients |
| Turnstile siteverify | Bots, scripted submissions |
| HTML tag stripping | XSS via injected markup in name/message |
| `\r\n` stripping | Email header injection |
| Length caps | Buffer abuse, oversized payloads |
| Email regex + min lengths | Garbage submissions |
| `text/plain` email body | HTML rendering attacks in the recipient's mail client |
| Sanitized error logs | Log-side leakage of user content / stack traces |

## Threat model — what this does NOT defend against

- **Determined attackers using human CAPTCHA solvers.** Add rate limiting if abuse is observed (Cloudflare Rate Limiting Rules paid, or Worker-level KV is free).
- **Compromised secret keys.** Rotate `TURNSTILE_SEC_TOKEN` if exposed.
- **Email provider quota exhaustion.** Cloudflare Email Routing has its own daily limits. Monitor.

## Setup

### 1. Cloudflare Resources

Configure these in the Cloudflare Dashboard before deploying the Worker code:

#### a. Worker
- Workers & Pages → Create application → "Hello World" template
- Name it whatever you like (e.g., `contact`)
- After creation: open the Worker → **Bindings** → Add binding:
  - Type: **Email Service**
  - Variable name: `SE_EMAIL`
- Then: open the Worker → **Settings** → **Variables and Secrets** → Add:
  - Type: **Secret** *(not Text — Secret encrypts at rest)*
  - Variable name: `TURNSTILE_SEC_TOKEN`
  - Value: *(filled in step 1c below)*

#### b. Email Routing — verify destination
- Email → Email Routing → **Destination addresses** → Add
- Enter recipient inbox → click verification link in that inbox
- Status must show **Verified** before the Worker can send to it

#### c. Turnstile widget
- Protect & Connect → Turnstile → Add Widget
- Hostname Management: add your production domain (and `localhost` if you want local testing)
- Mode: **Managed** (default)
- After creation, copy:
  - **Site Key** → goes into `Form.html` (replaces `YOUR_TURNSTILE_SITEKEY`)
  - **Secret Key** → paste as the value of `TURNSTILE_SEC_TOKEN` (step 1a above)

### 2. Edit the configuration constants

**`worker.js`** — top of file:
```js
const ALLOWED_ORIGINS = new Set([
    "https://your-site.example",      // ← your production domain
]);
const RECIPIENT_EMAIL = "your-inbox@example.com";   // ← step 1b verified address
const SENDER_EMAIL = "noreply@your-domain.example"; // ← on a Cloudflare-managed domain
const EMAIL_SUBJECT_PREFIX = "Contact Form";        // ← optional
```

**`Form.html`** — inside the `<script>` block near the bottom:
```js
const TURNSTILE_SITEKEY = "YOUR_TURNSTILE_SITEKEY";       // ← step 1c Site Key
const WORKER_URL = "https://your-worker.your-account.workers.dev/"; // ← your Worker URL
```

The Turnstile script tag is already included in `Form.html` `<head>` — no separate setup needed.

### 3. Deploy

**Worker** — paste `worker.js` into the Cloudflare dashboard editor, or use Wrangler:
```bash
wrangler deploy
```

**Frontend** — `Form.html` and `Form.css` are static files. Drop them into any web host:
- Upload to any static host: GitHub Pages, Netlify, Vercel, S3 + CloudFront, etc.
- Or copy the `<form>` markup, `<link rel="stylesheet">`, and `<script>` block into your existing site
- For local testing, see the [Local development](#local-development) section — `file://` won't work because Cloudflare Turnstile and the Worker both require an `http://` or `https://` origin

## Smoke test

1. Open your contact page
2. Fill name, email, message
3. Wait for Turnstile to auto-resolve (managed mode usually completes in ~1–2 seconds)
4. Click Send
5. Expected: green success toast, email arrives in destination inbox within ~30 seconds

If something fails, open DevTools Network tab → click the POST request → response body shows a JSON error indicating which gate rejected:
- `Unauthorized Origin` → check `ALLOWED_ORIGINS` includes the page's origin
- `Unsupported Media Type` → frontend isn't sending `Content-Type: application/json`
- `Missing security token` → Turnstile widget didn't render (script tag missing, or sitekey wrong)
- `Security check failed` → sitekey/secret key mismatch
- `Invalid Input Syntax` → field too short or email format invalid
- `Internal Security Error` → check Worker Live Tail for the actual error

## Local development

Browsers block direct `file://` requests against external services (CORS). To test locally you need a tiny static server:

```bash
# Python 3 (built-in):
python -m http.server 3000

# Node.js (npm):
npx serve -l 3000
```

Then:
1. In the Turnstile widget settings, add `localhost` to Hostname Management
2. In `worker.js`, uncomment the localhost entries in `ALLOWED_ORIGINS` and re-deploy the Worker
3. Open `http://localhost:3000/Form.html`

> **Important:** form submissions from localhost still hit the live Worker and send real emails. There is no separate "dev mode" — every submission goes through the same pipeline. Test sparingly, delete test emails afterwards.

## Customization ideas

- **Framework integration:** The core logic (Turnstile rendering, fetch with abort timeout, JSON error parsing, status banner) is contained in the `<script>` block of `Form.html`. Copy that block into a React `useEffect`, a Vue `mounted`, or any other framework — the API surface is just `window.turnstile` and `fetch()`.
- **Styling:** `Form.css` uses neutral colours. Replace with your design system — the HTML uses no framework-specific class names, just standard form elements.
- **Rate limiting:** Add a Cloudflare Rate Limiting Rule on the Worker route, or a Worker-level check via Workers KV (free tier sufficient for most contact forms).
- **Reply-To header:** Add `replyTo: email` inside `env.SE_EMAIL.send()` so hitting Reply in your inbox replies to the inquirer instead of yourself. Verify your email service's exact key name (some use `reply_to`).
- **Auto-acknowledgement:** Add a second `env.SE_EMAIL.send()` to the inquirer thanking them. Doubles your quota usage and adds spam-reflection risk if Turnstile is bypassed — only enable once you have rate limiting.

## License

This template is provided as-is for reference. Use freely.
