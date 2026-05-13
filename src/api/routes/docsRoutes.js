const fp = require('fastify-plugin');
const crypto = require('crypto');

const COOKIE_NAME = 'api_docs_token';
const COOKIE_MAX_AGE = 86400; // 24h in seconds

function hmacToken(password) {
    return crypto.createHmac('sha256', password).update('api-docs-session').digest('hex');
}

function isAuthenticated(request) {
    const password = process.env.API_DOCS_PASSWORD;
    if (!password) return false;

    const cookie = request.cookies?.[COOKIE_NAME] || parseCookie(request.headers.cookie, COOKIE_NAME);
    if (!cookie) return false;

    const expected = hmacToken(password);
    const a = Buffer.from(cookie);
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function parseCookie(header, name) {
    if (!header) return null;
    const match = header.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
    return match ? decodeURIComponent(match[1]) : null;
}

async function docsRoutes(fastify) {
    // GET /api/docs — serve login or docs page
    fastify.get('/api/docs', async (request, reply) => {
        const password = process.env.API_DOCS_PASSWORD;
        if (!password) {
            return reply.code(503).send({
                success: false,
                code: 503,
                message: 'API documentation is not configured. Set API_DOCS_PASSWORD environment variable.',
                data: null
            });
        }

        if (!isAuthenticated(request)) {
            reply.type('text/html; charset=utf-8');
            return reply.send(loginPage());
        }

        reply.type('text/html; charset=utf-8');
        return reply.send(docsPage());
    });

    // POST /api/docs — handle login
    fastify.post('/api/docs', async (request, reply) => {
        const password = process.env.API_DOCS_PASSWORD;
        if (!password) {
            return reply.code(503).send({
                success: false,
                code: 503,
                message: 'API documentation is not configured.',
                data: null
            });
        }

        const submitted = request.body?.password || '';
        const a = Buffer.from(String(submitted));
        const b = Buffer.from(password);

        if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
            return reply.code(401).send({ error: 'Invalid password.' });
        }

        const token = hmacToken(password);
        reply.header('Set-Cookie', `${COOKIE_NAME}=${token}; HttpOnly; Path=/api/docs; Max-Age=${COOKIE_MAX_AGE}; SameSite=Strict`);
        return reply.send({ ok: true });
    });

    // POST /api/docs/logout
    fastify.post('/api/docs/logout', async (request, reply) => {
        reply.header('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; Path=/api/docs; Max-Age=0; SameSite=Strict`);
        return reply.send({ ok: true });
    });
}

function loginPage(error = '') {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>API Docs — Login</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#0d1117;color:#c9d1d9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh}
.card{background:#161b22;border:1px solid #30363d;border-radius:12px;padding:40px;width:380px;max-width:90vw}
h1{font-size:1.5rem;margin-bottom:8px;color:#f0f6fc}
p.sub{color:#8b949e;margin-bottom:24px;font-size:.9rem}
label{display:block;font-size:.85rem;color:#8b949e;margin-bottom:6px}
input[type=password]{width:100%;padding:10px 12px;background:#0d1117;border:1px solid #30363d;border-radius:6px;color:#c9d1d9;font-size:1rem;outline:none}
input[type=password]:focus{border-color:#58a6ff}
button{width:100%;padding:10px;margin-top:16px;background:#238636;color:#fff;border:none;border-radius:6px;font-size:1rem;cursor:pointer;font-weight:600}
button:hover{background:#2ea043}
.error{color:#f85149;font-size:.85rem;margin-top:12px}
</style>
</head>
<body>
<div class="card">
<h1>API Documentation</h1>
<p class="sub">Enter the docs password to continue.</p>
<form id="loginForm">
<label for="pw">Password</label>
<input type="password" id="pw" name="password" autofocus required>
<button type="submit">Sign in</button>
<p class="error" id="errMsg">${error || ''}</p>
</form>
<script>
document.getElementById('loginForm').addEventListener('submit', async function(e) {
    e.preventDefault();
    const pw = document.getElementById('pw').value;
    const res = await fetch('/api/docs', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({password: pw})
    });
    const data = await res.json().catch(() => null);
    if (data && data.ok) {
        window.location.reload();
    } else if (data && data.error) {
        document.getElementById('errMsg').textContent = data.error;
    } else {
        document.getElementById('errMsg').textContent = 'Something went wrong.';
    }
});
</script>
</div>
</body>
</html>`;
}

/* ───────────────────────────────────────────────
   Full documentation page (self-contained HTML)
   ─────────────────────────────────────────────── */
function docsPage() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>OrkutWhatsApp5.0 — API Documentation</title>
<style>
:root{--bg:#0d1117;--surface:#161b22;--border:#30363d;--text:#c9d1d9;--text-muted:#8b949e;--accent:#58a6ff;--green:#3fb950;--red:#f85149;--orange:#d29922;--purple:#bc8cff;--code-bg:#1c2128;--hover:#1f2937}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;line-height:1.6;padding:0 0 80px}
a{color:var(--accent);text-decoration:none}
a:hover{text-decoration:underline}

/* Top bar */
.topbar{background:var(--surface);border-bottom:1px solid var(--border);padding:16px 24px;display:flex;align-items:center;justify-content:space-between;position:sticky;top:0;z-index:100}
.topbar h1{font-size:1.25rem;color:#f0f6fc}
.topbar .actions{display:flex;gap:12px;align-items:center}
.topbar .badge{font-size:.75rem;padding:3px 8px;border-radius:12px;background:#238636;color:#fff;font-weight:600}
.logout-btn{background:transparent;border:1px solid var(--border);color:var(--text-muted);padding:6px 14px;border-radius:6px;cursor:pointer;font-size:.8rem}
.logout-btn:hover{border-color:var(--text-muted);color:var(--text)}

/* Layout */
.container{max-width:1100px;margin:0 auto;padding:24px 20px}

/* Nav */
.toc{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:20px 24px;margin-bottom:32px}
.toc h2{font-size:1rem;color:#f0f6fc;margin-bottom:12px}
.toc ul{list-style:none;columns:2;gap:16px}
.toc li{margin-bottom:6px}
.toc a{font-size:.9rem}
@media(max-width:640px){.toc ul{columns:1}}

/* Section headings */
.section{margin-bottom:40px}
.section > h2{font-size:1.3rem;color:#f0f6fc;padding-bottom:8px;border-bottom:1px solid var(--border);margin-bottom:16px}
.section > p{color:var(--text-muted);margin-bottom:16px;font-size:.92rem}

/* Endpoint card */
.endpoint{background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:12px;overflow:hidden}
.endpoint-header{display:flex;align-items:center;gap:12px;padding:14px 18px;cursor:pointer;user-select:none}
.endpoint-header:hover{background:var(--hover)}
.method{font-family:'SF Mono',SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace;font-size:.8rem;font-weight:700;padding:3px 10px;border-radius:4px;min-width:62px;text-align:center;text-transform:uppercase}
.method.get{background:#1f6feb22;color:var(--accent)}
.method.post{background:#23863622;color:var(--green)}
.method.patch{background:#d2992222;color:var(--orange)}
.method.delete{background:#f8514922;color:var(--red)}
.method.ws{background:#bc8cff22;color:var(--purple)}
.path{font-family:'SF Mono',SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace;font-size:.9rem;color:#f0f6fc;flex:1}
.desc-short{color:var(--text-muted);font-size:.85rem}
.chevron{color:var(--text-muted);transition:transform .2s;font-size:.8rem}
.endpoint.open .chevron{transform:rotate(90deg)}
.endpoint-body{display:none;padding:0 18px 18px;border-top:1px solid var(--border)}
.endpoint.open .endpoint-body{display:block}

/* Code blocks */
pre{background:var(--code-bg);border:1px solid var(--border);border-radius:6px;padding:14px 16px;overflow-x:auto;font-size:.84rem;line-height:1.5;margin:10px 0;font-family:'SF Mono',SFMono-Regular,Consolas,'Liberation Mono',Menlo,monospace}
code{font-family:inherit}
.label{font-size:.8rem;font-weight:600;color:var(--text-muted);text-transform:uppercase;letter-spacing:.5px;margin:16px 0 6px;display:block}
.note{background:#d2992215;border-left:3px solid var(--orange);padding:10px 14px;border-radius:4px;font-size:.85rem;margin:10px 0;color:var(--orange)}
.info{background:#1f6feb15;border-left:3px solid var(--accent);padding:10px 14px;border-radius:4px;font-size:.85rem;margin:10px 0;color:var(--accent)}

/* Setup guide */
.step{display:flex;gap:14px;margin-bottom:20px}
.step-num{background:#238636;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.85rem;flex-shrink:0;margin-top:2px}
.step-content h3{font-size:1rem;color:#f0f6fc;margin-bottom:4px}
.step-content p{font-size:.9rem;color:var(--text-muted)}

/* Table */
table{width:100%;border-collapse:collapse;margin:10px 0;font-size:.85rem}
th{text-align:left;padding:8px 10px;background:var(--code-bg);border:1px solid var(--border);color:#f0f6fc;font-weight:600}
td{padding:8px 10px;border:1px solid var(--border)}
td code{background:var(--code-bg);padding:1px 5px;border-radius:3px;font-size:.82rem}
</style>
</head>
<body>
<div class="topbar">
<div style="display:flex;align-items:center;gap:12px">
<h1>OrkutWhatsApp5.0 API</h1>
<span class="badge">v5.0</span>
</div>
<div class="actions">
<button class="logout-btn" onclick="fetch('/api/docs/logout',{method:'POST'}).then(()=>location.reload())">Logout</button>
</div>
</div>
<div class="container">

<!-- Table of Contents -->
<nav class="toc">
<h2>Contents</h2>
<ul>
<li><a href="#setup">Setup Guide</a></li>
<li><a href="#auth">Authentication</a></li>
<li><a href="#errors">Error Responses</a></li>
<li><a href="#health">Health &amp; Readiness</a></li>
<li><a href="#bots">Bot Management</a></li>
<li><a href="#transactions">Transactions</a></li>
<li><a href="#broadcast">Broadcast</a></li>
<li><a href="#websocket">WebSocket</a></li>
<li><a href="#webhooks">Webhook Notifications</a></li>
</ul>
</nav>

<!-- ========== SETUP GUIDE ========== -->
<div class="section" id="setup">
<h2>Step-by-Step Setup Guide</h2>

<div class="step">
<div class="step-num">1</div>
<div class="step-content">
<h3>Environment Variables</h3>
<p>Copy <code>.env.example</code> to <code>.env</code> and configure at minimum:</p>
<pre>BOT_MODE=MULTI
DATABASE_MONGODB_URI=mongodb://127.0.0.1:27017/?retryWrites=true&amp;w=majority
DATABASE_NAME=koalaBOT
API_KEY=&lt;generate: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"&gt;
WA_AUTH_ENCRYPTION_KEY=&lt;generate same way&gt;
API_PORT=3000
API_DOCS_PASSWORD=your-secret-docs-password</pre>
</div>
</div>

<div class="step">
<div class="step-num">2</div>
<div class="step-content">
<h3>Docker Setup</h3>
<p>Build and start the container:</p>
<pre>docker compose -f docker/docker-compose.yml up -d</pre>
<p>Or run directly with Node.js:</p>
<pre>npm install
npm start</pre>
</div>
</div>

<div class="step">
<div class="step-num">3</div>
<div class="step-content">
<h3>Verify the Server</h3>
<p>Check the health endpoint (no auth required):</p>
<pre>curl http://localhost:3000/health</pre>
</div>
</div>

<div class="step">
<div class="step-num">4</div>
<div class="step-content">
<h3>Create Your First Bot</h3>
<p>Register a bot instance with the API:</p>
<pre>curl -X POST http://localhost:3000/api/bots/create \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{
    "user_id": "user-001",
    "phone_number": "6281234567890",
    "bot_name": "My Store Bot",
    "pairing_method": "code"
  }'</pre>
<p>The response will include a <code>pairing_code</code>. Enter it in WhatsApp &gt; Linked Devices &gt; Link with phone number.</p>
</div>
</div>

<div class="step">
<div class="step-num">5</div>
<div class="step-content">
<h3>Set Up Webhooks (Optional)</h3>
<p>Set <code>webhook_url</code> + <code>webhook_events</code> at create-time, or PATCH them later. The response includes a <code>webhook_secret</code> ONCE — store it; you'll need it to verify the <code>X-Webhook-Signature</code> header on every delivery. See <a href="#webhooks">Webhooks</a> for the envelope, signature, retry, and full event catalog.</p>
<pre>curl -X PATCH http://localhost:3000/api/bots/BOT_ID \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{
    "webhook_url": "https://your-backend.com/api/wa/webhook",
    "webhook_events": ["bot_connected", "bot_disconnected", "messages.upsert", "call"]
  }'</pre>
</div>
</div>
</div>

<!-- ========== AUTHENTICATION ========== -->
<div class="section" id="auth">
<h2>Authentication</h2>
<p>All API endpoints (except <code>/health</code>, <code>/ready</code>, and <code>/ws/*</code>) require the <code>X-API-Key</code> header. The value must match the <code>API_KEY</code> environment variable. Comparison uses constant-time <code>crypto.timingSafeEqual</code> to prevent timing attacks.</p>
<pre>curl -H "X-API-Key: YOUR_API_KEY" http://localhost:3000/api/bots</pre>
<div class="note">If <code>API_KEY</code> is not set on the server, all authenticated requests will return 401.</div>
</div>

<!-- ========== ERROR RESPONSES ========== -->
<div class="section" id="errors">
<h2>Error Responses</h2>
<p>All errors follow a consistent envelope:</p>
<table>
<tr><th>Status</th><th>Body</th></tr>
<tr><td><code>400</code></td><td><code>{ "success": false, "code": 400, "message": "...", "data": null }</code></td></tr>
<tr><td><code>401</code></td><td><code>{ "success": false, "code": 401, "message": "Unauthorized: Invalid or missing API key", "data": null }</code></td></tr>
<tr><td><code>404</code></td><td><code>{ "success": false, "code": 404, "message": "...", "data": null }</code></td></tr>
<tr><td><code>500</code></td><td><code>{ "success": false, "code": 500, "message": "Internal server error", "data": null }</code></td></tr>
</table>
<div class="info">The <code>message</code> field in 500 responses is always sanitized to <code>"Internal server error"</code> — implementation details are never leaked.</div>
</div>

<!-- ========== HEALTH ========== -->
<div class="section" id="health">
<h2>Health &amp; Readiness</h2>
<p>No authentication required. Used for load balancer and orchestrator probes.</p>

${endpoint('GET', '/health', 'Liveness probe', {
    desc: 'Returns 200 if the process is alive. In MULTI mode, includes running bot count.',
    response: `{
  "success": true,
  "code": 200,
  "message": "OK",
  "data": {
    "status": "healthy",
    "mode": "MULTI",
    "timestamp": "2026-04-08T12:00:00.000Z",
    "uptime": 3600,
    "runningBots": 5
  }
}`,
    curl: 'curl http://localhost:3000/health'
})}

${endpoint('GET', '/ready', 'Readiness probe', {
    desc: 'Returns 200 when ready to serve traffic. Returns 503 during startup or graceful shutdown.',
    response: `{
  "status": "ready",
  "ready": true,
  "runningBots": 5,
  "uptime": 3600
}`,
    curl: 'curl http://localhost:3000/ready'
})}
</div>

<!-- ========== BOT MANAGEMENT ========== -->
<div class="section" id="bots">
<h2>Bot Management</h2>
<p>MULTI mode only. Manage WhatsApp bot instances — create, configure, connect, and disconnect.</p>

${endpoint('POST', '/api/bots/create', 'Create a new bot', {
    desc: 'Registers a new WhatsApp bot instance. Choose <code>pairing_method</code>: <code>"qr"</code> returns a WebSocket URL for QR scanning, <code>"code"</code> returns an 8-digit pairing code. Optional webhook fields enable outbound event delivery — see <a href="#webhooks">Webhooks</a> for the envelope and signature spec.',
    body: `{
  "user_id": "user-001",            // required
  "phone_number": "6281234567890",  // required, international format
  "bot_name": "My Store",           // optional
  "pairing_method": "code",         // optional: "qr" | "code" (default: "qr")
  "webhook_url": "https://your.app/wa/webhook",   // optional
  "webhook_events": ["*"]           // optional, default ["*"]; see Webhooks for full list
}`,
    response: `{
  "success": true,
  "code": 201,
  "message": "Bot created. Complete pairing to activate connection.",
  "data": {
    "bot_id": "abc123",
    "user_id": "user-001",
    "phone_number": "6281234567890",
    "bot_name": "My Store",
    "pairing_method": "code",
    "is_active": true,
    "is_suspended": false,
    "webhook_url": "https://your.app/wa/webhook",
    "webhook_events": ["*"],
    "webhook_secret": "f3a1...redacted-32-byte-hex",  // returned ONCE — store now
    "created_at": "2026-05-10T12:00:00.000Z",
    "pairing_code": "12345678"
  }
}`,
    notes: '<code>webhook_secret</code> is auto-generated when <code>webhook_url</code> is provided and is returned only on this response (and on PATCH if the URL is rotated). Store it server-side; lose it and you must rotate the URL to get a new one.',
    curl: `curl -X POST http://localhost:3000/api/bots/create \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{
    "user_id": "user-001",
    "phone_number": "6281234567890",
    "pairing_method": "code",
    "webhook_url": "https://your.app/wa/webhook",
    "webhook_events": ["messages.upsert", "bot_connected", "bot_disconnected"]
  }'`
})}

${endpoint('GET', '/api/bots', 'List bots', {
    desc: 'Paginated list of all registered bots. Filter by owner, status.',
    body: null,
    query: `user_id     — Filter by owner
is_active   — "true" | "false"
is_suspended — "true" | "false"
page        — Page number (default: 1)
limit       — Items per page (default: 20)`,
    response: `{
  "success": true,
  "code": 200,
  "message": "Bots retrieved successfully",
  "data": {
    "bots": [
      {
        "bot_id": "abc123",
        "user_id": "user-001",
        "phone_number": "6281234567890",
        "bot_name": "My Store",
        "is_active": true,
        "is_suspended": false,
        "webhook_url": null,
        "created_at": "2026-04-08T12:00:00.000Z"
      }
    ],
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 1,
      "total_pages": 1
    }
  }
}`,
    curl: `curl "http://localhost:3000/api/bots?user_id=user-001&page=1&limit=10" \\
  -H "X-API-Key: YOUR_API_KEY"`
})}

${endpoint('GET', '/api/bots/:id', 'Get bot details', {
    desc: 'Retrieve a single bot by its ID, including runtime status if the bot is currently running.',
    response: `{
  "success": true,
  "code": 200,
  "message": "Bot retrieved successfully",
  "data": {
    "bot_id": "abc123",
    "user_id": "user-001",
    "phone_number": "6281234567890",
    "bot_name": "My Store",
    "pairing_method": "code",
    "is_active": true,
    "is_suspended": false,
    "webhook_url": "https://...",
    "last_connected_at": "2026-04-08T11:00:00.000Z",
    "created_at": "2026-04-08T10:00:00.000Z",
    "updated_at": "2026-04-08T11:00:00.000Z",
    "runtime": {
      "is_running": true,
      "started_at": "2026-04-08T11:00:00.000Z"
    }
  }
}`,
    curl: `curl http://localhost:3000/api/bots/abc123 \\
  -H "X-API-Key: YOUR_API_KEY"`
})}

${endpoint('PATCH', '/api/bots/:id', 'Update bot', {
    desc: 'Update bot name, webhook URL, or webhook event subscription. Changing <code>webhook_url</code> rotates the <code>webhook_secret</code>; the new secret is returned ONCE in the response. Subscription changes take effect immediately on running bots — no restart needed.',
    body: `{
  "bot_name": "Updated Name",                       // optional
  "webhook_url": "https://your.app/wa/webhook",     // optional; pass null to disable
  "webhook_events": ["messages.upsert", "call"]     // optional
}`,
    response: `{
  "success": true,
  "code": 200,
  "message": "Bot updated successfully",
  "data": {
    "bot_id": "abc123",
    "bot_name": "Updated Name",
    "webhook_url": "https://your.app/wa/webhook",
    "webhook_events": ["messages.upsert", "call"],
    "webhook_secret": "9c4e...redacted",  // ONLY present when URL was rotated
    "updated_at": "2026-05-10T12:30:00.000Z"
  }
}`,
    curl: `curl -X PATCH http://localhost:3000/api/bots/abc123 \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{"webhook_events":["messages.upsert","group-participants.update"]}'`
})}

${endpoint('DELETE', '/api/bots/:id', 'Delete bot', {
    desc: 'Permanently delete a bot and its session data.',
    response: `{
  "success": true,
  "code": 200,
  "message": "Bot deleted successfully",
  "data": null
}`,
    curl: `curl -X DELETE http://localhost:3000/api/bots/abc123 \\
  -H "X-API-Key: YOUR_API_KEY"`
})}

${endpoint('POST', '/api/bots/:id/deactivate', 'Deactivate (disconnect)', {
    desc: 'Gracefully disconnect the bot from WhatsApp without deleting the session. The bot can be reactivated later.',
    response: `{
  "success": true,
  "code": 200,
  "message": "Bot deactivated successfully",
  "data": null
}`,
    curl: `curl -X POST http://localhost:3000/api/bots/abc123/deactivate \\
  -H "X-API-Key: YOUR_API_KEY"`
})}

${endpoint('POST', '/api/bots/:id/reactivate', 'Reactivate (reconnect)', {
    desc: 'Reconnect a previously deactivated bot using its stored session.',
    response: `{
  "success": true,
  "code": 200,
  "message": "Bot reactivated successfully",
  "data": null
}`,
    curl: `curl -X POST http://localhost:3000/api/bots/abc123/reactivate \\
  -H "X-API-Key: YOUR_API_KEY"`
})}

${endpoint('POST', '/api/bots/:id/pairing-code', 'Get pairing code', {
    desc: 'Request a new 8-digit pairing code for an existing bot. Use this when the previous code has expired or when re-pairing.',
    response: `{
  "success": true,
  "code": 200,
  "message": "Pairing code generated",
  "data": {
    "bot_id": "abc123",
    "pairing_code": "12345678",
    "phone_number": "6281234567890"
  }
}`,
    curl: `curl -X POST http://localhost:3000/api/bots/abc123/pairing-code \\
  -H "X-API-Key: YOUR_API_KEY"`
})}

${endpoint('GET', '/api/bots/:id/webhook-logs', 'Webhook delivery audit log', {
    desc: 'Per-bot audit trail of every webhook delivery attempt. Each row records the envelope sent, status (pending/delivered/failed), HTTP response code, and last-attempt timestamp. Records auto-expire after 7 days.',
    query: `status — "pending" | "delivered" | "failed" (optional)
event  — exact event name to filter (optional)
page   — Page number (default: 1)
limit  — Items per page (default: 20, max 100)`,
    response: `{
  "success": true,
  "code": 200,
  "message": "Webhook delivery logs retrieved successfully",
  "data": {
    "logs": [
      {
        "id": "65f...",
        "envelope_id": "evt_1715290473000_a1b2c3d4e5f6",
        "event": "messages.upsert",
        "url": "https://your.app/wa/webhook",
        "status": "delivered",
        "attempts": 1,
        "response_code": 200,
        "response_body": null,
        "last_attempt_at": "2026-05-10T15:14:33.500Z",
        "created_at": "2026-05-10T15:14:33.123Z",
        "payload": { "id": "evt_...", "event": "messages.upsert", ... }
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 1, "total_pages": 1 }
  }
}`,
    curl: `curl "http://localhost:3000/api/bots/abc123/webhook-logs?status=failed&limit=10" \\
  -H "X-API-Key: YOUR_API_KEY"`
})}
</div>

<!-- ========== TRANSACTIONS ========== -->
<div class="section" id="transactions">
<h2>Transactions</h2>
<p>MULTI mode only. Called by the backend (koalabotbe) to trigger order delivery after payment confirmation.</p>

${endpoint('POST', '/api/transactions/process-payment', 'Process payment', {
    desc: 'Notifies the bot that a transaction has been paid. The bot will deliver the purchased items to the buyer via WhatsApp. Idempotent: re-calling for an already-processed transaction returns <code>already_processed</code>.',
    body: `{
  "transaction_id": "INV-20260408-001",  // required
  "paid_at": "2026-04-08T12:00:00.000Z", // optional
  "payment_id": "PAY-123",               // optional
  "amount": 50000                         // optional
}`,
    response: `{
  "success": true,
  "code": 200,
  "message": "Transaction processed",
  "data": {
    "transaction_id": "INV-20260408-001",
    "status": "delivered"
  }
}`,
    notes: 'Possible <code>status</code> values: <code>already_processed</code>, <code>paid_pending_delivery</code>, <code>delivered</code>, <code>paid_delivery_pending</code>.',
    curl: `curl -X POST http://localhost:3000/api/transactions/process-payment \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{"transaction_id":"INV-20260408-001"}'`
})}
</div>

<!-- ========== BROADCAST ========== -->
<div class="section" id="broadcast">
<h2>Broadcast</h2>
<p>Available in both SINGLE and MULTI mode. Send messages to all registered users. Rate-limited to 25 messages/second.</p>

${endpoint('POST', '/api/broadcast/send', 'Send broadcast', {
    desc: 'Queue a broadcast message to all active users. Returns a job ID for progress tracking. Non-blocking — returns immediately.',
    body: `{
  "bot_id": "abc123",       // required in MULTI mode
  "text": "Hello everyone!", // required (message text)
  "image_url": "https://..."  // optional (attach image)
}`,
    response: `{
  "success": true,
  "code": 200,
  "message": "Broadcast queued",
  "data": {
    "job_id": "bcast-abc123-1712577600000",
    "status": "processing",
    "total": 1500
  }
}`,
    curl: `curl -X POST http://localhost:3000/api/broadcast/send \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{"bot_id":"abc123","text":"Hello everyone!"}'`
})}

${endpoint('GET', '/api/broadcast/:jobId', 'Get broadcast status', {
    desc: 'Check the progress of a broadcast job.',
    response: `{
  "success": true,
  "code": 200,
  "data": {
    "job_id": "bcast-abc123-1712577600000",
    "status": "completed",
    "total": 1500,
    "sent": 1487,
    "failed": 13,
    "progress_pct": 100,
    "created_at": "2026-04-08T12:00:00.000Z",
    "completed_at": "2026-04-08T12:01:05.000Z"
  }
}`,
    curl: `curl http://localhost:3000/api/broadcast/bcast-abc123-1712577600000 \\
  -H "X-API-Key: YOUR_API_KEY"`
})}
</div>

<!-- ========== WEBSOCKET ========== -->
<div class="section" id="websocket">
<h2>WebSocket</h2>
<p>No authentication required. Used for real-time QR code streaming during bot pairing.</p>

${endpoint('WS', '/ws/qr/:botId', 'QR code stream', {
    desc: 'Upgrade to WebSocket for real-time QR code delivery. The server pushes QR updates as the WhatsApp handshake progresses. Connection times out after 3 minutes.',
    body: null,
    response: `// Server sends these message types:
{ "type": "qr", "data": "2@AbCdEf..." }      // QR code string
{ "type": "connected", "data": "6281234567890" } // Pairing complete
{ "type": "error", "data": "Session expired" }  // Error occurred
{ "type": "timeout", "data": "QR timeout" }     // 3-minute timeout

// Client can send:
{ "type": "ping" }  // Heartbeat to keep connection alive`,
    notes: 'Use a WebSocket client (not cURL). Example with <code>wscat</code>:',
    curl: `wscat -c ws://localhost:3000/ws/qr/abc123`
})}
</div>

<!-- ========== WEBHOOK NOTIFICATIONS ========== -->
<div class="section" id="webhooks">
<h2>Webhook Notifications (Outbound)</h2>
<p>Configure <code>webhook_url</code> + <code>webhook_events</code> on a bot (via POST /api/bots/create or PATCH /api/bots/:id) to receive every WhatsApp event your bot observes — connection lifecycle, incoming messages, presence, receipts, calls, group changes, and more — pushed to your endpoint as a signed JSON POST.</p>

<h3>Standard envelope</h3>
<p>Every delivery uses the same JSON shape:</p>
<pre>{
  "id": "evt_1715290473000_a1b2c3d4e5f6",
  "event": "messages.upsert",
  "bot_id": "abc123",
  "phone_number": "6281234567890",
  "timestamp": "2026-05-10T15:14:33.123Z",
  "data": { /* event-specific payload, see Event Catalog below */ }
}</pre>
<table>
<tr><th>Field</th><th>Type</th><th>Description</th></tr>
<tr><td><code>id</code></td><td>string</td><td>Unique envelope id. Use as idempotency key — retried deliveries reuse the same id.</td></tr>
<tr><td><code>event</code></td><td>string</td><td>Event name. See <a href="#webhook-events">Event Catalog</a>.</td></tr>
<tr><td><code>bot_id</code></td><td>string</td><td>The bot's MongoDB <code>_id</code>.</td></tr>
<tr><td><code>phone_number</code></td><td>string</td><td>Bot's WhatsApp number (international, no +).</td></tr>
<tr><td><code>timestamp</code></td><td>string</td><td>ISO-8601 server time when the event was queued.</td></tr>
<tr><td><code>data</code></td><td>object</td><td>Event-specific payload. Buffers are base64-encoded; Long ints become strings.</td></tr>
</table>

<h3 id="webhook-signature">Signature verification</h3>
<p>Every request carries an <code>X-Webhook-Signature</code> header of the form <code>sha256=&lt;hex&gt;</code>, computed as HMAC-SHA256 over the raw request body using the bot's <code>webhook_secret</code> (returned ONCE on create or URL rotation). Always compare using a constant-time function.</p>
<span class="label">Node.js</span>
<pre>const crypto = require('crypto');
function verify(rawBody, headerSig, secret) {
    const expected = 'sha256=' + crypto.createHmac('sha256', secret)
        .update(rawBody).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(headerSig), Buffer.from(expected));
}</pre>
<span class="label">Python</span>
<pre>import hmac, hashlib
def verify(raw_body: bytes, header_sig: str, secret: str) -&gt; bool:
    expected = 'sha256=' + hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(header_sig, expected)</pre>
<span class="label">PHP</span>
<pre>function verify(string $rawBody, string $headerSig, string $secret): bool {
    $expected = 'sha256=' . hash_hmac('sha256', $rawBody, $secret);
    return hash_equals($expected, $headerSig);
}</pre>
<div class="info">In Express, use <code>app.use(express.raw({ type: 'application/json' }))</code> for the webhook route so you can verify the exact bytes the server signed.</div>

<h3>Subscription rules</h3>
<ul>
<li><code>webhook_events: ["*"]</code> (default) — subscribe to every event.</li>
<li><code>webhook_events: ["messages.upsert", "call"]</code> — exact-match list. No wildcards or prefixes.</li>
<li>Unknown event names are rejected by request validation (<code>400 Bad Request</code>).</li>
<li>PATCHing <code>webhook_events</code> takes effect on running bots immediately — no restart.</li>
</ul>

<h3>Delivery semantics &amp; retry</h3>
<ul>
<li><b>Queue</b>: per-bot in-memory queue, concurrency 4. Different bots deliver in parallel.</li>
<li><b>Retry</b>: 3 attempts on connection error or non-2xx response. Delays: <code>0ms</code>, <code>2s</code>, <code>10s</code>. Worst case ~12s before <code>failed</code>.</li>
<li><b>Timeout</b>: 5 seconds per attempt.</li>
<li><b>Idempotency</b>: retried deliveries reuse the same <code>id</code>. Your handler MUST be idempotent.</li>
<li><b>Audit</b>: every delivery is recorded in <code>webhook_delivery_logs</code> (TTL 7 days). Query via <code>GET /api/bots/:id/webhook-logs</code>.</li>
</ul>

<h3 id="webhook-events">Event catalog</h3>
<p>The system forwards two classes of events:</p>
<ol>
<li><b>High-level lifecycle events</b> — server-curated, easier shape for common needs.</li>
<li><b>Raw Baileys events</b> — pass-through of the underlying WhatsApp protocol events. Use these for advanced features (presence, receipts, group changes, calls).</li>
</ol>
<table>
<tr><th>Category</th><th>Event name</th><th><code>data</code> shape (selected fields)</th></tr>
<tr><td>lifecycle</td><td><code>bot_connected</code></td><td><code>{ started_at, user_jid, user_name }</code></td></tr>
<tr><td>lifecycle</td><td><code>bot_disconnected</code></td><td><code>{ reason, status_code? }</code></td></tr>
<tr><td>lifecycle</td><td><code>bot_logged_out</code></td><td><code>{ status_code }</code> — session invalid, must re-pair</td></tr>
<tr><td>lifecycle</td><td><code>qr_generated</code></td><td><code>{ qr, qr_image_base64 }</code> — <code>qr</code> is the raw string; <code>qr_image_base64</code> is a <code>data:image/png;base64,...</code> URL ready to drop into an <code>&lt;img src&gt;</code></td></tr>
<tr><td>lifecycle</td><td><code>pairing_code_generated</code></td><td><code>{ code, code_formatted, phone_number }</code> — <code>code</code> is 8 chars, <code>code_formatted</code> is <code>XXXX-XXXX</code> matching the WhatsApp UI</td></tr>
<tr><td>lifecycle</td><td><code>pairing_code_error</code></td><td><code>{ message }</code> — fired when pairing-code request fails</td></tr>
<tr><td>message</td><td><code>message_received</code></td><td><code>{ message_id, from, push_name, message_timestamp, message_type, message_body, raw_message }</code> — DM only, deduplicated/filtered</td></tr>
<tr><td>message</td><td><code>messages.upsert</code></td><td><code>{ messages: [WAMessage], type: "notify"|"append" }</code> — full Baileys upsert</td></tr>
<tr><td>message</td><td><code>messages.update</code></td><td><code>WAMessageUpdate[]</code> — edits / status changes</td></tr>
<tr><td>message</td><td><code>messages.delete</code></td><td><code>{ keys } | { jid, all }</code></td></tr>
<tr><td>message</td><td><code>messages.reaction</code></td><td><code>{ key, reaction }[]</code></td></tr>
<tr><td>message</td><td><code>messages.media-update</code></td><td><code>{ key, media, error? }[]</code></td></tr>
<tr><td>message</td><td><code>message-receipt.update</code></td><td><code>MessageUserReceiptUpdate[]</code> — read/delivered receipts</td></tr>
<tr><td>presence</td><td><code>presence.update</code></td><td><code>{ id, presences: { [jid]: { lastKnownPresence, lastSeen } } }</code></td></tr>
<tr><td>contact</td><td><code>contacts.upsert</code></td><td><code>Contact[]</code></td></tr>
<tr><td>contact</td><td><code>contacts.update</code></td><td><code>Partial&lt;Contact&gt;[]</code></td></tr>
<tr><td>chat</td><td><code>chats.upsert</code></td><td><code>Chat[]</code></td></tr>
<tr><td>chat</td><td><code>chats.update</code></td><td><code>ChatUpdate[]</code></td></tr>
<tr><td>chat</td><td><code>chats.delete</code></td><td><code>string[]</code> — jids</td></tr>
<tr><td>chat</td><td><code>chats.lock</code></td><td><code>{ jid, isLocked }</code></td></tr>
<tr><td>chat</td><td><code>messaging-history.set</code></td><td>Initial history sync payload (large; subscribe sparingly)</td></tr>
<tr><td>group</td><td><code>groups.upsert</code></td><td><code>GroupMetadata[]</code></td></tr>
<tr><td>group</td><td><code>groups.update</code></td><td><code>Partial&lt;GroupMetadata&gt;[]</code></td></tr>
<tr><td>group</td><td><code>group-participants.update</code></td><td><code>{ id, author, participants, action: "add"|"remove"|"promote"|"demote" }</code></td></tr>
<tr><td>group</td><td><code>group.join-request</code></td><td><code>{ id, author, participant, action, method }</code></td></tr>
<tr><td>call</td><td><code>call</code></td><td><code>WACallEvent[]</code> — incoming/outgoing calls</td></tr>
<tr><td>system</td><td><code>connection.update</code></td><td><code>Partial&lt;ConnectionState&gt;</code> — raw state changes</td></tr>
<tr><td>system</td><td><code>creds.update</code></td><td><b>Not forwarded.</b> Contains noise + identity keys + thousands of preKeys (~650KB, ~50ms to serialize). Forwarding it on every save blocks the event loop and triggers WS keepalive 408/428. Use <code>bot_connected</code>/<code>bot_logged_out</code> for session lifecycle.</td></tr>
<tr><td>system</td><td><code>messaging-history.set</code></td><td><b>Not forwarded.</b> Initial history sync — can be megabytes. Subscribe to <code>messages.upsert</code> for ongoing messages instead.</td></tr>
<tr><td>system</td><td><code>blocklist.set</code> / <code>blocklist.update</code></td><td><code>{ blocklist }</code> / <code>{ blocklist, type }</code></td></tr>
<tr><td>system</td><td><code>labels.edit</code> / <code>labels.association</code></td><td><code>Label</code> / <code>{ association, type }</code></td></tr>
<tr><td>system</td><td><code>settings.update</code></td><td><code>{ name, value }</code></td></tr>
</table>
<div class="info">Field shapes for raw Baileys events follow <code>baileys/lib/Types/Events.d.ts</code>. <code>Buffer</code> values are serialized as base64 strings; <code>Long</code> ints become decimal strings. Subscribing to <code>"*"</code> can produce hundreds of events per minute on busy bots — filter aggressively.</div>

<h3 id="webhook-receiver-example">Example receiver (Express)</h3>
<pre>const express = require('express');
const crypto = require('crypto');

const app = express();
const SECRET = process.env.WA_WEBHOOK_SECRET;  // from POST /api/bots/create response

app.post('/wa/webhook',
    express.raw({ type: 'application/json', limit: '5mb' }),
    (req, res) =&gt; {
        const sig = req.header('X-Webhook-Signature') || '';
        const expected = 'sha256=' + crypto.createHmac('sha256', SECRET)
            .update(req.body).digest('hex');

        if (sig.length !== expected.length ||
            !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
            return res.status(401).send('bad signature');
        }

        const envelope = JSON.parse(req.body.toString('utf8'));
        // Idempotency: dedupe on envelope.id
        // Dispatch by envelope.event ...
        console.log(envelope.event, envelope.bot_id);

        res.sendStatus(200);  // ACK fast — heavy work goes on a background queue
    }
);

app.listen(4000);</pre>
</div>

</div><!-- /.container -->

<script>
document.querySelectorAll('.endpoint-header').forEach(h => {
    h.addEventListener('click', () => h.parentElement.classList.toggle('open'));
});
</script>
</body>
</html>`;
}

/**
 * Helper to generate an endpoint card HTML block.
 */
function endpoint(method, path, shortDesc, opts = {}) {
    const m = method.toLowerCase();
    const bodyBlock = opts.body ? `<span class="label">Request Body</span>\n<pre>${esc(opts.body)}</pre>` : '';
    const queryBlock = opts.query ? `<span class="label">Query Parameters</span>\n<pre>${esc(opts.query)}</pre>` : '';
    const notesBlock = opts.notes ? `<div class="note">${opts.notes}</div>` : '';
    const responseBlock = opts.response ? `<span class="label">Response</span>\n<pre>${esc(opts.response)}</pre>` : '';
    const curlBlock = opts.curl ? `<span class="label">cURL Example</span>\n<pre>${esc(opts.curl)}</pre>` : '';
    const descBlock = opts.desc ? `<p style="color:var(--text-muted);font-size:.9rem;margin-bottom:8px">${opts.desc}</p>` : '';

    return `<div class="endpoint">
<div class="endpoint-header">
<span class="method ${m}">${method}</span>
<span class="path">${esc(path)}</span>
<span class="desc-short">${esc(shortDesc)}</span>
<span class="chevron">&#9654;</span>
</div>
<div class="endpoint-body">
${descBlock}
${queryBlock}
${bodyBlock}
${responseBlock}
${notesBlock}
${curlBlock}
</div>
</div>`;
}

function esc(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

module.exports = fp(docsRoutes);
