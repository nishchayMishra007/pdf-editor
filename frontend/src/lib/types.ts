export type BBox = { x0: number; y0: number; x1: number; y1: number };

export type TextSpan = {
  id: string;
  bbox: [number, number, number, number];
  text: string;
  font: string;
  size: number;
  color: [number, number, number];
  origin?: [number, number];
  dir?: [number, number];
  flags?: number;
};

export type TextLine = {
  bbox: number[];
  dir?: number[];
  spans: TextSpan[];
};

export type TextBlock = {
  id: string;
  bbox: number[];
  lines: TextLine[];
};

export type PageLayout = {
  page: number;
  width: number;
  height: number;
  rotation: number;
  has_text: boolean;
  blocks: TextBlock[];
  message?: string | null;
};

export type OpType =
  | "replace_text"
  | "move"
  | "duplicate"
  | "delete"
  | "add_text";

export type EditOp = {
  id: string;
  type: OpType;
  page: number;
  span_id?: string | null;
  bbox?: BBox | null;
  text?: string | null;
  new_bbox?: BBox | null;
  font?: string | null;
  size?: number | null;
  color?: [number, number, number] | null;
  original_text?: string | null;
  meta?: Record<string, unknown>;
};

export type DocumentMeta = {
  id: string;
  name: string;
  page_count: number;
  has_text: boolean;
  has_file?: boolean;
  created_at: string;
  updated_at: string;
  warnings: string[];
};

export type OpMetrics = {
  op_id: string;
  font_source: string;
  fallback_glyph_count: number;
  fallback_glyphs: string[];
  overflow: boolean;
  clipped: boolean;
  notes: string[];
  drawn_bbox?: [number, number, number, number] | null;
};

export type OpsPutResult = {
  id: string;
  applied: string[];
  skipped: string[];
  warnings: string[];
  op_metrics: OpMetrics[];
};

export type EditorWarning = {
  id: string;
  severity: "info" | "warn" | "error";
  message: string;
  opId?: string;
  spanId?: string;
};
