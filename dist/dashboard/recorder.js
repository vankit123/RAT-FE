"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRecordingSnapshot = getRecordingSnapshot;
exports.startRecording = startRecording;
exports.stopRecording = stopRecording;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const playwright_1 = require("playwright");
function eventKey(event) {
    return [event.type, event.selector, event.value || '', event.url, String(event.timestamp)].join('::');
}
async function syncSessionEvents(session) {
    try {
        const browserEvents = await session.page.evaluate(() => {
            const recorded = window.__dashboardRecorderEvents;
            return Array.isArray(recorded) ? recorded : [];
        });
        const existing = new Set(session.events.map(eventKey));
        for (const raw of browserEvents) {
            if (!raw || typeof raw !== 'object')
                continue;
            const event = raw;
            const key = eventKey(event);
            if (existing.has(key))
                continue;
            session.events.push(event);
            existing.add(key);
        }
    }
    catch {
        // Best effort. If the page is gone or evaluate fails, keep the server-side
        // buffer only.
    }
}
const sessions = new Map();
function buildSessionId() {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const suffix = Math.random().toString(36).slice(2, 8);
    return `record-${stamp}-${suffix}`;
}
function selectorBuilderScript() {
    return `
    (() => {
      function escapeValue(value) {
        return String(value).replace(/"/g, '\\"');
      }
      function normalizeText(value) {
        return String(value || '').replace(/\\s+/g, ' ').trim();
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
        const stableId = exactTarget.getAttribute('id');
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
      function looksLikeHoverMenuTrigger(element) {
        if (!element || !element.getAttribute) return false;
        if (isFormFieldElement(element) || looksLikeSelectTrigger(element)) {
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
      function resolveHoverMenuTrigger(event) {
        const path = event.composedPath ? event.composedPath() : [];
        const pointTarget = document.elementFromPoint ? document.elementFromPoint(event.clientX, event.clientY) : null;
        const nodes = [...(path.length ? path : [event.target]), pointTarget].map(toElement).filter(Boolean);
        for (const node of nodes) {
          const element = node;
          const trigger = element.closest
            ? element.closest('[data-slot="navigation-menu-trigger"], [role="menuitem"], button[aria-controls], [aria-haspopup="menu"]')
            : null;
          if (trigger && looksLikeHoverMenuTrigger(trigger)) {
            return trigger;
          }
          if (looksLikeHoverMenuTrigger(element)) {
            return element;
          }
        }
        return null;
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
        if (stableId && isStableId(stableId)) return '#' + CSS.escape(stableId);
        const testId = element.getAttribute('data-testid');
        if (testId) return '[data-testid="' + escapeValue(testId) + '"]';
        if (tagName === 'button' || tagName === 'a' || element.getAttribute('role') === 'button' || looksLikeHoverMenuTrigger(element)) {
          const buttonText = conciseVisibleText(element) || normalizeText(element.getAttribute('aria-label') || '');
          if (buttonText) return textSelector(tagName === 'a' ? 'link' : 'button', buttonText);
        }
        const stableAttribute = stableAttributeSelector(element);
        if (stableAttribute) return stableAttribute;
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
        return (
          element.getAttribute('role') === 'combobox' ||
          element.getAttribute('aria-haspopup') === 'listbox' ||
          element.getAttribute('data-slot') === 'select-trigger' ||
          element.getAttribute('data-radix-collection-item') !== null ||
          element.getAttribute('aria-expanded') === 'true' ||
          element.getAttribute('aria-expanded') === 'false'
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
          '[role="option"]',
          '[role="combobox"]',
          '[aria-haspopup="listbox"]',
          '[data-slot="navigation-menu-trigger"]',
          '[data-slot="navigation-menu-content"] a',
          '[data-slot="navigation-menu-content"] button',
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
      if (window.__dashboardRecorderInstalled) return;
      window.__dashboardRecorderInstalled = true;
      window.__dashboardRecorderEvents = Array.isArray(window.__dashboardRecorderEvents) ? window.__dashboardRecorderEvents : [];
      window.__dashboardRecorderLastPointerTarget = null;
      window.__dashboardRecorderLastFieldTarget = null;
      window.__dashboardRecorderPendingSelect = null;
      window.__dashboardRecorderPendingHover = null;
      window.__dashboardRecorderLastHoverSelector = '';
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
        if (window.__dashboardRecorderPendingHover && window.__dashboardRecorderPendingHover.timerId) {
          window.clearTimeout(window.__dashboardRecorderPendingHover.timerId);
        }
        window.__dashboardRecorderPendingHover = null;
      }
      function queueHover(target) {
        if (!target) return;
        if (isFormFieldElement(target) || looksLikeSelectTrigger(target)) {
          return;
        }
        const selector = safeSemanticSelector(target);
        if (!selector || selector === 'unknown' || selector === 'html > body') return;
        if (window.__dashboardRecorderLastHoverSelector === selector) return;

        const existing = window.__dashboardRecorderPendingHover;
        if (existing && existing.selector === selector) {
          return;
        }

        clearPendingHover();
        window.__dashboardRecorderPendingHover = {
          selector,
          timerId: window.setTimeout(() => {
            const pending = window.__dashboardRecorderPendingHover;
            if (!pending || pending.selector !== selector || !target.isConnected) {
              return;
            }
            window.__dashboardRecorderLastHoverSelector = selector;
            pushRecorderEvent({
              type: 'hover',
              selector,
              label: normalizeText(target.innerText || target.textContent || '').slice(0, 80),
              inputType: '',
              value: '',
              url: location.href,
              timestamp: Date.now(),
            });
            clearPendingHover();
          }, 180),
        };
      }
      document.addEventListener('pointerdown', (event) => {
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
        const relatedTarget = event.relatedTarget;
        const target = resolveHoverMenuTrigger(event);
        if (!target) {
          clearPendingHover();
          return;
        }
        if (relatedTarget && relatedTarget.nodeType === Node.ELEMENT_NODE && target.contains(relatedTarget)) {
          return;
        }
        clearPendingHover();
      }, true);
      document.addEventListener('click', (event) => {
        clearPendingHover();
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
function dedupeEvents(events) {
    const deduped = [];
    for (const event of events) {
        const previous = deduped[deduped.length - 1];
        if (previous &&
            previous.type === 'change' &&
            event.type === 'change' &&
            previous.selector === event.selector &&
            previous.url === event.url) {
            deduped[deduped.length - 1] = event;
            continue;
        }
        deduped.push(event);
    }
    return deduped;
}
function normalizeRecordedUrl(value) {
    const normalized = String(value || '').trim();
    return normalized && normalized !== 'about:blank' ? normalized : '';
}
function normalizeScreenKey(value, fallbackUrl) {
    const explicit = String(value || '').trim();
    if (explicit)
        return explicit;
    const normalizedUrl = normalizeRecordedUrl(fallbackUrl);
    if (!normalizedUrl)
        return 'screen';
    try {
        const parsed = new URL(normalizedUrl);
        const pathKey = parsed.pathname
            .replace(/^\/+|\/+$/g, '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '_')
            .replace(/^_+|_+$/g, '');
        return pathKey || 'home';
    }
    catch {
        return 'screen';
    }
}
function isStableFieldSelector(selector) {
    const normalized = String(selector || '').trim();
    if (!normalized)
        return false;
    if (normalized.startsWith('kind='))
        return false;
    if (/^\[value=/i.test(normalized))
        return false;
    return (normalized.startsWith('#') ||
        /^\[(data-testid|name|aria-label|placeholder)=/i.test(normalized));
}
function mapEventsToSteps(events, fallbackUrl) {
    const steps = [];
    let firstUrl = normalizeRecordedUrl(fallbackUrl);
    let lastFieldSelectorByScreen = new Map();
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
            const preferredSelector = /^\[value=/i.test(String(event.selector || '').trim()) && lastFieldSelectorByScreen.get(screenKey)
                ? lastFieldSelectorByScreen.get(screenKey)
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
async function getRecordingSnapshot(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
        throw new Error('Recording session not found.');
    }
    await syncSessionEvents(session);
    const steps = mapEventsToSteps(session.events, session.startUrl);
    return {
        sessionId,
        createdAt: session.createdAt,
        currentUrl: session.page.url(),
        eventCount: session.events.length,
        stepCount: steps.length,
        steps,
        code: JSON.stringify(steps, null, 2),
    };
}
async function startRecording(payload) {
    if (!payload.url) {
        throw new Error('Recording requires a URL.');
    }
    const sessionId = buildSessionId();
    const artifactDir = path_1.default.join(process.cwd(), 'dashboard', 'artifacts', sessionId);
    await promises_1.default.mkdir(artifactDir, { recursive: true });
    const events = [];
    const browser = await playwright_1.chromium.launch({ headless: false, slowMo: 100 });
    const recorderScript = selectorBuilderScript();
    const context = await browser.newContext({
        viewport: { width: 1440, height: 960 },
        recordVideo: {
            dir: artifactDir,
            size: { width: 1280, height: 720 },
        },
    });
    await context.exposeBinding('__dashboardRecorderPush', async (_source, payloadFromPage) => {
        events.push(payloadFromPage);
    });
    await context.addInitScript(recorderScript);
    const page = await context.newPage();
    page.on('framenavigated', (frame) => {
        if (frame !== page.mainFrame())
            return;
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
async function stopRecording(sessionId) {
    const session = sessions.get(sessionId);
    if (!session) {
        throw new Error('Recording session not found.');
    }
    let currentUrl = '';
    let videoAbsolutePath = null;
    try {
        await session.page
            .evaluate(() => {
            const active = document.activeElement;
            if (active instanceof HTMLInputElement ||
                active instanceof HTMLTextAreaElement ||
                active instanceof HTMLSelectElement) {
                active.dispatchEvent(new Event('change', { bubbles: true }));
                active.blur();
            }
        })
            .catch(() => undefined);
        await syncSessionEvents(session);
        currentUrl = session.page.url();
        await session.page.close().catch(() => undefined);
        try {
            videoAbsolutePath = (await session.pageVideo?.path()) ?? null;
        }
        catch {
            videoAbsolutePath = null;
        }
        await session.context.close().catch(() => undefined);
        await session.browser.close().catch(() => undefined);
    }
    finally {
        sessions.delete(sessionId);
    }
    const recordedSteps = mapEventsToSteps(session.events, session.startUrl);
    const summary = {
        sessionId,
        currentUrl,
        eventCount: session.events.length,
        stepCount: recordedSteps.length,
        steps: recordedSteps,
        code: JSON.stringify(recordedSteps, null, 2),
        artifacts: {
            video: videoAbsolutePath
                ? {
                    absolutePath: videoAbsolutePath,
                    url: `/artifacts/${sessionId}/${path_1.default.basename(videoAbsolutePath)}`,
                }
                : null,
        },
    };
    await promises_1.default.writeFile(path_1.default.join(session.artifactDir, 'recording-summary.json'), JSON.stringify(summary, null, 2), 'utf8');
    return summary;
}
