"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runFlow = runFlow;
const test_1 = require("@playwright/test");
const actionExecutor_1 = require("./actionExecutor");
async function runStepGroup(page, steps, timeoutMs) {
    let firstError;
    for (const { step } of steps) {
        const title = step.description ?? `${step.action} ${step.selector ?? step.target ?? step.url ?? step.value ?? ''}`.trim();
        await test_1.test.step(title, async () => {
            try {
                await (0, actionExecutor_1.executeStep)(page, step, timeoutMs);
            }
            catch (error) {
                firstError ??= error;
            }
        });
        if (firstError) {
            break;
        }
    }
    return firstError;
}
function groupStepsByDataSet(steps) {
    return Array.from(steps
        .reduce((groups, item) => {
        const dataSetId = item.step.backend?.testDataSetId ?? null;
        const group = groups.get(dataSetId);
        if (group) {
            group.push(item);
        }
        else {
            groups.set(dataSetId, [item]);
        }
        return groups;
    }, new Map())
        .values());
}
async function runFlow(page, flow) {
    const timeoutMs = Number(flow.timeoutMs) > 0 ? Number(flow.timeoutMs) : 10000;
    const shouldContinueAcrossDataSets = Boolean(flow.backend && flow.backend.testDataSetIds.length > 1);
    const indexedSteps = flow.steps.map((step, index) => ({ step, index }));
    let firstError;
    if (shouldContinueAcrossDataSets) {
        const browser = page.context().browser();
        if (!browser) {
            firstError = await runStepGroup(page, indexedSteps, timeoutMs);
        }
        else {
            for (const stepGroup of groupStepsByDataSet(indexedSteps)) {
                const context = await browser.newContext({
                    baseURL: process.env.BASE_URL ?? 'http://127.0.0.1:3000',
                    ignoreHTTPSErrors: true,
                });
                const dataSetPage = await context.newPage();
                try {
                    firstError ??= await runStepGroup(dataSetPage, stepGroup, timeoutMs);
                }
                finally {
                    await dataSetPage.close().catch(() => undefined);
                    await context.close().catch(() => undefined);
                }
            }
        }
    }
    else {
        firstError = await runStepGroup(page, indexedSteps, timeoutMs);
    }
    if (firstError) {
        throw firstError;
    }
}
