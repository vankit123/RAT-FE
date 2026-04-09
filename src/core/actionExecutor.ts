import { Locator, Page } from '@playwright/test';
import { executeAssertion } from './assertionExecutor';
import { resolveStepLocator } from '../../dashboard/selectorResolver';
import { Step } from './types';

const assertionActions = new Set(['assertVisible', 'assertText', 'assertUrlContains']);
const DEFAULT_TIMEOUT = 10000;

function stepSelector(step: Step): string | undefined {
  return step.selector ?? step.target;
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

async function fillSelectLikeValue(locator: Locator, value: string, timeout: number): Promise<boolean> {
  const page = locator.page();
  const expectedValue = String(value ?? '').trim();
  if (!expectedValue) return false;

  const escaped = expectedValue.replace(/"/g, '\\"');
  const safeRegex = new RegExp(`^${expectedValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const candidateLocators = [
    page.getByRole('option', { name: safeRegex }),
    page.locator(`[role="option"][data-value="${escaped}"]`),
    page.locator(`[role="option"][value="${escaped}"]`),
    page.locator(`[data-radix-collection-item][data-value="${escaped}"]`),
    page.locator(`[data-value="${escaped}"]`),
    page.getByText(safeRegex),
  ];

  if (!(await isSelectLikeOpen(locator))) {
    try {
      await locator.click({ timeout });
    } catch {
      return false;
    }
  }

  let selectedLabel = '';

  for (const candidate of candidateLocators) {
    const option = candidate.first();
    try {
      await option.waitFor({ state: 'visible', timeout: Math.min(timeout, 2500) });
      selectedLabel = (await option.textContent())?.trim() || selectedLabel;
      await option.click({ timeout });
      await page.waitForTimeout(250);
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
        const visible = !!(element.offsetParent || element.getClientRects().length);
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
      await page.waitForTimeout(250);
      if (await verifySelectLikeValue(locator, expectedValue, selectedLabel)) {
        return true;
      }
    }
  } catch {
    // continue to final verification
  }

  return verifySelectLikeValue(locator, expectedValue, selectedLabel);
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

export async function executeStep(page: Page, step: Step, defaultTimeout = DEFAULT_TIMEOUT) {
  const timeout = step.timeout ?? defaultTimeout;

  if (assertionActions.has(step.action)) {
    await executeAssertion(page, step, timeout);
    return;
  }

  switch (step.action) {
    case 'goto': {
      const url = step.url ?? step.value;
      if (!url) {
        throw new Error('goto action requires url');
      }
      await page.goto(url, { timeout });
      return;
    }

    case 'waitForUrl': {
      if (!step.value) {
        throw new Error('waitForUrl action requires value');
      }
      await page.waitForURL(new RegExp(step.value), { timeout });
      return;
    }

    case 'payViaVnpay': {
      throw new Error('payViaVnpay is supported in the dashboard runner. Run this flow from RAT-FE dashboard to use VNPAY automation.');
    }

    case 'click': {
      const selector = stepSelector(step);
      if (!selector) {
        throw new Error('click action requires selector');
      }

      await (await resolveStepLocator(page, selector, 'click')).click({ timeout });
      return;
    }

    case 'hover': {
      const selector = stepSelector(step);
      if (!selector) {
        throw new Error('hover action requires selector');
      }

      const locator = await resolveStepLocator(page, selector, 'hover');
      await locator.scrollIntoViewIfNeeded().catch(() => undefined);
      await locator.hover({ timeout });
      await settleHoverTarget(locator, timeout);
      await page.waitForTimeout(450);
      return;
    }

    case 'fill': {
      const selector = stepSelector(step);
      if (!selector) {
        throw new Error('fill action requires selector');
      }

      const locator = await resolveStepLocator(page, selector, 'fill');
      const normalizedValue = step.value ?? '';
      if (await isSelectLikeTrigger(locator)) {
        if (await fillSelectLikeValue(locator, normalizedValue, timeout)) {
          await page.waitForTimeout(250);
          return;
        }
      }
      if (await fillNativeInputValue(locator, normalizedValue)) {
        await page.waitForTimeout(250);
        return;
      }
      try {
        await locator.fill(normalizedValue, { timeout });
      } catch (error) {
        if (await fillNativeInputValue(locator, normalizedValue)) {
          await page.waitForTimeout(250);
          return;
        }
        throw error;
      }
      return;
    }

    case 'press': {
      const selector = stepSelector(step);
      if (!selector) {
        throw new Error('press action requires selector');
      }

      await (await resolveStepLocator(page, selector, 'press')).press(step.value ?? 'Enter', { timeout });
      return;
    }

    case 'waitFor': {
      const selector = stepSelector(step);
      if (!selector) {
        throw new Error('waitFor action requires selector');
      }

      await (await resolveStepLocator(page, selector, 'waitFor')).waitFor({ state: 'visible', timeout });
      return;
    }

    default:
      throw new Error(`Unsupported action: ${step.action}`);
  }
}
