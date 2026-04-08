import { backendApiUrl, dashboardApiUrl } from './api';

async function requestJson<TResponse>(url: string, init?: RequestInit): Promise<TResponse> {
  const response = await fetch(url, init);
  const text = await response.text();
  const data = (text ? JSON.parse(text) : {}) as TResponse & { error?: string };
  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status}).`);
  }
  return data;
}

export function postDashboardJson<TResponse>(url: string, payload: unknown): Promise<TResponse> {
  return requestJson<TResponse>(dashboardApiUrl(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function getDashboardJson<TResponse>(url: string): Promise<TResponse> {
  return requestJson<TResponse>(dashboardApiUrl(url), { cache: 'no-store' });
}

export function postBackendJson<TResponse>(url: string, payload: unknown): Promise<TResponse> {
  return requestJson<TResponse>(backendApiUrl(url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function putBackendJson<TResponse>(url: string, payload: unknown): Promise<TResponse> {
  return requestJson<TResponse>(backendApiUrl(url), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

export function deleteBackendJson<TResponse>(url: string): Promise<TResponse> {
  return requestJson<TResponse>(backendApiUrl(url), {
    method: 'DELETE',
  });
}

export function getBackendJson<TResponse>(url: string): Promise<TResponse> {
  return requestJson<TResponse>(backendApiUrl(url), { cache: 'no-store' });
}
