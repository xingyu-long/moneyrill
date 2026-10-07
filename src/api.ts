export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

export async function api(url: string, body?: any, method?: string) {
  const r = await fetch('/api' + url, {
    method: method || (body === undefined ? 'GET' : 'POST'),
    ...(body !== undefined
      ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      : {}),
  });
  const d = await r.json();
  if (!r.ok) throw new ApiError(d.error || 'Request failed', r.status);
  return d;
}

export function download(name: string, content: string, type = 'text/csv') {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}
