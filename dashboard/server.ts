import fs from 'fs';
import path from 'path';
import http from 'http';
import { URL } from 'url';
import { runFlow } from './flowRunner';
import { getRecordingSnapshot, startRecording, stopRecording } from './recorder';
import { createFlowFromTemplate, getTemplateSummaries } from './templateLibrary';
import { loadBackendTestCaseFlow } from '../src/backendFlowLoader';
import { FlowDefinition, FlowRunSummary } from './types';

const host = process.env.DASHBOARD_HOST || '127.0.0.1';
const port = Number(process.env.DASHBOARD_PORT || 3000);
const backendBaseUrl = (process.env.RAT_BE_BASE_URL || 'http://localhost:8083/api').replace(/\/+$/, '');
const clientDistDir = path.join(__dirname, 'client');
const artifactsDir = path.join(process.cwd(), 'dashboard', 'artifacts');

const contentTypes: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webm': 'video/webm',
};

function sendJson(response: http.ServerResponse, statusCode: number, payload: unknown): void {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  response.end(JSON.stringify(payload));
}

function startJsonStream(response: http.ServerResponse): void {
  response.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-store',
    Connection: 'keep-alive',
  });
}

function writeJsonStream(response: http.ServerResponse, payload: unknown): void {
  if (response.writableEnded || response.destroyed) {
    return;
  }
  response.write(`${JSON.stringify(payload)}\n`);
}

function sendHtml(response: http.ServerResponse, html: string): void {
  response.writeHead(200, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(html);
}

function renderIndexHtml(filePath: string): string {
  const html = fs.readFileSync(filePath, 'utf8');
  return html.replace(
    "'__DASHBOARD_API_BASE_URL__'",
    JSON.stringify(process.env.DASHBOARD_API_BASE_URL || '')
  ).replace(
    "'__RAT_BE_BASE_URL__'",
    JSON.stringify(process.env.RAT_BE_BASE_URL || 'http://localhost:8083/api')
  );
}

function streamFile(response: http.ServerResponse, filePath: string): void {
  const extension = path.extname(filePath).toLowerCase();
  response.writeHead(200, {
    'Content-Type': contentTypes[extension] || 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(response);
}

function resolveSafePath(rootDir: string, requestPath: string): string | null {
  const decodedPath = decodeURIComponent(requestPath);
  const relativePath = decodedPath.replace(/^\/+/, '');
  const absolutePath = path.normalize(path.join(rootDir, relativePath));
  return absolutePath.startsWith(rootDir) ? absolutePath : null;
}

async function readRequestBody<T>(request: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const piece = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += piece.length;
    if (size > 1024 * 1024) {
      throw new Error('Request body too large.');
    }
    chunks.push(piece);
  }

  const body = Buffer.concat(chunks).toString('utf8');
  return (body ? JSON.parse(body) : {}) as T;
}

async function proxyBackendJson(
  response: http.ServerResponse,
  method: 'GET' | 'POST',
  pathName: string,
  body?: unknown
): Promise<void> {
  const backendResponse = await fetch(`${backendBaseUrl}${pathName}`, {
    method,
    headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
    body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
  });

  const text = await backendResponse.text();
  response.writeHead(backendResponse.status, {
    'Content-Type': backendResponse.headers.get('content-type') || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(text);
}

async function checkReachableUrl(rawUrl: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const normalizedUrl = rawUrl.trim();
  if (!normalizedUrl) {
    return { ok: true };
  }

  if (!/^https?:\/\//i.test(normalizedUrl)) {
    return { ok: false, error: 'URL phải bắt đầu bằng http:// hoặc https://.' };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    let checkResponse = await fetch(normalizedUrl, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });

    if (checkResponse.status === 405 || checkResponse.status === 403) {
      checkResponse = await fetch(normalizedUrl, {
        method: 'GET',
        redirect: 'follow',
        signal: controller.signal,
      });
    }

    return {
      ok: checkResponse.status >= 200 && checkResponse.status < 500,
      status: checkResponse.status,
      error: checkResponse.status >= 500 ? `URL trả về HTTP ${checkResponse.status}.` : undefined,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function postBackendJson<TResponse>(pathName: string, body: unknown, baseUrl = backendBaseUrl): Promise<TResponse> {
  const backendResponse = await fetch(`${baseUrl.replace(/\/+$/, '')}${pathName}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const text = await backendResponse.text();
  if (!backendResponse.ok) {
    throw new Error(`RAT-BE POST ${pathName} failed with ${backendResponse.status}: ${text}`);
  }
  return (text ? JSON.parse(text) : {}) as TResponse;
}

function actualValueForStep(step: FlowDefinition['steps'][number], status: 'passed' | 'failed'): string | null {
  if (step.action === 'assertVisible') return status === 'passed' ? 'visible' : 'not_found';
  if (step.action === 'assertText') return status === 'passed' ? step.value || null : 'not_matched';
  if (step.action === 'assertUrlContains') return status === 'passed' ? step.value || null : 'not_matched';
  return null;
}

async function saveBackendRunResult(flow: FlowDefinition, result: FlowRunSummary, baseUrl?: string): Promise<void> {
  if (!flow.backend) return;

  const dataSetIds = flow.backend.testDataSetIds;
  const testRun = await postBackendJson<{ id: number }>('/test-runs', {
    projectId: flow.backend.projectId,
    testFlowId: null,
    testCaseId: flow.backend.testCaseId,
    testDataSetId: dataSetIds.length === 1 ? dataSetIds[0] : null,
    runType: 'case',
    status: result.status,
    startedAt: result.startedAt,
    endedAt: result.finishedAt,
    durationMs: result.durationMs,
  }, baseUrl);

  const stepsByDataSet = new Map<number | null, Array<{ step: FlowDefinition['steps'][number]; index: number }>>();
  flow.steps.forEach((step, index) => {
    const key = step.backend?.testDataSetId ?? null;
    const items = stepsByDataSet.get(key) || [];
    items.push({ step, index });
    stepsByDataSet.set(key, items);
  });

  for (const [testDataSetId, items] of stepsByDataSet.entries()) {
    const executedItems: Array<{
      step: FlowDefinition['steps'][number];
      index: number;
      result: FlowRunSummary['steps'][number];
    }> = [];

    for (const item of items) {
      const stepResult = result.steps.find((step) => step.flowStepIndex === item.index);
      if (stepResult) {
        executedItems.push({ ...item, result: stepResult });
      }
    }

    if (!executedItems.length) continue;
    const executedResults = executedItems.map((item) => item.result);
    const firstStep = executedResults[0];
    const lastStep = executedResults[executedResults.length - 1];
    const status = executedResults.some((step) => step.status === 'failed') ? 'failed' : 'passed';
    const errorMessage = executedResults.find((step) => step.error)?.error || null;
    const testRunCase = await postBackendJson<{ id: number }>('/test-run-cases', {
      testRunId: testRun.id,
      testCaseId: flow.backend.testCaseId,
      testDataSetId,
      status,
      startedAt: firstStep.startedAt || result.startedAt,
      endedAt: lastStep.endedAt || result.finishedAt,
      durationMs: executedResults.reduce((total, step) => total + step.durationMs, 0),
      errorMessage,
    }, baseUrl);

    for (const item of executedItems) {
      const stepResult = item.result;
      const backendStep = item.step.backend;
      if (!backendStep || backendStep.testCaseStepId <= 0) continue;
      await postBackendJson('/test-run-steps', {
        testRunCaseId: testRunCase.id,
        testCaseStepId: backendStep.testCaseStepId,
        stepOrder: backendStep.stepOrder,
        actionType: backendStep.actionType,
        target: backendStep.target ?? item.step.selector ?? item.step.url ?? null,
        value: backendStep.value ?? item.step.value ?? null,
        expectedValue: backendStep.expectedValue ?? null,
        actualValue: actualValueForStep(item.step, stepResult.status),
        status: stepResult.status,
        startedAt: stepResult.startedAt || null,
        endedAt: stepResult.endedAt || null,
        durationMs: stepResult.durationMs,
        errorMessage: stepResult.error || null,
      }, baseUrl);
    }
  }
}

const server = http.createServer(async (request, response) => {
  const method = request.method || 'GET';
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || `${host}:${port}`}`);

  if (method === 'GET' && requestUrl.pathname === '/') {
    const filePath = resolveSafePath(clientDistDir, 'index.html');
    if (!filePath || !fs.existsSync(filePath)) {
      sendJson(response, 404, { ok: false, error: 'Dashboard entry not found.' });
      return;
    }
    sendHtml(response, renderIndexHtml(filePath));
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/api/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/api/templates') {
    sendJson(response, 200, { templates: getTemplateSummaries() });
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/api/check-url') {
    try {
      const payload = await readRequestBody<{ url?: string }>(request);
      sendJson(response, 200, await checkReachableUrl(String(payload.url || '')));
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/api/projects') {
    try {
      await proxyBackendJson(response, 'GET', '/projects');
    } catch (error) {
      sendJson(response, 502, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/api/projects') {
    try {
      const payload = await readRequestBody<unknown>(request);
      await proxyBackendJson(response, 'POST', '/projects', payload);
    } catch (error) {
      sendJson(response, 502, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (method === 'GET' && requestUrl.pathname === '/api/test-cases') {
    try {
      await proxyBackendJson(response, 'GET', '/test-cases');
    } catch (error) {
      sendJson(response, 502, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/api/test-cases') {
    try {
      const payload = await readRequestBody<unknown>(request);
      await proxyBackendJson(response, 'POST', '/test-cases', payload);
    } catch (error) {
      sendJson(response, 502, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/api/test-case-steps') {
    try {
      const payload = await readRequestBody<unknown>(request);
      await proxyBackendJson(response, 'POST', '/test-case-steps', payload);
    } catch (error) {
      sendJson(response, 502, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/api/test-data-sets') {
    try {
      const payload = await readRequestBody<unknown>(request);
      await proxyBackendJson(response, 'POST', '/test-data-sets', payload);
    } catch (error) {
      sendJson(response, 502, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/api/test-case-data-sets') {
    try {
      const payload = await readRequestBody<unknown>(request);
      await proxyBackendJson(response, 'POST', '/test-case-data-sets', payload);
    } catch (error) {
      sendJson(response, 502, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/api/run-template') {
    try {
      const payload = await readRequestBody<{ templateId: string; input: Record<string, string> }>(request);
      const flow = createFlowFromTemplate(payload.templateId, payload.input);
      const result = await runFlow({ prefix: payload.templateId || 'template', flow, input: payload.input });
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/api/run-custom') {
    try {
      const payload = await readRequestBody<{ name?: string; timeoutMs?: number; steps: unknown[]; targetUrl?: string }>(request);
      const result = await runFlow({
        prefix: 'custom',
        flow: {
          name: payload.name || 'Custom Flow',
          targetUrl: payload.targetUrl || '',
          timeoutMs: payload.timeoutMs,
          steps: payload.steps as never,
        },
        input: payload,
      });
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/api/run-backend-test-case') {
    try {
      const payload = await readRequestBody<{ testCaseId: number; backendBaseUrl?: string; stream?: boolean }>(request);
      const testCaseId = Number(payload.testCaseId);
      if (!Number.isInteger(testCaseId) || testCaseId <= 0) {
        throw new Error('testCaseId must be a positive number.');
      }

      const selectedBackendBaseUrl = payload.backendBaseUrl || process.env.RAT_BE_BASE_URL;
      if (payload.stream) {
        startJsonStream(response);
        const abortController = new AbortController();
        const handleAbort = () => abortController.abort();
        request.on('aborted', handleAbort);
        request.on('close', handleAbort);
        response.on('close', handleAbort);
        try {
          const flow = await loadBackendTestCaseFlow(testCaseId, selectedBackendBaseUrl);
          const result = await runFlow({
            prefix: `test-case-${testCaseId}`,
            flow,
            input: { testCaseId },
            onProgress: (event) => writeJsonStream(response, { type: 'progress', event }),
            signal: abortController.signal,
          });
          await saveBackendRunResult(flow, result, selectedBackendBaseUrl);
          writeJsonStream(response, { type: 'result', result });
        } catch (error) {
          if (!abortController.signal.aborted) {
            writeJsonStream(response, { type: 'error', error: error instanceof Error ? error.message : String(error) });
          }
        } finally {
          if (!response.writableEnded && !response.destroyed) {
            response.end();
          }
        }
        return;
      }

      const flow = await loadBackendTestCaseFlow(testCaseId, selectedBackendBaseUrl);
      const result = await runFlow({
        prefix: `test-case-${testCaseId}`,
        flow,
        input: { testCaseId },
      });
      await saveBackendRunResult(flow, result, selectedBackendBaseUrl);
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/api/recordings/start') {
    try {
      const payload = await readRequestBody<{ url?: string }>(request);
      sendJson(response, 200, await startRecording(payload));
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (method === 'GET' && requestUrl.pathname.startsWith('/api/recordings/')) {
    try {
      const sessionId = requestUrl.pathname.replace('/api/recordings/', '').replace(/\/+$/, '');
      if (!sessionId || sessionId === 'start' || sessionId === 'stop') {
        sendJson(response, 404, { ok: false, error: 'Recording session not found.' });
        return;
      }
      sendJson(response, 200, await getRecordingSnapshot(sessionId));
    } catch (error) {
      sendJson(response, 404, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (method === 'POST' && requestUrl.pathname === '/api/recordings/stop') {
    try {
      const payload = await readRequestBody<{ sessionId: string }>(request);
      sendJson(response, 200, await stopRecording(payload.sessionId));
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : String(error) });
    }
    return;
  }

  if (method === 'GET' && requestUrl.pathname.startsWith('/artifacts/')) {
    const artifactPath = resolveSafePath(artifactsDir, requestUrl.pathname.replace('/artifacts/', ''));
    if (!artifactPath || !fs.existsSync(artifactPath) || fs.statSync(artifactPath).isDirectory()) {
      sendJson(response, 404, { ok: false, error: 'Artifact not found.' });
      return;
    }
    streamFile(response, artifactPath);
    return;
  }

  if (method === 'GET' && requestUrl.pathname.endsWith('.js')) {
    const filePath = resolveSafePath(clientDistDir, requestUrl.pathname);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      sendJson(response, 404, { ok: false, error: 'Script not found.' });
      return;
    }
    streamFile(response, filePath);
    return;
  }

  if (method === 'GET' && requestUrl.pathname.endsWith('.css')) {
    const filePath = resolveSafePath(clientDistDir, requestUrl.pathname);
    if (!filePath || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      sendJson(response, 404, { ok: false, error: 'Stylesheet not found.' });
      return;
    }
    streamFile(response, filePath);
    return;
  }

  sendJson(response, 404, { ok: false, error: 'Page not found.' });
});

server.listen(port, host, () => {
  console.log(`Dashboard running at http://${host}:${port}`);
});
