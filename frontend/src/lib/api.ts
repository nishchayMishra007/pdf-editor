import type {
  DocumentMeta,
  EditOp,
  OpsPutResult,
  PageLayout,
} from "./types";

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "ApiError";
  }
}

type ParsedError = { message: string; code?: string };

async function parseError(res: Response): Promise<ParsedError> {
  try {
    const data = await res.json();
    const detail = data?.detail;
    if (typeof detail === "string") return { message: detail };
    if (detail && typeof detail === "object" && !Array.isArray(detail)) {
      const message =
        typeof detail.message === "string"
          ? detail.message
          : JSON.stringify(detail);
      const code = typeof detail.code === "string" ? detail.code : undefined;
      return { message, code };
    }
    if (Array.isArray(detail)) {
      return {
        message: detail
          .map((d: { msg?: string }) => d.msg || String(d))
          .join("; "),
      };
    }
    return { message: JSON.stringify(data) };
  } catch {
    return { message: res.statusText || `Request failed (${res.status})` };
  }
}

async function request<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(
      "Cannot reach the editor server. Start the backend on port 8000.",
      0,
    );
  }
  if (!res.ok) {
    const err = await parseError(res);
    throw new ApiError(err.message, res.status, err.code);
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) return res.json() as Promise<T>;
  return res as unknown as T;
}

export function apiBase() {
  return API_BASE;
}

export async function listDocuments(): Promise<DocumentMeta[]> {
  return request("/documents");
}

export async function uploadDocument(
  file: File,
  password?: string,
): Promise<DocumentMeta> {
  const body = new FormData();
  body.append("file", file);
  if (password != null && password !== "") {
    body.append("password", password);
  }
  return request("/documents", { method: "POST", body });
}

export async function createDraft(): Promise<DocumentMeta> {
  return request("/documents/drafts", { method: "POST" });
}

export async function attachPdf(
  id: string,
  file: File,
  password?: string,
): Promise<DocumentMeta> {
  const body = new FormData();
  body.append("file", file);
  if (password != null && password !== "") {
    body.append("password", password);
  }
  return request(`/documents/${id}/file`, { method: "POST", body });
}

export async function getOps(id: string): Promise<EditOp[]> {
  const data = await request<{ ops: EditOp[] }>(`/documents/${id}/ops`);
  return data.ops || [];
}

export async function getDocument(id: string): Promise<DocumentMeta> {
  return request(`/documents/${id}`);
}

export async function renameDocument(
  id: string,
  name: string,
): Promise<DocumentMeta> {
  return request(`/documents/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

export async function deleteDocument(id: string): Promise<void> {
  await request<void>(`/documents/${id}`, { method: "DELETE" });
}

export async function getLayout(
  id: string,
  page1Based: number,
): Promise<PageLayout> {
  return request(`/documents/${id}/pages/${page1Based}/layout`);
}

export async function putOps(
  id: string,
  ops: EditOp[],
): Promise<OpsPutResult> {
  return request(`/documents/${id}/ops`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ops }),
  });
}

export function workingPdfUrl(id: string, bust = 0): string {
  return `${API_BASE}/documents/${id}/working?t=${bust}`;
}

export function originalPdfUrl(id: string): string {
  return `${API_BASE}/documents/${id}/original`;
}

export function fontUrl(id: string, name: string, page = 0): string {
  return `${API_BASE}/documents/${id}/fonts/${encodeURIComponent(name)}?page=${page}`;
}

export async function exportDocument(
  id: string,
): Promise<{ blob: Blob; filename: string }> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}/documents/${id}/export`, { method: "POST" });
  } catch {
    throw new ApiError(
      "Cannot reach the editor server. Start the backend on port 8000.",
      0,
    );
  }
  if (!res.ok) {
    const err = await parseError(res);
    throw new ApiError(err.message, res.status, err.code);
  }
  const blob = await res.blob();
  const header = res.headers.get("X-Export-Filename");
  const cd = res.headers.get("Content-Disposition") || "";
  const match = /filename="?([^"]+)"?/i.exec(cd);
  const filename = header || match?.[1] || "document_edited.pdf";
  return { blob, filename };
}
