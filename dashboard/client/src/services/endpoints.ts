export const BACKEND_ENDPOINTS = {
  projects: '/projects',
  testCases: '/test-cases',
  testCaseSteps: '/test-case-steps',
  testDataSets: '/test-data-sets',
  testCaseDataSets: '/test-case-data-sets',
  testAssets: {
    upload: '/test-assets/upload',
    byId(assetId: number | string): string {
      return `/test-assets/${encodeURIComponent(assetId)}`;
    },
    download(assetId: number | string): string {
      return `/test-assets/${encodeURIComponent(assetId)}/download`;
    },
  },
  latestProjectRunDetail(projectId: number): string {
    return `/test-runs/projects/${encodeURIComponent(projectId)}/latest/detail`;
  },
} as const;

export const DASHBOARD_ENDPOINTS = {
  templates: '/api/templates',
  checkUrl: '/api/check-url',
  runTemplate: '/api/run-template',
  runCustom: '/api/run-custom',
  runBackendTestCase: '/api/run-backend-test-case',
  recordings: {
    start: '/api/recordings/start',
    stop: '/api/recordings/stop',
    byId(sessionId: string): string {
      return `/api/recordings/${encodeURIComponent(sessionId)}`;
    },
  },
} as const;
