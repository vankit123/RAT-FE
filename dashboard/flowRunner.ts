import fs from 'fs/promises';
import path from 'path';
import { Locator, Page } from 'playwright';
import { FlowDefinition, FlowRunProgressEvent, FlowRunSummary, FlowStep } from './types';
import {
  applyExternalPaymentContext,
  ExternalPaymentRuntime,
  flowRequiresExternalPayment,
  inferExternalPaymentConfig,
  launchBrowserForFlow,
  runConfiguredExternalPayment,
  runExternalPaymentIfNeeded,
  shouldSkipHandledExternalPaymentStep,
} from './externalPayments/vnpayRunner';
import { parseSelectorHint, resolveStepLocator } from './selectorResolver';

const DEFAULT_TIMEOUT = 10000;
const STEP_SETTLE_MS = 250;
const RUN_FINISH_SETTLE_MS = 2000;

type IndexedStep = {
  step: FlowStep;
  index: number;
};

function formatRuntimeDataSetLabel(step: FlowStep | undefined, fallbackLabel: string): string {
  const code = String(step?.backend?.testDataSetCode || '').trim();
  const name = String(step?.backend?.testDataSetName || '').trim();
  if (code && name && code !== name) {
    return `${code} - ${name}`;
  }
  return name || code || fallbackLabel;
}

function buildRunId(prefix: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${prefix}-${stamp}-${suffix}`;
}

async function writeJson(filePath: string, data: unknown): Promise<void> {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function waitForVisibleText(page: Page, text: string, timeoutMs: number): Promise<boolean> {
  try {
    await page.waitForFunction(
      (expectedText: string) => {
        const normalizedExpected = expectedText.trim().toLowerCase();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);

        function normalizedVariants(value: string): string[] {
          const normalized = value.trim().toLowerCase().replace(/\s+/g, ' ');
          return [normalized, normalized.replace(/\s*\*\s*/g, ''), normalized.replace(/[:*]/g, '').trim()];
        }

        while (walker.nextNode()) {
          const node = walker.currentNode as HTMLElement;
          const nodeText = node.innerText?.trim();
          if (!nodeText) {
            continue;
          }

          const nodeMatches = normalizedVariants(nodeText).some((variant) => variant === normalizedExpected);
          if (!nodeMatches) continue;

          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          const visible =
            style.visibility !== 'hidden' &&
            style.display !== 'none' &&
            Number(style.opacity || '1') > 0 &&
            rect.width > 0 &&
            rect.height > 0;

          if (visible) {
            return true;
          }
        }

        return false;
      },
      text,
      { timeout: timeoutMs }
    );
    return true;
  } catch {
    return false;
  }
}

async function waitForUrlContains(page: Page, expectedValue: string, timeoutMs: number): Promise<void> {
  const pattern = new RegExp(expectedValue);
  await page.waitForFunction(
    (expectedPatternSource: string) => {
      try {
        return new RegExp(expectedPatternSource).test(window.location.href);
      } catch {
        return false;
      }
    },
    pattern.source,
    { timeout: timeoutMs }
  );
}

async function verifyFilledValue(locator: Locator, expectedValue: string): Promise<boolean> {
  try {
    return await locator.evaluate(
      (element, expected) =>
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement
          ? String(element.value ?? '') === expected
          : false,
      expectedValue
    );
  } catch {
    return false;
  }
}

async function isSelectLikeTrigger(locator: Locator): Promise<boolean> {
  try {
    return await locator.evaluate((element) => {
      if (!(element instanceof HTMLElement)) return false;
      const tagName = element.tagName.toLowerCase();
      const role = String(element.getAttribute('role') || '').toLowerCase();
      const ariaHasPopup = String(element.getAttribute('aria-haspopup') || '').toLowerCase();
      const dataSlot = String(element.getAttribute('data-slot') || '').toLowerCase();
      return (
        tagName === 'select' ||
        role === 'combobox' ||
        ariaHasPopup === 'listbox' ||
        dataSlot === 'select-trigger'
      );
    });
  } catch {
    return false;
  }
}

async function verifySelectLikeValue(locator: Locator, expectedValue: string, selectedLabel?: string): Promise<boolean> {
  try {
    return await locator.evaluate(
      (element, payload) => {
        if (!(element instanceof HTMLElement)) return false;
        const normalized = (value: string | null | undefined) =>
          String(value || '').trim().toLowerCase();

        const expected = normalized(payload.expected);
        const label = normalized(payload.label);
        const text = normalized(element.innerText || element.textContent || '');
        const rawValue =
          'value' in element ? normalized(String((element as HTMLInputElement | HTMLSelectElement).value || '')) : '';
        const ariaValue = normalized(element.getAttribute('aria-valuetext'));
        const dataValue = normalized(element.getAttribute('data-value'));

        return [text, rawValue, ariaValue, dataValue].some(
          (candidate) => candidate && (candidate === expected || (label && candidate === label)),
        );
      },
      { expected: expectedValue, label: selectedLabel || '' },
    );
  } catch {
    return false;
  }
}

async function isSelectLikeOpen(locator: Locator): Promise<boolean> {
  try {
    return await locator.evaluate((element) => {
      if (!(element instanceof HTMLElement)) return false;
      const ariaExpanded = String(element.getAttribute('aria-expanded') || '').toLowerCase();
      if (ariaExpanded === 'true') return true;

      const ariaControls = String(element.getAttribute('aria-controls') || '').trim();
      if (ariaControls) {
        const controlled = document.getElementById(ariaControls);
        if (controlled) {
          const visible = !!(controlled instanceof HTMLElement && (controlled.offsetParent || controlled.getClientRects().length));
          if (visible) return true;
        }
      }

      return false;
    });
  } catch {
    return false;
  }
}

async function fillSelectLikeValue(locator: Locator, value: string, timeoutMs: number): Promise<boolean> {
  const page = locator.page();
  const expectedValue = String(value ?? '').trim();
  if (!expectedValue) return false;

  const escaped = expectedValue.replace(/"/g, '\\"');
  const candidateLocators = [
    page.getByRole('option', { name: new RegExp(`^${expectedValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') }),
    page.locator(`[role="option"][data-value="${escaped}"]`),
    page.locator(`[role="option"][value="${escaped}"]`),
    page.locator(`[data-radix-collection-item][data-value="${escaped}"]`),
    page.locator(`[data-value="${escaped}"]`),
    page.getByText(new RegExp(`^${expectedValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i')),
  ];

  if (!(await isSelectLikeOpen(locator))) {
    try {
      await locator.click({ timeout: timeoutMs });
    } catch {
      return false;
    }
  }

  let selectedLabel = '';

  for (const candidate of candidateLocators) {
    const option = candidate.first();
    try {
      await option.waitFor({ state: 'visible', timeout: Math.min(timeoutMs, 2500) });
      selectedLabel = (await option.textContent())?.trim() || selectedLabel;
      await option.click({ timeout: timeoutMs });
      await page.waitForTimeout(STEP_SETTLE_MS);
      if (await verifySelectLikeValue(locator, expectedValue, selectedLabel)) {
        return true;
      }
    } catch {
      // try next option strategy
    }
  }

  try {
    const domSelected = await page.evaluate((expected) => {
      const normalize = (value: string | null | undefined) =>
        String(value || '')
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim()
          .toLowerCase();

      const normalizedExpected = normalize(expected);
      const candidates = Array.from(
        document.querySelectorAll(
          '[role="option"], [data-radix-collection-item], [data-slot="select-item"]',
        ),
      ) as HTMLElement[];

      const target = candidates.find((element) => {
        const text = normalize(element.innerText || element.textContent || '');
        const dataValue = normalize(element.getAttribute('data-value'));
        const valueAttr = normalize(element.getAttribute('value'));
        const visible = !!(
          element.offsetParent ||
          element.getClientRects().length
        );
        return (
          visible &&
          (text === normalizedExpected ||
            dataValue === normalizedExpected ||
            valueAttr === normalizedExpected)
        );
      });

      if (!target) {
        return false;
      }

      const pointerDown = new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        pointerType: 'mouse',
      });
      const mouseDown = new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
      });
      const click = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
      });

      target.dispatchEvent(pointerDown);
      target.dispatchEvent(mouseDown);
      target.click();
      target.dispatchEvent(click);
      return true;
    }, expectedValue);

    if (domSelected) {
      await page.waitForTimeout(STEP_SETTLE_MS);
      if (await verifySelectLikeValue(locator, expectedValue, selectedLabel)) {
        return true;
      }
    }
  } catch {
    // continue to final verification
  }

  return verifySelectLikeValue(locator, expectedValue, selectedLabel);
}

async function fillNativeInputValue(locator: Locator, value: string): Promise<boolean> {
  try {
    return await locator.evaluate((element, expectedValue) => {
      if (
        !(element instanceof HTMLInputElement) &&
        !(element instanceof HTMLTextAreaElement) &&
        !(element instanceof HTMLSelectElement)
      ) {
        return false;
      }

      const proto =
        element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : element instanceof HTMLSelectElement
            ? HTMLSelectElement.prototype
            : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
      if (!setter) {
        return false;
      }

      setter.call(element, expectedValue);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: expectedValue, inputType: 'insertText' }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));
      return String((element as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement).value ?? '') === expectedValue;
    }, value);
  } catch {
    return false;
  }
}

async function fillReadonlyDateProxy(locator: Locator, value: string): Promise<boolean> {
  try {
    return await locator.evaluate((element, expectedValue) => {
      if (!(element instanceof HTMLInputElement) || !element.readOnly) {
        return false;
      }

      const containers = [
        element.parentElement,
        element.closest('div'),
        element.closest('form'),
        element.closest('[role="dialog"]'),
      ].filter(Boolean) as HTMLElement[];

      const dateInput =
        containers
          .flatMap((container) => Array.from(container.querySelectorAll('input[type="date"]')))
          .find((input) => input instanceof HTMLInputElement) || null;

      if (!(dateInput instanceof HTMLInputElement)) {
        return false;
      }

      const inputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      if (!inputValueSetter) {
        return false;
      }

      // Use the native setter so controlled frameworks like React detect the update.
      inputValueSetter.call(dateInput, expectedValue);
      dateInput.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: expectedValue, inputType: 'insertText' }));
      dateInput.dispatchEvent(new Event('change', { bubbles: true }));
      dateInput.dispatchEvent(new Event('blur', { bubbles: true }));

      inputValueSetter.call(element, expectedValue);
      element.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: expectedValue, inputType: 'insertText' }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));

      return dateInput.value === expectedValue || element.value === expectedValue;
    }, value);
  } catch {
    return false;
  }
}

async function fillResolvedLocator(locator: Locator, value: string, timeoutMs: number): Promise<void> {
  const normalizedValue = String(value ?? '');

  await locator.waitFor({ state: 'visible', timeout: timeoutMs });

  if (await isSelectLikeTrigger(locator)) {
    if (await fillSelectLikeValue(locator, normalizedValue, timeoutMs)) {
      await locator.page().waitForTimeout(STEP_SETTLE_MS);
      return;
    }
  }

  if (await fillNativeInputValue(locator, normalizedValue)) {
    await locator.page().waitForTimeout(STEP_SETTLE_MS);
    return;
  }

  try {
    await locator.click({ timeout: timeoutMs });
  } catch {
    if ((await fillReadonlyDateProxy(locator, normalizedValue)) || (await fillNativeInputValue(locator, normalizedValue))) {
      await locator.page().waitForTimeout(STEP_SETTLE_MS);
      return;
    }
  }

  try {
    await locator.fill('', { timeout: timeoutMs });
    await locator.fill(normalizedValue, { timeout: timeoutMs });
  } catch {
    if ((await fillReadonlyDateProxy(locator, normalizedValue)) || (await fillNativeInputValue(locator, normalizedValue))) {
      return;
    }
  }

  if (await verifyFilledValue(locator, normalizedValue)) {
    await locator.page().waitForTimeout(STEP_SETTLE_MS);
    return;
  }

  try {
    await locator.click({ timeout: timeoutMs });
  } catch {
    if ((await fillReadonlyDateProxy(locator, normalizedValue)) || (await fillNativeInputValue(locator, normalizedValue))) {
      await locator.page().waitForTimeout(STEP_SETTLE_MS);
      return;
    }
  }
  try {
    await locator.pressSequentially(normalizedValue, { delay: 40, timeout: timeoutMs });
  } catch {
    if ((await fillReadonlyDateProxy(locator, normalizedValue)) || (await fillNativeInputValue(locator, normalizedValue))) {
      return;
    }
  }

  if (await verifyFilledValue(locator, normalizedValue)) {
    await locator.page().waitForTimeout(STEP_SETTLE_MS);
    return;
  }

  if ((await fillReadonlyDateProxy(locator, normalizedValue)) || (await fillNativeInputValue(locator, normalizedValue))) {
    await locator.page().waitForTimeout(STEP_SETTLE_MS);
    return;
  }

  throw new Error(`Filled field did not keep the expected value "${normalizedValue}".`);
}

async function settleHoverTarget(locator: Locator, timeoutMs: number): Promise<void> {
  try {
    await locator.evaluate(
      async (element, maxWaitMs) => {
        const target = element as HTMLElement;
        const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));
        const started = Date.now();
        const ariaControls = target.getAttribute('aria-controls');

        while (Date.now() - started < maxWaitMs) {
          const ariaExpanded = target.getAttribute('aria-expanded');
          if (ariaExpanded === 'true') {
            return;
          }

          if (ariaControls) {
            const controlled = document.getElementById(ariaControls);
            if (controlled) {
              const style = window.getComputedStyle(controlled);
              const rect = controlled.getBoundingClientRect();
              const visible =
                style.visibility !== 'hidden' &&
                style.display !== 'none' &&
                Number(style.opacity || '1') > 0 &&
                rect.width > 0 &&
                rect.height > 0;
              if (visible) {
                return;
              }
            }
          }

          await sleep(50);
        }
      },
      Math.min(timeoutMs, 1500)
    );
  } catch {
    // Best effort only. Some hover targets do not expose expansion state.
  }
}

async function dispatchSyntheticHover(locator: Locator): Promise<boolean> {
  try {
    return await locator.evaluate((element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const events = ['pointerover', 'mouseover', 'mouseenter'];
      for (const eventName of events) {
        element.dispatchEvent(
          new MouseEvent(eventName, {
            bubbles: true,
            cancelable: true,
            composed: true,
            view: window,
          }),
        );
      }

      return true;
    });
  } catch {
    return false;
  }
}

function canIgnoreHoverFailure(step: FlowStep, error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const selector = String(step.selector || '').trim().toLowerCase();

  return (
    message.includes('intercepts pointer events') ||
    message.includes('hover: timeout') ||
    selector.startsWith('#') ||
    selector.includes('combobox') ||
    selector.includes('roleName'.toLowerCase()) ||
    selector.includes('sex')
  );
}

async function isFormLikeHoverTarget(locator: Locator): Promise<boolean> {
  try {
    return await locator.evaluate((element) => {
      if (!(element instanceof HTMLElement)) {
        return false;
      }

      const tagName = element.tagName.toLowerCase();
      const role = String(element.getAttribute('role') || '').toLowerCase();
      const ariaHasPopup = String(element.getAttribute('aria-haspopup') || '').toLowerCase();
      const dataSlot = String(element.getAttribute('data-slot') || '').toLowerCase();

      return (
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select' ||
        role === 'combobox' ||
        role === 'textbox' ||
        ariaHasPopup === 'listbox' ||
        dataSlot === 'select-trigger'
      );
    });
  } catch {
    return false;
  }
}

async function executeStep(page: Page, step: FlowStep, timeoutMs: number): Promise<void> {
  switch (step.action) {
    case 'goto':
      if (!step.url) throw new Error('goto action requires url');
      await page.goto(step.url, { timeout: timeoutMs, waitUntil: 'domcontentloaded' });
      await page.waitForTimeout(STEP_SETTLE_MS);
      return;
    case 'waitForUrl':
      if (!step.value) throw new Error('waitForUrl action requires value');
      await page.waitForURL(new RegExp(step.value), { timeout: timeoutMs });
      await page.waitForTimeout(STEP_SETTLE_MS);
      return;
    case 'payViaVnpay':
      return;
    case 'click':
      if (!step.selector) throw new Error('click action requires selector');
      await (await resolveStepLocator(page, step.selector, 'click')).click({ timeout: timeoutMs });
      await page.waitForTimeout(STEP_SETTLE_MS);
      return;
    case 'hover':
      if (!step.selector) throw new Error('hover action requires selector');
      {
        const locator = await resolveStepLocator(page, step.selector, 'hover');
        if (await isFormLikeHoverTarget(locator)) {
          await page.waitForTimeout(STEP_SETTLE_MS);
          return;
        }
        await locator.scrollIntoViewIfNeeded().catch(() => undefined);
        try {
          await locator.hover({ timeout: timeoutMs });
        } catch (error) {
          const syntheticHoverWorked = await dispatchSyntheticHover(locator);
          if (!syntheticHoverWorked && !canIgnoreHoverFailure(step, error)) {
            throw error;
          }
        }
        await settleHoverTarget(locator, timeoutMs).catch(() => undefined);
        await page.waitForTimeout(Math.max(STEP_SETTLE_MS, 450));
      }
      return;
    case 'fill':
      if (!step.selector) throw new Error('fill action requires selector');
      await fillResolvedLocator(await resolveStepLocator(page, step.selector, 'fill'), String(step.value ?? ''), timeoutMs);
      return;
    case 'press':
      if (!step.selector) throw new Error('press action requires selector');
      await (await resolveStepLocator(page, step.selector, 'press')).press(step.value || 'Enter', { timeout: timeoutMs });
      await page.waitForTimeout(STEP_SETTLE_MS);
      return;
    case 'assertVisible':
      if (!step.selector) throw new Error('assertVisible action requires selector');
      try {
        await (await resolveStepLocator(page, step.selector, 'assertVisible')).waitFor({ state: 'visible', timeout: timeoutMs });
      } catch (error) {
        const parsedHint = parseSelectorHint(step.selector);
        if (
          ['text', 'button', 'link', 'auto'].includes(parsedHint.kind) &&
          parsedHint.value &&
          (await waitForVisibleText(page, parsedHint.value, timeoutMs))
        ) {
          return;
        }

        throw error;
      }
      return;
    case 'assertText':
      if (!step.selector) throw new Error('assertText action requires selector');
      if (!step.value) throw new Error('assertText action requires value');
      if (parseSelectorHint(step.selector).kind === 'text' && step.value.trim().toLowerCase() === 'visible') {
        await (await resolveStepLocator(page, step.selector, 'assertVisible')).waitFor({
          state: 'visible',
          timeout: timeoutMs,
        });
        return;
      }
      await (await resolveStepLocator(page, step.selector, 'assertVisible')).filter({ hasText: step.value }).waitFor({
        state: 'visible',
        timeout: timeoutMs,
      });
      return;
    case 'assertUrlContains':
      if (!step.value) throw new Error('assertUrlContains action requires value');
      await waitForUrlContains(page, step.value, timeoutMs);
      return;
    case 'waitFor':
      if (!step.selector) throw new Error('waitFor action requires selector');
      try {
        await (await resolveStepLocator(page, step.selector, 'waitFor')).waitFor({ state: 'visible', timeout: timeoutMs });
      } catch (error) {
        const parsedHint = parseSelectorHint(step.selector);
        if (
          ['text', 'button', 'link', 'auto'].includes(parsedHint.kind) &&
          parsedHint.value &&
          (await waitForVisibleText(page, parsedHint.value, timeoutMs))
        ) {
          return;
        }

        throw error;
      }
      return;
    default:
      throw new Error(`Unsupported action: ${String(step.action)}`);
  }
}

export async function runFlow(options: {
  prefix: string;
  flow: FlowDefinition;
  input?: unknown;
  headless?: boolean;
  onProgress?(event: FlowRunProgressEvent): void | Promise<void>;
  signal?: AbortSignal;
}): Promise<FlowRunSummary> {
  if (!options.flow.steps.length) {
    throw new Error('Flow requires at least one step.');
  }

  const runId = buildRunId(options.prefix);
  const runDir = path.join(process.cwd(), 'dashboard', 'artifacts', runId);
  await fs.mkdir(runDir, { recursive: true });

  const timeoutMs = Number(options.flow.timeoutMs) > 0 ? Number(options.flow.timeoutMs) : DEFAULT_TIMEOUT;
  const startedAt = new Date().toISOString();
  const steps: FlowRunSummary['steps'] = [];
  const dataSets: NonNullable<FlowRunSummary['dataSets']> = [];
  const shouldContinueAcrossDataSets = Boolean(options.flow.backend && options.flow.backend.testDataSetIds.length > 1);

  let currentUrl = '';
  let status: FlowRunSummary['status'] = 'passed';
  let errorMessage: string | null = null;
  let screenshotAbsolutePath: string | null = null;
  let videoAbsolutePath: string | null = null;
  const videoArtifacts: NonNullable<FlowRunSummary['artifacts']['videos']> = [];
  const started = Date.now();

  const browser = await launchBrowserForFlow(options.flow, options.headless);

  function throwIfAborted(): void {
    if (options.signal?.aborted) {
      throw new Error('Test run cancelled by user.');
    }
  }

  try {
    throwIfAborted();
    await options.onProgress?.({
      type: 'runStarted',
      runId,
      flowName: options.flow.name || 'Custom Flow',
    });

    async function runStepGroup(indexedSteps: IndexedStep[], groupNumber: number, totalGroups: number): Promise<void> {
      throwIfAborted();
      const dataSetId = indexedSteps[0]?.step.backend?.testDataSetId ?? null;
      const dataSetLabel = formatRuntimeDataSetLabel(
        indexedSteps[0]?.step,
        dataSetId ? `DataSet ${dataSetId}` : `Run ${groupNumber}`,
      );
      let groupStatus: 'passed' | 'failed' = 'passed';
      let groupErrorMessage: string | null = null;
      let executedStepCount = 0;
      let failedStepCount = 0;
      const runtime: ExternalPaymentRuntime = {
        externalPayment:
          indexedSteps.find((item) => item.step.backend?.externalPayment)?.step.backend?.externalPayment ||
          inferExternalPaymentConfig({
            ...options.flow,
            steps: indexedSteps.map((item) => item.step),
          }),
        externalPaymentHandled: false,
        explicitPaymentStepPresent: indexedSteps.some((item) => item.step.action === 'payViaVnpay'),
      };
      const groupStarted = Date.now();
      const context = await browser.newContext({
        ignoreHTTPSErrors: true,
        viewport: { width: 1440, height: 960 },
        recordVideo: {
          dir: runDir,
          size: { width: 1280, height: 720 },
        },
      });
      await applyExternalPaymentContext(context);

      const page = await context.newPage();
      const pageVideo = page.video();

      try {
        await options.onProgress?.({
          type: 'dataSetStarted',
          testDataSetId: dataSetId,
          label: dataSetLabel,
          groupIndex: groupNumber,
          totalGroups,
        });

        for (const [{ step, index }, stepIndex] of indexedSteps.map((item, itemIndex) => [item, itemIndex] as const)) {
          throwIfAborted();
          await runExternalPaymentIfNeeded(page, runtime, timeoutMs);
          const stepStarted = Date.now();
          const stepStartedAt = new Date().toISOString();
          const stepName = step.description || `${step.action} ${step.selector || step.url || ''}`.trim();

          if (shouldSkipHandledExternalPaymentStep(step, runtime)) {
            const skippedName = `${stepName} (bỏ qua, do VNPAY runner đã xử lý)`;
            steps.push({
              name: skippedName,
              status: 'passed',
              testDataSetId: dataSetId,
              dataSetLabel,
              flowStepIndex: index,
              startedAt: stepStartedAt,
              endedAt: new Date().toISOString(),
              durationMs: 0,
            });
            await options.onProgress?.({
              type: 'stepFinished',
              testDataSetId: dataSetId,
              groupIndex: groupNumber,
              stepIndex: stepIndex + 1,
              totalSteps: indexedSteps.length,
              flowStepIndex: index,
              name: skippedName,
              action: step.action,
              status: 'passed',
              durationMs: 0,
            });
            continue;
          }

          await options.onProgress?.({
            type: 'stepStarted',
            testDataSetId: dataSetId,
            groupIndex: groupNumber,
            stepIndex: stepIndex + 1,
            totalSteps: indexedSteps.length,
            flowStepIndex: index,
            name: stepName,
            action: step.action,
          });
          try {
            await executeStep(page, step, timeoutMs);
            if (step.action === 'payViaVnpay') {
              await runConfiguredExternalPayment(page, runtime, timeoutMs);
            }
            await runExternalPaymentIfNeeded(page, runtime, timeoutMs);
            steps.push({
              name: stepName,
              status: 'passed',
              testDataSetId: dataSetId,
              dataSetLabel,
              flowStepIndex: index,
              startedAt: stepStartedAt,
              endedAt: new Date().toISOString(),
              durationMs: Date.now() - stepStarted,
            });
            executedStepCount += 1;
            await options.onProgress?.({
              type: 'stepFinished',
              testDataSetId: dataSetId,
              groupIndex: groupNumber,
              stepIndex: stepIndex + 1,
              totalSteps: indexedSteps.length,
              flowStepIndex: index,
              name: stepName,
              action: step.action,
              status: 'passed',
              durationMs: Date.now() - stepStarted,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            groupStatus = 'failed';
            groupErrorMessage ??= message;

            steps.push({
              name: stepName,
              status: 'failed',
              testDataSetId: dataSetId,
              dataSetLabel,
              flowStepIndex: index,
              startedAt: stepStartedAt,
              endedAt: new Date().toISOString(),
              durationMs: Date.now() - stepStarted,
              error: message,
            });
            executedStepCount += 1;
            failedStepCount += 1;
            await options.onProgress?.({
              type: 'stepFinished',
              testDataSetId: dataSetId,
              groupIndex: groupNumber,
              stepIndex: stepIndex + 1,
              totalSteps: indexedSteps.length,
              flowStepIndex: index,
              name: stepName,
              action: step.action,
              status: 'failed',
              durationMs: Date.now() - stepStarted,
              error: message,
            });

            status = 'failed';
            errorMessage ??= message;

            if (!screenshotAbsolutePath) {
              screenshotAbsolutePath = path.join(runDir, 'failure.png');
              try {
                await page.screenshot({ path: screenshotAbsolutePath, fullPage: true });
              } catch {
                screenshotAbsolutePath = null;
              }
            }

            // A failing data set should not block the next data set, but the
            // remaining steps for this data set are no longer reliable.
            break;
          }
        }
      } finally {
        dataSets.push({
          testDataSetId: dataSetId,
          label: dataSetLabel,
          status: groupStatus,
          durationMs: Date.now() - groupStarted,
          stepCount: indexedSteps.length,
          executedStepCount,
          failedStepCount,
          errorMessage: groupErrorMessage,
        });
        await options.onProgress?.({
          type: 'dataSetFinished',
          testDataSetId: dataSetId,
          label: dataSetLabel,
          groupIndex: groupNumber,
          totalGroups,
          status: groupStatus,
        });
        await page.waitForTimeout(RUN_FINISH_SETTLE_MS).catch(() => undefined);
        currentUrl = page.url();
        await page.close().catch(() => undefined);
        try {
          const groupVideoPath = (await pageVideo?.path()) ?? null;
          if (groupVideoPath) {
            videoAbsolutePath = groupVideoPath;
            videoArtifacts.push({
              absolutePath: groupVideoPath,
              url: `/artifacts/${runId}/${path.basename(groupVideoPath)}`,
              testDataSetId: dataSetId,
              label: dataSetLabel,
            });
          }
        } catch {
          videoAbsolutePath = videoAbsolutePath ?? null;
        }
        await context.close().catch(() => undefined);
      }
    }

    const indexedSteps = options.flow.steps.map((step, index) => ({ step, index }));
    const stepGroups = shouldContinueAcrossDataSets
      ? Array.from(
          indexedSteps
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
        )
      : [indexedSteps];

    for (const [groupIndex, stepGroup] of stepGroups.entries()) {
      throwIfAborted();
      await runStepGroup(stepGroup, groupIndex + 1, stepGroups.length);
    }
  } finally {
    await browser.close().catch(() => undefined);
  }

  const summary: FlowRunSummary = {
    runId,
    startedAt,
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    status,
    currentUrl,
    targetUrl: options.flow.targetUrl || options.flow.steps[0]?.url || '',
    errorMessage,
    flowName: options.flow.name || 'Custom Flow',
    steps,
    dataSets,
    artifacts: {
      screenshot: screenshotAbsolutePath
        ? {
            absolutePath: screenshotAbsolutePath,
            url: `/artifacts/${runId}/failure.png`,
          }
        : null,
      video: videoAbsolutePath
        ? {
            absolutePath: videoAbsolutePath,
            url: `/artifacts/${runId}/${path.basename(videoAbsolutePath)}`,
            label: 'Latest video',
          }
        : null,
      videos: videoArtifacts,
    },
    input: options.input ?? null,
  };

  await writeJson(path.join(runDir, 'summary.json'), summary);
  await options.onProgress?.({
    type: 'runFinished',
    runId,
    status,
  });
  return summary;
}
