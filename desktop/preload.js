const { contextBridge } = require("electron");

function readApiBase() {
  const prefix = "--pdf-editor-api=";
  const arg = process.argv.find((item) => item.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : "http://127.0.0.1:8000";
}

contextBridge.exposeInMainWorld("pdfEditor", {
  apiBase: readApiBase(),
});
