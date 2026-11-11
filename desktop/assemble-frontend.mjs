import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(desktopDir, "..");
const standalone = path.join(root, "frontend", ".next", "standalone");
const out = path.join(desktopDir, "build", "frontend");

function findServerDir(dir) {
  if (fs.existsSync(path.join(dir, "server.js"))) return dir;
  if (!fs.existsSync(dir)) return null;
  for (const name of fs.readdirSync(dir)) {
    const child = path.join(dir, name);
    if (fs.existsSync(path.join(child, "server.js"))) return child;
  }
  return null;
}

if (!fs.existsSync(standalone)) {
  console.error("Missing frontend/.next/standalone. Run npm run build in frontend/ first.");
  process.exit(1);
}

fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(standalone, out, { recursive: true });

const serverDir = findServerDir(out);
if (!serverDir) {
  console.error("standalone server.js was not found.");
  process.exit(1);
}

const staticSrc = path.join(root, "frontend", ".next", "static");
const staticDest = path.join(serverDir, ".next", "static");
fs.mkdirSync(path.dirname(staticDest), { recursive: true });
fs.cpSync(staticSrc, staticDest, { recursive: true });

const publicSrc = path.join(root, "frontend", "public");
if (fs.existsSync(publicSrc)) {
  fs.cpSync(publicSrc, path.join(serverDir, "public"), { recursive: true });
}

console.log("Frontend assembled at", out);
console.log("Server directory:", path.relative(out, serverDir) || ".");
