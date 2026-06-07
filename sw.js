// Service worker — routes Datasette/ASGI requests to the Pyodide Web Worker.
// Static files (the shell page + JS assets) pass through to the network.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", e => e.waitUntil(self.clients.claim()));

// Files served directly by the static host — never intercepted by the bridge.
// SW_BASE is the directory this sw.js lives in (e.g. "/" or "/repo-name/").
const SW_BASE = self.location.pathname.replace(/sw\.js$/, "");

function isStatic(url) {
  const p = new URL(url).pathname;
  // The shell page itself
  if (p === SW_BASE || p === SW_BASE + "index.html") return true;
  // All JS/runtime assets next to index.html
  if (p.startsWith(SW_BASE) && !p.replace(SW_BASE, "").startsWith("-/")) {
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
  // Shell is the page at SW_BASE (the index.html). Datasette pages are at /-/…
  return (
    windows.find(w => new URL(w.url).pathname === SW_BASE) ||
    windows.find(w => new URL(w.url).pathname === SW_BASE + "index.html") ||
    windows[0] ||
    null
  );
}

async function handleRequest(request) {
  const shell = await findShellClient();
  if (!shell)
    return new Response("ASGI bridge unavailable — reload the page.", { status: 503 });

  const hasBody = !["GET", "HEAD"].includes(request.method);
  const body = hasBody ? await request.arrayBuffer() : null;
  const headers = [...request.headers.entries()];

  const channel = new MessageChannel();
  const reply = new Promise(resolve => { channel.port1.onmessage = e => resolve(e.data); });

  shell.postMessage(
    { type: "asgi-request", request: { method: request.method, url: request.url, headers, body } },
    [channel.port2]
  );

  // 5-minute timeout covers long LLM streaming responses
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("bridge timeout")), 300_000)
  );

  let msg;
  try { msg = await Promise.race([reply, timeout]); }
  catch (e) { return new Response("Bridge timeout: " + e.message, { status: 504 }); }

  const responseHeaders = new Headers();
  for (const [k, v] of msg.headers) {
    if (k.toLowerCase() === "x-frame-options") continue;
    if (k.toLowerCase() === "content-security-policy") {
      const filtered = v.split(";").map(d => d.trim())
        .filter(d => d && !/^frame-ancestors\b/i.test(d));
      if (filtered.length) responseHeaders.append(k, filtered.join("; "));
      continue;
    }
    responseHeaders.append(k, v);
  }

  const noBody = [204, 205, 304].includes(msg.status);
  return new Response(noBody ? null : msg.body, { status: msg.status, headers: responseHeaders });
}
