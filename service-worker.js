// Service worker — routes Datasette/ASGI requests to the Pyodide Web Worker.
// v4

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

// SW_BASE = path prefix for this deployment, e.g. "/datasette-gh-pages/"
const SW_BASE = self.location.pathname.replace(/[^/]+$/, "");

function isStatic(url) {
  const p = new URL(url).pathname;
  if (p === SW_BASE || p === SW_BASE + "index.html") return true;
  if (p.startsWith(SW_BASE)) {
    const rest = p.slice(SW_BASE.length);
    if (!rest.includes("/") || rest.startsWith("vendor/")) return true;
  }
  return false;
}

self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  if (isStatic(event.request.url)) return;
  event.respondWith(handleRequest(event.request));
});

async function findShellClient() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  return (
    windows.find(w => new URL(w.url).pathname === SW_BASE) ||
    windows.find(w => new URL(w.url).pathname === SW_BASE + "index.html") ||
    windows[0] || null
  );
}

async function handleRequest(request) {
  const shell = await findShellClient();
  if (!shell)
    return new Response("ASGI bridge unavailable — reload the page.", { status: 503 });

  const hasBody = !["GET", "HEAD"].includes(request.method);
  const body = hasBody ? await request.arrayBuffer() : null;
  const headers = [...request.headers.entries()];

  // Strip SW_BASE so Datasette (configured with base_url="/") sees clean paths.
  // e.g. /datasette-gh-pages/-/agent/123 → /-/agent/123
  const stripped = new URL(request.url);
  stripped.pathname = "/" + stripped.pathname.slice(SW_BASE.length);

  const channel = new MessageChannel();
  const reply = new Promise(resolve => { channel.port1.onmessage = e => resolve(e.data); });
  shell.postMessage(
    { type: "asgi-request", request: { method: request.method, url: stripped.href, headers, body } },
    [channel.port2]
  );

  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("bridge timeout")), 300_000)
  );
  let msg;
  try { msg = await Promise.race([reply, timeout]); }
  catch (e) { return new Response("Bridge timeout: " + e.message, { status: 504 }); }

  const responseHeaders = new Headers();
  let isText = false;
  for (const [k, v] of msg.headers) {
    if (k.toLowerCase() === "x-frame-options") continue;
    if (k.toLowerCase() === "content-security-policy") {
      const filtered = v.split(";").map(d => d.trim())
        .filter(d => d && !/^frame-ancestors\b/i.test(d));
      if (filtered.length) responseHeaders.append(k, filtered.join("; "));
      continue;
    }
    if (k.toLowerCase() === "content-type") {
      // Rewrite HTML, JS, and CSS — all Datasette text responses can contain /-/ paths
      if (v.includes("text/html") || v.includes("javascript") || v.includes("text/css")) {
        isText = true;
      }
    }
    responseHeaders.append(k, v);
  }

  const noBody = [204, 205, 304].includes(msg.status);
  if (noBody) return new Response(null, { status: msg.status, headers: responseHeaders });

  // Rewrite root-relative /-/ paths in text responses so Datasette's assets,
  // API calls, and navigation all resolve under SW_BASE (the SW's scope).
  // Datasette's entire surface lives under /-/ so this rewrite is safe and complete.
  if (isText && SW_BASE !== "/" && msg.body) {
    const text = new TextDecoder().decode(msg.body);
    const patched = text.replaceAll('"/-/', `"${SW_BASE}-/`).replaceAll("'/-/", `'${SW_BASE}-/`);
    const encoded = new TextEncoder().encode(patched);
    responseHeaders.set("content-length", String(encoded.length));
    return new Response(encoded, { status: msg.status, headers: responseHeaders });
  }

  return new Response(msg.body, { status: msg.status, headers: responseHeaders });
}
