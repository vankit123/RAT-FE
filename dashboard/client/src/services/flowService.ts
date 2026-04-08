import { RunProgressEvent, RunResult } from '../types';
import { dashboardApiUrl } from './api';
import { BACKEND_ENDPOINTS, DASHBOARD_ENDPOINTS } from './endpoints';
import { getBackendJson, postDashboardJson } from './httpService';

export function runTemplateRequest(templateId: string, input: Record<string, string>): Promise<RunResult> {
  return postDashboardJson<RunResult>(DASHBOARD_ENDPOINTS.runTemplate, { templateId, input });
}

export function runCustomFlowRequest(payload: { name: string; timeoutMs: number; steps: unknown[] }): Promise<RunResult> {
  return postDashboardJson<RunResult>(DASHBOARD_ENDPOINTS.runCustom, payload);
}

type TestRunStepDetailResponse = {
  id: number;
  testRunCaseId: number;
  testCaseStepId: number;
  stepOrder: number;
  actionType: string;
  target?: string | null;
  value?: string | null;
  expectedValue?: string | null;
  actualValue?: string | null;
  status: string;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
  errorMessage?: string | null;
};

type TestRunCaseDetailResponse = {
  id: number;
  testRunId: number;
  testCaseId: number;
  testDataSetId?: number | null;
  status: string;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  steps?: TestRunStepDetailResponse[] | null;
};

type TestRunDetailResponse = {
  id: number;
  projectId: number;
  testFlowId?: number | null;
  testCaseId?: number | null;
  testDataSetId?: number | null;
  runType: string;
  status: string;
  startedAt?: string | null;
  endedAt?: string | null;
  durationMs?: number | null;
  videoUrl?: string | null;
  cases?: TestRunCaseDetailResponse[] | null;
};

function normalizeRunStatus(status?: string | null): 'passed' | 'failed' {
  return String(status || '').toLowerCase() === 'passed' ? 'passed' : 'failed';
}

function dataSetLabel(testDataSetId: number | null | undefined, index: number): string {
  return testDataSetId ? `DataSet ${testDataSetId}` : `DataSet ${index + 1}`;
}

export async function getLatestProjectRunResult(projectId: number): Promise<RunResult | null> {
  const detail = await getBackendJson<TestRunDetailResponse>(BACKEND_ENDPOINTS.latestProjectRunDetail(projectId)).catch((error) => {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
    if (message.includes('not found') || message.includes('404')) {
      return null;
    }
    throw error;
  });

  if (!detail) return null;

  const cases = detail.cases || [];
  const steps = cases.flatMap((runCase, caseIndex) => {
    const label = dataSetLabel(runCase.testDataSetId, caseIndex);
    return (runCase.steps || []).map((step) => ({
      name: `Step ${step.stepOrder}: ${step.actionType}${step.target ? ` ${step.target}` : ''}`,
      status: normalizeRunStatus(step.status),
      durationMs: step.durationMs || 0,
      error: step.errorMessage || undefined,
      testDataSetId: runCase.testDataSetId ?? null,
      dataSetLabel: label,
    }));
  });
  const dataSets = cases.map((runCase, index) => {
    const caseSteps = runCase.steps || [];
    const failedStepCount = caseSteps.filter((step) => normalizeRunStatus(step.status) === 'failed').length;
    return {
      testDataSetId: runCase.testDataSetId ?? null,
      label: dataSetLabel(runCase.testDataSetId, index),
      status: normalizeRunStatus(runCase.status),
      durationMs: runCase.durationMs || 0,
      stepCount: caseSteps.length,
      executedStepCount: caseSteps.length,
      failedStepCount,
      errorMessage: runCase.errorMessage || null,
    };
  });

  return {
    runId: String(detail.id),
    durationMs: detail.durationMs || 0,
    status: normalizeRunStatus(detail.status),
    currentUrl: '',
    errorMessage: cases.find((runCase) => runCase.errorMessage)?.errorMessage || null,
    flowName: detail.testCaseId ? `Test case ${detail.testCaseId}` : detail.runType || 'Latest run',
    steps,
    dataSets,
    artifacts: {
      video: detail.videoUrl ? { url: detail.videoUrl, label: 'Latest video', testDataSetId: detail.testDataSetId ?? null } : null,
      videos: detail.videoUrl ? [{ url: detail.videoUrl, label: 'Latest video', testDataSetId: detail.testDataSetId ?? null }] : [],
      screenshot: null,
    },
  };
}

type RunStreamMessage =
  | { type: 'progress'; event: RunProgressEvent }
  | { type: 'result'; result: RunResult }
  | { type: 'error'; error: string };

function isRunResult(value: unknown): value is RunResult {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'runId' in value &&
      'status' in value &&
      'steps' in value
  );
}

export async function runBackendTestCaseRequest(
  testCaseId: number,
  onProgress?: (event: RunProgressEvent) => void,
  signal?: AbortSignal,
): Promise<RunResult> {
  if (!onProgress) {
    if (!signal) {
      return postDashboardJson<RunResult>(DASHBOARD_ENDPOINTS.runBackendTestCase, { testCaseId });
    }

    let response: Response;
    try {
      response = await fetch(dashboardApiUrl(DASHBOARD_ENDPOINTS.runBackendTestCase), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testCaseId }),
        signal,
      });
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('Đã dừng chạy test.');
      }
      throw error;
    }
    const data = (await response.json().catch(() => null)) as RunResult | { error?: string } | null;
    if (!response.ok) {
      throw new Error((data && 'error' in data ? data.error : null) || 'Could not start test run.');
    }
    if (!data || !isRunResult(data)) {
      throw new Error('Test run finished without a valid result.');
    }
    return data;
  }

  let response: Response;
  try {
    response = await fetch(dashboardApiUrl(DASHBOARD_ENDPOINTS.runBackendTestCase), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testCaseId, stream: true }),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Đã dừng chạy test.');
    }
    throw error;
  }

  if (!response.ok || !response.body) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || 'Could not start streamed test run.');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: RunResult | null = null;
  let streamError: string | null = null;

  async function handleLine(line: string): Promise<void> {
    if (!line.trim()) return;
    const parsed = JSON.parse(line) as RunStreamMessage | RunResult | { ok?: boolean; error?: string };
    if (isRunResult(parsed)) {
      result = parsed;
      return;
    }

    const message = parsed as RunStreamMessage | { ok?: boolean; error?: string };
    if (message.type === 'progress') {
      onProgress(message.event);
      return;
    }
    if (message.type === 'result') {
      result = message.result;
      return;
    }
    if (message.type === 'error' || message.error) {
      streamError = message.error || 'Streamed test run failed.';
    }
  }

  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        await handleLine(line);
      }
      if (done) break;
    }
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error('Đã dừng chạy test.');
    }
    throw error;
  }

  if (buffer.trim()) {
    await handleLine(buffer);
  }

  if (streamError) {
    throw new Error(streamError);
  }
  if (!result) {
    throw new Error('Test run finished without a result. Restart dashboard with npm run dashboard so the server supports progress streaming.');
  }
  return result;
}
