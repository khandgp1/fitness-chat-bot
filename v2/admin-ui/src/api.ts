export class ApiError extends Error {
  constructor(
    public status: number,
    message: string
  ) {
    super(message);
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(res.status, body.error ?? `HTTP ${res.status}`);
  }
  return (await res.json()) as T;
}

export const get = <T>(path: string) => req<T>(path);
export const post = <T>(path: string, body?: unknown) =>
  req<T>(path, { method: 'POST', body: JSON.stringify(body ?? {}) });
export const put = <T>(path: string, body: unknown) =>
  req<T>(path, { method: 'PUT', body: JSON.stringify(body) });

// ---- shared shapes (mirrors the server, loosely) ----
export interface TriageItem {
  type: string;
  clientId: string;
  clientName: string;
  title: string;
  detail?: string;
  refs: { batchId?: string; draftId?: string; date?: string };
}
export interface ClientRow {
  id: string;
  displayName: string;
  status: string;
  timezone: string;
  streak: number;
}
export interface Draft {
  id: string;
  draftText: string;
  finalText?: string;
  responseType: string;
  confidence?: number;
  status: string;
  createdAt: string;
}
export interface ClientDetail {
  client: ClientRow & { verifiedAt?: string };
  streak: number;
  today: string;
  calendar: Array<{ date: string; status: string; streakAfter?: number }>;
  narrative: string;
  staleness: { flags: number; replyWorthyBatches: number };
  drafts: Draft[];
  identity?: { externalId: string; handle?: string };
}
export interface Message {
  id: string;
  direction: 'inbound' | 'outbound';
  text: string;
  createdAt: string;
}
