"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.flowRequiresExternalPayment = flowRequiresExternalPayment;
exports.inferExternalPaymentConfig = inferExternalPaymentConfig;
exports.shouldSkipHandledExternalPaymentStep = shouldSkipHandledExternalPaymentStep;
exports.applyExternalPaymentContext = applyExternalPaymentContext;
exports.launchBrowserForFlow = launchBrowserForFlow;
exports.runExternalPaymentIfNeeded = runExternalPaymentIfNeeded;
exports.runConfiguredExternalPayment = runConfiguredExternalPayment;
const playwright_1 = require("playwright");
const STEP_SETTLE_MS = 250;
const VNPAY_HOST_PATTERN = /sandbox\.vnpayment\.vn/i;
const VNPAY_PAYMENT_METHOD_PATTERN = /sandbox\.vnpayment\.vn\/paymentv2\/Transaction\/PaymentMethod\.html/i;
const MANUAL_PAYMENT_TIMEOUT_MS = 3 * 60 * 1000;
const VNPAY_STEP_KEYWORDS = [
    'sandbox.vnpayment.vn',
    'paymentv2/vpcpay.html',
    'paymentmethod.html',
    'thẻ nội địa',
    'tai khoan ngan hang',
    'tài khoản ngân hàng',
    'paymethod',
    'bankcode',
    'cardholder',
    'cardDate',
    'carddate',
    'card_date',
    'cardholdername',
    'card_holder',
    'card_holder_name',
    'cardnumber',
    'card_number',
    'issue date',
    'issuedate',
    'ngay phat hanh',
    'ngày phát hành',
    'số thẻ',
    'ten chu the',
    'tên chủ thẻ',
    'otp',
    'đồng ý',
    'tiếp tục',
    'thanh toán',
    'btncontinue',
    'btnpayment',
    'btnconfirm',
    'vnp_',
];
const VNPAY_FIELD_PATTERN = /(?:^|[^a-z])(paymethod|bankcode|carddate|card_date|cardholder|cardholdername|card_holder|card_holder_name|cardnumber|card_number|issuedate|issue_date|otp|btncontinue|btnpayment|btnconfirm)(?:[^a-z]|$)/i;
function stepLooksLikeVnpay(step) {
    const stepTexts = [
        step.url,
        step.selector,
        step.value,
        step.description,
        step.backend?.target,
        step.backend?.value,
        step.backend?.expectedValue,
        step.backend?.actionType,
    ];
    return stepTexts.some((text) => {
        const normalizedText = String(text || '');
        return VNPAY_FIELD_PATTERN.test(normalizedText) || VNPAY_STEP_KEYWORDS.some((keyword) => normalizedIncludes(normalizedText, keyword));
    });
}
function firstExternalPaymentConfig(steps) {
    return steps.find((step) => step.backend?.externalPayment)?.backend?.externalPayment || null;
}
function flowRequiresExternalPayment(flow) {
    return Boolean(firstExternalPaymentConfig(flow.steps)) || flow.steps.some((step) => stepLooksLikeVnpay(step));
}
function inferExternalPaymentConfig(flow) {
    const configured = firstExternalPaymentConfig(flow.steps);
    if (configured) {
        return configured;
    }
    if (!flow.steps.some((step) => stepLooksLikeVnpay(step))) {
        return null;
    }
    return {
        provider: 'vnpay',
        mode: 'manual-complete',
    };
}
function manualPaymentTimeout(config, timeoutMs) {
    return Math.max(config?.timeoutMs || 0, timeoutMs, MANUAL_PAYMENT_TIMEOUT_MS);
}
function sanitizeExternalPayment(config) {
    return {
        provider: 'vnpay',
        // Keep VNPAY sandbox in manual mode so the browser shows a single,
        // user-driven payment flow instead of a competing automation flow.
        mode: 'manual-complete',
        bankText: String(config.bankText || '').trim() || undefined,
        bankSelector: String(config.bankSelector || '').trim() || undefined,
        cardNumber: String(config.cardNumber || '').trim() || undefined,
        cardHolderName: String(config.cardHolderName || '').trim() || undefined,
        issueDate: String(config.issueDate || '').trim() || undefined,
        otp: String(config.otp || '').trim() || undefined,
        returnUrl: String(config.returnUrl || '').trim() || undefined,
        timeoutMs: config.timeoutMs && Number.isFinite(config.timeoutMs) ? config.timeoutMs : undefined,
    };
}
function normalizedIncludes(haystack, needle) {
    return String(haystack || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .includes(needle
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, ''));
}
function shouldSkipHandledExternalPaymentStep(step, runtime) {
    if (!runtime.externalPaymentHandled || !runtime.externalPayment) {
        return false;
    }
    const config = sanitizeExternalPayment(runtime.externalPayment);
    const stepTexts = [
        step.url,
        step.selector,
        step.value,
        step.description,
        step.backend?.target,
        step.backend?.value,
        step.backend?.expectedValue,
    ];
    const dynamicKeywords = [config.bankText, config.bankSelector].filter(Boolean);
    const allKeywords = [...VNPAY_STEP_KEYWORDS, ...dynamicKeywords];
    return stepTexts.some((text) => {
        const normalizedText = String(text || '');
        return VNPAY_FIELD_PATTERN.test(normalizedText) || allKeywords.some((keyword) => normalizedIncludes(normalizedText, keyword));
    });
}
async function executeExternalPayment(page, runtime, timeoutMs) {
    if (runtime.externalPaymentHandled || !runtime.externalPayment)
        return;
    const config = sanitizeExternalPayment(runtime.externalPayment);
    if (!isVnpayUrl(page.url()))
        return;
    if (config.mode === 'manual-complete') {
        runtime.externalPaymentHandled = true;
        await waitForManualVnpayCompletion(page, config, timeoutMs, 'Flow dang o che do manual-complete cho VNPAY.');
        return;
    }
    try {
        if (await isVnpayForbidden(page)) {
            throw new Error('VNPAY tra ve 403 Forbidden cho browser automation.');
        }
        await runVnpayAutoFlow(page, config, timeoutMs);
        runtime.externalPaymentHandled = true;
    }
    catch (error) {
        runtime.externalPaymentHandled = true;
        await waitForManualVnpayCompletion(page, { ...config, mode: 'manual-complete' }, timeoutMs, `VNPAY auto-fill khong the tiep tuc.${error instanceof Error ? ` ${error.message}` : ''}`);
    }
}
function isVnpayUrl(url) {
    return VNPAY_HOST_PATTERN.test(url);
}
async function applyExternalPaymentContext(context) {
    await context.addInitScript(() => {
        Object.defineProperty(navigator, 'webdriver', {
            configurable: true,
            get: () => undefined,
        });
        Object.defineProperty(navigator, 'languages', {
            configurable: true,
            get: () => ['vi-VN', 'vi', 'en-US', 'en'],
        });
        Object.defineProperty(navigator, 'plugins', {
            configurable: true,
            get: () => [1, 2, 3, 4],
        });
        const chromeLike = window.chrome || {};
        window.chrome = {
            ...chromeLike,
            runtime: chromeLike.runtime || {},
        };
    });
}
async function launchBrowserForFlow(flow, requestedHeadless) {
    if (!flowRequiresExternalPayment(flow)) {
        return playwright_1.chromium.launch({
            headless: requestedHeadless !== false,
        });
    }
    const paymentLaunchArgs = ['--disable-blink-features=AutomationControlled'];
    try {
        return await playwright_1.chromium.launch({
            headless: false,
            channel: 'chrome',
            args: paymentLaunchArgs,
        });
    }
    catch {
        return playwright_1.chromium.launch({
            headless: false,
            args: paymentLaunchArgs,
        });
    }
}
async function waitForAnyVisibleLocator(page, candidates, timeoutMs, description) {
    const started = Date.now();
    let lastError;
    while (Date.now() - started < timeoutMs) {
        for (const candidate of candidates) {
            const first = candidate.first();
            try {
                if ((await first.count()) < 1)
                    continue;
                await first.waitFor({ state: 'visible', timeout: Math.min(800, timeoutMs) });
                return first;
            }
            catch (error) {
                lastError = error;
            }
        }
        await page.waitForTimeout(200);
    }
    throw new Error(lastError instanceof Error ? lastError.message : `Could not find a visible ${description}.`);
}
async function readBodyText(page) {
    try {
        return await page.locator('body').innerText({ timeout: 1000 });
    }
    catch {
        return '';
    }
}
async function isVnpayForbidden(page) {
    if (!isVnpayUrl(page.url()))
        return false;
    const bodyText = (await readBodyText(page)).toLowerCase();
    return bodyText.includes('403') || bodyText.includes('forbidden') || bodyText.includes('access denied');
}
async function verifyFilledValue(locator, expectedValue) {
    try {
        return await locator.evaluate((element, expected) => element instanceof HTMLInputElement ||
            element instanceof HTMLTextAreaElement ||
            element instanceof HTMLSelectElement
            ? String(element.value ?? '') === expected
            : false, expectedValue);
    }
    catch {
        return false;
    }
}
async function fillNativeInputValue(locator, value) {
    try {
        return await locator.evaluate((element, expectedValue) => {
            if (!(element instanceof HTMLInputElement) &&
                !(element instanceof HTMLTextAreaElement) &&
                !(element instanceof HTMLSelectElement)) {
                return false;
            }
            const proto = element instanceof HTMLTextAreaElement
                ? HTMLTextAreaElement.prototype
                : element instanceof HTMLSelectElement
                    ? HTMLSelectElement.prototype
                    : HTMLInputElement.prototype;
            const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
            if (!setter)
                return false;
            setter.call(element, expectedValue);
            element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: expectedValue, inputType: 'insertText' }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
            element.dispatchEvent(new Event('blur', { bubbles: true }));
            return String(element.value ?? '') === expectedValue;
        }, value);
    }
    catch {
        return false;
    }
}
async function fillResolvedLocator(locator, value, timeoutMs) {
    const normalizedValue = String(value ?? '');
    await locator.waitFor({ state: 'visible', timeout: timeoutMs });
    if (await fillNativeInputValue(locator, normalizedValue)) {
        await locator.page().waitForTimeout(STEP_SETTLE_MS);
        return;
    }
    await locator.click({ timeout: timeoutMs }).catch(() => undefined);
    try {
        await locator.fill(normalizedValue, { timeout: timeoutMs });
    }
    catch {
        if (await fillNativeInputValue(locator, normalizedValue)) {
            await locator.page().waitForTimeout(STEP_SETTLE_MS);
            return;
        }
    }
    if (await verifyFilledValue(locator, normalizedValue)) {
        await locator.page().waitForTimeout(STEP_SETTLE_MS);
        return;
    }
    if (await fillNativeInputValue(locator, normalizedValue)) {
        await locator.page().waitForTimeout(STEP_SETTLE_MS);
        return;
    }
    throw new Error(`Filled field did not keep the expected value "${normalizedValue}".`);
}
async function waitForManualVnpayCompletion(page, config, timeoutMs, reason) {
    const effectiveTimeout = manualPaymentTimeout(config, timeoutMs);
    const returnUrl = String(config.returnUrl || '').trim();
    try {
        await page.waitForURL((url) => {
            const current = url.toString();
            if (!isVnpayUrl(current))
                return true;
            if (returnUrl && current.startsWith(returnUrl))
                return true;
            return false;
        }, { timeout: effectiveTimeout });
    }
    catch (error) {
        throw new Error(`${reason} Vui lòng hoàn tất thanh toán thủ công trong cửa sổ Chrome đang mở. Hệ thống đã chờ ${Math.round(effectiveTimeout / 1000)} giây nhưng vẫn chưa rời khỏi VNPAY.${error instanceof Error ? ` ${error.message}` : ''}`);
    }
}
function missingVnpayFields(config) {
    const required = [
        ['bankText', 'bankText'],
        ['cardNumber', 'cardNumber'],
        ['cardHolderName', 'cardHolderName'],
        ['issueDate', 'issueDate'],
        ['otp', 'otp'],
    ];
    return required.filter(([key]) => !String(config[key] || '').trim()).map(([, label]) => label);
}
async function selectVnpayBank(page, config, timeoutMs) {
    const candidates = [];
    if (config.bankSelector)
        candidates.push(page.locator(config.bankSelector));
    if (config.bankText) {
        candidates.push(page.getByText(config.bankText, { exact: false }));
        candidates.push(page.getByRole('button', { name: new RegExp(config.bankText, 'i') }));
        candidates.push(page.getByRole('link', { name: new RegExp(config.bankText, 'i') }));
    }
    const target = await waitForAnyVisibleLocator(page, candidates, timeoutMs, 'VNPAY bank selector');
    await target.click({ timeout: timeoutMs });
}
async function runVnpayAutoFlow(page, config, timeoutMs) {
    const missing = missingVnpayFields(config);
    if (missing.length) {
        throw new Error(`Thiếu cấu hình VNPAY auto-fill: ${missing.join(', ')}.`);
    }
    await page.waitForURL(VNPAY_PAYMENT_METHOD_PATTERN, { timeout: Math.max(timeoutMs, 60000) });
    await selectVnpayBank(page, config, timeoutMs);
    const cardNumberInput = await waitForAnyVisibleLocator(page, [
        page.getByRole('textbox', { name: /Số thẻ/i }),
        page.locator('input[name="card_number"], #card_number, input[placeholder*="Số thẻ" i]'),
    ], timeoutMs, 'VNPAY card number input');
    await fillResolvedLocator(cardNumberInput, config.cardNumber || '', timeoutMs);
    const cardHolderInput = await waitForAnyVisibleLocator(page, [
        page.getByRole('textbox', { name: /Tên chủ thẻ/i }),
        page.locator('input[name="cardHolderName"], #cardHolderName, input[placeholder*="Tên chủ thẻ" i]'),
    ], timeoutMs, 'VNPAY card holder input');
    await fillResolvedLocator(cardHolderInput, config.cardHolderName || '', timeoutMs);
    const issueDateInput = await waitForAnyVisibleLocator(page, [
        page.getByRole('textbox', { name: /Ngày phát hành/i }),
        page.locator('input[name="issueDate"], #issueDate, input[placeholder*="Ngày phát hành" i]'),
    ], timeoutMs, 'VNPAY issue date input');
    await fillResolvedLocator(issueDateInput, config.issueDate || '', timeoutMs);
    const continueButton = await waitForAnyVisibleLocator(page, [
        page.locator('#btnContinue'),
        page.getByRole('button', { name: /Tiếp tục|Continue/i }),
        page.getByRole('link', { name: /Đồng ý\s*&\s*Tiếp tục/i }),
    ], timeoutMs, 'VNPAY continue button');
    await continueButton.click({ timeout: timeoutMs });
    const agreeLink = await waitForAnyVisibleLocator(page, [
        page.getByRole('link', { name: /Đồng ý\s*&\s*Tiếp tục/i }),
        page.getByRole('button', { name: /Đồng ý\s*&\s*Tiếp tục/i }),
    ], timeoutMs, 'VNPAY agree link');
    await agreeLink.click({ timeout: timeoutMs });
    const otpInput = await waitForAnyVisibleLocator(page, [
        page.getByPlaceholder(/OTP/i),
        page.getByRole('textbox', { name: /OTP/i }),
        page.locator('input[name="otp"], #otp, input[placeholder*="OTP" i]'),
    ], timeoutMs, 'VNPAY OTP input');
    await fillResolvedLocator(otpInput, config.otp || '', timeoutMs);
    const payButton = await waitForAnyVisibleLocator(page, [
        page.getByRole('button', { name: /Thanh toán|Pay/i }),
        page.locator('button[type="submit"], #btnConfirm, #btnPayment'),
    ], timeoutMs, 'VNPAY pay button');
    await payButton.click({ timeout: timeoutMs });
    await waitForManualVnpayCompletion(page, config, timeoutMs, 'Da gui thong tin VNPAY xong.');
}
async function runExternalPaymentIfNeeded(page, runtime, timeoutMs) {
    if (runtime.explicitPaymentStepPresent)
        return;
    await executeExternalPayment(page, runtime, timeoutMs);
}
async function runConfiguredExternalPayment(page, runtime, timeoutMs) {
    await executeExternalPayment(page, runtime, timeoutMs);
}
