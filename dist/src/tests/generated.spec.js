"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const test_1 = require("@playwright/test");
const backendFlowLoader_1 = require("../backendFlowLoader");
const flowRunner_1 = require("../core/flowRunner");
async function loadRuntimeFlows() {
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
        return (0, backendFlowLoader_1.loadBackendTestCaseFlows)(ids, process.env.RAT_BE_BASE_URL);
    }
    if (!rawFlow && !flowFile) {
        return [];
    }
    const payload = rawFlow ?? fs_1.default.readFileSync(String(flowFile), 'utf8');
    const parsed = JSON.parse(payload);
    if (Array.isArray(parsed)) {
        return parsed;
    }
    if ('flows' in parsed && Array.isArray(parsed.flows)) {
        return parsed.flows;
    }
    return [parsed];
}
test_1.test.describe('Runtime Playwright flows', () => {
    (0, test_1.test)('execute runtime flow input', async ({ page }) => {
        const flows = await loadRuntimeFlows();
        test_1.test.skip(flows.length === 0, 'Provide RAT_TEST_CASE_ID, RAT_FLOW_JSON, or RAT_FLOW_FILE to run stored test cases.');
        for (const flow of flows) {
            await test_1.test.step(flow.name || 'Runtime flow', async () => {
                await (0, flowRunner_1.runFlow)(page, flow);
            });
        }
    });
});
