const { app, BrowserWindow, dialog } = require("electron");
const { spawn } = require("child_process");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");

app.setName("PDF Editor");

const children = [];
let quitting = false;
let mainWindow = null;

function logDir() {
  const dir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function freePort(preferred) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();
    server.once("error", () => {
      const fallback = net.createServer();
      fallback.listen(0, "127.0.0.1", () => {
        const { port } = fallback.address();
        fallback.close(() => resolve(port));
      });
    });
    server.listen(preferred, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function waitForHttp(url, timeoutMs, child) {
  const started = Date.now();
  return new Promise((resolve, reject) => {
    let settled = false;
    const succeed = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    if (child) {
      if (child.exitCode != null) {
        fail(new Error(`Process already exited (code ${child.exitCode}) before ${url} was ready.`));
        return;
      }
      child.once("exit", (code) => {
        fail(new Error(`Process exited before ${url} was ready (code ${code}).`));
      });
    }
    const attempt = () => {
      if (settled) return;
      if (Date.now() - started > timeoutMs) {
        fail(new Error(`Timed out waiting for ${url}`));
        return;
      }
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode < 500) {
          succeed();
          return;
        }
        setTimeout(attempt, 400);
      });
      req.on("error", () => setTimeout(attempt, 400));
      req.setTimeout(2000, () => {
        req.destroy();
      });
    };
    attempt();
  });
}

function pipeLogs(child, filePath) {
  const stream = fs.createWriteStream(filePath, { flags: "a" });
  child.stdout?.pipe(stream);
  child.stderr?.pipe(stream);
  child.once("exit", () => stream.end());
}

function stopChild(child) {
  if (!child || child.pid == null || child.exitCode != null) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json",
  ".wasm": "application/wasm",
  ".pdf": "application/pdf",
};

let staticServer = null;

function resolveStatic(root, requestPath) {
  const rootResolved = path.resolve(root);
  let decoded = "/";
  try {
    decoded = decodeURIComponent(requestPath.split("?")[0]);
  } catch {
    return null;
  }
  const rel = path.normalize(decoded).replace(/^([/\\])+/, "");
  const full = path.resolve(rootResolved, rel);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) return null;
  const candidates = [full];
  if (!path.extname(full)) {
    candidates.push(path.join(full, "index.html"));
    candidates.push(`${full}.html`);
  }
  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

function startStaticServer(root, port) {
  const server = http.createServer((req, res) => {
    const filePath = resolveStatic(root, req.url || "/");
    if (!filePath) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    const type = MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    fs.createReadStream(filePath).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      staticServer = server;
      resolve(server);
    });
  });
}

function startBackend(apiPort, dataDir) {
  const logs = path.join(logDir(), "backend-console.log");
  const env = {
    ...process.env,
    PDF_EDITOR_HOST: "127.0.0.1",
    PDF_EDITOR_PORT: String(apiPort),
    PDF_EDITOR_DATA_DIR: dataDir,
    PDF_EDITOR_DESKTOP: "1",
    PYTHONNOUSERSITE: "1",
    PYTHONUTF8: "1",
  };

  let command;
  let args;
  let cwd;

  if (app.isPackaged) {
    const backendDir = path.join(process.resourcesPath, "backend");
    command = path.join(backendDir, "python.exe");
    args = ["desktop_entry.py"];
    cwd = backendDir;
    if (!fs.existsSync(command)) {
      throw new Error(`Backend program is missing:\n${command}`);
    }
  } else {
    const root = path.resolve(__dirname, "..");
    const python =
      process.platform === "win32"
        ? path.join(root, ".venv", "Scripts", "python.exe")
        : path.join(root, ".venv", "bin", "python");
    if (!fs.existsSync(python)) {
      throw new Error(
        "Python environment was not found.\n\nOn Windows, double-click start-windows.bat once so it can install dependencies.",
      );
    }
    command = python;
    args = ["desktop_entry.py"];
    cwd = path.join(root, "backend");
  }

  const child = spawn(command, args, {
    cwd,
    env,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.on("error", (error) => {
    fs.appendFileSync(logs, `${error.stack || error.message}\n`);
  });
  pipeLogs(child, logs);
  children.push(child);
  return child;
}

function startFrontend(uiPort) {
  const logs = path.join(logDir(), "frontend-console.log");
  const env = {
    ...process.env,
    PORT: String(uiPort),
    HOSTNAME: "127.0.0.1",
    BROWSER: "none",
  };

  let command;
  let args;
  let cwd;

  {
    const frontendDir = path.resolve(__dirname, "..", "frontend");
    const nextBin = path.join(frontendDir, "node_modules", "next", "dist", "bin", "next");
    command = "node";
    args = [nextBin, "dev", "--port", String(uiPort), "--hostname", "127.0.0.1"];
    cwd = frontendDir;
    if (!fs.existsSync(nextBin)) {
      throw new Error("Frontend dependencies are missing. Run npm install inside frontend/.");
    }
  }

  const child = spawn(command, args, {
    cwd,
    env,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.on("error", (error) => {
    fs.appendFileSync(logs, `${error.stack || error.message}\n`);
  });
  pipeLogs(child, logs);
  children.push(child);
  return child;
}

function createWindow(uiPort, apiPort) {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: "#f8fafc",
    title: "PDF Editor",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--pdf-editor-api=http://127.0.0.1:${apiPort}`],
    },
  });
  mainWindow = win;
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    mainWindow = null;
  });
  return win;
}

async function boot() {
  const dataDir = app.getPath("userData");
  fs.mkdirSync(dataDir, { recursive: true });
  const apiPort = await freePort(8000);
  const uiPort = await freePort(apiPort === 3000 ? 3001 : 3000);
  console.log(`PDF Editor API http://127.0.0.1:${apiPort}`);
  console.log(`PDF Editor UI  http://127.0.0.1:${uiPort}`);
  const backend = startBackend(apiPort, dataDir);
  let frontend = null;
  if (app.isPackaged) {
    const uiRoot = path.join(process.resourcesPath, "frontend");
    if (!fs.existsSync(path.join(uiRoot, "index.html"))) {
      throw new Error("The editor screen is missing from the app folder.");
    }
    await startStaticServer(uiRoot, uiPort);
  } else {
    frontend = startFrontend(uiPort);
  }
  const win = createWindow(uiPort, apiPort);
  await win.loadURL(
    "data:text/html;charset=utf-8," +
      encodeURIComponent(
        "<body style=\"margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:sans-serif;background:#f8fafc;color:#18181b\">Starting PDF Editor…</body>",
      ),
  );

  const timeout = app.isPackaged ? 60000 : 120000;
  await waitForHttp(`http://127.0.0.1:${apiPort}/health`, timeout, backend);
  await waitForHttp(`http://127.0.0.1:${uiPort}`, timeout, frontend);
  await win.loadURL(`http://127.0.0.1:${uiPort}`);
}

app.whenReady().then(() => {
  boot().catch((error) => {
    const logs = logDir();
    console.error(error);
    dialog.showErrorBox(
      "PDF Editor",
      `${error.message}\n\nLogs:\n${logs}`,
    );
    app.quit();
  });
});

app.on("before-quit", () => {
  quitting = true;
  for (const child of children) stopChild(child);
  if (staticServer) staticServer.close();
});

app.on("window-all-closed", () => {
  app.quit();
});
