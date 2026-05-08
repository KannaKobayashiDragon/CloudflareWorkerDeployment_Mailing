/**
 * ============================================================================
 * Cloudflare Worker — Secure Contact Form Backend
 * ============================================================================
 *
 * Public reference template. Fork, configure, deploy.
 *
 * Security layers (in execution order):
 *   1. CORS preflight handling
 *   2. POST-only methods filter
 *   3. Origin allow-list (defense-in-depth, not primary)
 *   4. Content-Type 415 gate (rejects non-JSON before parsing)
 *   5. Cloudflare Turnstile siteverify (primary bot defense)
 *   6. Input sanitization (HTML strip, newline strip, length cap)
 *   7. Email regex + minimum-length validation
 *   8. Sender hardening (text-only emails — no HTML rendering attacks)
 *   9. Sanitized error logging (no stack traces, no user input echoed)
 *
 * Required Cloudflare resources (configure via Dashboard before deploy):
 *   - Worker Variable & Secret: TURNSTILE_SEC_TOKEN  (Type: Secret)
 *   - Worker Binding:           SE_EMAIL             (Type: Email Service)
 *   - Email Routing:            verified destination address
 *   - Turnstile Widget:         on the same Cloudflare account
 *
 * Quota notes:
 *   - This Worker uses 1 subrequest per submission (siteverify) + 1 email send.
 *   - Free Workers tier: 100,000 requests/day. Plenty for a contact form.
 *
 * Threat model — what this Worker DOES NOT defend against:
 *   - Distributed bot networks that solve Turnstile via human farms.
 *     Add rate limiting (Cloudflare Rate Limiting Rules or Worker-level KV)
 *     if abuse is observed. See README for guidance.
 *   - Abuse via stolen secret keys. Rotate TURNSTILE_SEC_TOKEN if exposed.
 *
 * ============================================================================
 */

// ============================================================================
// CONFIGURATION — edit these for your deployment
// ============================================================================

/** Origins permitted to call this Worker. Add your production domain here. */
const ALLOWED_ORIGINS = new Set([
    "https://your-site.example",
    // Optional: uncomment for local dev. Remove before going live if desired.
    // "http://localhost:3000",
    // "http://127.0.0.1:3000",
]);

/** Recipient inbox. Must be VERIFIED in Cloudflare > Email > Email Routing. */
const RECIPIENT_EMAIL = "your-inbox@example.com";

/** Sender address. Must be on a Cloudflare-managed domain with valid SPF/DKIM. */
const SENDER_EMAIL = "noreply@your-domain.example";

/** Email subject prefix. Final subject becomes "<prefix>: <Sanitized Name>". */
const EMAIL_SUBJECT_PREFIX = "Contact Form";

// ============================================================================
// WORKER ENTRY POINT
// ============================================================================

export default {
    async fetch(request, env) {
        const origin = request.headers.get("Origin");
        const isAllowedOrigin = ALLOWED_ORIGINS.has(origin);

        // CORS headers — echo a permitted Origin back; otherwise fall back to
        // the first configured origin so misconfigured clients still get a
        // coherent (rejected) preflight response.
        const corsHeaders = {
            "Access-Control-Allow-Origin": isAllowedOrigin ? origin : Array.from(ALLOWED_ORIGINS)[0],
            "Access-Control-Allow-Methods": "POST, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Accept",
        };

        // Reusable JSON error helper — every error response is machine-parseable.
        const errorResponse = (msg, status) =>
            new Response(JSON.stringify({ success: false, error: msg }), {
                status,
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });

        // 1. CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: { ...corsHeaders, "Access-Control-Max-Age": "86400" },
            });
        }

        // 2. Method filter
        if (request.method !== "POST") {
            return errorResponse("Method Not Allowed", 405);
        }

        // 3. Origin allow-list
        if (!isAllowedOrigin) {
            return errorResponse("Unauthorized Origin", 403);
        }

        // 4. Content-Type validation — fail fast on non-JSON before parsing.
        const contentType = request.headers.get("Content-Type") ?? "";
        if (!contentType.includes("application/json")) {
            return errorResponse("Unsupported Media Type", 415);
        }

        try {
            const body = await request.json();

            // 5. Turnstile token verification (primary bot defense).
            //    The client widget is decorative without this server-side check —
            //    any HTTP client could otherwise POST a fake/empty token.
            const turnstileToken = typeof body.turnstileToken === "string" ? body.turnstileToken : "";
            if (!turnstileToken) {
                return errorResponse("Missing security token", 403);
            }

            const verifyResponse = await fetch(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                {
                    method: "POST",
                    body: new URLSearchParams({
                        secret: env.TURNSTILE_SEC_TOKEN,
                        response: turnstileToken,
                        remoteip: request.headers.get("CF-Connecting-IP") ?? "",
                    }),
                }
            );
            const verifyData = await verifyResponse.json();
            if (!verifyData.success) {
                return errorResponse("Security check failed", 403);
            }

            // 6. Input sanitization — strip HTML tags, strip CR/LF (header injection),
            //    trim, and cap length. Defends against rendering attacks downstream.
            const sanitize = (str, maxLen) => {
                if (typeof str !== "string") return "";
                return str
                    .replace(/<[^>]*>?/gm, "")
                    .replace(/[\r\n]/g, " ")
                    .trim()
                    .substring(0, maxLen);
            };

            const name = sanitize(body.name, 100);
            const email = sanitize(body.email, 254); // RFC 5321 max
            const message = sanitize(body.message, 2000);

            // 7. Validate after sanitization. Order matters — never validate raw input.
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            if (!emailRegex.test(email) || name.length < 2 || message.length < 5) {
                return errorResponse("Invalid Input Syntax", 400);
            }

            // 8. Send email — text/plain only. The recipient's mail client will
            //    not execute any HTML or scripts because the body has no HTML part.
            await env.SE_EMAIL.send({
                to: RECIPIENT_EMAIL,
                from: SENDER_EMAIL,
                subject: `${EMAIL_SUBJECT_PREFIX}: ${name}`,
                text:
                    `Verified Submission\n` +
                    `--------------------\n` +
                    `Name: ${name}\n` +
                    `Email: ${email}\n` +
                    `Timestamp: ${new Date().toISOString()}\n\n` +
                    `Message:\n${message}`,
            });

            return new Response(JSON.stringify({ success: true }), {
                headers: {
                    ...corsHeaders,
                    "Content-Type": "application/json",
                    "X-Content-Type-Options": "nosniff",
                },
            });

        } catch (error) {
            // 9. Sanitized logging — only the error message, never the full Error.
            //    Avoids leaking stack traces or fragments of user-submitted content.
            console.error("Worker error:", error?.message ?? "unknown");
            return errorResponse("Internal Security Error", 500);
        }
    },
};
