type ApiRuntimeConfig = {
  dashboardBaseUrl: string;
  backendBaseUrl: string;
};

declare global {
  interface Window {
    __RAT_API_CONFIG__?: Partial<ApiRuntimeConfig>;
  }
}

const apiConfig: ApiRuntimeConfig = {
  dashboardBaseUrl: window.__RAT_API_CONFIG__?.dashboardBaseUrl
    ? String(window.__RAT_API_CONFIG__.dashboardBaseUrl).replace(/\/+$/, '')
    : '',
  backendBaseUrl: window.__RAT_API_CONFIG__?.backendBaseUrl
    ? String(window.__RAT_API_CONFIG__.backendBaseUrl).replace(/\/+$/, '')
    : 'http://localhost:8083/api',
};

function joinApiUrl(baseUrl: string, endpoint: string): string {
  const normalizedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${baseUrl}${normalizedEndpoint}`;
}

export function dashboardApiUrl(endpoint: string): string {
  return joinApiUrl(apiConfig.dashboardBaseUrl, endpoint);
}

export function backendApiUrl(endpoint: string): string {
  return joinApiUrl(apiConfig.backendBaseUrl, endpoint);
}
