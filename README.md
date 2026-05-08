# 🛡️ Secure Contact Form — Cloudflare Worker + Turnstile

**A drop-in, battle-hardened contact form protected against bots, spam, and header injection.**

[![Cloudflare](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Security](https://img.shields.io/badge/Security-Turnstile%20Protected-blue)](https://www.cloudflare.com/products/turnstile/)

---

## 📖 Description

A professional-grade reference implementation for a secure contact form. Unlike basic forms, this uses a **server-side defense strategy** where Cloudflare Workers handle the heavy lifting — validating tokens, sanitizing malicious HTML, and preventing email header injection before a single mail is sent.

**Key Features:**

- ✅ **Turnstile Integration** — Invisible / Managed bot protection (goodbye, CAPTCHA)
- ✅ **Input Sanitization** — Automatically strips HTML tags and CRLF characters
- ✅ **Security Gates** — Origin checks, Content-Type validation, length caps
- ✅ **Zero-Dependency** — Pure Vanilla JS, HTML, and CSS
- ✅ **Serverless Architecture** — Runs entirely on the Cloudflare Edge

---

## 🏗️ Architecture & Flow

```text
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

---

## 📦 What's Inside?

| Component | Purpose |
|---|---|
| 🛠️ `worker.js` | The **Brain** — verifies tokens, cleans data, and fires the email |
| 📄 `Form.html` | The **Face** — minimal HTML + JS to render the form and widget |
| 🎨 `Form.css` | The **Style** — neutral, framework-free CSS for quick styling |

---

## 🛡️ Multi-Layer Defense Stack

| Layer | Mitigates |
|---|---|
| 🌐 Origin Allow-list | Casual cross-site (CORS) requests |
| 🚦 Content-Type 415 | Misconfigured clients or lazy exploit scripts |
| 🤖 Turnstile Verify | Automated bots and scripted submissions |
| ✂️ Tag Stripping | XSS attacks via `name` or `message` fields |
| 🛡️ Header Protection | Email injection via `\r\n` stripping |
| 📏 Length Caps | Oversized payloads and buffer abuse |
| 📧 Plain Text Body | HTML rendering attacks in your email client |
| 📝 Sanitized Logs | Stack-trace and user-content leakage in Worker logs |

---

## 🚀 Quick Start Setup

### 1. Cloudflare Dashboard ☁️

- **Worker**: Create a "Hello World" Worker. Add an **Email Service** binding named `SE_EMAIL`.
- **Secrets**: In Worker → Settings → Variables and Secrets, add `TURNSTILE_SEC_TOKEN` (Type: **Secret**, not Text).
- **Email**: Verify your destination address in Email → Email Routing → Destination addresses.
- **Turnstile**: Create a widget (Managed Mode). Copy the **Site Key** and **Secret Key**.

### 2. Configuration ⚙️

**`worker.js`** — top of file:

```js
const ALLOWED_ORIGINS = new Set(["https://your-site.example"]);
const RECIPIENT_EMAIL = "your-inbox@example.com";
const SENDER_EMAIL = "noreply@your-domain.example";
const EMAIL_SUBJECT_PREFIX = "Contact Form";
```

**`Form.html`** — inside the `<script>` block:

```js
const TURNSTILE_SITEKEY = "YOUR_TURNSTILE_SITEKEY";
const WORKER_URL = "https://your-worker.your-account.workers.dev/";
```

### 3. Deployment 🚢

```bash
# Deploy the backend
wrangler deploy

# Deploy the frontend — upload Form.html and Form.css to any static host
# (GitHub Pages, Netlify, Vercel, S3 + CloudFront, etc.)
```

---

## ⚠️ Legal & Security Disclaimer

> [!IMPORTANT]
> **Threat Model Awareness — this tool does NOT protect against:**
> - Determined attackers using paid human CAPTCHA-solving services
> - Compromised secret keys (always rotate `TURNSTILE_SEC_TOKEN` if exposed)
> - Email provider quota exhaustion (monitor your Cloudflare Email Routing limits)

---

## 💡 Troubleshooting (Smoke Test)

If the "Send" button fails, open **DevTools → Network tab** → click the POST request → inspect the JSON response body:

| Error | Cause |
|---|---|
| ❌ `Unauthorized Origin` | Your domain isn't in `ALLOWED_ORIGINS` |
| ❌ `Unsupported Media Type` | Frontend isn't sending `Content-Type: application/json` |
| ❌ `Missing security token` | Turnstile widget didn't render (script tag missing or sitekey wrong) |
| ❌ `Security check failed` | Sitekey / Secret Key mismatch |
| ❌ `Invalid Input Syntax` | Field too short or email format invalid |
| ❌ `Internal Security Error` | Check Worker Live Tail in Cloudflare dashboard |

---

## 🧪 Local Development

Browsers block direct `file://` requests against external services (CORS). Run a tiny static server:

```bash
# Python 3 (built-in)
python -m http.server 3000

# Node.js (npm)
npx serve -l 3000
```

Then:

1. In the Turnstile widget settings, add `localhost` to **Hostname Management**
2. In `worker.js`, uncomment the localhost entries in `ALLOWED_ORIGINS` and re-deploy the Worker
3. Open `http://localhost:3000/Form.html`

> **Important:** Form submissions from localhost still hit the live Worker and send real emails. There is no separate "dev mode" — every submission goes through the same pipeline. Test sparingly, delete test emails afterwards.

---

## 🎨 Customization Ideas

- **Framework integration**: The core logic lives in the `<script>` block of `Form.html`. Copy that block into a React `useEffect`, a Vue `mounted`, or any other framework — the API surface is just `window.turnstile` and `fetch()`.
- **Styling**: Replace `Form.css` with your design system. The HTML uses no framework-specific class names.
- **Rate limiting**: Add a Cloudflare Rate Limiting Rule on the Worker route (paid), or implement Worker-level rate limiting via Workers KV (free tier).
- **Reply-To header**: Add `replyTo: email` inside `env.SE_EMAIL.send()` so hitting Reply in your inbox replies to the inquirer instead of yourself. Verify your email service's exact key name (some use `reply_to`).
- **Auto-acknowledgement**: Send a second email to the inquirer thanking them. Doubles your quota usage and adds spam-reflection risk if Turnstile is bypassed — only enable once you have rate limiting.

---

## 📄 License

MIT License — see `LICENSE` file for details.
