import fs from 'fs';
import { test } from '@playwright/test';
import { loadBackendTestCaseFlows } from '../backendFlowLoader';
import { runFlow } from '../core/flowRunner';
import { FlowDefinition } from '../core/types';

async function loadRuntimeFlows(): Promise<FlowDefinition[]> {
  const backendTestCaseIds = process.env.RAT_TEST_CASE_IDS || process.env.RAT_TEST_CASE_ID;
  const rawFlow = process.env.RAT_FLOW_JSON;
  const flowFile = process.env.RAT_FLOW_FILE;

  if (backendTestCaseIds) {
    const ids = backendTestCaseIds
      .split(',')
      .map((value) => Number(value.trim()))
      .filter((value) => Number.isInteger(value) && value > 0);
    if (!ids.length) {
      throw new Error('RAT_TEST_CASE_ID/RAT_TEST_CASE_IDS must contain at least one numeric id.');
    }
    return loadBackendTestCaseFlows(ids, process.env.RAT_BE_BASE_URL);
  }

  if (!rawFlow && !flowFile) {
    return [];
  }

  const payload = rawFlow ?? fs.readFileSync(String(flowFile), 'utf8');
  const parsed = JSON.parse(payload) as FlowDefinition | FlowDefinition[] | { flows?: FlowDefinition[] };

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if ('flows' in parsed && Array.isArray(parsed.flows)) {
    return parsed.flows;
  }

  return [parsed as FlowDefinition];
}

test.describe('Runtime Playwright flows', () => {
  test('execute runtime flow input', async ({ page }) => {
    const flows = await loadRuntimeFlows();
    test.skip(flows.length === 0, 'Provide RAT_TEST_CASE_ID, RAT_FLOW_JSON, or RAT_FLOW_FILE to run stored test cases.');

    for (const flow of flows) {
      await test.step(flow.name || 'Runtime flow', async () => {
        await runFlow(page, flow);
      });
    }
  });
});
