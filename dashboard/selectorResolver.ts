import { Locator, Page } from 'playwright';

type SelectorIntent = 'fill' | 'click' | 'hover' | 'assertVisible' | 'waitFor' | 'press';
type SelectorKind = 'auto' | 'text' | 'button' | 'link' | 'label' | 'placeholder' | 'css' | 'option';
const RESOLVE_TIMEOUT_MS = 10000;
const RESOLVE_POLL_MS = 150;

interface ParsedHint {
  kind: SelectorKind;
  value: string;
}

function escapeForAttribute(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizeAsciiToken(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function normalizeHint(value: string): string {
  return value.trim();
}

function looksLikeSelectorExpression(value: string): boolean {
  const normalized = value.trim();
  if (!normalized) return false;

  return /^(css=|xpath=|\/\/|\.?\/\/|text=|id=|role=)/i.test(normalized) || /[#.[\]>:+~*]/.test(normalized);
}

function unescapeCssIdentifier(value: string): string {
  return value.replaceAll('\\:', ':').replaceAll('\\\\', '\\');
}

function buildDynamicIdFallbackCandidates(page: Page, selector: string): Locator[] {
  const normalized = selector.trim();
  const matchedId = /^#(.+)$/.exec(normalized);
  if (!matchedId) return [];

  const rawId = unescapeCssIdentifier(matchedId[1]);
  const radixMatch = /^radix-:[^:]+:-(trigger|content)-(.+)$/i.exec(rawId);
  if (!radixMatch) return [];

  const part = radixMatch[1].toLowerCase();
  const value = radixMatch[2].trim();
  const hintRegex = new RegExp(escapeForRegex(value), 'i');
  const escapedSuffix = escapeForAttribute(`-${part}-${value}`);
  const escapedRawId = escapeForAttribute(rawId);
  const titledValue = value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
  const titledRegex = titledValue ? new RegExp(escapeForRegex(titledValue), 'i') : hintRegex;

  return [
    page.locator(`[aria-controls="${escapedRawId}"]`),
    page.locator(`[data-value="${escapeForAttribute(value)}"]`),
    page.locator(`[value="${escapeForAttribute(value)}"]`),
    page.locator(`[id$="${escapedSuffix}"]`),
    page.getByRole('tab', { name: hintRegex }),
    page.getByRole('tab', { name: titledRegex }),
    page.getByRole('button', { name: hintRegex }),
    page.getByRole('button', { name: titledRegex }),
    page.getByText(hintRegex),
    page.getByText(titledRegex),
  ];
}

export function parseSelectorHint(value: string): ParsedHint {
  const normalized = normalizeHint(value);
  const matched = /^kind=(auto|text|button|link|label|placeholder|css|option)::([\s\S]*)$/i.exec(normalized);

  if (!matched) {
    return { kind: 'auto', value: normalized };
  }

  return {
    kind: matched[1].toLowerCase() as SelectorKind,
    value: normalizeHint(matched[2]),
  };
}

function buildSemanticSelectors(hint: string): string[] {
  const lowerHint = hint.toLowerCase();

  if (['email', 'e-mail', 'username', 'user', 'ten tai khoan', 'tai khoan', 'tên tài khoản'].includes(lowerHint)) {
    return [
      'input[type="email"]',
      'input[name*="email" i]',
      'input[id*="email" i]',
      'input[name*="user" i]',
      'input[id*="user" i]',
      'input[autocomplete="username"]',
      'input:not([type="hidden"])',
    ];
  }

  if (['password', 'mat khau', 'mật khẩu', 'pass'].includes(lowerHint)) {
    return [
      'input[type="password"]',
      'input[name*="password" i]',
      'input[id*="password" i]',
      'input[autocomplete="current-password"]',
    ];
  }

  if (['search', 'keyword', 'tu khoa', 'từ khóa', 'tim kiem', 'tìm kiếm'].includes(lowerHint)) {
    return [
      'input[type="search"]',
      'input[name*="search" i]',
      'input[id*="search" i]',
      'input[placeholder*="search" i]',
      'input[placeholder*="tim" i]',
    ];
  }

  return [];
}

function buildClickSemanticSelectors(hint: string): string[] {
  const lowerHint = hint.toLowerCase();

  if (['submit', 'login', 'log in', 'sign in', 'dang nhap', 'đăng nhập'].includes(lowerHint)) {
    return [
      'button[type="submit"]',
      'input[type="submit"]',
      '#submit',
      '[id="submit"]',
      '[name="submit"]',
      'button[id*="submit" i]',
      'button[name*="submit" i]',
      'button[id*="login" i]',
      'button[name*="login" i]',
    ];
  }

  return [];
}

function expandMeaningTokens(hint: string): string[] {
  const normalized = normalizeAsciiToken(hint);
  const tokens = new Set<string>([normalized]);

  if (normalized === 'tuan') tokens.add('week');
  if (normalized === 'ngay') tokens.add('day');
  if (normalized === 'thang') tokens.add('month');
  if (normalized === 'nam') tokens.add('year');
  if (normalized === 'sang') tokens.add('morning');
  if (normalized === 'chieu') tokens.add('afternoon');
  if (normalized === 'toi') tokens.add('evening');

  return Array.from(tokens).filter(Boolean);
}

function buildMeaningAttributeCandidates(page: Page, hint: string): Locator[] {
  const tokens = expandMeaningTokens(hint);
  const selectors: string[] = [];

  for (const token of tokens) {
    const escapedToken = escapeForAttribute(token);
    selectors.push(
      `[data-testid="${escapedToken}"]`,
      `[data-testid*="${escapedToken}" i]`,
      `[data-value="${escapedToken}"]`,
      `[value="${escapedToken}"]`,
      `[aria-label="${escapedToken}"]`,
      `[title="${escapedToken}"]`,
      `[name="${escapedToken}"]`,
      `[id*="${escapedToken}" i]`,
      `[class*="${escapedToken}" i]`,
      `[data-state*="${escapedToken}" i]`
    );
  }

  return selectors.map((selector) => page.locator(selector));
}

function buildGenericClickTextCandidates(page: Page, hintRegex: RegExp, exactHint: string): Locator[] {
  const escapedXPathText = exactHint.replaceAll('"', '\\"');

  return [
    ...buildMeaningAttributeCandidates(page, exactHint),
    page.locator('[class*="cursor-pointer"]').filter({ hasText: hintRegex }),
    page.locator('[onclick]').filter({ hasText: hintRegex }),
    page.locator('[data-state]').filter({ hasText: hintRegex }),
    page.locator('[aria-controls]').filter({ hasText: hintRegex }),
    page.locator(
      `xpath=//*[normalize-space(.)="${escapedXPathText}"]/ancestor-or-self::*[
        self::button or self::a or @role="button" or @role="tab" or @onclick or contains(@class,"cursor-pointer")
      ][1]`
    ),
    page.locator(
      `xpath=//*[contains(normalize-space(.), "${escapedXPathText}")]/ancestor-or-self::*[
        self::button or self::a or @role="button" or @role="tab" or @onclick or contains(@class,"cursor-pointer")
      ][1]`
    ),
    page.locator(
      `xpath=//*[normalize-space(.)="${escapedXPathText}"]`
    ),
    page.locator(
      `xpath=//*[contains(normalize-space(.), "${escapedXPathText}")]`
    ),
  ];
}

function buildFillCandidates(
  page: Page,
  hintRegex: RegExp,
  attributeHint: string,
  semanticLocators: Locator[],
  exactHint: string
): Locator[] {
  const inputTags = 'input, textarea, select';
  const interactiveInputXPath =
    'self::input[not(@type="hidden") and not(@aria-hidden="true") and not(@tabindex="-1")] or self::textarea[not(@aria-hidden="true") and not(@tabindex="-1")] or self::select[not(@aria-hidden="true") and not(@tabindex="-1")]';
  const attributeSelectors = {
    ariaLabel: `input[aria-label="${attributeHint}"], textarea[aria-label="${attributeHint}"], select[aria-label="${attributeHint}"]`,
    name: `input[name="${attributeHint}"], textarea[name="${attributeHint}"], select[name="${attributeHint}"]`,
    id: `input[id="${attributeHint}"], textarea[id="${attributeHint}"], select[id="${attributeHint}"]`,
    placeholder: `input[placeholder="${attributeHint}"], textarea[placeholder="${attributeHint}"], select[placeholder="${attributeHint}"]`,
  };
  const escapedXPathText = exactHint.replaceAll('"', '\\"');
  const textAnchoredInputs = [
    `xpath=//*[normalize-space(.)="${escapedXPathText}"]/following::*[${interactiveInputXPath}][1]`,
    `xpath=//*[contains(normalize-space(.), "${escapedXPathText}")]/following::*[${interactiveInputXPath}][1]`,
    `xpath=//*[normalize-space(.)="${escapedXPathText}"]/ancestor::*[self::td or self::th or self::div or self::section or self::form][1]//*[${interactiveInputXPath}][1]`,
    `xpath=//*[contains(normalize-space(.), "${escapedXPathText}")]/ancestor::*[self::td or self::th or self::div or self::section or self::form][1]//*[${interactiveInputXPath}][1]`,
  ].map((selector) => page.locator(selector));

  return [
    ...textAnchoredInputs,
    page.getByLabel(hintRegex),
    page.getByPlaceholder(hintRegex),
    page.locator(attributeSelectors.ariaLabel),
    page.locator(attributeSelectors.name),
    page.locator(attributeSelectors.id),
    page.locator(attributeSelectors.placeholder),
    ...semanticLocators,
    page.locator(inputTags).filter({ hasText: hintRegex }),
  ];
}

function candidateLocators(page: Page, hint: string, intent: SelectorIntent): Locator[] {
  const parsedHint = parseSelectorHint(hint);
  const exactHint = parsedHint.value;
  const attributeHint = escapeForAttribute(exactHint);
  const hintRegex = new RegExp(escapeForRegex(exactHint), 'i');

  if (parsedHint.kind === 'css' || (parsedHint.kind === 'auto' && looksLikeSelectorExpression(exactHint))) {
    return [page.locator(exactHint), ...buildDynamicIdFallbackCandidates(page, exactHint)];
  }

  const semanticLocators = buildSemanticSelectors(exactHint).map((selector) => page.locator(selector));

  if (parsedHint.kind === 'text') {
    if (intent === 'fill' || intent === 'press') {
      return [...buildFillCandidates(page, hintRegex, attributeHint, semanticLocators, exactHint), page.getByText(hintRegex)];
    }

    return [page.getByText(hintRegex), page.locator(`text=${exactHint}`)];
  }

  if (parsedHint.kind === 'button') {
    return [
      page.getByRole('button', { name: hintRegex }),
      ...buildClickSemanticSelectors(exactHint).map((selector) => page.locator(selector)),
      ...buildGenericClickTextCandidates(page, hintRegex, exactHint),
      page.getByText(hintRegex),
    ];
  }

  if (parsedHint.kind === 'link') {
    return [page.getByRole('link', { name: hintRegex }), page.getByText(hintRegex)];
  }

  if (parsedHint.kind === 'option') {
    return [page.getByRole('option', { name: hintRegex }), page.getByText(hintRegex)];
  }

  if (parsedHint.kind === 'label') {
    return buildFillCandidates(page, hintRegex, attributeHint, semanticLocators, exactHint);
  }

  if (parsedHint.kind === 'placeholder') {
    return buildFillCandidates(page, hintRegex, attributeHint, semanticLocators, exactHint);
  }

  if (intent === 'fill' || intent === 'press') {
    return buildFillCandidates(page, hintRegex, attributeHint, semanticLocators, exactHint);
  }

  return [
    page.getByRole('button', { name: hintRegex }),
    page.getByRole('link', { name: hintRegex }),
    page.getByRole('tab', { name: hintRegex }),
    page.getByRole('menuitem', { name: hintRegex }),
    page.getByLabel(hintRegex),
    page.getByText(hintRegex),
    page.locator(`[aria-label="${attributeHint}"]`),
    page.locator(`[title="${attributeHint}"]`),
    page.locator(`[name="${attributeHint}"]`),
    page.locator(`[id="${attributeHint}"]`),
    ...buildClickSemanticSelectors(exactHint).map((selector) => page.locator(selector)),
    ...buildGenericClickTextCandidates(page, hintRegex, exactHint),
    ...semanticLocators,
    page.locator(exactHint),
  ];
}

async function pickFirstExistingLocator(candidates: Locator[]): Promise<Locator | null> {
  for (const candidate of candidates) {
    try {
      const count = await candidate.count();
      if (count === 0) {
        continue;
      }

      for (let index = 0; index < count; index += 1) {
        const match = candidate.nth(index);
        if (await match.isVisible().catch(() => false)) {
          return match;
        }
      }

      return candidate.first();
    } catch {
      continue;
    }
  }

  return null;
}

async function isInteractable(locator: Locator): Promise<boolean> {
  try {
    return await locator.evaluate((element) => {
      const htmlElement = element as HTMLElement;
      const style = window.getComputedStyle(htmlElement);
      const ariaHidden = htmlElement.getAttribute('aria-hidden') === 'true';
      const tabindex = htmlElement.getAttribute('tabindex');
      const disabled =
        htmlElement.hasAttribute('disabled') ||
        (htmlElement instanceof HTMLInputElement && htmlElement.disabled) ||
        (htmlElement instanceof HTMLButtonElement && htmlElement.disabled) ||
        (htmlElement instanceof HTMLSelectElement && htmlElement.disabled) ||
        (htmlElement instanceof HTMLTextAreaElement && htmlElement.disabled);
      return !ariaHidden && tabindex !== '-1' && style.pointerEvents !== 'none' && !disabled;
    });
  } catch {
    return false;
  }
}

async function resolveInteractableCandidate(candidates: Locator[], timeoutMs: number): Promise<Locator | null> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    for (const candidate of candidates) {
      try {
        const count = await candidate.count();
        if (count === 0) continue;

        for (let index = 0; index < count; index += 1) {
          const match = candidate.nth(index);
          if ((await match.isVisible().catch(() => false)) && (await isInteractable(match))) {
            return match;
          }
        }
      } catch {
        continue;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, RESOLVE_POLL_MS));
  }

  return null;
}

async function waitForExistingLocator(candidates: Locator[], timeoutMs: number): Promise<Locator | null> {
  const started = Date.now();

  while (Date.now() - started < timeoutMs) {
    const resolved = await pickFirstExistingLocator(candidates);
    if (resolved) {
      return resolved;
    }

    await new Promise((resolve) => setTimeout(resolve, RESOLVE_POLL_MS));
  }

  return null;
}

export async function resolveStepLocator(page: Page, hint: string, intent: SelectorIntent): Promise<Locator> {
  const parsedHint = parseSelectorHint(hint);
  const candidates = candidateLocators(page, hint, intent);

  if (intent === 'click' || intent === 'hover' || intent === 'fill' || intent === 'press') {
    const resolvedInteractive = await resolveInteractableCandidate(candidates, RESOLVE_TIMEOUT_MS);
    if (resolvedInteractive) {
      return resolvedInteractive;
    }
  }

  const resolved = await waitForExistingLocator(candidates, RESOLVE_TIMEOUT_MS);

  if (resolved) {
    return resolved;
  }

  throw new Error(
    `Could not find element for "${parsedHint.value}". Choose an element type like Text, Button, Label, Placeholder, or CSS and try again.`
  );
}
