import { Page, test } from '@playwright/test';
import { executeStep } from './actionExecutor';
import { FlowDefinition } from './types';

type IndexedStep = {
  step: FlowDefinition['steps'][number];
  index: number;
};

async function runStepGroup(page: Page, steps: IndexedStep[], timeoutMs: number): Promise<unknown> {
  let firstError: unknown;

  for (const { step } of steps) {
    const title = step.description ?? `${step.action} ${step.selector ?? step.target ?? step.url ?? step.value ?? ''}`.trim();

    await test.step(title, async () => {
      try {
        await executeStep(page, step, timeoutMs);
      } catch (error) {
        firstError ??= error;
      }
    });

    if (firstError) {
      break;
    }
  }

  return firstError;
}

function groupStepsByDataSet(steps: IndexedStep[]): IndexedStep[][] {
  return Array.from(
    steps
      .reduce((groups, item) => {
        const dataSetId = item.step.backend?.testDataSetId ?? null;
        const group = groups.get(dataSetId);
        if (group) {
          group.push(item);
        } else {
          groups.set(dataSetId, [item]);
        }

        return groups;
      }, new Map<number | null, IndexedStep[]>())
      .values()
  );
}

export async function runFlow(page: Page, flow: FlowDefinition) {
  const timeoutMs = Number(flow.timeoutMs) > 0 ? Number(flow.timeoutMs) : 10000;
  const shouldContinueAcrossDataSets = Boolean(flow.backend && flow.backend.testDataSetIds.length > 1);
  const indexedSteps = flow.steps.map((step, index) => ({ step, index }));
  let firstError: unknown;

  if (shouldContinueAcrossDataSets) {
    const browser = page.context().browser();
    if (!browser) {
      firstError = await runStepGroup(page, indexedSteps, timeoutMs);
    } else {
      for (const stepGroup of groupStepsByDataSet(indexedSteps)) {
        const context = await browser.newContext({
          baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000',
          ignoreHTTPSErrors: true,
        });
        const dataSetPage = await context.newPage();

        try {
          firstError ??= await runStepGroup(dataSetPage, stepGroup, timeoutMs);
        } finally {
          await dataSetPage.close().catch(() => undefined);
          await context.close().catch(() => undefined);
        }
      }
    }
  } else {
    firstError = await runStepGroup(page, indexedSteps, timeoutMs);
  }

  if (firstError) {
    throw firstError;
  }
}
