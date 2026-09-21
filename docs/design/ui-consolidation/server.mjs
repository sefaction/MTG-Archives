import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const assets = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/prototype.css", ["prototype.css", "text/css; charset=utf-8"]],
  ["/prototype.js", ["prototype.js", "text/javascript; charset=utf-8"]],
]);
createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const asset = assets.get(pathname);
  if (request.method !== "GET" || !asset) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const content = await readFile(new URL(asset[0], import.meta.url));
    response
      .writeHead(200, {
        "Content-Type": asset[1],
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'none'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
        "X-Content-Type-Options": "nosniff",
      })
      .end(content);
  } catch {
    response.writeHead(500).end("Preview asset unavailable");
  }
}).listen(8080, "0.0.0.0");
