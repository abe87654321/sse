export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
}

export interface PaginationInfo {
  page: number;
  page_size: number;
  total: number;
  has_more: boolean;
}

export function toPaginated<T>(
  rows: T[],
  total: number,
  page: number,
  pageSize: number,
): { results: T[]; pagination: PaginationInfo } {
  return {
    results: rows,
    pagination: {
      page,
      page_size: pageSize,
      total,
      has_more: page * pageSize < total,
    },
  };
}

export function formatTimestamp(d: Date | string | undefined | null): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString();
}

export function errorResult(code: string, message: string): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify({ error: { code, message } }) }],
    isError: true,
  };
}

export function successResult(data: unknown): ToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data) }],
  };
}

export function parseISO8601Date(val: unknown): string | undefined {
  if (typeof val !== "string") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(val)) return undefined;
  return val;
}
