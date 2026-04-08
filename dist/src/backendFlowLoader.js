"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadBackendTestCaseFlow = loadBackendTestCaseFlow;
exports.loadBackendTestCaseFlows = loadBackendTestCaseFlows;
const DEFAULT_BACKEND_BASE_URL = 'http://localhost:8083/api';
function normalizeExternalPaymentConfig(dataJson) {
    const payment = dataJson?.payment;
    if (!payment || typeof payment !== 'object')
        return null;
    const vnpay = payment.vnpay;
    if (!vnpay || typeof vnpay !== 'object')
        return null;
    const raw = vnpay;
    const provider = String(raw.provider || 'vnpay').trim().toLowerCase();
    if (provider !== 'vnpay')
        return null;
    const mode = String(raw.mode || 'auto').trim().toLowerCase();
    const timeoutMs = Number(raw.timeoutMs);
    return {
        provider: 'vnpay',
        mode: mode === 'manual-complete' ? 'manual-complete' : 'auto',
        bankText: raw.bankText === undefined || raw.bankText === null ? undefined : String(raw.bankText).trim(),
        bankSelector: raw.bankSelector === undefined || raw.bankSelector === null ? undefined : String(raw.bankSelector).trim(),
        cardNumber: raw.cardNumber === undefined || raw.cardNumber === null ? undefined : String(raw.cardNumber).trim(),
        cardHolderName: raw.cardHolderName === undefined || raw.cardHolderName === null ? undefined : String(raw.cardHolderName).trim(),
        issueDate: raw.issueDate === undefined || raw.issueDate === null ? undefined : String(raw.issueDate).trim(),
        otp: raw.otp === undefined || raw.otp === null ? undefined : String(raw.otp).trim(),
        returnUrl: raw.returnUrl === undefined || raw.returnUrl === null ? undefined : String(raw.returnUrl).trim(),
        timeoutMs: Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : undefined,
    };
}
function trimTrailingSlash(value) {
    return value.endsWith('/') ? value.slice(0, -1) : value;
}
function joinUrl(baseUrl, pathOrUrl) {
    const value = String(pathOrUrl || '').trim();
    if (!value)
        return undefined;
    if (/^https?:\/\//i.test(value))
        return value;
    if (!baseUrl)
        return value;
    return `${trimTrailingSlash(baseUrl)}${value.startsWith('/') ? value : `/${value}`}`;
}
function normalizeAction(step) {
    const actionType = String(step.actionType || '').trim();
    const normalized = actionType.replace(/[_\-\s]/g, '').toLowerCase();
    const actionMap = {
        goto: 'goto',
        waitforurl: 'waitForUrl',
        payviavnpay: 'payViaVnpay',
        hover: 'hover',
        click: 'click',
        fill: 'fill',
        press: 'press',
        waitfor: 'waitFor',
        assertvisible: 'assertVisible',
        asserttext: 'assertText',
        asserturlcontains: 'assertUrlContains',
    };
    const action = actionMap[normalized];
    if (!action) {
        throw new Error(`Unsupported backend step actionType "${actionType || '(empty)'}" at test_case_steps id=${step.id}, stepOrder=${step.stepOrder}. Open Edit dataStep and choose an action type.`);
    }
    return action;
}
async function fetchJson(baseUrl, path) {
    const response = await fetch(`${trimTrailingSlash(baseUrl)}${path}`);
    if (!response.ok) {
        throw new Error(`RAT-BE request failed: GET ${path} returned ${response.status}`);
    }
    return (await response.json());
}
function resolveDataPath(data, path) {
    const value = path.split('.').reduce((current, key) => {
        if (current && typeof current === 'object' && key in current) {
            return current[key];
        }
        return undefined;
    }, data);
    return value === undefined || value === null ? undefined : String(value);
}
function resolvePlaceholders(value, data, context) {
    if (!value)
        return undefined;
    return value.replace(/\$\{([^}]+)\}/g, (match, path) => {
        const normalizedPath = String(path).trim();
        const resolved = resolveDataPath(data, normalizedPath);
        if (resolved === undefined) {
            throw new Error(`Cannot resolve placeholder "${match}" for ${context}. Check dataJson/expectedJson contains "${normalizedPath}".`);
        }
        return resolved;
    });
}
function shouldUseVisibleAssertion(action, target, expectedValue) {
    return action === 'assertText' && /^kind=text::/i.test(String(target || '').trim()) && String(expectedValue || '').trim().toLowerCase() === 'visible';
}
function mapBackendStep(step, project, dataSet) {
    const action = normalizeAction(step);
    const expectedJson = dataSet?.expectedJson || dataSet?.expected_json || {};
    const externalPayment = normalizeExternalPaymentConfig(dataSet?.dataJson);
    const data = {
        ...(dataSet?.dataJson || {}),
        expected: expectedJson,
    };
    const context = `test_case_steps id=${step.id}, dataSet=${dataSet?.code || dataSet?.id || 'none'}`;
    const resolvedTarget = resolvePlaceholders(step.target, data, `${context}, target`);
    const resolvedValue = resolvePlaceholders(step.value, data, `${context}, value`);
    const resolvedExpectedValue = resolvePlaceholders(step.expectedValue, data, `${context}, expectedValue`);
    const effectiveAction = shouldUseVisibleAssertion(action, resolvedTarget, resolvedExpectedValue) ? 'assertVisible' : action;
    const common = {
        action: effectiveAction,
        description: `${dataSet ? `[${dataSet.code}] ` : ''}${step.description || ''}`.trim() || undefined,
    };
    if (effectiveAction === 'goto') {
        return {
            ...common,
            url: joinUrl(project.baseUrl, resolvedValue || resolvedTarget),
            backend: {
                testCaseStepId: step.id,
                testCaseId: step.testCaseId,
                testDataSetId: dataSet?.id,
                stepOrder: step.stepOrder,
                actionType: effectiveAction,
                target: resolvedTarget || null,
                value: resolvedValue || null,
                expectedValue: resolvedExpectedValue || null,
                externalPayment,
            },
        };
    }
    if (effectiveAction === 'assertUrlContains') {
        return {
            ...common,
            value: resolvedExpectedValue || resolvedValue || resolvedTarget,
            backend: {
                testCaseStepId: step.id,
                testCaseId: step.testCaseId,
                testDataSetId: dataSet?.id,
                stepOrder: step.stepOrder,
                actionType: effectiveAction,
                target: resolvedTarget || null,
                value: resolvedValue || null,
                expectedValue: resolvedExpectedValue || resolvedValue || resolvedTarget || null,
                externalPayment,
            },
        };
    }
    return {
        ...common,
        selector: resolvedTarget,
        value: effectiveAction === 'assertVisible' ? resolvedValue : resolvedExpectedValue || resolvedValue,
        backend: {
            testCaseStepId: step.id,
            testCaseId: step.testCaseId,
            testDataSetId: dataSet?.id,
            stepOrder: step.stepOrder,
            actionType: effectiveAction,
            target: resolvedTarget || null,
            value: resolvedValue || null,
            expectedValue: resolvedExpectedValue || null,
            externalPayment,
        },
    };
}
async function loadBackendTestCaseFlow(testCaseId, backendBaseUrl = DEFAULT_BACKEND_BASE_URL) {
    const testCase = await fetchJson(backendBaseUrl, `/test-cases/${testCaseId}`);
    const project = await fetchJson(backendBaseUrl, `/projects/${testCase.projectId}`);
    const [allSteps, allDataSets, allMappings] = await Promise.all([
        fetchJson(backendBaseUrl, '/test-case-steps'),
        fetchJson(backendBaseUrl, '/test-data-sets'),
        fetchJson(backendBaseUrl, '/test-case-data-sets'),
    ]);
    const caseSteps = allSteps
        .filter((step) => step.testCaseId === testCase.id)
        .sort((left, right) => left.stepOrder - right.stepOrder);
    const dataSets = allMappings
        .filter((mapping) => mapping.testCaseId === testCase.id)
        .map((mapping) => allDataSets.find((dataSet) => dataSet.id === mapping.testDataSetId))
        .filter((dataSet) => Boolean(dataSet));
    const steps = dataSets.length
        ? dataSets.flatMap((dataSet) => caseSteps.map((step) => mapBackendStep(step, project, dataSet)))
        : caseSteps.map((step) => mapBackendStep(step, project));
    return {
        name: dataSets.length > 1
            ? `${testCase.name || testCase.code || `Test case ${testCase.id}`} (${dataSets.length} data sets)`
            : testCase.name || testCase.code || `Test case ${testCase.id}`,
        description: testCase.description || undefined,
        targetUrl: project.baseUrl || undefined,
        backend: {
            projectId: project.id,
            testCaseId: testCase.id,
            testDataSetIds: dataSets.map((dataSet) => dataSet.id),
        },
        steps,
    };
}
async function loadBackendTestCaseFlows(testCaseIds, backendBaseUrl = DEFAULT_BACKEND_BASE_URL) {
    return Promise.all(testCaseIds.map((testCaseId) => loadBackendTestCaseFlow(testCaseId, backendBaseUrl)));
}
