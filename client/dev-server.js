import http from "http";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = Number(process.env.PORT || 5500);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

function resolveFilePath(urlPath) {
  const cleanPath = urlPath === "/" ? "/index.html" : urlPath;
  const safePath = path.normalize(cleanPath).replace(/^(\.\.[/\\])+/, "");
  return path.join(__dirname, safePath);
}

const server = http.createServer(async (req, res) => {
  try {
    const filePath = resolveFilePath(req.url || "/");
    const ext = path.extname(filePath).toLowerCase();
    const body = await fs.readFile(filePath);
    res.writeHead(200, { "Content-Type": MIME_TYPES[ext] || "text/plain; charset=utf-8" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Client server running at http://localhost:${PORT}`);
});
