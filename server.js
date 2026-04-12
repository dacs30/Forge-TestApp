// @ts-check
const { createServer } = require("http");
const { parse } = require("url");
const next = require("next");
const { WebSocket, WebSocketServer } = require("ws");

const dev = process.env.NODE_ENV !== "production";
const port = parseInt(process.env.PORT || "3000", 10);

// Do NOT pass httpServer — Next.js discovers the server lazily from the first
// request's socket and registers its own HMR upgrade handler at that point.
const app = next({ dev });
const handle = app.getRequestHandler();

// Route: /api/ws/terminal/:envId
const WS_TERMINAL_RE = /^\/api\/ws\/terminal\/([^/]+)$/;

app.prepare().then(() => {
  // Read env vars AFTER app.prepare() so Next.js has loaded .env files
  const HAAS_URL = process.env.HAAS_URL || "http://localhost:8080";
  const HAAS_API_KEY = process.env.HAAS_API_KEY;

  console.log(
    `[ws-proxy] HaaS URL: ${HAAS_URL} | auth: ${HAAS_API_KEY ? "yes" : "NO KEY SET"}`
  );

  // Create the server inside prepare().then() — the standard Next.js custom
  // server pattern. Next.js will attach its HMR upgrade listener lazily on the
  // first HTTP request via req.socket.server.
  const server = createServer((req, res) => {
    handle(req, res, parse(req.url || "/", true));
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname, query } = parse(req.url || "/", true);
    const match = (pathname || "").match(WS_TERMINAL_RE);

    // Return (don't destroy) so Next.js can handle HMR and other upgrades
    if (!match) return;

    const envId = match[1];
    const haasWsBase =
      HAAS_URL.replace(/^http/, "ws") +
      `/v1/environments/${encodeURIComponent(envId)}/exec/ws`;

    const params = new URLSearchParams();
    const cmds = Array.isArray(query.cmd)
      ? query.cmd
      : query.cmd
      ? [query.cmd]
      : [];
    cmds.forEach((c) => params.append("cmd", c));
    if (query.working_dir) params.set("working_dir", String(query.working_dir));

    const targetUrl = params.toString()
      ? `${haasWsBase}?${params}`
      : haasWsBase;

    const upstreamHeaders = {};
    if (HAAS_API_KEY) upstreamHeaders["Authorization"] = `Bearer ${HAAS_API_KEY}`;

    // Accept the browser WebSocket IMMEDIATELY to claim the socket before
    // Next.js's upgrade handler can call socket.end() on it.
    // Buffer client messages until the upstream connection is ready.
    const wss = new WebSocketServer({ noServer: true });
    wss.handleUpgrade(req, socket, head, (client) => {
      /** @type {{ data: Buffer, isBinary: boolean }[]} */
      const queue = [];
      client.on("message", (data, isBinary) => queue.push({ data: /** @type {Buffer} */ (data), isBinary }));

      console.log(`[ws-proxy] connecting → ${targetUrl} (auth: ${HAAS_API_KEY ? "yes" : "no"})`);
      const upstream = new WebSocket(targetUrl, { headers: upstreamHeaders });

      upstream.once("open", () => {
        console.log(`[ws-proxy] upstream open for ${envId}`);

        // Flush buffered messages (preserve text vs binary frame type)
        queue.forEach(({ data, isBinary }) => upstream.send(data, { binary: isBinary }));
        client.removeAllListeners("message");

        // Bidirectional proxy — preserve frame types so JSON stays as text frames
        client.on("message", (data, isBinary) => {
          if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
        });
        upstream.on("message", (data, isBinary) => {
          if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
        });
        client.on("close", () => upstream.terminate());
        upstream.on("close", (code, reason) => {
          if (client.readyState === WebSocket.OPEN) client.close(code, reason);
        });
        client.on("error", (err) => {
          console.error("[ws-proxy] client error:", err.message);
          upstream.terminate();
        });
        upstream.on("error", (err) => {
          console.error("[ws-proxy] upstream error:", err.message);
          client.terminate();
        });
      });

      upstream.on("error", (err) => {
        console.error("[ws-proxy] upstream connect failed:", err.message);
        // Send error through the already-open WebSocket so the terminal can display it
        if (client.readyState === WebSocket.OPEN) {
          client.send(JSON.stringify({ stream: "error", data: err.message }));
          client.close(1011, err.message.slice(0, 123));
        }
      });
    });
  });

  server.listen(port, () => {
    console.log(
      `> Ready on http://localhost:${port} (${dev ? "development" : "production"})`
    );
  });
});
