"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeAssertion = executeAssertion;
const test_1 = require("@playwright/test");
const selectorResolver_1 = require("../../dashboard/selectorResolver");
function stepSelector(step) {
    return step.selector ?? step.target;
}
async function executeAssertion(page, step, defaultTimeout = 10000) {
    const timeout = step.timeout ?? defaultTimeout;
    switch (step.action) {
        case 'assertVisible': {
            const selector = stepSelector(step);
            if (!selector) {
                throw new Error('assertVisible action requires selector');
            }
            await (0, test_1.expect)(await (0, selectorResolver_1.resolveStepLocator)(page, selector, 'assertVisible')).toBeVisible({ timeout });
            return;
        }
        case 'assertText': {
            const selector = stepSelector(step);
            if (!selector) {
                throw new Error('assertText action requires selector');
            }
            if (selector.startsWith('kind=text::') && String(step.value || '').trim().toLowerCase() === 'visible') {
                await (0, test_1.expect)(await (0, selectorResolver_1.resolveStepLocator)(page, selector, 'assertVisible')).toBeVisible({ timeout });
                return;
            }
            await (0, test_1.expect)(await (0, selectorResolver_1.resolveStepLocator)(page, selector, 'assertVisible')).toContainText(step.value ?? '', {
                timeout,
            });
            return;
        }
        case 'assertUrlContains': {
            if (!step.value) {
                throw new Error('assertUrlContains action requires value');
            }
            await (0, test_1.expect)(page).toHaveURL(new RegExp(step.value), { timeout });
            return;
        }
        default:
            throw new Error(`Unsupported assertion action: ${step.action}`);
    }
}
