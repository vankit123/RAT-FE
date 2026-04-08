import { expect, Page } from '@playwright/test';
import { resolveStepLocator } from '../../dashboard/selectorResolver';
import { Step } from './types';

function stepSelector(step: Step): string | undefined {
  return step.selector ?? step.target;
}

export async function executeAssertion(page: Page, step: Step, defaultTimeout = 10000) {
  const timeout = step.timeout ?? defaultTimeout;

  switch (step.action) {
    case 'assertVisible': {
      const selector = stepSelector(step);
      if (!selector) {
        throw new Error('assertVisible action requires selector');
      }

      await expect(await resolveStepLocator(page, selector, 'assertVisible')).toBeVisible({ timeout });
      return;
    }

    case 'assertText': {
      const selector = stepSelector(step);
      if (!selector) {
        throw new Error('assertText action requires selector');
      }
      if (selector.startsWith('kind=text::') && String(step.value || '').trim().toLowerCase() === 'visible') {
        await expect(await resolveStepLocator(page, selector, 'assertVisible')).toBeVisible({ timeout });
        return;
      }

      await expect(await resolveStepLocator(page, selector, 'assertVisible')).toContainText(step.value ?? '', {
        timeout,
      });
      return;
    }

    case 'assertUrlContains': {
      if (!step.value) {
        throw new Error('assertUrlContains action requires value');
      }

      await expect(page).toHaveURL(new RegExp(step.value), { timeout });
      return;
    }

    default:
      throw new Error(`Unsupported assertion action: ${step.action}`);
  }
}
