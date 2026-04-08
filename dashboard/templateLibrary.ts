import { FlowDefinition, TemplateSummary } from './types';

interface TemplateDefinition extends TemplateSummary {
  buildFlow(input: Record<string, string>): FlowDefinition;
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export function joinUrl(baseUrl: string, pagePath: string): string {
  if (/^https?:\/\//i.test(pagePath)) {
    return pagePath;
  }

  const normalizedBaseUrl = trimTrailingSlash(baseUrl);
  const normalizedPath = pagePath.startsWith('/') ? pagePath : `/${pagePath}`;
  return `${normalizedBaseUrl}${normalizedPath}`;
}

const templates: Record<string, TemplateDefinition> = {
  login: {
    id: 'login',
    name: 'Login',
    description: 'Open login page, fill credentials, submit, and verify success.',
    fields: [
      { key: 'baseUrl', label: 'Base URL', type: 'text', required: true, defaultValue: 'http://localhost:5173' },
      { key: 'pagePath', label: 'Page Path', type: 'text', required: true, defaultValue: '/signin' },
      { key: 'timeoutMs', label: 'Timeout (ms)', type: 'number', required: false, defaultValue: '10000' },
      { key: 'username', label: 'Username', type: 'text', required: true, defaultValue: 'admin@basico.local' },
      { key: 'password', label: 'Password', type: 'password', required: true, defaultValue: 'Admin@123' },
      {
        key: 'selectorUsername',
        label: 'Username Field Or Selector',
        type: 'text',
        required: true,
        defaultValue: 'Email',
        selectorKinds: ['auto', 'label', 'placeholder', 'text', 'css'],
        selectorDefaultKind: 'label',
      },
      {
        key: 'selectorPassword',
        label: 'Password Field Or Selector',
        type: 'text',
        required: true,
        defaultValue: 'Mật khẩu',
        selectorKinds: ['auto', 'label', 'placeholder', 'text', 'css'],
        selectorDefaultKind: 'placeholder',
      },
      {
        key: 'selectorSubmit',
        label: 'Submit Button Or Selector',
        type: 'text',
        required: true,
        defaultValue: 'Đăng nhập',
        selectorKinds: ['auto', 'button', 'text', 'css'],
        selectorDefaultKind: 'button',
      },
      {
        key: 'selectorSuccess',
        label: 'Success Text Or Selector',
        type: 'text',
        required: true,
        defaultValue: 'Cài đặt hệ thống',
        selectorKinds: ['auto', 'text', 'button', 'link', 'css'],
        selectorDefaultKind: 'text',
      },
    ],
    buildFlow(input) {
      const targetUrl = joinUrl(input.baseUrl, input.pagePath);
      return {
        name: 'Login Template',
        targetUrl,
        timeoutMs: input.timeoutMs,
        steps: [
          { action: 'goto', url: targetUrl, description: 'Open login page' },
          { action: 'fill', selector: input.selectorUsername, value: input.username, description: 'Fill username' },
          { action: 'fill', selector: input.selectorPassword, value: input.password, description: 'Fill password' },
          { action: 'click', selector: input.selectorSubmit, description: 'Submit login form' },
          { action: 'assertVisible', selector: input.selectorSuccess, description: 'Verify login success' },
        ],
      };
    },
  },
  search: {
    id: 'search',
    name: 'Search',
    description: 'Open page, enter keyword, click search, verify results.',
    fields: [
      { key: 'baseUrl', label: 'Base URL', type: 'text', required: true, defaultValue: 'http://localhost:5173' },
      { key: 'pagePath', label: 'Page Path', type: 'text', required: true, defaultValue: '/users' },
      { key: 'timeoutMs', label: 'Timeout (ms)', type: 'number', required: false, defaultValue: '10000' },
      { key: 'keyword', label: 'Keyword', type: 'text', required: true, defaultValue: 'admin' },
      {
        key: 'selectorInput',
        label: 'Search Input Or Selector',
        type: 'text',
        required: true,
        defaultValue: 'Tìm kiếm',
        selectorKinds: ['auto', 'label', 'placeholder', 'text', 'css'],
        selectorDefaultKind: 'placeholder',
      },
      {
        key: 'selectorButton',
        label: 'Search Button Or Selector',
        type: 'text',
        required: true,
        defaultValue: 'Tìm kiếm',
        selectorKinds: ['auto', 'button', 'text', 'css'],
        selectorDefaultKind: 'button',
      },
      {
        key: 'selectorResult',
        label: 'Result Text Or Selector',
        type: 'text',
        required: true,
        defaultValue: 'table tbody tr',
        selectorKinds: ['auto', 'text', 'css'],
        selectorDefaultKind: 'css',
      },
    ],
    buildFlow(input) {
      const targetUrl = joinUrl(input.baseUrl, input.pagePath);
      return {
        name: 'Search Template',
        targetUrl,
        timeoutMs: input.timeoutMs,
        steps: [
          { action: 'goto', url: targetUrl, description: 'Open search page' },
          { action: 'fill', selector: input.selectorInput, value: input.keyword, description: 'Fill keyword' },
          { action: 'click', selector: input.selectorButton, description: 'Run search' },
          { action: 'assertVisible', selector: input.selectorResult, description: 'Verify at least one result row' },
        ],
      };
    },
  },
  smoke: {
    id: 'smoke',
    name: 'Smoke',
    description: 'Open page and verify key UI elements are visible.',
    fields: [
      { key: 'baseUrl', label: 'Base URL', type: 'text', required: true, defaultValue: 'http://localhost:5173' },
      { key: 'pagePath', label: 'Page Path', type: 'text', required: true, defaultValue: '/' },
      { key: 'timeoutMs', label: 'Timeout (ms)', type: 'number', required: false, defaultValue: '10000' },
      { key: 'selectorHeading', label: 'Heading Selector', type: 'text', required: true, defaultValue: 'h1' },
      {
        key: 'selectorPrimaryAction',
        label: 'Primary Action Selector',
        type: 'text',
        required: true,
        defaultValue: 'button, a',
        selectorKinds: ['auto', 'button', 'link', 'text', 'css'],
        selectorDefaultKind: 'css',
      },
    ],
    buildFlow(input) {
      const targetUrl = joinUrl(input.baseUrl, input.pagePath);
      return {
        name: 'Smoke Template',
        targetUrl,
        timeoutMs: input.timeoutMs,
        steps: [
          { action: 'goto', url: targetUrl, description: 'Open target page' },
          { action: 'assertVisible', selector: input.selectorHeading, description: 'Verify page heading' },
          {
            action: 'assertVisible',
            selector: input.selectorPrimaryAction,
            description: 'Verify primary action is visible',
          },
        ],
      };
    },
  },
};

export function getTemplateSummaries(): TemplateSummary[] {
  return Object.values(templates).map(({ buildFlow, ...summary }) => summary);
}

export function createFlowFromTemplate(templateId: string, input: Record<string, string>): FlowDefinition {
  const template = templates[templateId];
  if (!template) {
    throw new Error(`Unknown template: ${templateId}`);
  }

  return template.buildFlow(input);
}
