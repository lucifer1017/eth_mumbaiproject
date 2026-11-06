// Thin fetch wrapper around the Daemon API. Every endpoint returns the
// universal envelope from API_SPEC.md §1.1:
//   { success, data: { code, message, details } }
// On success we hand callers `data.details`; on failure we throw an ApiError
// carrying `data.code` and `data.message`.

const BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL;

interface Envelope<T> {
  success: boolean;
  data: {
    code: string;
    message: string;
    details: T;
  };
}

export class ApiError extends Error {
  code: string;
  details: unknown;

  constructor(code: string, message: string, details: unknown = {}) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!BASE_URL) {
    throw new ApiError(
      "config",
      "NEXT_PUBLIC_API_BASE_URL is not set: point it at the backend in .env.local",
    );
  }

  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } catch {
    throw new ApiError("network", "Could not reach the backend");
  }

  let body: Envelope<T>;
  try {
    body = (await res.json()) as Envelope<T>;
  } catch {
    throw new ApiError(String(res.status), res.statusText || "Unexpected response");
  }

  if (!body.success) {
    throw new ApiError(body.data.code, body.data.message, body.data.details);
  }
  return body.data.details;
}

export type QueryParams = Record<string, string | number | undefined>;

export function apiGet<T>(path: string, query?: QueryParams): Promise<T> {
  const qs = query
    ? "?" +
      new URLSearchParams(
        Object.entries(query)
          .filter(([, v]) => v !== undefined && v !== "")
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : "";
  return request<T>(`${path}${qs}`, { method: "GET" });
}

export function apiPost<T>(
  path: string,
  body?: unknown,
  headers?: Record<string, string>,
): Promise<T> {
  return request<T>(path, {
    method: "POST",
    body: body !== undefined ? JSON.stringify(body) : undefined,
    ...(headers ? { headers } : {}),
  });
}
