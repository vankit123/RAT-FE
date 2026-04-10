import fs from 'fs/promises';
import path from 'path';
import { chromium, Browser, BrowserContext, Page, Video } from 'playwright';
import { FlowStep, RecorderEvent } from './types';

interface RecordingSession {
  sessionId: string;
  createdAt: string;
  startUrl: string;
  browser: Browser;
  context: BrowserContext;
  page: Page;
  pageVideo: Video | null;
  events: RecorderEvent[];
  artifactDir: string;
}

function eventKey(event: RecorderEvent): string {
  return [event.type, event.selector, event.value || '', event.url, String(event.timestamp)].join('::');
}

async function syncSessionEvents(session: RecordingSession): Promise<void> {
  try {
    const browserEvents = await session.page.evaluate(() => {
      const recorded = (window as typeof window & { __dashboardRecorderEvents?: unknown[] }).__dashboardRecorderEvents;
      return Array.isArray(recorded) ? recorded : [];
    });

    const existing = new Set(session.events.map(eventKey));
    for (const raw of browserEvents) {
      if (!raw || typeof raw !== 'object') continue;
      const event = raw as RecorderEvent;
      const key = eventKey(event);
      if (existing.has(key)) continue;
      session.events.push(event);
      existing.add(key);
    }
  } catch {
    // Best effort. If the page is gone or evaluate fails, keep the server-side
    // buffer only.
  }
}

async function getRecorderDebugState(session: RecordingSession): Promise<Record<string, unknown>> {
  try {
    return await session.page.evaluate(() => {
      const debug = (window as typeof window & { __dashboardRecorderDebug?: Record<string, unknown> }).__dashboardRecorderDebug;
      return debug && typeof debug === 'object' ? debug : {};
    });
  } catch {
    return {};
  }
}

export interface RecordingSnapshot {
  sessionId: string;
  createdAt: string;
  currentUrl: string;
  eventCount: number;
  stepCount: number;
  steps: FlowStep[];
  code: string;
  debug?: {
    recorderState?: Record<string, unknown>;
    recentEvents?: RecorderEvent[];
  };
}

const sessions = new Map<string, RecordingSession>();

function buildSessionId(): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = Math.random().toString(36).slice(2, 8);
  return `record-${stamp}-${suffix}`;
}

function selectorBuilderScript(): string {
  return `
    (() => {
      const SHORT_HOVER_DELAY_MS = 240;
      const LONG_HOVER_DELAY_MS = 2200;
      const POLLED_STRONG_HOVER_EMIT_MS = 2500;
      function escapeValue(value) {
        return String(value).replace(/"/g, '\\"');
      }
      function normalizeText(value) {
        return String(value || '').replace(/\\s+/g, ' ').trim();
      }
      function setRecorderDebug(patch) {
        const previous = window.__dashboardRecorderDebug || {};
        const stickyHoverState = {
          ...(previous.stickyHoverState || {}),
        };
        const stickyKeys = [
          'resolvedHoverSelector',
          'resolvedHoverLabel',
          'expandedHoverSelector',
          'expandedHoverLabel',
          'polledHoverSelector',
          'polledHoverLabel',
          'pointedHoverSelector',
          'pointedHoverLabel',
          'pointedTopSelector',
          'pointedTopLabel',
          'overlayBlockerSelector',
          'overlayBlockerLabel',
          'hoverRejectCandidates',
          'polledStableHoverSelector',
          'polledStableHoverSince',
          'hoverCandidateSelector',
          'hoverCandidateLabel',
          'pendingHoverSelector',
          'pendingHoverLabel',
          'lastHoverSelector',
          'lastHoverLabel',
          'hoverIgnoredReason',
          'hoverIgnoredTarget',
          'hoverEmitSkippedSelector',
          'hoverEmitSkippedReason',
          'hoverExpandedSelector',
          'hoverExpandedAfterSignal',
        ];
        for (const key of stickyKeys) {
          const value = patch[key];
          if (
            value !== undefined &&
            value !== null &&
            !(typeof value === 'string' && value.trim() === '') &&
            !(Array.isArray(value) && value.length === 0)
          ) {
            stickyHoverState[key] = value;
          }
        }
        window.__dashboardRecorderDebug = {
          ...previous,
          ...patch,
          stickyHoverState,
          updatedAt: Date.now(),
        };
      }
      function appendRecorderDebugLog(entry) {
        const previous = window.__dashboardRecorderDebug || {};
        const currentLog = Array.isArray(previous.hoverDebugLog) ? previous.hoverDebugLog : [];
        const nextLog = [...currentLog.slice(-11), { ...entry, timestamp: Date.now() }];
        setRecorderDebug({ hoverDebugLog: nextLog });
      }
      function slugify(value) {
        return String(value || '')
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\\u0300-\\u036f]/g, '')
          .replace(/[^a-z0-9]+/g, '_')
          .replace(/^_+|_+$/g, '') || 'screen';
      }
      function screenKeyFromUrl(rawUrl) {
        try {
          const parsed = new URL(rawUrl || location.href, location.origin);
          const pathKey = slugify(parsed.pathname.replace(/^\\/+|\\/+$/g, '') || 'home');
          return pathKey;
        } catch {
          return 'screen';
        }
      }
      function closestDialogHeading(element) {
        const dialog = element && element.closest
          ? element.closest('[role="dialog"],[aria-modal="true"],dialog,[data-slot="dialog-content"],[data-state="open"]')
          : null;
        if (!dialog || !dialog.querySelector) return '';
        const heading = dialog.querySelector('h1,h2,h3,[role="heading"],[data-slot="dialog-title"]');
        return normalizeText(heading ? (heading.innerText || heading.textContent || '') : '');
      }
      function resolveScreenKey(element) {
        const baseKey = screenKeyFromUrl(location.href);
        const dialogHeading = slugify(closestDialogHeading(element));
        return dialogHeading && dialogHeading !== 'screen'
          ? baseKey + '__' + dialogHeading
          : baseKey;
      }
      function toElement(node) {
        if (!node) return null;
        if (node.nodeType === Node.ELEMENT_NODE) return node;
        return node.parentElement || null;
      }
      function isStableId(value) {
        if (!value) return false;
        return !/^_xfUid-\\d+-\\d+$/i.test(value) && !/^radix-/i.test(value) && !/\\d{6,}/.test(value);
      }
      function textSelector(kind, value) {
        const normalized = normalizeText(value);
        return normalized ? 'kind=' + kind + '::' + normalized : '';
      }
      function conciseVisibleText(element) {
        if (!element) return '';
        const headingCandidate = element.querySelector
          ? element.querySelector('h1,h2,h3,h4,h5,h6,[role="heading"],strong,b')
          : null;
        const headingText = normalizeText(headingCandidate ? (headingCandidate.innerText || headingCandidate.textContent || '') : '');
        if (headingText && headingText.length <= 80) {
          return headingText;
        }

        const sourceText = String(element.innerText || element.textContent || '');
        const lines = sourceText
          .split(/\\n+/)
          .map((line) => normalizeText(line))
          .filter(Boolean);

        for (const line of lines) {
          if (line.length <= 80) {
            return line;
          }
        }

        return normalizeText(sourceText).slice(0, 80);
      }
      function safeSemanticSelector(element) {
        try {
          return semanticSelector(element);
        } catch {
          try {
            const tagName = element && element.tagName ? element.tagName.toLowerCase() : 'div';
            const text = conciseVisibleText(element) || normalizeText(element && element.getAttribute ? (element.getAttribute('aria-label') || '') : '');
            if (text) {
              if (tagName === 'a') return textSelector('link', text);
              if (tagName === 'button' || (element && element.getAttribute && element.getAttribute('role') === 'button')) {
                return textSelector('button', text);
              }
              return textSelector('text', text);
            }
            const stableId = element && element.getAttribute ? element.getAttribute('id') : '';
            if (stableId && isStableId(stableId)) {
              return '#' + CSS.escape(stableId);
            }
          } catch {
            // fall through
          }
          return 'unknown';
        }
      }
      function stableAttributeSelector(element) {
        if (!element || !element.getAttribute) return '';
        const exactTarget = element;
        const recorderHover = normalizeText(exactTarget.getAttribute('data-recorder-hover'));
        if (recorderHover) return '[data-recorder-hover="' + escapeValue(recorderHover) + '"]';
        const hoverKey = normalizeText(exactTarget.getAttribute('data-hover'));
        if (hoverKey) return '[data-hover="' + escapeValue(hoverKey) + '"]';
        const stableId = exactTarget.getAttribute('id');
        const placeholderKey = normalizeText(exactTarget.getAttribute('data-placeholder-key'));
        if (placeholderKey) return '[data-placeholder-key="' + escapeValue(placeholderKey) + '"]';
        const fieldId = normalizeText(exactTarget.getAttribute('data-field-id'));
        if (fieldId) return '[data-field-id="' + escapeValue(fieldId) + '"]';
        if (stableId && isStableId(stableId)) return '#' + CSS.escape(stableId);
        const nearestTestIdTarget = element.closest ? element.closest('[data-testid]') : null;
        const target = nearestTestIdTarget || exactTarget;
        if (!target || !target.getAttribute) return '';
        const testId = target.getAttribute('data-testid');
        if (testId) return '[data-testid="' + escapeValue(testId) + '"]';
        const ariaLabel = normalizeText(exactTarget.getAttribute('aria-label'));
        if (ariaLabel) return '[' + 'aria-label="' + escapeValue(ariaLabel) + '"]';
        const title = normalizeText(exactTarget.getAttribute('title'));
        if (title) return '[title="' + escapeValue(title) + '"]';
        const name = normalizeText(exactTarget.getAttribute('name'));
        if (name) return '[name="' + escapeValue(name) + '"]';
        const dataValue = normalizeText(exactTarget.getAttribute('data-value'));
        if (dataValue) return '[data-value="' + escapeValue(dataValue) + '"]';
        const value = normalizeText(exactTarget.getAttribute('value'));
        if (value) return '[value="' + escapeValue(value) + '"]';
        return '';
      }
      function isDocxFieldBox(element) {
        if (!element || !element.getAttribute) return false;
        const id = String(element.getAttribute('id') || '');
        const className = String(element.getAttribute('class') || '');
        return (
          className.includes('field-box-replacement') ||
          /^docx-field-box-/i.test(id) ||
          element.getAttribute('data-placeholder-key') !== null ||
          element.getAttribute('data-field-id') !== null
        );
      }
      function looksLikeHoverMenuTrigger(element) {
        if (!element || !element.getAttribute) return false;
        if (isFormFieldElement(element) || looksLikeSelectTrigger(element)) {
          return false;
        }
        if (isDocxFieldBox(element)) {
          return false;
        }
        const ariaHasPopup = String(element.getAttribute('aria-haspopup') || '').toLowerCase();
        return (
          element.getAttribute('data-slot') === 'navigation-menu-trigger' ||
          element.getAttribute('role') === 'menuitem' ||
          ariaHasPopup === 'menu' ||
          (element.getAttribute('aria-controls') && ariaHasPopup === 'menu' && element.getAttribute('aria-expanded') !== null) ||
          (element.tagName && element.tagName.toLowerCase() === 'button' && element.closest('[data-slot="navigation-menu"]'))
        );
      }
      function shouldAlwaysRecordHover(element) {
        if (!element || !element.getAttribute) return false;
        if (element.getAttribute('data-recorder-hover')) return true;
        if (element.getAttribute('data-hover') === 'true') return true;
        if (element.getAttribute('data-hover')) return true;
        const ariaHasPopup = String(element.getAttribute('aria-haspopup') || '').toLowerCase();
        return (
          looksLikeHoverMenuTrigger(element) ||
          ariaHasPopup === 'menu' ||
          ariaHasPopup === 'true' ||
          (element.getAttribute('aria-controls') && element.getAttribute('aria-expanded') !== null) ||
          element.getAttribute('data-slot') === 'navigation-menu-trigger'
        );
      }
      function looksLikeHoverableRegion(element) {
        if (!element || !element.getAttribute) return false;
        if (isFormFieldElement(element) || looksLikeSelectTrigger(element) || isDocxFieldBox(element)) {
          return false;
        }
        const tagName = (element.tagName || '').toLowerCase();
        const text = conciseVisibleText(element);
        const role = String(element.getAttribute('role') || '').toLowerCase();
        const className = String(element.getAttribute('class') || '');
        const ariaHasPopup = String(element.getAttribute('aria-haspopup') || '').toLowerCase();
        const hasExplicitHoverMarker = Boolean(
          element.getAttribute('data-recorder-hover') ||
          element.getAttribute('data-hover')
        );
        const inNavRegion = Boolean(
          element.closest &&
          element.closest('header,nav,aside,[role="navigation"],[class*="sidebar"],[class*="menu"],[class*="header"]')
        );
        return (
          looksLikeHoverMenuTrigger(element) ||
          hasExplicitHoverMarker ||
          (inNavRegion && !!text && text.length <= 80 && (
            tagName === 'a' ||
            role === 'menuitem' ||
            role === 'tab' ||
            ariaHasPopup === 'menu' ||
            ariaHasPopup === 'true'
          ))
        );
      }
      function hoverTargetScore(element) {
        if (!element || !element.getAttribute) return -1;
        let score = 0;
        const tagName = (element.tagName || '').toLowerCase();
        const role = String(element.getAttribute('role') || '').toLowerCase();
        const ariaHasPopup = String(element.getAttribute('aria-haspopup') || '').toLowerCase();
        const dataSlot = String(element.getAttribute('data-slot') || '').toLowerCase();
        const inNavRegion = Boolean(
          element.closest &&
          element.closest('header,nav,aside,[role="navigation"],[class*="sidebar"],[class*="menu"],[class*="header"]')
        );
        if (dataSlot === 'navigation-menu-trigger') score += 1000;
        if (element.getAttribute('data-recorder-hover') !== null) score += 900;
        if (element.getAttribute('data-hover') !== null) score += 850;
        if (role === 'menuitem') score += 700;
        if (ariaHasPopup === 'menu' || ariaHasPopup === 'true') score += 650;
        if (element.getAttribute('aria-controls')) score += 600;
        if (tagName === 'a') score += 300;
        if (role === 'tab') score += 250;
        if (inNavRegion) score += 200;
        const text = conciseVisibleText(element);
        if (text) score += Math.max(0, 120 - text.length);
        return score;
      }
      function hoveredElementsFromDom() {
        try {
          return Array.from(document.querySelectorAll(':hover')).map(toElement).filter(Boolean);
        } catch {
          return [];
        }
      }
      function pointerPointTargetsFromDom() {
        try {
          const point = window.__dashboardRecorderLastPointerPoint;
          if (!point || typeof point.x !== 'number' || typeof point.y !== 'number') {
            return [];
          }
          return document.elementsFromPoint
            ? Array.from(document.elementsFromPoint(point.x, point.y)).map(toElement).filter(Boolean)
            : [];
        } catch {
          return [];
        }
      }
      function pickBestHoverTarget(nodes) {
        const candidates = [];
        for (const node of nodes.map(toElement).filter(Boolean)) {
          const element = node;
          const tagName = (element.tagName || '').toLowerCase();
          if (tagName === 'html' || tagName === 'body') {
            continue;
          }
          if (isDocxFieldBox(element)) {
            return null;
          }
          const explicitHoverTarget = element.closest
            ? element.closest('[data-recorder-hover], [data-hover], [data-testid]')
            : null;
          if (explicitHoverTarget && looksLikeHoverableRegion(explicitHoverTarget)) {
            candidates.push(explicitHoverTarget);
          }
          const trigger = element.closest
            ? element.closest('[data-recorder-hover], [data-hover], [data-testid], [data-slot="navigation-menu-trigger"], [data-slot="navigation-menu-item"], [role="menuitem"], button[aria-controls], [aria-haspopup="menu"], header a, header button, nav a, nav button, aside a, aside button, [role="navigation"] a, [role="navigation"] button, [class*="sidebar"] a, [class*="sidebar"] button, [class*="menu"] a, [class*="menu"] button')
            : null;
          if (trigger && looksLikeHoverableRegion(trigger)) {
            candidates.push(trigger);
          }
          if (looksLikeHoverableRegion(element)) {
            candidates.push(element);
          }
        }
        const uniqueCandidates = Array.from(new Set(candidates));
        uniqueCandidates.sort((left, right) => hoverTargetScore(right) - hoverTargetScore(left));
        return uniqueCandidates[0] || null;
      }
      function describeHoverNodes(nodes) {
        return nodes
          .map(toElement)
          .filter(Boolean)
          .slice(0, 8)
          .map((element) => ({
            selector: safeSemanticSelector(element),
            label: normalizeText(element.innerText || element.textContent || '').slice(0, 60),
            tagName: (element.tagName || '').toLowerCase(),
            dataSlot: String(element.getAttribute('data-slot') || ''),
            role: String(element.getAttribute('role') || ''),
          }));
      }
      function describeHoverCandidates(nodes) {
        return nodes
          .map(toElement)
          .filter(Boolean)
          .slice(0, 8)
          .map((element) => ({
            selector: safeSemanticSelector(element),
            label: normalizeText(element.innerText || element.textContent || '').slice(0, 60),
            tagName: (element.tagName || '').toLowerCase(),
            hoverable: looksLikeHoverableRegion(element),
            score: hoverTargetScore(element),
            dataSlot: String(element.getAttribute('data-slot') || ''),
            role: String(element.getAttribute('role') || ''),
            pointerEvents: window.getComputedStyle ? window.getComputedStyle(element).pointerEvents : '',
            zIndex: window.getComputedStyle ? window.getComputedStyle(element).zIndex : '',
          }));
      }
      function inferExpandedHoverTrigger() {
        const expandedCandidates = Array.from(
          document.querySelectorAll(
            '[data-slot="navigation-menu-trigger"][data-state="open"], [data-slot="navigation-menu-trigger"][aria-expanded="true"], [aria-haspopup="menu"][aria-expanded="true"], button[aria-controls][aria-expanded="true"], [role="menuitem"][aria-expanded="true"], [data-state="open"][aria-controls]'
          )
        )
          .map(toElement)
          .filter(Boolean)
          .filter((element) => looksLikeHoverableRegion(element))
          .filter((element) => isElementVisible(element));

        const uniqueCandidates = Array.from(new Set(expandedCandidates));
        uniqueCandidates.sort((left, right) => hoverTargetScore(right) - hoverTargetScore(left));
        return uniqueCandidates[0] || null;
      }
      function resolveHoverPersistenceRoot(element) {
        if (!element || !element.closest) return null;
        return element.closest(
          '[data-slot="navigation-menu"], [role="navigation"], nav, aside, header, [role="menu"], [role="menubar"], [role="listbox"], [class*="group"], [class*="dropdown"], [class*="popover"], [class*="submenu"], [class*="sidebar"], [class*="menu"]'
        );
      }
      function isElementVisible(element) {
        if (!element || !element.isConnected) return false;
        const style = window.getComputedStyle ? window.getComputedStyle(element) : null;
        if (!style) return true;
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
          return false;
        }
        const rect = element.getBoundingClientRect ? element.getBoundingClientRect() : null;
        return Boolean(rect && rect.width >= 1 && rect.height >= 1);
      }
      function collectHoverExpansionSignal(target) {
        const selectors = [
          '[aria-expanded="true"]',
          '[data-state="open"]',
          '[data-open="true"]',
          '[open]',
          '[data-expanded="true"]',
          '[role="menu"]',
          '[role="listbox"]',
          '[role="dialog"]',
          '[role="tooltip"]',
          '[data-slot="navigation-menu-content"]',
          '[data-radix-popper-content-wrapper]',
          '[data-submenu]',
          '[class*="submenu"]',
          '[class*="dropdown"]',
          '[class*="popover"]',
        ];
        const targetRoot = resolveHoverPersistenceRoot(target);
        const expandedSelf = target && target.getAttribute
          ? [
              target.getAttribute('aria-expanded'),
              target.getAttribute('data-state'),
              target.getAttribute('data-open'),
              target.getAttribute('data-expanded'),
              target.getAttribute('open'),
            ].join('|')
          : '';
        const visibleSignals = [];
        for (const selector of selectors) {
          const matches = Array.from(document.querySelectorAll(selector))
            .map(toElement)
            .filter(Boolean)
            .filter((element) => isElementVisible(element))
            .filter((element) => {
              if (!targetRoot) return true;
              return belongsToSameHoverCluster(targetRoot, element) || belongsToSameHoverCluster(target, element);
            })
            .slice(0, 12)
            .map((element) => safeSemanticSelector(element) || (element.tagName || '').toLowerCase());
          if (matches.length) {
            visibleSignals.push(selector + ':' + matches.join(','));
          }
        }
        return expandedSelf + '::' + visibleSignals.join('||');
      }
      function belongsToSameHoverCluster(left, right) {
        if (!left || !right) return false;
        if (left === right) return true;
        if (left.contains && left.contains(right)) return true;
        if (right.contains && right.contains(left)) return true;
        const leftRoot = resolveHoverPersistenceRoot(left);
        const rightRoot = resolveHoverPersistenceRoot(right);
        return Boolean(leftRoot && rightRoot && leftRoot === rightRoot);
      }
      function resolveHoverMenuTrigger(event) {
        const path = event.composedPath ? event.composedPath() : [];
        const pointTargets = document.elementsFromPoint ? document.elementsFromPoint(event.clientX, event.clientY) : [];
        const hovered = hoveredElementsFromDom();
        const resolved = pickBestHoverTarget([...hovered, ...(path.length ? path : [event.target]), ...pointTargets]);
        if (resolved) {
          setRecorderDebug({
            resolvedHoverSelector: safeSemanticSelector(resolved),
            resolvedHoverLabel: normalizeText(resolved.innerText || resolved.textContent || '').slice(0, 80),
          });
        }
        return resolved;
      }
      function titleCaseWords(value) {
        return String(value || '')
          .split(/[-_\\s]+/)
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ');
      }
      function labelTextFor(element) {
        if (!element) return '';
        if (element.labels && element.labels.length) {
          return normalizeText(Array.from(element.labels).map((label) => label.innerText || label.textContent || '').join(' '));
        }
        const parentLabel = element.closest('label');
        if (parentLabel) {
          return normalizeText(parentLabel.innerText || parentLabel.textContent || '');
        }
        const group = element.closest('td,dd,div,section,form');
        if (group && group.previousElementSibling) {
          return normalizeText(group.previousElementSibling.innerText || group.previousElementSibling.textContent || '');
        }
        return '';
      }
      function semanticSelector(element) {
        if (!element || !element.tagName) return 'unknown';
        const tagName = element.tagName.toLowerCase();
        const stableId = element.getAttribute('id');
        if (isDocxFieldBox(element)) {
          const stableAttribute = stableAttributeSelector(element);
          if (stableAttribute) return stableAttribute;
          if (stableId && isStableId(stableId)) return '#' + CSS.escape(stableId);
          const docxFieldText = conciseVisibleText(element) || normalizeText(element.getAttribute('aria-label') || '');
          if (docxFieldText) return textSelector('text', docxFieldText);
        }
        if (stableId && isStableId(stableId)) return '#' + CSS.escape(stableId);
        const stableAttribute = stableAttributeSelector(element);
        if (stableAttribute) return stableAttribute;
        const testId = element.getAttribute('data-testid');
        if (testId) return '[data-testid="' + escapeValue(testId) + '"]';
        if (tagName === 'button' || tagName === 'a' || element.getAttribute('role') === 'button' || looksLikeHoverMenuTrigger(element)) {
          const buttonText = conciseVisibleText(element) || normalizeText(element.getAttribute('aria-label') || '');
          if (buttonText) return textSelector(tagName === 'a' ? 'link' : 'button', buttonText);
        }
        const radixId = element.getAttribute('id');
        const radixContentMatch = radixId ? /^radix-:[^:]+:-(trigger|content)-(.+)$/i.exec(radixId) : null;
        if (radixContentMatch) {
          const radixMode = radixContentMatch[1].toLowerCase();
          const radixValue = normalizeText(radixContentMatch[2]);
          const relatedTrigger =
            document.querySelector('[aria-controls="' + escapeValue(radixId) + '"]') ||
            document.querySelector('[data-value="' + escapeValue(radixValue) + '"]') ||
            document.querySelector('[value="' + escapeValue(radixValue) + '"]');
          if (relatedTrigger) {
            const triggerStableAttribute = stableAttributeSelector(relatedTrigger);
            if (triggerStableAttribute) {
              return triggerStableAttribute;
            }
            const triggerText = normalizeText(
              relatedTrigger.innerText ||
              relatedTrigger.textContent ||
              relatedTrigger.getAttribute('aria-label') ||
              relatedTrigger.getAttribute('value') ||
              radixValue,
            );
            if (triggerText) {
              return textSelector('button', triggerText);
            }
          }
          const semanticText = titleCaseWords(radixValue);
          if (semanticText) {
            return textSelector(radixMode === 'content' ? 'button' : 'text', semanticText);
          }
        }
        if (element.getAttribute('role') === 'option') {
          const optionText = normalizeText(element.innerText || element.textContent || element.getAttribute('aria-label') || '');
          if (optionText) return textSelector('option', optionText);
        }
        if (stableId && isStableId(stableId) && (element.getAttribute('role') === 'combobox' || element.getAttribute('aria-haspopup') === 'listbox')) {
          return '#' + CSS.escape(stableId);
        }
        if (tagName === 'button' || tagName === 'a' || element.getAttribute('role') === 'button') {
          const buttonText = conciseVisibleText(element) || normalizeText(element.getAttribute('aria-label') || '');
          if (buttonText) return textSelector(tagName === 'a' ? 'link' : 'button', buttonText);
        }
        const genericText = conciseVisibleText(element) || normalizeText(element.getAttribute('aria-label') || '');
        if (
          genericText &&
          genericText.length <= 60 &&
          (
            element.getAttribute('role') === 'menuitem' ||
            element.getAttribute('onclick') !== null ||
            element.getAttribute('data-slot') !== null ||
            (element.className && String(element.className).includes('cursor-pointer'))
          )
        ) {
          return textSelector('text', genericText);
        }
        if (tagName === 'input' || tagName === 'textarea' || tagName === 'select') {
          const labelText = labelTextFor(element);
          if (labelText) return textSelector('label', labelText.replace(/:$/, ''));
          const placeholder = normalizeText(element.getAttribute('placeholder'));
          if (placeholder) return textSelector('placeholder', placeholder);
          const ariaLabel = normalizeText(element.getAttribute('aria-label'));
          if (ariaLabel) return textSelector('label', ariaLabel);
        }
        const ariaLabel = element.getAttribute('aria-label');
        if (ariaLabel) return element.tagName.toLowerCase() + '[aria-label="' + escapeValue(ariaLabel) + '"]';
        const name = element.getAttribute('name');
        if (name) return element.tagName.toLowerCase() + '[name="' + escapeValue(name) + '"]';
        const placeholder = element.getAttribute('placeholder');
        if (placeholder) return element.tagName.toLowerCase() + '[placeholder="' + escapeValue(placeholder) + '"]';
        let current = element;
        const parts = [];
        while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
          let part = current.tagName.toLowerCase();
          const siblings = current.parentElement
            ? Array.from(current.parentElement.children).filter((child) => child.tagName === current.tagName)
            : [];
          if (siblings.length > 1) {
            const index = siblings.indexOf(current) + 1;
            part += ':nth-of-type(' + index + ')';
          }
          parts.unshift(part);
          current = current.parentElement;
        }
        return parts.join(' > ');
      }
      function looksLikeSelectTrigger(element) {
        if (!element || !element.getAttribute) return false;
        const role = String(element.getAttribute('role') || '').toLowerCase();
        const ariaHasPopup = String(element.getAttribute('aria-haspopup') || '').toLowerCase();
        const dataSlot = String(element.getAttribute('data-slot') || '').toLowerCase();
        const insideSelect = Boolean(
          element.closest &&
          element.closest('[data-slot="select"], [data-slot="select-content"], [role="listbox"], [data-radix-select-content]')
        );
        return (
          role === 'combobox' ||
          ariaHasPopup === 'listbox' ||
          dataSlot === 'select-trigger' ||
          dataSlot === 'select-value' ||
          (element.getAttribute('data-radix-collection-item') !== null && insideSelect)
        );
      }
      function isFormFieldElement(element) {
        if (!element || !element.tagName) return false;
        const tagName = element.tagName.toLowerCase();
        return (
          tagName === 'input' ||
          tagName === 'textarea' ||
          tagName === 'select' ||
          looksLikeSelectTrigger(element)
        );
      }
      function hasStableFieldIdentity(element) {
        if (!element || !element.getAttribute) return false;
        const stableId = element.getAttribute('id');
        if (stableId && isStableId(stableId)) return true;
        return Boolean(
          element.getAttribute('data-testid') ||
          normalizeText(element.getAttribute('aria-label')) ||
          normalizeText(element.getAttribute('name')) ||
          normalizeText(element.getAttribute('placeholder'))
        );
      }
      function resolveRecordedFieldElement(element) {
        if (element && isFormFieldElement(element) && hasStableFieldIdentity(element)) {
          return element;
        }
        const lastFieldTarget = toElement(window.__dashboardRecorderLastFieldTarget);
        if (lastFieldTarget && isFormFieldElement(lastFieldTarget) && hasStableFieldIdentity(lastFieldTarget)) {
          return lastFieldTarget;
        }
        return element;
      }
      function looksLikeOptionElement(element) {
        if (!element || !element.getAttribute) return false;
        const role = element.getAttribute('role');
        const dataState = element.getAttribute('data-state');
        const ariaSelected = element.getAttribute('aria-selected');
        const dataHighlighted = element.getAttribute('data-highlighted');
        const parentRole = element.parentElement ? element.parentElement.getAttribute('role') : '';
        const text = normalizeText(element.innerText || element.textContent || '');
        return (
          role === 'option' ||
          role === 'menuitem' ||
          parentRole === 'listbox' ||
          parentRole === 'menu' ||
          ariaSelected === 'true' ||
          ariaSelected === 'false' ||
          dataHighlighted !== null ||
          dataState === 'checked' ||
          dataState === 'active' ||
          (!!text && text.length <= 60 && !!element.closest('[role="listbox"],[role="menu"],[data-radix-popper-content-wrapper]'))
        );
      }
      function findMeaningfulTextElement(nodes) {
        for (const node of nodes) {
          const element = node;
          const text = normalizeText(element.innerText || element.textContent || '');
          if (!text || text.length > 80) continue;
          if (['html', 'body'].includes((element.tagName || '').toLowerCase())) continue;
          if (looksLikeOptionElement(element)) return element;
          if (text.length <= 40) return element;
        }
        return null;
      }
      function resolveInteractiveTarget(event) {
        const path = event.composedPath ? event.composedPath() : [];
        const pointTarget = document.elementFromPoint ? document.elementFromPoint(event.clientX, event.clientY) : null;
        const nodes = [...(path.length ? path : [event.target]), pointTarget].map(toElement).filter(Boolean);
        const selectors = [
          '.field-box-replacement',
          '[data-placeholder-key]',
          '[data-field-id]',
          '[role="option"]',
          '[role="combobox"]',
          '[aria-haspopup="listbox"]',
          '[data-slot="navigation-menu-trigger"]',
          '[data-slot="navigation-menu-content"] a',
          '[data-slot="navigation-menu-content"] button',
          'header a',
          'header button',
          'nav a',
          'nav button',
          'aside a',
          'aside button',
          '[data-slot="select-trigger"]',
          '[data-radix-collection-item]',
          'button',
          'a',
          'input',
          '[role="button"]',
        ];
        for (const node of nodes) {
          if (!node || node.nodeType !== Node.ELEMENT_NODE) continue;
          const element = node;
          if (isDocxFieldBox(element)) return element;
          if (looksLikeOptionElement(element)) return element;
          if (looksLikeSelectTrigger(element)) return element;
          if (element.matches && selectors.some((selector) => element.matches(selector))) return element;
          if (element.closest) {
            const match = element.closest(selectors.join(','));
            if (match) return match;
          }
        }
        const meaningful = findMeaningfulTextElement(nodes);
        if (meaningful) return meaningful;
        const eventTarget = toElement(event.target);
        return eventTarget && eventTarget.closest ? eventTarget.closest(selectors.join(',')) || eventTarget : eventTarget;
      }
      function buildEventPayload(type, target, extra = {}) {
        const element = toElement(target);
        if (!element) {
          return {
            type,
            selector: 'unknown',
            label: '',
            inputType: '',
            value: '',
            url: location.href,
            timestamp: Date.now(),
            ...extra,
          };
        }
        const label = (() => {
          try {
            return normalizeText(element.innerText || element.textContent || '').slice(0, 80);
          } catch {
            return '';
          }
        })();
        const inputType = (() => {
          try {
            return element.type || '';
          } catch {
            return '';
          }
        })();
        const value = (() => {
          try {
            return typeof element.value === 'string' ? element.value : '';
          } catch {
            return '';
          }
        })();
        const recordedElement = type === 'change' ? resolveRecordedFieldElement(element) : element;
        return {
          type,
          selector: safeSemanticSelector(recordedElement),
          label,
          inputType,
          value,
          screenKey: resolveScreenKey(recordedElement),
          url: location.href,
          timestamp: Date.now(),
          ...extra,
        };
      }
      function pushRecorderEvent(payload) {
        window.__dashboardRecorderEvents = Array.isArray(window.__dashboardRecorderEvents) ? window.__dashboardRecorderEvents : [];
        window.__dashboardRecorderEvents.push(payload);
        if (window.__dashboardRecorderPush) {
          Promise.resolve(window.__dashboardRecorderPush(payload)).catch(() => undefined);
        }
      }
      function readFilesForRecorder(input) {
        const files = Array.from(input && input.files ? input.files : []);
        return Promise.all(
          files.map(
            (file) =>
              new Promise((resolve) => {
                const reader = new FileReader();
                reader.onload = () =>
                  resolve({
                    fileName: file.name,
                    mimeType: file.type || 'application/octet-stream',
                    sizeBytes: Number(file.size || 0),
                    dataUrl: typeof reader.result === 'string' ? reader.result : '',
                  });
                reader.onerror = () =>
                  resolve({
                    fileName: file.name,
                    mimeType: file.type || 'application/octet-stream',
                    sizeBytes: Number(file.size || 0),
                    dataUrl: '',
                  });
                reader.readAsDataURL(file);
              }),
          ),
        );
      }
      if (window.__dashboardRecorderInstalled) return;
      window.__dashboardRecorderInstalled = true;
      window.__dashboardRecorderEvents = Array.isArray(window.__dashboardRecorderEvents) ? window.__dashboardRecorderEvents : [];
      window.__dashboardRecorderDebug = window.__dashboardRecorderDebug || {};
      setRecorderDebug({
        installed: true,
        hoverPollActive: true,
      });
      if (window.__dashboardRecorderHoverPollId) {
        window.clearInterval(window.__dashboardRecorderHoverPollId);
      }
      window.__dashboardRecorderHoverPollId = window.setInterval(() => {
        const hovered = hoveredElementsFromDom();
        const pointTargets = pointerPointTargetsFromDom();
        const target = pickBestHoverTarget([
          ...pointTargets,
          ...hovered,
          window.__dashboardRecorderLastPointerTarget,
        ]);
        const expandedTarget = inferExpandedHoverTrigger();
        setRecorderDebug({
          hoverPollTickAt: Date.now(),
          hoveredNodeCount: hovered.length,
          hoveredNodePreview: describeHoverNodes(hovered),
          pointedNodeCount: pointTargets.length,
          pointedNodePreview: describeHoverNodes(pointTargets),
          pointedTopSelector: pointTargets.length ? safeSemanticSelector(pointTargets[0]) : '',
          pointedTopLabel: pointTargets.length
            ? normalizeText(pointTargets[0].innerText || pointTargets[0].textContent || '').slice(0, 80)
            : '',
          pointedHoverSelector: pointTargets.length ? safeSemanticSelector(pointTargets[0]) : '',
          pointedHoverLabel: pointTargets.length
            ? normalizeText(pointTargets[0].innerText || pointTargets[0].textContent || '').slice(0, 80)
            : '',
          hoverRejectCandidates: describeHoverCandidates(pointTargets),
          expandedHoverSelector: expandedTarget ? safeSemanticSelector(expandedTarget) : '',
          expandedHoverLabel: expandedTarget ? normalizeText(expandedTarget.innerText || expandedTarget.textContent || '').slice(0, 80) : '',
        });
        const pointedTarget = pickBestHoverTarget(pointTargets);
        setRecorderDebug({
          overlayBlockerSelector:
            pointTargets.length && pointedTarget && pointTargets[0] !== pointedTarget
              ? safeSemanticSelector(pointTargets[0])
              : '',
          overlayBlockerLabel:
            pointTargets.length && pointedTarget && pointTargets[0] !== pointedTarget
              ? normalizeText(pointTargets[0].innerText || pointTargets[0].textContent || '').slice(0, 80)
              : '',
        });
        const resolvedTarget = target || pointedTarget || expandedTarget;
        if (!resolvedTarget) {
          setRecorderDebug({
            polledHoverSelector: '',
            polledHoverLabel: '',
            hoverIgnoredReason: 'hover-poll-no-target',
          });
          return;
        }
        setRecorderDebug({
          polledHoverSelector: safeSemanticSelector(resolvedTarget),
          polledHoverLabel: normalizeText(resolvedTarget.innerText || resolvedTarget.textContent || '').slice(0, 80),
        });
        const resolvedSelector = safeSemanticSelector(resolvedTarget);
        const now = Date.now();
        const previousPolled = window.__dashboardRecorderPolledHoverCandidate;
        if (
          previousPolled &&
          previousPolled.selector === resolvedSelector &&
          previousPolled.target === resolvedTarget
        ) {
          previousPolled.lastSeenAt = now;
        } else {
          window.__dashboardRecorderPolledHoverCandidate = {
            selector: resolvedSelector,
            target: resolvedTarget,
            label: normalizeText(resolvedTarget.innerText || resolvedTarget.textContent || '').slice(0, 80),
            screenKey: resolveScreenKey(resolvedTarget),
            since: now,
            lastSeenAt: now,
          };
        }
        setRecorderDebug({
          polledStableHoverSelector: window.__dashboardRecorderPolledHoverCandidate.selector,
          polledStableHoverSince: window.__dashboardRecorderPolledHoverCandidate.since,
        });
        if (expandedTarget && shouldAlwaysRecordHover(expandedTarget)) {
          rememberHoverCandidate(expandedTarget);
          emitHoverEvent({
            selector: safeSemanticSelector(expandedTarget),
            target: expandedTarget,
            label: normalizeText(expandedTarget.innerText || expandedTarget.textContent || '').slice(0, 80),
            screenKey: resolveScreenKey(expandedTarget),
          });
          return;
        }
        if (
          resolvedSelector &&
          resolvedSelector !== 'unknown' &&
          resolvedSelector !== 'html > body' &&
          looksLikeHoverableRegion(resolvedTarget) &&
          window.__dashboardRecorderPolledHoverCandidate &&
          window.__dashboardRecorderPolledHoverCandidate.selector === resolvedSelector &&
          now - Number(window.__dashboardRecorderPolledHoverCandidate.since || 0) >= POLLED_STRONG_HOVER_EMIT_MS
        ) {
          setRecorderDebug({
            hoverEmitSource: 'stable-polled-hover',
            hoverEmitStableDurationMs: now - Number(window.__dashboardRecorderPolledHoverCandidate.since || 0),
          });
          rememberHoverCandidate(resolvedTarget);
          emitHoverEvent({
            selector: resolvedSelector,
            target: resolvedTarget,
            label: normalizeText(resolvedTarget.innerText || resolvedTarget.textContent || '').slice(0, 80),
            screenKey: resolveScreenKey(resolvedTarget),
          });
          return;
        }
        queueHover(resolvedTarget);
      }, 150);
      window.__dashboardRecorderLastPointerTarget = null;
      window.__dashboardRecorderLastPointerPoint = null;
      window.__dashboardRecorderLastFieldTarget = null;
      window.__dashboardRecorderPendingSelect = null;
      window.__dashboardRecorderPendingHover = null;
      window.__dashboardRecorderLastHoverSelector = '';
      window.__dashboardRecorderLastHoverCandidate = null;
      window.__dashboardRecorderPolledHoverCandidate = null;
      function clearPendingSelectWatcher() {
        if (window.__dashboardRecorderPendingSelect && window.__dashboardRecorderPendingSelect.timerId) {
          window.clearInterval(window.__dashboardRecorderPendingSelect.timerId);
        }
      }
      function rememberPendingSelect(target) {
        if (!target || !target.getAttribute) return;
        const id = target.getAttribute('id');
        if (!id || !looksLikeSelectTrigger(target)) return;
        const triggerSelector = safeSemanticSelector(target);
        clearPendingSelectWatcher();
        window.__dashboardRecorderPendingSelect = {
          id,
          selector: triggerSelector,
          beforeText: normalizeText(target.innerText || target.textContent || ''),
          emittedValue: '',
          timerId: 0,
        };
        window.__dashboardRecorderPendingSelect.timerId = window.setInterval(() => {
          const pending = window.__dashboardRecorderPendingSelect;
          if (!pending || pending.id !== id) return;
          const trigger = document.getElementById(id);
          if (!trigger) {
            clearPendingSelectWatcher();
            window.__dashboardRecorderPendingSelect = null;
            return;
          }
          const afterText = normalizeText(trigger.innerText || trigger.textContent || '');
          if (afterText && afterText !== pending.beforeText && !/^chon /i.test(afterText) && afterText !== pending.emittedValue) {
            pending.emittedValue = afterText;
            pushRecorderEvent({
              type: 'change',
              selector: pending.selector || ('#' + CSS.escape(id)),
              label: afterText,
              inputType: '',
              value: afterText,
              screenKey: resolveScreenKey(trigger),
              url: location.href,
              timestamp: Date.now(),
            });
            clearPendingSelectWatcher();
            window.__dashboardRecorderPendingSelect = null;
          }
        }, 120);
        window.setTimeout(() => {
          if (window.__dashboardRecorderPendingSelect && window.__dashboardRecorderPendingSelect.id === id) {
            clearPendingSelectWatcher();
            window.__dashboardRecorderPendingSelect = null;
          }
        }, 2500);
      }
      function flushPendingSelect() {
        const pending = window.__dashboardRecorderPendingSelect;
        if (!pending || !window.__dashboardRecorderPush) return;
        const trigger = document.getElementById(pending.id);
        if (!trigger) {
          clearPendingSelectWatcher();
          window.__dashboardRecorderPendingSelect = null;
          return;
        }
        const afterText = normalizeText(trigger.innerText || trigger.textContent || '');
        if (afterText && afterText !== pending.beforeText && !/^chon /i.test(afterText) && afterText !== pending.emittedValue) {
          pending.emittedValue = afterText;
          pushRecorderEvent({
            type: 'change',
            selector: pending.selector || safeSemanticSelector(trigger),
            label: afterText,
            inputType: '',
            value: afterText,
            screenKey: resolveScreenKey(trigger),
            url: location.href,
            timestamp: Date.now(),
          });
        }
        clearPendingSelectWatcher();
        window.__dashboardRecorderPendingSelect = null;
      }
      function clearPendingHover() {
        if (window.__dashboardRecorderPendingHover && window.__dashboardRecorderPendingHover.observer) {
          window.__dashboardRecorderPendingHover.observer.disconnect();
        }
        if (window.__dashboardRecorderPendingHover && window.__dashboardRecorderPendingHover.timerId) {
          window.clearTimeout(window.__dashboardRecorderPendingHover.timerId);
        }
        if (window.__dashboardRecorderPendingHover && window.__dashboardRecorderPendingHover.longTimerId) {
          window.clearTimeout(window.__dashboardRecorderPendingHover.longTimerId);
        }
        setRecorderDebug({ pendingHoverSelector: '', pendingHoverLabel: '' });
        window.__dashboardRecorderPendingHover = null;
      }
      function shouldKeepExistingHoverTarget(existingTarget, nextTarget) {
        const current = toElement(existingTarget);
        const next = toElement(nextTarget);
        if (!current || !next) return false;
        if (!belongsToSameHoverCluster(current, next)) return false;
        const currentStrong =
          shouldAlwaysRecordHover(current) ||
          current.getAttribute('data-recorder-hover') !== null ||
          current.getAttribute('data-hover') !== null;
        const nextStrong =
          shouldAlwaysRecordHover(next) ||
          next.getAttribute('data-recorder-hover') !== null ||
          next.getAttribute('data-hover') !== null;
        if (currentStrong && !nextStrong) return true;
        if (currentStrong && nextStrong && current.contains && current.contains(next)) return true;
        return false;
      }
      function rememberHoverCandidate(target) {
        if (!target) return;
        const selector = safeSemanticSelector(target);
        if (!selector || selector === 'unknown' || selector === 'html > body') return;
        const existingCandidate = window.__dashboardRecorderLastHoverCandidate;
        if (existingCandidate && shouldKeepExistingHoverTarget(existingCandidate.target, target)) {
          setRecorderDebug({
            hoverIgnoredTarget: selector,
            hoverIgnoredReason: 'kept-existing-stronger-hover-target',
          });
          return;
        }
        window.__dashboardRecorderLastHoverCandidate = {
          selector,
          target,
          label: normalizeText(target.innerText || target.textContent || '').slice(0, 80),
          screenKey: resolveScreenKey(target),
          timestamp: Date.now(),
        };
        setRecorderDebug({
          hoverCandidateSelector: selector,
          hoverCandidateLabel: normalizeText(target.innerText || target.textContent || '').slice(0, 80),
        });
      }
      function emitHoverEvent(candidate) {
        if (!candidate || !candidate.selector || candidate.selector === window.__dashboardRecorderLastHoverSelector) {
          setRecorderDebug({
            hoverEmitSkippedSelector: candidate && candidate.selector ? candidate.selector : '',
            hoverEmitSkippedReason: !candidate || !candidate.selector ? 'missing-candidate' : 'same-as-last-hover-selector',
          });
          appendRecorderDebugLog({
            stage: 'emit-skip',
            selector: candidate && candidate.selector ? candidate.selector : '',
            reason: !candidate || !candidate.selector ? 'missing-candidate' : 'same-as-last-hover-selector',
          });
          return false;
        }
        const target = toElement(candidate.target);
        if (!target || !target.isConnected) {
          setRecorderDebug({
            hoverEmitSkippedSelector: candidate.selector,
            hoverEmitSkippedReason: 'target-disconnected',
          });
          appendRecorderDebugLog({
            stage: 'emit-skip',
            selector: candidate.selector,
            reason: 'target-disconnected',
          });
          return false;
        }
        window.__dashboardRecorderLastHoverSelector = candidate.selector;
        setRecorderDebug({
          lastHoverSelector: candidate.selector,
          lastHoverLabel: candidate.label || normalizeText(target.innerText || target.textContent || '').slice(0, 80),
          hoverEmittedSelector: candidate.selector,
          hoverEmittedLabel: candidate.label || normalizeText(target.innerText || target.textContent || '').slice(0, 80),
        });
        appendRecorderDebugLog({
          stage: 'emit-success',
          selector: candidate.selector,
          label: candidate.label || normalizeText(target.innerText || target.textContent || '').slice(0, 80),
        });
        pushRecorderEvent({
          type: 'hover',
          selector: candidate.selector,
          label: candidate.label || normalizeText(target.innerText || target.textContent || '').slice(0, 80),
          inputType: '',
          value: '',
          screenKey: candidate.screenKey || resolveScreenKey(target),
          url: location.href,
          timestamp: Date.now(),
        });
        return true;
      }
      function flushHoverBeforeClick(clickTarget) {
        const candidate = window.__dashboardRecorderLastHoverCandidate;
        if (!candidate || !clickTarget) return;
        const candidateTarget = toElement(candidate.target);
        if (!candidateTarget) return;
        if (Date.now() - Number(candidate.timestamp || 0) > 2500) return;
        if (
          belongsToSameHoverCluster(candidateTarget, clickTarget) &&
          candidateTarget !== clickTarget &&
          !(candidateTarget.contains && candidateTarget.contains(clickTarget))
        ) {
          emitHoverEvent(candidate);
        }
      }
      function queueHover(target) {
        if (!target) return;
        if (isFormFieldElement(target) || looksLikeSelectTrigger(target)) {
          setRecorderDebug({
            hoverIgnoredTarget: safeSemanticSelector(target),
            hoverIgnoredReason: 'form-like-target',
          });
          return;
        }
        const selector = safeSemanticSelector(target);
        if (!selector || selector === 'unknown' || selector === 'html > body') {
          setRecorderDebug({
            hoverIgnoredTarget: selector || '',
            hoverIgnoredReason: 'invalid-selector',
          });
          return;
        }
        rememberHoverCandidate(target);
        if (window.__dashboardRecorderLastHoverSelector === selector) return;

        const existing = window.__dashboardRecorderPendingHover;
        if (existing && shouldKeepExistingHoverTarget(existing.target, target)) {
          setRecorderDebug({
            hoverIgnoredTarget: selector,
            hoverIgnoredReason: 'kept-existing-pending-hover-target',
          });
          return;
        }
        if (existing && existing.selector === selector) {
          return;
        }

        clearPendingHover();
        const beforeSignal = collectHoverExpansionSignal(target);
        const observer = typeof MutationObserver === 'function'
          ? new MutationObserver(() => {
              const pending = window.__dashboardRecorderPendingHover;
              if (!pending || pending.selector !== selector || !target.isConnected) {
                return;
              }
              const afterSignal = collectHoverExpansionSignal(target);
              if (afterSignal && afterSignal !== pending.beforeSignal) {
                setRecorderDebug({
                  hoverExpandedSelector: selector,
                  hoverExpandedAfterSignal: afterSignal,
                });
                emitHoverEvent({
                  selector,
                  target,
                  label: normalizeText(target.innerText || target.textContent || '').slice(0, 80),
                  screenKey: resolveScreenKey(target),
                });
                clearPendingHover();
              }
            })
          : null;
        if (observer && document.body) {
          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['aria-expanded', 'data-state', 'data-open', 'data-expanded', 'open', 'style', 'class', 'hidden'],
          });
        }
        const alwaysRecordHover = shouldAlwaysRecordHover(target);
        setRecorderDebug({
          pendingHoverSelector: selector,
          pendingHoverLabel: normalizeText(target.innerText || target.textContent || '').slice(0, 80),
          pendingHoverAlwaysRecord: alwaysRecordHover,
          pendingHoverBeforeSignal: beforeSignal,
        });
        window.__dashboardRecorderPendingHover = {
          selector,
          target,
          beforeSignal,
          observer,
          alwaysRecordHover,
          timerId: window.setTimeout(() => {
            const pending = window.__dashboardRecorderPendingHover;
            if (!pending || pending.selector !== selector || !target.isConnected) {
              return;
            }
            if (!pending.alwaysRecordHover) {
              emitHoverEvent({
                selector,
                target,
                label: normalizeText(target.innerText || target.textContent || '').slice(0, 80),
                screenKey: resolveScreenKey(target),
              });
              clearPendingHover();
            }
          }, SHORT_HOVER_DELAY_MS),
          longTimerId: window.setTimeout(() => {
            const pending = window.__dashboardRecorderPendingHover;
            if (!pending || pending.selector !== selector || !target.isConnected) {
              return;
            }
            if (pending.alwaysRecordHover) {
              emitHoverEvent({
                selector,
                target,
                label: normalizeText(target.innerText || target.textContent || '').slice(0, 80),
                screenKey: resolveScreenKey(target),
              });
              clearPendingHover();
            }
          }, LONG_HOVER_DELAY_MS),
        };
      }
      document.addEventListener('pointerdown', (event) => {
        window.__dashboardRecorderLastPointerPoint = {
          x: event.clientX,
          y: event.clientY,
        };
        let target = null;
        try {
          target = resolveInteractiveTarget(event);
        } catch {
          target = toElement(event.target);
        }
        if (target && target.tagName && !['html', 'body'].includes(target.tagName.toLowerCase())) {
          window.__dashboardRecorderLastPointerTarget = target;
          if (isFormFieldElement(target)) {
            window.__dashboardRecorderLastFieldTarget = target;
          }
          rememberPendingSelect(target);
        }
      }, true);
      document.addEventListener('pointerover', (event) => {
        let target = null;
        try {
          target = resolveHoverMenuTrigger(event);
        } catch {
          target = null;
        }
        if (!target) return;
        queueHover(target);
      }, true);
      document.addEventListener('pointerout', (event) => {
        const pending = window.__dashboardRecorderPendingHover;
        if (!pending) return;
        const relatedTarget = toElement(event.relatedTarget);
        const target = resolveHoverMenuTrigger(event);
        if (!target) {
          if (pending.target && relatedTarget && belongsToSameHoverCluster(pending.target, relatedTarget)) {
            return;
          }
          clearPendingHover();
          return;
        }
        if (relatedTarget && belongsToSameHoverCluster(target, relatedTarget)) {
          return;
        }
        clearPendingHover();
      }, true);
      document.addEventListener('mouseover', (event) => {
        let target = null;
        try {
          target = resolveHoverMenuTrigger(event);
        } catch {
          target = null;
        }
        if (!target) return;
        queueHover(target);
      }, true);
      document.addEventListener('mousemove', (event) => {
        window.__dashboardRecorderLastPointerPoint = {
          x: event.clientX,
          y: event.clientY,
        };
        let target = null;
        try {
          target = resolveHoverMenuTrigger(event);
        } catch {
          target = null;
        }
        if (!target) return;
        queueHover(target);
      }, true);
      document.addEventListener('mouseout', (event) => {
        const pending = window.__dashboardRecorderPendingHover;
        if (!pending) return;
        const relatedTarget = toElement(event.relatedTarget);
        let target = null;
        try {
          target = resolveHoverMenuTrigger(event);
        } catch {
          target = null;
        }
        if (!target) {
          if (pending.target && relatedTarget && belongsToSameHoverCluster(pending.target, relatedTarget)) {
            return;
          }
          clearPendingHover();
          return;
        }
        if (relatedTarget && belongsToSameHoverCluster(target, relatedTarget)) {
          return;
        }
        clearPendingHover();
      }, true);
      document.addEventListener('click', (event) => {
        let target = null;
        try {
          target = resolveInteractiveTarget(event);
        } catch {
          target = toElement(event.target);
        }
        if (
          (!target || !target.tagName || ['html', 'body'].includes(target.tagName.toLowerCase())) &&
          window.__dashboardRecorderLastPointerTarget
        ) {
          target = window.__dashboardRecorderLastPointerTarget;
        }
        if (!target) return;
        flushHoverBeforeClick(target);
        clearPendingHover();
        if (looksLikeOptionElement(target)) {
          flushPendingSelect();
          window.__dashboardRecorderLastPointerTarget = null;
          return;
        }
        pushRecorderEvent(buildEventPayload('click', target));
        if (isFormFieldElement(target)) {
          window.__dashboardRecorderLastFieldTarget = target;
        }
        window.__dashboardRecorderLastPointerTarget = null;
      }, true);
      document.addEventListener('change', (event) => {
        const target = toElement(event.target);
        if (!target) return;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') {
          if (target instanceof HTMLInputElement && target.type === 'file') {
            void readFilesForRecorder(target).then((files) => {
              pushRecorderEvent(
                buildEventPayload('change', target, {
                  inputType: 'file',
                  value: files.map((file) => file.fileName).join(', '),
                  files,
                }),
              );
              window.__dashboardRecorderLastFieldTarget = resolveRecordedFieldElement(target);
            });
            return;
          }
          pushRecorderEvent(buildEventPayload('change', target));
          window.__dashboardRecorderLastFieldTarget = resolveRecordedFieldElement(target);
        }
      }, true);
      window.addEventListener('beforeunload', () => {
        pushRecorderEvent({
          type: 'navigation',
          selector: '',
          value: '',
          url: location.href,
          timestamp: Date.now(),
        });
      });
    })();
  `;
}

function dedupeEvents(events: RecorderEvent[]): RecorderEvent[] {
  const deduped: RecorderEvent[] = [];

  for (const event of events) {
    const previous = deduped[deduped.length - 1];
    if (
      previous &&
      previous.type === 'change' &&
      event.type === 'change' &&
      previous.selector === event.selector &&
      previous.url === event.url
    ) {
      deduped[deduped.length - 1] = event;
      continue;
    }
    deduped.push(event);
  }

  return deduped;
}

function normalizeRecordedUrl(value: string | undefined): string {
  const normalized = String(value || '').trim();
  return normalized && normalized !== 'about:blank' ? normalized : '';
}

function normalizeScreenKey(value: string | undefined, fallbackUrl?: string): string {
  const explicit = String(value || '').trim();
  if (explicit) return explicit;

  const normalizedUrl = normalizeRecordedUrl(fallbackUrl);
  if (!normalizedUrl) return 'screen';

  try {
    const parsed = new URL(normalizedUrl);
    const pathKey = parsed.pathname
      .replace(/^\/+|\/+$/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    return pathKey || 'home';
  } catch {
    return 'screen';
  }
}

function deriveRecordedInputKeyFromSelector(selector: string | undefined): string {
  const source = String(selector || '');
  const match =
    /kind=label::([^]+)$/i.exec(source) ||
    /kind=placeholder::([^]+)$/i.exec(source) ||
    /kind=text::([^]+)$/i.exec(source) ||
    /\[name="([^"]+)"\]/i.exec(source) ||
    /\[placeholder="([^"]+)"\]/i.exec(source) ||
    /\[aria-label="([^"]+)"\]/i.exec(source) ||
    /^#(.+)$/i.exec(source);

  return String(match?.[1] || source)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'input';
}

function isStableFieldSelector(selector: string | undefined): boolean {
  const normalized = String(selector || '').trim();
  if (!normalized) return false;
  if (normalized.startsWith('kind=')) return false;
  if (/^\[value=/i.test(normalized)) return false;
  return (
    normalized.startsWith('#') ||
    /^\[(data-testid|name|aria-label|placeholder)=/i.test(normalized)
  );
}

function mapEventsToSteps(events: RecorderEvent[], fallbackUrl?: string): FlowStep[] {
  const steps: FlowStep[] = [];
  let firstUrl = normalizeRecordedUrl(fallbackUrl);
  let lastFieldSelectorByScreen = new Map<string, string>();

  if (firstUrl) {
    steps.push({
      action: 'goto',
      url: firstUrl,
      description: 'Open recorded page',
      screenKey: normalizeScreenKey(undefined, firstUrl),
    });
  }

  for (const event of dedupeEvents(events)) {
    const eventUrl = normalizeRecordedUrl(event.url);
    const screenKey = normalizeScreenKey(event.screenKey, event.url);
    if (!firstUrl && eventUrl) {
      firstUrl = eventUrl;
      steps.push({
        action: 'goto',
        url: eventUrl,
        description: 'Open recorded page',
        screenKey,
      });
    }

    if (event.type === 'change') {
      if (String(event.inputType || '').trim().toLowerCase() === 'file') {
        const preferredSelector =
          isStableFieldSelector(event.selector)
            ? event.selector
            : lastFieldSelectorByScreen.get(screenKey) || event.selector;
        if (!preferredSelector) {
          continue;
        }
        steps.push({
          action: 'upload',
          selector: preferredSelector,
          value: event.value || '',
          description: `Upload ${event.value || preferredSelector}`,
          screenKey,
        });
        if (isStableFieldSelector(preferredSelector)) {
          lastFieldSelectorByScreen.set(screenKey, preferredSelector);
        }
        continue;
      }
      const preferredSelector =
        /^\[value=/i.test(String(event.selector || '').trim()) && lastFieldSelectorByScreen.get(screenKey)
          ? lastFieldSelectorByScreen.get(screenKey)!
          : event.selector;
      steps.push({
        action: 'fill',
        selector: preferredSelector,
        value: event.value || '',
        description: `Fill ${preferredSelector}`,
        screenKey,
      });
      if (isStableFieldSelector(preferredSelector)) {
        lastFieldSelectorByScreen.set(screenKey, preferredSelector || '');
      }
      continue;
    }

    if (event.type === 'hover') {
      if (!event.selector || event.selector === 'unknown' || event.selector === 'html > body') {
        continue;
      }
      steps.push({
        action: 'hover',
        selector: event.selector,
        description: event.label ? `Hover ${event.label}` : `Hover ${event.selector}`,
        screenKey,
      });
      continue;
    }

    if (event.type === 'click') {
      if (!event.selector || event.selector === 'unknown' || event.selector === 'html > body') {
        continue;
      }
      if (isStableFieldSelector(event.selector)) {
        lastFieldSelectorByScreen.set(screenKey, event.selector);
      }
      steps.push({
        action: 'click',
        selector: event.selector,
        description: event.label ? `Click ${event.label}` : `Click ${event.selector}`,
        screenKey,
      });
    }
  }

  return steps;
}

function extractRecordedUploads(events: RecorderEvent[]): Array<{
  selector: string;
  screenKey?: string;
  inputKey: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  dataUrl: string;
}> {
  const latestByField = new Map<
    string,
    {
      selector: string;
      screenKey?: string;
      inputKey: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      dataUrl: string;
    }
  >();

  for (const event of dedupeEvents(events)) {
    if (
      event.type !== 'change' ||
      String(event.inputType || '').trim().toLowerCase() !== 'file' ||
      !event.files?.length
    ) {
      continue;
    }

    const firstFile = event.files[0];
    if (!firstFile?.dataUrl) {
      continue;
    }

    const screenKey = normalizeScreenKey(event.screenKey, event.url);
    const selector = String(event.selector || '').trim();
    latestByField.set(`${screenKey}::${selector}`, {
      selector,
      screenKey,
      inputKey: deriveRecordedInputKeyFromSelector(selector),
      fileName: firstFile.fileName,
      mimeType: firstFile.mimeType,
      sizeBytes: firstFile.sizeBytes,
      dataUrl: firstFile.dataUrl,
    });
  }

  return Array.from(latestByField.values());
}

export async function getRecordingSnapshot(sessionId: string): Promise<RecordingSnapshot> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('Recording session not found.');
  }

  await syncSessionEvents(session);
  const steps = mapEventsToSteps(session.events, session.startUrl);
  const recorderState = await getRecorderDebugState(session);
  return {
    sessionId,
    createdAt: session.createdAt,
    currentUrl: session.page.url(),
    eventCount: session.events.length,
    stepCount: steps.length,
    steps,
    code: JSON.stringify(steps, null, 2),
    debug: {
      recorderState,
      recentEvents: session.events.slice(-12),
    },
  };
}

export async function startRecording(payload: { url?: string }): Promise<{ sessionId: string; message: string }> {
  if (!payload.url) {
    throw new Error('Recording requires a URL.');
  }

  const sessionId = buildSessionId();
  const artifactDir = path.join(process.cwd(), 'dashboard', 'artifacts', sessionId);
  await fs.mkdir(artifactDir, { recursive: true });

  const events: RecorderEvent[] = [];
  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const recorderScript = selectorBuilderScript();
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    recordVideo: {
      dir: artifactDir,
      size: { width: 1280, height: 720 },
    },
  });

  await context.exposeBinding('__dashboardRecorderPush', async (_source, payloadFromPage: RecorderEvent) => {
    events.push(payloadFromPage);
  });
  await context.addInitScript(recorderScript);

  const page = await context.newPage();
  page.on('framenavigated', (frame) => {
    if (frame !== page.mainFrame()) return;
    void page.evaluate(recorderScript).catch(() => undefined);
  });
  await page.goto(payload.url, { waitUntil: 'domcontentloaded' });
  await page.evaluate(recorderScript).catch(() => undefined);
  events.push({
    type: 'navigation',
    selector: '',
    value: '',
    url: page.url(),
    timestamp: Date.now(),
  });
  sessions.set(sessionId, {
    sessionId,
    createdAt: new Date().toISOString(),
    startUrl: payload.url,
    browser,
    context,
    page,
    pageVideo: page.video(),
    events,
    artifactDir,
  });

  return {
    sessionId,
    message: 'Recorder started. Interact with the opened browser, then click Stop Recording in the dashboard.',
  };
}

export async function stopRecording(sessionId: string): Promise<{
  sessionId: string;
  currentUrl: string;
  eventCount: number;
  stepCount: number;
  steps: FlowStep[];
  uploadedFiles: Array<{
    selector: string;
    screenKey?: string;
    inputKey: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    dataUrl: string;
  }>;
  code: string;
  artifacts: {
    video: { absolutePath: string; url: string } | null;
  };
  debug?: {
    recorderState?: Record<string, unknown>;
    recentEvents?: RecorderEvent[];
  };
}> {
  const session = sessions.get(sessionId);
  if (!session) {
    throw new Error('Recording session not found.');
  }

  let currentUrl = '';
  let videoAbsolutePath: string | null = null;
  let recorderState: Record<string, unknown> = {};

  try {
    await session.page
      .evaluate(() => {
        const active = document.activeElement;
        if (
          active instanceof HTMLInputElement ||
          active instanceof HTMLTextAreaElement ||
          active instanceof HTMLSelectElement
        ) {
          active.dispatchEvent(new Event('change', { bubbles: true }));
          active.blur();
        }
      })
      .catch(() => undefined);
    await syncSessionEvents(session);
    recorderState = await getRecorderDebugState(session);
    currentUrl = session.page.url();
    await session.page.close().catch(() => undefined);
    try {
      videoAbsolutePath = (await session.pageVideo?.path()) ?? null;
    } catch {
      videoAbsolutePath = null;
    }
    await session.context.close().catch(() => undefined);
    await session.browser.close().catch(() => undefined);
  } finally {
    sessions.delete(sessionId);
  }

  const recordedSteps = mapEventsToSteps(session.events, session.startUrl);
  const summary = {
    sessionId,
    currentUrl,
    eventCount: session.events.length,
    stepCount: recordedSteps.length,
    steps: recordedSteps,
    uploadedFiles: extractRecordedUploads(session.events),
    code: JSON.stringify(recordedSteps, null, 2),
    artifacts: {
      video: videoAbsolutePath
        ? {
            absolutePath: videoAbsolutePath,
            url: `/artifacts/${sessionId}/${path.basename(videoAbsolutePath)}`,
          }
        : null,
    },
    debug: {
      recorderState,
      recentEvents: session.events.slice(-20),
    },
  };

  await fs.writeFile(path.join(session.artifactDir, 'recording-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  return summary;
}
