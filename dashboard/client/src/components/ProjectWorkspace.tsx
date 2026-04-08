import { FormEvent, useEffect, useMemo, useState } from 'react';
import { LoginTemplateInput, Project, ProjectRequest, StatusTone, TemplateSummary, TestCase, TestCaseDataSet, TestCaseRequest, TestCaseStep, TestCaseStepRequest, TestDataSet, TestDataSetRequest } from '../types';
import { StatusPill } from './StatusPill';

type ProjectWorkspaceProps = {
  project: Project;
  templates: TemplateSummary[];
  testCases: TestCase[];
  testCaseDataSets: TestCaseDataSet[];
  testCaseSteps: TestCaseStep[];
  testDataSets: TestDataSet[];
  status: string;
  statusTone?: StatusTone;
  onOpenRecorder(): void;
  checkBaseUrl(url: string): Promise<{ ok: boolean; status?: number; error?: string }>;
  onUpdateProject(project: Project, payload: ProjectRequest): Promise<void>;
  onCreateTestCase(
    payload: Omit<TestCaseRequest, 'projectId' | 'type' | 'status'>,
    template: TemplateSummary,
    input: LoginTemplateInput
  ): Promise<void>;
  onRunTestCase(testCase: TestCase): Promise<void>;
  onRunMultipleTestCases(testCases: TestCase[]): Promise<void>;
  onStopTestRun(): void;
  onDeleteTestCase(testCase: TestCase): Promise<void>;
  onDeleteTestCaseStep(step: TestCaseStep): Promise<void>;
  onDeleteTestDataSet(testCase: TestCase, dataSet: TestDataSet): Promise<void>;
  onUpdateTestCase(
    testCase: TestCase,
    payload: TestCaseRequest,
    dataSetUpdates?: Array<{ id: number; payload: TestDataSetRequest }>,
    stepUpdates?: Array<{ id: number; payload: TestCaseStepRequest }>,
    newDataSet?: TestDataSetRequest,
    newStep?: TestCaseStepRequest
  ): Promise<void>;
  runningTestCaseId: number | null;
};

export function ProjectWorkspace({ project, templates, testCases, testCaseDataSets, testCaseSteps, testDataSets, status, statusTone, onOpenRecorder, checkBaseUrl, onUpdateProject, onCreateTestCase, onRunTestCase, onRunMultipleTestCases, onStopTestRun, onDeleteTestCase, onDeleteTestCaseStep, onDeleteTestDataSet, onUpdateTestCase, runningTestCaseId }: ProjectWorkspaceProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(templates[0]?.id || '');
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [createMode, setCreateMode] = useState<'template' | 'recorder'>('template');
  const [editingProjectUrl, setEditingProjectUrl] = useState(false);
  const [editingTestCaseId, setEditingTestCaseId] = useState<number | null>(null);
  const [addingDataSetForTestCaseId, setAddingDataSetForTestCaseId] = useState<number | null>(null);
  const [expandedTestCaseInfoForId, setExpandedTestCaseInfoForId] = useState<Record<number, boolean>>({});
  const [expandedDataSetsForTestCaseId, setExpandedDataSetsForTestCaseId] = useState<Record<number, boolean>>({});
  const [expandedStepsForTestCaseId, setExpandedStepsForTestCaseId] = useState<number | null>(null);
  const [expandedDataJsonKeys, setExpandedDataJsonKeys] = useState<Record<string, boolean>>({});
  const [dataJsonModes, setDataJsonModes] = useState<Record<string, 'json' | 'builder'>>({});
  const [expectedJsonModes, setExpectedJsonModes] = useState<Record<string, 'json' | 'builder'>>({});
  const [expectedSelectorKinds, setExpectedSelectorKinds] = useState<Record<string, string>>({});
  const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});
  const [editError, setEditError] = useState('');
  const [projectUrlCheckMessage, setProjectUrlCheckMessage] = useState('');
  const [projectUrlCheckTone, setProjectUrlCheckTone] = useState<'running' | 'passed' | 'failed' | undefined>();
  const [submitting, setSubmitting] = useState(false);
  const [selectedTestCaseIds, setSelectedTestCaseIds] = useState<number[]>([]);
  const selectedTemplate = useMemo(
    () => templates.find((template) => template.id === selectedTemplateId) || templates[0],
    [selectedTemplateId, templates]
  );

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setSubmitting(true);
    setEditError('');
    try {
      await onCreateTestCase({
        code: String(data.get('code') || '').trim(),
        name: String(data.get('name') || '').trim(),
        description: String(data.get('description') || '').trim(),
      }, selectedTemplate, {
        pagePath: String(data.get('pagePath') || '').trim(),
        emailSelector: String(data.get('emailSelector') || '').trim(),
        passwordSelector: String(data.get('passwordSelector') || '').trim(),
        submitSelectorKind: String(data.get('submitSelectorKind') || 'auto') as LoginTemplateInput['submitSelectorKind'],
        submitSelector: String(data.get('submitSelector') || '').trim(),
        successSelectorKind: String(data.get('successSelectorKind') || 'css') as LoginTemplateInput['successSelectorKind'],
        successSelector: String(data.get('successSelector') || '').trim(),
        username: String(data.get('username') || '').trim(),
        password: String(data.get('password') || '').trim(),
      });
      form.reset();
      setCreatePanelOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    setSelectedTestCaseIds((current) =>
      current.filter((id) => testCases.some((testCase) => testCase.id === id))
    );
  }, [testCases]);

  async function handleProjectUrlSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const baseUrl = String(data.get('projectBaseUrl') || '').trim();
    setSubmitting(true);
    setProjectUrlCheckMessage('');
    setProjectUrlCheckTone('running');
    try {
      const urlCheck = await checkBaseUrl(baseUrl);
      if (!urlCheck.ok) {
        setProjectUrlCheckTone('failed');
        setProjectUrlCheckMessage(`Không thể truy cập URL web${urlCheck.status ? ` (HTTP ${urlCheck.status})` : ''}: ${urlCheck.error || 'Vui lòng kiểm tra lại URL.'}`);
        return;
      }

      setProjectUrlCheckTone('passed');
      setProjectUrlCheckMessage(baseUrl ? `URL web truy cập được${urlCheck.status ? ` (HTTP ${urlCheck.status})` : ''}.` : '');
      await onUpdateProject(project, {
        code: project.code,
        name: project.name,
        description: project.description || '',
        baseUrl,
        status: project.status || 'ACTIVE',
      });
      setEditingProjectUrl(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleEditSubmit(event: FormEvent<HTMLFormElement>, testCase: TestCase) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const stepsForCurrentTestCase = getStepsForTestCase(testCase.id);
    setSubmitting(true);
    try {
      const dataSetUpdates = getAttachedDataSets(testCase.id).map((dataSet) => {
        const dataSetJson = String(data.get(`dataJson-${dataSet.id}`) || '').trim();
        const expectedJson = String(data.get(`expectedJson-${dataSet.id}`) || '').trim();
        const dataKey = dataSetModeKey(dataSet.id);
        return {
          id: dataSet.id,
          payload: {
            projectId: project.id,
            code: String(data.get(`dataSetCode-${dataSet.id}`) || '').trim(),
            name: String(data.get(`dataSetName-${dataSet.id}`) || '').trim(),
            description: String(data.get(`dataSetDescription-${dataSet.id}`) || '').trim(),
            dataJson: dataJsonMode(dataKey) === 'json'
              ? dataSetJson ? JSON.parse(dataSetJson) as Record<string, unknown> : {}
              : buildDataJson(data, `dataSet-${dataSet.id}`, dataSet.dataJson),
            expectedJson: expectedJsonMode(dataKey) === 'json'
              ? expectedJson ? JSON.parse(expectedJson) as Record<string, unknown> : {}
              : buildExpectedJson(data, `expected-${dataSet.id}`),
            status: String(data.get(`dataSetStatus-${dataSet.id}`) || '').trim(),
          },
        };
      });
      const newDataSetCode = String(data.get('newDataSetCode') || '').trim();
      const newDataSetJson = String(data.get('newDataJson') || '').trim();
      const newExpectedJson = String(data.get('newExpectedJson') || '').trim();
      const newKey = dataSetModeKey('new');
      const recordedTemplateDataJson = getAttachedDataSets(testCase.id).find((dataSet) => recordedDataEntries(dataSet.dataJson).length)?.dataJson;
      const newDataSet = newDataSetCode ? {
        projectId: project.id,
        code: newDataSetCode,
        name: String(data.get('newDataSetName') || '').trim() || newDataSetCode,
        description: String(data.get('newDataSetDescription') || '').trim(),
        dataJson: dataJsonMode(newKey) === 'json'
          ? newDataSetJson ? JSON.parse(newDataSetJson) as Record<string, unknown> : {}
          : buildDataJson(data, 'newData', recordedTemplateDataJson),
        expectedJson: expectedJsonMode(newKey) === 'json'
          ? newExpectedJson ? JSON.parse(newExpectedJson) as Record<string, unknown> : {}
          : buildExpectedJson(data, 'newExpected'),
        status: String(data.get('newDataSetStatus') || '').trim() || 'active',
      } : undefined;
      const stepUpdates = expandedStepsForTestCaseId === testCase.id
        ? stepsForCurrentTestCase.map((step) => ({
          id: step.id,
          payload: {
            testCaseId: testCase.id,
            stepOrder: Number(data.get(`stepOrder-${step.id}`) || step.stepOrder),
            actionType: String(data.get(`actionType-${step.id}`) || step.actionType).trim(),
            target: emptyToNull(formatTargetHint(
              String(data.get(`targetKind-${step.id}`) || 'raw'),
              String(data.get(`target-${step.id}`) ?? step.target ?? '')
            )),
            value: emptyToNull(String(data.get(`value-${step.id}`) ?? step.value ?? '').trim()),
            expectedValue: emptyToNull(String(data.get(`expectedValue-${step.id}`) ?? step.expectedValue ?? '').trim()),
            description: String(data.get(`stepDescription-${step.id}`) ?? step.description ?? '').trim(),
          },
        }))
        : [];
      const newStepActionType = String(data.get('newStepActionType') || '').trim();
      const newStep = expandedStepsForTestCaseId === testCase.id && newStepActionType
        ? {
          testCaseId: testCase.id,
          stepOrder: Number(data.get('newStepOrder') || stepsForCurrentTestCase.length + 1),
          actionType: newStepActionType,
          target: emptyToNull(formatTargetHint(
            String(data.get('newStepTargetKind') || 'raw'),
            String(data.get('newStepTarget') || '')
          )),
          value: emptyToNull(String(data.get('newStepValue') || '').trim()),
          expectedValue: emptyToNull(String(data.get('newStepExpectedValue') || '').trim()),
          description: String(data.get('newStepDescription') || '').trim(),
        }
        : undefined;
      const expectedJsonForAutoStep = findExpectedJsonForAutoStep(dataSetUpdates, newDataSet);
      const existingPassConditionStep = findPassConditionStep(stepsForCurrentTestCase);
      const maxStepOrder = Math.max(0, ...stepsForCurrentTestCase.map((step) => Number(step.stepOrder) || 0));
      const expectedStepOrder = existingPassConditionStep && existingPassConditionStep.stepOrder >= maxStepOrder
        ? existingPassConditionStep.stepOrder
        : maxStepOrder + 1;
      const shouldSyncExpectedStep = Boolean(nestedString(expectedJsonForAutoStep, 'result.selector')) && expandedStepsForTestCaseId !== testCase.id;
      const autoExpectedStepUpdate = shouldSyncExpectedStep && existingPassConditionStep
        ? {
          id: existingPassConditionStep.id,
          payload: {
            testCaseId: testCase.id,
            stepOrder: expectedStepOrder,
            actionType: 'assertVisible',
            target: '${expected.result.selector}',
            value: null,
            expectedValue: '${expected.result.value}',
            description: existingPassConditionStep.description || 'Kiểm tra kết quả mong muốn từ Expected JSON',
          },
        }
        : undefined;
      const finalStepUpdates = autoExpectedStepUpdate ? [...stepUpdates, autoExpectedStepUpdate] : stepUpdates;
      const autoExpectedStep = !newStep && !existingPassConditionStep && nestedString(expectedJsonForAutoStep, 'result.selector')
        ? {
          testCaseId: testCase.id,
          stepOrder: maxStepOrder + 1,
          actionType: 'assertVisible',
          target: '${expected.result.selector}',
          value: null,
          expectedValue: '${expected.result.value}',
          description: 'Kiểm tra kết quả mong muốn từ Expected JSON',
        }
        : undefined;

      await onUpdateTestCase(testCase, {
        projectId: project.id,
        code: String(data.get('code') || '').trim(),
        name: String(data.get('name') || '').trim(),
        description: String(data.get('description') || '').trim(),
        type: String(data.get('type') || '').trim(),
        status: String(data.get('status') || '').trim(),
      }, dataSetUpdates, finalStepUpdates, newDataSet, newStep || autoExpectedStep);
      setEditingTestCaseId(null);
      setAddingDataSetForTestCaseId(null);
      setExpandedStepsForTestCaseId(null);
    } catch (error) {
      setEditError(error instanceof SyntaxError ? 'Data JSON không hợp lệ. Vui lòng kiểm tra lại cú pháp JSON.' : error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  function getAttachedDataSets(testCaseId: number): TestDataSet[] {
    const dataSetIds = new Set(
      testCaseDataSets
        .filter((item) => item.testCaseId === testCaseId)
        .map((item) => item.testDataSetId)
    );
    return testDataSets.filter((dataSet) => dataSetIds.has(dataSet.id));
  }

  function getStepsForTestCase(testCaseId: number): TestCaseStep[] {
    return testCaseSteps
      .filter((step) => step.testCaseId === testCaseId)
      .sort((left, right) => left.stepOrder - right.stepOrder);
  }

  function hasManualRunRequirement(testCaseId: number): boolean {
    const hasDataSetManualFlag = getAttachedDataSets(testCaseId).some((dataSet) => {
      if (!dataSet.dataJson || typeof dataSet.dataJson !== 'object') return false;
      const payment = (dataSet.dataJson as Record<string, unknown>).payment;
      if (!payment || typeof payment !== 'object') return false;
      const vnpay = (payment as Record<string, unknown>).vnpay;
      if (!vnpay || typeof vnpay !== 'object') return false;
      const provider = String((vnpay as Record<string, unknown>).provider || '').trim().toLowerCase();
      return provider === 'vnpay';
    });

    if (hasDataSetManualFlag) {
      return true;
    }

    const vnpayStepPattern = /sandbox\.vnpayment\.vn|paymentv2\/vpcpay\.html|paymentmethod\.html|payviavnpay|waitforurl|vnp_|paymethod|cardholder|carddate|issuedate|otp|thẻ nội địa|tài khoản ngân hàng|thanh toán/i;

    return getStepsForTestCase(testCaseId).some((step) => {
      const actionType = String(step.actionType || '').trim().toLowerCase();
      const target = String(step.target || '').trim();
      const value = String(step.value || '').trim();
      const expectedValue = String(step.expectedValue || '').trim();
      const description = String(step.description || '').trim();
      return [actionType, target, value, expectedValue, description].some((text) => vnpayStepPattern.test(text));
    });
  }

  function toggleSelectedTestCase(testCaseId: number): void {
    setSelectedTestCaseIds((current) =>
      current.includes(testCaseId)
        ? current.filter((id) => id !== testCaseId)
        : [...current, testCaseId]
    );
  }

  function selectAllTestCases(): void {
    setSelectedTestCaseIds(testCases.map((testCase) => testCase.id));
  }

  function clearSelectedTestCases(): void {
    setSelectedTestCaseIds([]);
  }

  function emptyToNull(value: string): string | null {
    return value ? value : null;
  }

  function formatExpectedSelector(kind: string, value: string): string {
    const trimmedValue = value.trim();
    return kind === 'auto' ? trimmedValue : `kind=${kind}::${trimmedValue}`;
  }

  function formatTargetHint(kind: string, value: string): string {
    const trimmedValue = value.trim();
    return kind === 'raw' || kind === 'auto' ? trimmedValue : `kind=${kind}::${trimmedValue}`;
  }

  function parseExpectedSelector(value: string): { kind: string; target: string } {
    const matched = /^kind=(auto|text|button|link|label|placeholder|css)::([\s\S]*)$/i.exec(value.trim());
    if (matched) {
      return { kind: matched[1].toLowerCase(), target: matched[2].trim() };
    }
    return { kind: value.trim().startsWith('.') || value.trim().startsWith('#') ? 'css' : 'auto', target: value };
  }

  function parseTargetHint(value: string | null | undefined): { kind: string; target: string } {
    const normalized = String(value || '').trim();
    const matched = /^kind=(auto|text|button|link|label|placeholder|css)::([\s\S]*)$/i.exec(normalized);
    if (matched) {
      return { kind: matched[1].toLowerCase(), target: matched[2].trim() };
    }
    return { kind: 'raw', target: normalized };
  }

  function dataSetModeKey(id: number | 'new'): string {
    return String(id);
  }

  function dataJsonMode(key: string): 'json' | 'builder' {
    return dataJsonModes[key] || 'builder';
  }

  function expectedJsonMode(key: string): 'json' | 'builder' {
    return expectedJsonModes[key] || 'builder';
  }

  function setDataJsonMode(key: string, mode: 'json' | 'builder'): void {
    setDataJsonModes((current) => ({ ...current, [key]: mode }));
  }

  function dataJsonExpanded(key: string): boolean {
    return Boolean(expandedDataJsonKeys[key]);
  }

  function toggleDataJsonExpanded(key: string): void {
    setExpandedDataJsonKeys((current) => ({ ...current, [key]: !current[key] }));
  }

  function setExpectedJsonMode(key: string, mode: 'json' | 'builder'): void {
    setExpectedJsonModes((current) => ({ ...current, [key]: mode }));
  }

  function expectedSelectorKind(key: string, selectorValue: string): string {
    return expectedSelectorKinds[key] || parseExpectedSelector(selectorValue).kind;
  }

  function setExpectedSelectorKind(key: string, kind: string): void {
    setExpectedSelectorKinds((current) => ({ ...current, [key]: kind }));
  }

  function nestedString(value: unknown, path: string, fallback = ''): string {
    const found = path.split('.').reduce<unknown>((current, key) => {
      if (current && typeof current === 'object' && key in current) {
        return (current as Record<string, unknown>)[key];
      }
      return undefined;
    }, value);
    return found === undefined || found === null ? fallback : String(found);
  }

  function passwordType(key: string): 'text' | 'password' {
    return showPasswords[key] ? 'text' : 'password';
  }

  function togglePassword(key: string): void {
    setShowPasswords((current) => ({ ...current, [key]: !current[key] }));
  }

  function passwordToggleLabel(key: string): string {
    return showPasswords[key] ? 'Ẩn' : 'Hiện';
  }

  function parseVnpayConfig(dataJson: unknown): {
    mode: 'auto' | 'manual-complete';
    bankText: string;
    bankSelector: string;
    cardNumber: string;
    cardHolderName: string;
    issueDate: string;
    otp: string;
    returnUrl: string;
  } {
    if (!dataJson || typeof dataJson !== 'object') {
      return {
        mode: 'auto',
        bankText: '',
        bankSelector: '',
        cardNumber: '',
        cardHolderName: '',
        issueDate: '',
        otp: '',
        returnUrl: '',
      };
    }

    const payment = (dataJson as Record<string, unknown>).payment;
    const vnpay = payment && typeof payment === 'object' ? (payment as Record<string, unknown>).vnpay : null;
    const raw = vnpay && typeof vnpay === 'object' ? vnpay as Record<string, unknown> : {};

    return {
      mode: String(raw.mode || 'auto').trim().toLowerCase() === 'manual-complete' ? 'manual-complete' : 'auto',
      bankText: raw.bankText === undefined || raw.bankText === null ? '' : String(raw.bankText),
      bankSelector: raw.bankSelector === undefined || raw.bankSelector === null ? '' : String(raw.bankSelector),
      cardNumber: raw.cardNumber === undefined || raw.cardNumber === null ? '' : String(raw.cardNumber),
      cardHolderName: raw.cardHolderName === undefined || raw.cardHolderName === null ? '' : String(raw.cardHolderName),
      issueDate: raw.issueDate === undefined || raw.issueDate === null ? '' : String(raw.issueDate),
      otp: raw.otp === undefined || raw.otp === null ? '' : String(raw.otp),
      returnUrl: raw.returnUrl === undefined || raw.returnUrl === null ? '' : String(raw.returnUrl),
    };
  }

  function buildVnpayConfig(data: FormData, prefix: string, currentDataJson: unknown): Record<string, unknown> | undefined {
    const current = parseVnpayConfig(currentDataJson);
    const mode = String(data.get(`${prefix}VnpayMode`) || current.mode || 'auto').trim().toLowerCase() === 'manual-complete'
      ? 'manual-complete'
      : 'auto';
    const bankText = String(data.get(`${prefix}VnpayBankText`) || current.bankText || '').trim();
    const bankSelector = String(data.get(`${prefix}VnpayBankSelector`) || current.bankSelector || '').trim();
    const cardNumber = String(data.get(`${prefix}VnpayCardNumber`) || current.cardNumber || '').trim();
    const cardHolderName = String(data.get(`${prefix}VnpayCardHolderName`) || current.cardHolderName || '').trim();
    const issueDate = String(data.get(`${prefix}VnpayIssueDate`) || current.issueDate || '').trim();
    const otp = String(data.get(`${prefix}VnpayOtp`) || current.otp || '').trim();
    const returnUrl = String(data.get(`${prefix}VnpayReturnUrl`) || current.returnUrl || '').trim();

    if (![bankText, bankSelector, cardNumber, cardHolderName, issueDate, otp, returnUrl].some(Boolean)) {
      return undefined;
    }

    return {
      provider: 'vnpay',
      mode,
      bankText,
      bankSelector,
      cardNumber,
      cardHolderName,
      issueDate,
      otp,
      returnUrl,
    };
  }

  function withVnpayConfig(
    baseDataJson: Record<string, unknown>,
    data: FormData,
    prefix: string,
    currentDataJson: unknown
  ): Record<string, unknown> {
    const payment = buildVnpayConfig(data, prefix, currentDataJson);
    if (!payment) {
      return baseDataJson;
    }

    const currentPayment =
      currentDataJson && typeof currentDataJson === 'object' && (currentDataJson as Record<string, unknown>).payment && typeof (currentDataJson as Record<string, unknown>).payment === 'object'
        ? (currentDataJson as Record<string, unknown>).payment as Record<string, unknown>
        : {};

    return {
      ...baseDataJson,
      payment: {
        ...currentPayment,
        vnpay: payment,
      },
    };
  }

  function buildLoginDataJson(data: FormData, prefix: string): Record<string, unknown> {
    return {
      validUser: {
        username: String(data.get(`${prefix}Username`) || '').trim(),
        password: String(data.get(`${prefix}Password`) || '').trim(),
      },
    };
  }

  function buildDataJson(data: FormData, prefix: string, currentDataJson: unknown): Record<string, unknown> {
    const recordedEntries = recordedDataEntries(currentDataJson);
    const baseDataJson = !recordedEntries.length ? buildLoginDataJson(data, prefix) : {
      recorded: Object.fromEntries(recordedEntries.map((entry) => [
        entry.key,
        {
          action: String(data.get(`${prefix}Recorded-${entry.key}-Action`) ?? entry.action).trim(),
          target: String(data.get(`${prefix}Recorded-${entry.key}-Target`) ?? entry.target).trim(),
          value: String(data.get(`${prefix}Recorded-${entry.key}-Value`) ?? entry.value).trim(),
        },
      ])),
    };
    return withVnpayConfig(baseDataJson, data, prefix, currentDataJson);
  }

  function buildExpectedJson(data: FormData, prefix: string): Record<string, unknown> {
    const selectorKind = String(data.get(`${prefix}SelectorKind`) || 'css');
    const selectorValue = String(data.get(`${prefix}SelectorValue`) || '').trim();
    const result: Record<string, string> = {
      selector: selectorValue ? formatExpectedSelector(selectorKind, selectorValue) : '',
      value: String(data.get(`${prefix}Value`) || 'visible').trim() || 'visible',
    };
    const expectedUrl = String(data.get(`${prefix}Url`) || '').trim();
    if (selectorKind === 'link' && expectedUrl) result.url = expectedUrl;
    return {
      result,
    };
  }

  function expectedTargetLabel(kind: string): string {
    if (kind === 'css') return 'Target mong muốn';
    if (kind === 'text') return 'Text mong muốn';
    if (kind === 'button') return 'Tên button mong muốn';
    if (kind === 'link') return 'Tên link mong muốn';
    if (kind === 'label') return 'Label mong muốn';
    if (kind === 'placeholder') return 'Placeholder mong muốn';
    return 'Giá trị mong muốn';
  }

  function expectedTargetPlaceholder(kind: string): string {
    if (kind === 'css') return 'VD: .dashboard';
    if (kind === 'text') return 'VD: Login success';
    if (kind === 'button') return 'VD: Dashboard';
    if (kind === 'link') return 'VD: Dashboard';
    if (kind === 'label') return 'VD: Email';
    if (kind === 'placeholder') return 'VD: Tìm kiếm';
    return 'VD: Login success hoặc .dashboard';
  }

  function recordedDataEntries(dataJson: unknown): Array<{ key: string; action: string; target: string; value: string }> {
    if (!dataJson || typeof dataJson !== 'object') return [];
    const recorded = (dataJson as Record<string, unknown>).recorded;
    if (!recorded || typeof recorded !== 'object') return [];
    return Object.entries(recorded as Record<string, unknown>)
      .filter(([, value]) => value && typeof value === 'object')
      .map(([key, value]) => {
        const item = value as Record<string, unknown>;
        return {
          key,
          action: item.action === undefined || item.action === null ? '' : String(item.action),
          target: item.target === undefined || item.target === null ? '' : String(item.target),
          value: item.value === undefined || item.value === null ? '' : String(item.value),
        };
      })
      .sort((left, right) => recordedStepNumber(left.key) - recordedStepNumber(right.key));
  }

  function recordedStepNumber(key: string): number {
    const matched = /(\d+)/.exec(key);
    return matched ? Number(matched[1]) : Number.MAX_SAFE_INTEGER;
  }

  function renderVnpayBuilder(prefix: string, currentDataJson: unknown) {
    const config = parseVnpayConfig(currentDataJson);
    return (
      <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50/70 p-4">
        <div>
          <h6 className="font-bold text-slate-900">Thanh toán ngoài hệ thống (VNPAY)</h6>
          <p className="mt-1 text-sm text-slate-600">
            Nếu luồng đi qua VNPAY sandbox, runner sẽ ưu tiên mở Chrome thật, thử auto-fill theo dataSet này, rồi fallback sang manual-complete nếu gateway vẫn chặn.
          </p>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="grid gap-2">
            <span className="text-sm text-slate-600">Chế độ thanh toán</span>
            <select className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue={config.mode} name={`${prefix}VnpayMode`}>
              <option value="auto">Auto-fill trước, fallback manual-complete</option>
              <option value="manual-complete">Manual-complete ngay trên Chrome</option>
            </select>
          </label>
          <label className="grid gap-2">
            <span className="text-sm text-slate-600">Nội dung chọn ngân hàng / loại thẻ</span>
            <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue={config.bankText} name={`${prefix}VnpayBankText`} placeholder="VD: NCB" />
          </label>
          <label className="grid gap-2">
            <span className="text-sm text-slate-600">Bank selector</span>
            <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue={config.bankSelector} name={`${prefix}VnpayBankSelector`} placeholder="Tùy chọn, VD: .bank-ncb hoặc [data-bank='NCB']" />
          </label>
          <label className="grid gap-2">
            <span className="text-sm text-slate-600">Số thẻ</span>
            <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue={config.cardNumber} name={`${prefix}VnpayCardNumber`} placeholder="9704198526191432198" />
          </label>
          <label className="grid gap-2">
            <span className="text-sm text-slate-600">Tên chủ thẻ</span>
            <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue={config.cardHolderName} name={`${prefix}VnpayCardHolderName`} placeholder="NGUYEN VAN A" />
          </label>
          <label className="grid gap-2">
            <span className="text-sm text-slate-600">Ngày phát hành</span>
            <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue={config.issueDate} name={`${prefix}VnpayIssueDate`} placeholder="07/15" />
          </label>
          <label className="grid gap-2">
            <span className="text-sm text-slate-600">OTP</span>
            <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue={config.otp} name={`${prefix}VnpayOtp`} placeholder="123456" />
          </label>
          <label className="grid gap-2">
            <span className="text-sm text-slate-600">Return URL sau thanh toán</span>
            <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue={config.returnUrl} name={`${prefix}VnpayReturnUrl`} placeholder="VD: http://localhost:8082/api/transactions/ipn/VNPAY" />
          </label>
        </div>
      </div>
    );
  }

  function hasPassConditionStep(steps: TestCaseStep[]): boolean {
    return Boolean(findPassConditionStep(steps));
  }

  function findPassConditionStep(steps: TestCaseStep[]): TestCaseStep | undefined {
    return steps.find((step) => {
      const normalized = step.actionType.replace(/[\s_-]/g, '').toLowerCase();
      return normalized === 'assertvisible' || normalized === 'asserttext' || normalized === 'asserturlcontains';
    });
  }

  function findExpectedJsonForAutoStep(
    dataSetUpdates: Array<{ id: number; payload: TestDataSetRequest }>,
    newDataSet?: TestDataSetRequest
  ): Record<string, unknown> {
    return dataSetUpdates.find((dataSetUpdate) => nestedString(dataSetUpdate.payload.expectedJson, 'result.selector'))?.payload.expectedJson
      || newDataSet?.expectedJson
      || {};
  }

  function testCaseInfoExpanded(testCaseId: number): boolean {
    return expandedTestCaseInfoForId[testCaseId] !== false;
  }

  function dataSetsExpanded(testCaseId: number): boolean {
    return expandedDataSetsForTestCaseId[testCaseId] !== false;
  }

  return (
    <section className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-2xl shadow-blue-900/10 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-blue-700">Selected Project</p>
          <h2 className="text-3xl font-black tracking-tight">Tạo test case cho {project.name}</h2>
          <p className="mt-2 text-slate-600">{project.code}{project.baseUrl ? ` - ${project.baseUrl}` : ''}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3">
          <button
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 font-bold text-slate-700"
            type="button"
            onClick={() => setEditingProjectUrl((value) => !value)}
          >
            {editingProjectUrl ? 'Đóng sửa URL web' : 'Sửa URL web'}
          </button>
          <StatusPill tone={statusTone}>{status}</StatusPill>
        </div>
      </div>

      {editingProjectUrl ? (
        <form className="mt-5 grid gap-3 rounded-3xl border border-blue-100 bg-blue-50/70 p-4 md:grid-cols-[1fr_auto_auto]" onSubmit={(event) => void handleProjectUrlSubmit(event)}>
          <label className="grid gap-2">
            <span className="text-sm font-semibold text-slate-600">URL của Web / Base URL</span>
            <input
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
              defaultValue={project.baseUrl || ''}
              name="projectBaseUrl"
              placeholder="VD: http://localhost:5173 hoặc https://app.example.com"
            />
            {projectUrlCheckMessage ? (
              <span className={`text-sm font-semibold ${projectUrlCheckTone === 'failed' ? 'text-red-700' : projectUrlCheckTone === 'passed' ? 'text-emerald-700' : 'text-blue-700'}`}>
                {projectUrlCheckMessage}
              </span>
            ) : null}
          </label>
          <button className="self-end rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white" disabled={submitting} type="submit">
            Lưu URL
          </button>
          <button className="self-end rounded-2xl border border-slate-200 bg-white px-5 py-3 font-bold text-slate-700" disabled={submitting} type="button" onClick={() => setEditingProjectUrl(false)}>
            Hủy
          </button>
        </form>
      ) : null}

      <div className="mt-6 rounded-3xl border border-slate-200 bg-white/75 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold">Danh sách test case</h3>
            <p className="mt-1 text-sm text-slate-500">Ưu tiên xem, chọn và chạy các test case đã tạo trong dự án.</p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-3">
            {testCases.length ? (
              <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm">
                <span className="font-semibold text-slate-700">Đã chọn {selectedTestCaseIds.length}/{testCases.length}</span>
                <button className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-bold text-slate-700" disabled={runningTestCaseId !== null} type="button" onClick={selectAllTestCases}>
                  Chọn tất cả
                </button>
                <button className="rounded-xl border border-slate-200 bg-white px-3 py-2 font-bold text-slate-700" disabled={runningTestCaseId !== null || !selectedTestCaseIds.length} type="button" onClick={clearSelectedTestCases}>
                  Bỏ chọn
                </button>
                <button
                  className="rounded-xl bg-blue-600 px-3 py-2 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                  disabled={runningTestCaseId !== null || !selectedTestCaseIds.length}
                  type="button"
                  onClick={() => void onRunMultipleTestCases(testCases.filter((testCase) => selectedTestCaseIds.includes(testCase.id)))}
                >
                  Chạy đã chọn
                </button>
              </div>
            ) : null}
            <button
              className="rounded-2xl bg-gradient-to-br from-blue-600 to-sky-400 px-5 py-3 font-bold text-white shadow-lg shadow-blue-700/20"
              type="button"
              onClick={() => {
                setCreateMode('template');
                setCreatePanelOpen((value) => !value);
              }}
            >
              {createPanelOpen ? 'Đóng tạo test case' : 'Tạo test case'}
            </button>
          </div>
        </div>

        <div className="mt-4 grid gap-3">
          {testCases.length ? (
            testCases.map((testCase) => {
              const isEditing = editingTestCaseId === testCase.id;
              const dataSets = getAttachedDataSets(testCase.id);
              const steps = getStepsForTestCase(testCase.id);
              const requiresManualRun = hasManualRunRequirement(testCase.id);
              const isRunningThisTest = runningTestCaseId === testCase.id;
              const isAnotherTestRunning = runningTestCaseId !== null && runningTestCaseId !== testCase.id;
              const recordedTemplateEntries = recordedDataEntries(dataSets.find((dataSet) => recordedDataEntries(dataSet.dataJson).length)?.dataJson);
              const visibleRecordedTemplateEntries = recordedTemplateEntries.filter((entry) => entry.value.trim());
              return (
                <article className="rounded-2xl border border-slate-200 bg-white p-4" key={testCase.id}>
                  {isEditing ? (
                    <form className="grid gap-4" onSubmit={(event) => void handleEditSubmit(event, testCase)}>
                      <div className="sticky top-4 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-white/95 p-3 shadow-lg shadow-blue-900/10 backdrop-blur">
                        <div>
                          <strong>Đang chỉnh sửa: {testCase.name}</strong>
                          <p className="mt-1 text-sm text-slate-500">Có thể lưu hoặc đóng chỉnh sửa ngay tại đây, không cần cuộn xuống cuối form.</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button className="rounded-2xl bg-blue-600 px-4 py-2 font-bold text-white" disabled={submitting} type="submit">
                            Lưu thay đổi
                          </button>
                          <button
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 font-bold text-slate-700"
                            disabled={submitting}
                            type="button"
                            onClick={() => {
                              setEditingTestCaseId(null);
                              setExpandedStepsForTestCaseId(null);
                              setAddingDataSetForTestCaseId(null);
                            }}
                          >
                            Đóng chỉnh sửa
                          </button>
                        </div>
                      </div>
                      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h4 className="font-bold">Thông tin test case</h4>
                            <p className="mt-1 text-sm text-slate-500">Chứa Mã test case, tên, loại, trạng thái và mô tả.</p>
                          </div>
                          <button
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700"
                            type="button"
                            onClick={() => setExpandedTestCaseInfoForId((current) => ({ ...current, [testCase.id]: !testCaseInfoExpanded(testCase.id) }))}
                          >
                            {testCaseInfoExpanded(testCase.id) ? 'Thu gọn thông tin test case' : 'Mở thông tin test case'}
                          </button>
                        </div>
                        {testCaseInfoExpanded(testCase.id) ? (
                          <div className="mt-4 grid gap-4">
                            <div className="grid gap-3 md:grid-cols-2">
                              <label className="grid gap-2">
                                <span className="text-sm text-slate-600">Mã test case</span>
                                <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={testCase.code} name="code" required />
                              </label>
                              <label className="grid gap-2">
                                <span className="text-sm text-slate-600">Tên test case</span>
                                <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={testCase.name} name="name" required />
                              </label>
                              <label className="grid gap-2">
                                <span className="text-sm text-slate-600">Type</span>
                                <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={testCase.type || 'login'} name="type" required />
                              </label>
                              <label className="grid gap-2">
                                <span className="text-sm text-slate-600">Status</span>
                                <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={testCase.status || 'active'} name="status" required />
                              </label>
                            </div>
                            <label className="grid gap-2">
                              <span className="text-sm text-slate-600">Mô tả</span>
                              <textarea className="min-h-24 rounded-2xl border border-slate-200 px-4 py-3" defaultValue={testCase.description || ''} name="description" />
                            </label>
                          </div>
                        ) : null}
                      </div>
                      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h4 className="font-bold">Data set của test case</h4>
                            <p className="mt-1 text-sm text-slate-500">Sửa dữ liệu test đang gắn với test case này, ví dụ username/password hợp lệ.</p>
                          </div>
                          <button
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700"
                            type="button"
                            onClick={() => setExpandedDataSetsForTestCaseId((current) => ({ ...current, [testCase.id]: !dataSetsExpanded(testCase.id) }))}
                          >
                            {dataSetsExpanded(testCase.id) ? 'Thu gọn dataSet' : 'Mở dataSet'}
                          </button>
                        </div>
                        {dataSetsExpanded(testCase.id) ? (dataSets.length ? (
                          <div className="mt-4 grid gap-4">
                            {dataSets.map((dataSet) => {
                              const modeKey = dataSetModeKey(dataSet.id);
                              const recordedEntries = recordedDataEntries(dataSet.dataJson);
                              const visibleRecordedEntries = recordedEntries.filter((entry) => entry.value.trim());
                              const parsedExpectedSelector = parseExpectedSelector(nestedString(dataSet.expectedJson, 'result.selector', '.dashboard'));
                              const selectedExpectedKind = expectedSelectorKind(modeKey, nestedString(dataSet.expectedJson, 'result.selector', '.dashboard'));
                              return (
                              <div className="rounded-2xl border border-slate-200 bg-white p-4" key={dataSet.id}>
                                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                  <strong>{dataSet.code}</strong>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500">{dataSet.status || 'active'}</span>
                                    <button
                                      className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-700"
                                      disabled={submitting}
                                      type="button"
                                      onClick={() => void onDeleteTestDataSet(testCase, dataSet)}
                                    >
                                      Xóa dataSet
                                    </button>
                                  </div>
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                  <label className="grid gap-2">
                                    <span className="text-sm text-slate-600">Mã data set</span>
                                    <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={dataSet.code} name={`dataSetCode-${dataSet.id}`} required />
                                  </label>
                                  <label className="grid gap-2">
                                    <span className="text-sm text-slate-600">Tên data set</span>
                                    <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={dataSet.name} name={`dataSetName-${dataSet.id}`} required />
                                  </label>
                                  <label className="grid gap-2">
                                    <span className="text-sm text-slate-600">Status data set</span>
                                    <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={dataSet.status || 'active'} name={`dataSetStatus-${dataSet.id}`} required />
                                  </label>
                                </div>
                                <label className="mt-3 grid gap-2">
                                  <span className="text-sm text-slate-600">Mô tả data set</span>
                                  <textarea className="min-h-20 rounded-2xl border border-slate-200 px-4 py-3" defaultValue={dataSet.description || ''} name={`dataSetDescription-${dataSet.id}`} />
                                </label>
                                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <h6 className="font-bold">Data JSON</h6>
                                    <div className="flex flex-wrap items-center gap-2">
                                      <button className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" type="button" onClick={() => toggleDataJsonExpanded(modeKey)}>
                                        {dataJsonExpanded(modeKey) ? 'Thu gọn Data JSON' : 'Mở Data JSON'}
                                      </button>
                                      <div className="flex rounded-2xl border border-slate-200 bg-white p-1">
                                        <button className={`rounded-xl px-4 py-2 text-sm font-bold ${dataJsonMode(modeKey) === 'builder' ? 'bg-blue-600 text-white' : 'text-slate-600'}`} type="button" onClick={() => setDataJsonMode(modeKey, 'builder')}>Chọn kiểu</button>
                                        <button className={`rounded-xl px-4 py-2 text-sm font-bold ${dataJsonMode(modeKey) === 'json' ? 'bg-blue-600 text-white' : 'text-slate-600'}`} type="button" onClick={() => setDataJsonMode(modeKey, 'json')}>JSON</button>
                                      </div>
                                    </div>
                                  </div>
                                  {dataJsonExpanded(modeKey) && dataJsonMode(modeKey) === 'builder' ? (
                                    <>
                                      {recordedEntries.length ? (
                                        <div className="mt-4 grid gap-3">
                                          <p className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                                            Data set này được tạo từ recorder. Bạn có thể sửa target/value tại đây, dataStep sẽ lấy lại qua placeholder `${'{recorded.stepX.target}'}` và `${'{recorded.stepX.value}'}` khi chạy.
                                          </p>
                                          {visibleRecordedEntries.map((entry) => (
                                            <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2" key={entry.key}>
                                              <label className="grid gap-2">
                                                <span className="text-sm text-slate-600">{entry.key} target (label)</span>
                                                <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={entry.target} name={`dataSet-${dataSet.id}Recorded-${entry.key}-Target`} />
                                              </label>
                                              <label className="grid gap-2">
                                                <span className="text-sm text-slate-600">{entry.key} data</span>
                                                <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={entry.value} name={`dataSet-${dataSet.id}Recorded-${entry.key}-Value`} />
                                              </label>
                                            </div>
                                          ))}
                                        </div>
                                      ) : (
                                        <div className="mt-4 grid gap-3 md:grid-cols-2">
                                          <label className="grid gap-2">
                                            <span className="text-sm text-slate-600">Username</span>
                                            <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={nestedString(dataSet.dataJson, 'validUser.username')} name={`dataSet-${dataSet.id}Username`} />
                                          </label>
                                          <label className="grid gap-2">
                                            <span className="text-sm text-slate-600">Password</span>
                                            <div className="flex rounded-2xl border border-slate-200 bg-white">
                                              <input className="min-w-0 flex-1 rounded-l-2xl px-4 py-3 outline-none" defaultValue={nestedString(dataSet.dataJson, 'validUser.password')} name={`dataSet-${dataSet.id}Password`} type={passwordType(`dataSet-${dataSet.id}`)} />
                                              <button className="rounded-r-2xl border-l border-slate-200 px-4 py-3 text-sm font-bold text-slate-600" type="button" onClick={() => togglePassword(`dataSet-${dataSet.id}`)}>
                                                {passwordToggleLabel(`dataSet-${dataSet.id}`)}
                                              </button>
                                            </div>
                                          </label>
                                        </div>
                                      )}
                                    </>
                                  ) : dataJsonExpanded(modeKey) ? (
                                    <textarea
                                      className="mt-4 min-h-48 w-full rounded-2xl border border-slate-200 p-4 font-mono text-sm"
                                      defaultValue={JSON.stringify(dataSet.dataJson || {}, null, 2)}
                                      name={`dataJson-${dataSet.id}`}
                                      required
                                    />
                                  ) : null}
                                </div>
                                <div className="mt-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                                  <div className="flex flex-wrap items-center justify-between gap-3">
                                    <div>
                                      <h6 className="font-bold">Expected JSON</h6>
                                      <p className="mt-1 text-sm text-slate-500">
                                        Khi lưu, FE sẽ dùng phần này để tự tạo hoặc cập nhật dataStep điều kiện pass nếu bạn chưa mở Edit dataStep để sửa tay.
                                      </p>
                                    </div>
                                    <div className="flex rounded-2xl border border-slate-200 bg-white p-1">
                                      <button className={`rounded-xl px-4 py-2 text-sm font-bold ${expectedJsonMode(modeKey) === 'builder' ? 'bg-blue-600 text-white' : 'text-slate-600'}`} type="button" onClick={() => setExpectedJsonMode(modeKey, 'builder')}>Chọn kiểu</button>
                                      <button className={`rounded-xl px-4 py-2 text-sm font-bold ${expectedJsonMode(modeKey) === 'json' ? 'bg-blue-600 text-white' : 'text-slate-600'}`} type="button" onClick={() => setExpectedJsonMode(modeKey, 'json')}>JSON</button>
                                    </div>
                                  </div>
                                  {expectedJsonMode(modeKey) === 'builder' ? (
                                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                                      <label className="grid gap-2">
                                        <span className="text-sm text-slate-600">Kiểu target mong muốn</span>
                                        <select
                                          className="rounded-2xl border border-slate-200 px-4 py-3"
                                          name={`expected-${dataSet.id}SelectorKind`}
                                          value={selectedExpectedKind}
                                          onChange={(event) => setExpectedSelectorKind(modeKey, event.target.value)}
                                        >
                                          <option value="css">CSS selector</option>
                                          <option value="text">Text</option>
                                          <option value="button">Button</option>
                                          <option value="link">Link</option>
                                          <option value="label">Label</option>
                                          <option value="placeholder">Placeholder</option>
                                          <option value="auto">Auto</option>
                                        </select>
                                      </label>
                                      <label className="grid gap-2">
                                        <span className="text-sm text-slate-600">{expectedTargetLabel(selectedExpectedKind)}</span>
                                        <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={parsedExpectedSelector.target} name={`expected-${dataSet.id}SelectorValue`} placeholder={expectedTargetPlaceholder(selectedExpectedKind)} />
                                      </label>
                                      <label className="grid gap-2">
                                        <span className="text-sm text-slate-600">Expected value</span>
                                        <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={nestedString(dataSet.expectedJson, 'result.value', 'visible')} name={`expected-${dataSet.id}Value`} />
                                      </label>
                                      {selectedExpectedKind === 'link' ? (
                                        <label className="grid gap-2">
                                          <span className="text-sm text-slate-600">Expected URL</span>
                                          <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={nestedString(dataSet.expectedJson, 'result.url')} name={`expected-${dataSet.id}Url`} placeholder="VD: /dashboard" />
                                        </label>
                                      ) : null}
                                    </div>
                                  ) : (
                                    <textarea
                                      className="mt-4 min-h-40 w-full rounded-2xl border border-slate-200 p-4 font-mono text-sm"
                                      defaultValue={JSON.stringify(dataSet.expectedJson || {}, null, 2)}
                                      name={`expectedJson-${dataSet.id}`}
                                    />
                                  )}
                                </div>
                              </div>
                              );
                            })}
                          </div>
                        ) : (
                          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-500">
                            Test case này chưa có data set được gắn, nên hiện chưa có dữ liệu để sửa.
                          </div>
                        )) : null}
                        {dataSetsExpanded(testCase.id) && addingDataSetForTestCaseId === testCase.id ? (
                          <div className="mt-4 rounded-2xl border border-dashed border-blue-200 bg-blue-50/70 p-4">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div>
                                <h5 className="font-bold">Tạo data set mới</h5>
                                <p className="mt-1 text-sm text-slate-500">Điền mã data set để tạo thêm data set và tự động gắn với test case khi lưu.</p>
                              </div>
                              <button
                                className="rounded-full border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700"
                                type="button"
                                onClick={() => setAddingDataSetForTestCaseId(null)}
                              >
                                Xóa dataSet mới
                              </button>
                            </div>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <label className="grid gap-2">
                                <span className="text-sm text-slate-600">Mã data set mới</span>
                                <input className="rounded-2xl border border-slate-200 px-4 py-3" name="newDataSetCode" placeholder="VD: TC_LOGIN_WRONGPASSWORD" />
                              </label>
                              <label className="grid gap-2">
                                <span className="text-sm text-slate-600">Tên data set mới</span>
                                <input className="rounded-2xl border border-slate-200 px-4 py-3" name="newDataSetName" placeholder="VD: Login wrong password" />
                              </label>
                              <label className="grid gap-2">
                                <span className="text-sm text-slate-600">Status data set mới</span>
                                <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue="active" name="newDataSetStatus" />
                              </label>
                            </div>
                            <label className="mt-3 grid gap-2">
                              <span className="text-sm text-slate-600">Mô tả data set mới</span>
                              <textarea className="min-h-20 rounded-2xl border border-slate-200 px-4 py-3" name="newDataSetDescription" placeholder="Bộ dữ liệu đăng nhập sai mật khẩu" />
                            </label>
                            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <h6 className="font-bold">Data JSON mới</h6>
                                <div className="flex flex-wrap items-center gap-2">
                                  <button className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-700" type="button" onClick={() => toggleDataJsonExpanded(dataSetModeKey('new'))}>
                                    {dataJsonExpanded(dataSetModeKey('new')) ? 'Thu gọn Data JSON' : 'Mở Data JSON'}
                                  </button>
                                  <div className="flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
                                    <button className={`rounded-xl px-4 py-2 text-sm font-bold ${dataJsonMode(dataSetModeKey('new')) === 'builder' ? 'bg-blue-600 text-white' : 'text-slate-600'}`} type="button" onClick={() => setDataJsonMode(dataSetModeKey('new'), 'builder')}>Chọn kiểu</button>
                                    <button className={`rounded-xl px-4 py-2 text-sm font-bold ${dataJsonMode(dataSetModeKey('new')) === 'json' ? 'bg-blue-600 text-white' : 'text-slate-600'}`} type="button" onClick={() => setDataJsonMode(dataSetModeKey('new'), 'json')}>JSON</button>
                                  </div>
                                </div>
                              </div>
                              {dataJsonExpanded(dataSetModeKey('new')) && dataJsonMode(dataSetModeKey('new')) === 'builder' ? (
                                <>
                                  {visibleRecordedTemplateEntries.length ? (
                                    <div className="mt-4 grid gap-3">
                                      <p className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
                                        DataSet mới sẽ dùng lại cấu trúc DataJson của recording hiện có. Bạn chỉ cần sửa target và data cho từng bước.
                                      </p>
                                      {visibleRecordedTemplateEntries.map((entry) => (
                                        <div className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 md:grid-cols-2" key={entry.key}>
                                          <label className="grid gap-2">
                                            <span className="text-sm text-slate-600">{entry.key} target (label)</span>
                                            <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={entry.target} name={`newDataRecorded-${entry.key}-Target`} />
                                          </label>
                                          <label className="grid gap-2">
                                            <span className="text-sm text-slate-600">{entry.key} data</span>
                                            <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={entry.value} name={`newDataRecorded-${entry.key}-Value`} />
                                          </label>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <div className="mt-4 grid gap-3 md:grid-cols-2">
                                      <label className="grid gap-2">
                                        <span className="text-sm text-slate-600">Username</span>
                                        <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue="admin@basico.local" name="newDataUsername" />
                                      </label>
                                      <label className="grid gap-2">
                                        <span className="text-sm text-slate-600">Password</span>
                                        <div className="flex rounded-2xl border border-slate-200 bg-white">
                                          <input className="min-w-0 flex-1 rounded-l-2xl px-4 py-3 outline-none" defaultValue="wrongpassword" name="newDataPassword" type={passwordType('newDataPassword')} />
                                          <button className="rounded-r-2xl border-l border-slate-200 px-4 py-3 text-sm font-bold text-slate-600" type="button" onClick={() => togglePassword('newDataPassword')}>
                                            {passwordToggleLabel('newDataPassword')}
                                          </button>
                                        </div>
                                      </label>
                                    </div>
                                  )}
                                </>
                              ) : dataJsonExpanded(dataSetModeKey('new')) ? (
                                <textarea
                                  className="mt-4 min-h-40 w-full rounded-2xl border border-slate-200 p-4 font-mono text-sm"
                                  defaultValue={JSON.stringify({ validUser: { username: 'admin@basico.local', password: 'wrongpassword' } }, null, 2)}
                                  name="newDataJson"
                                />
                              ) : null}
                            </div>
                            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4">
                              <div className="flex flex-wrap items-center justify-between gap-3">
                                <div>
                                  <h6 className="font-bold">Expected JSON mới</h6>
                                  <p className="mt-1 text-sm text-slate-500">Chọn kiểu nhanh hoặc nhập JSON trực tiếp. Khi lưu, FE sẽ tạo/cập nhật dataStep điều kiện pass từ Expected JSON nếu phù hợp.</p>
                                </div>
                                <div className="flex rounded-2xl border border-slate-200 bg-slate-50 p-1">
                                  <button
                                    className={`rounded-xl px-4 py-2 text-sm font-bold ${expectedJsonMode(dataSetModeKey('new')) === 'builder' ? 'bg-blue-600 text-white' : 'text-slate-600'}`}
                                    type="button"
                                    onClick={() => setExpectedJsonMode(dataSetModeKey('new'), 'builder')}
                                  >
                                    Chọn kiểu
                                  </button>
                                  <button
                                    className={`rounded-xl px-4 py-2 text-sm font-bold ${expectedJsonMode(dataSetModeKey('new')) === 'json' ? 'bg-blue-600 text-white' : 'text-slate-600'}`}
                                    type="button"
                                    onClick={() => setExpectedJsonMode(dataSetModeKey('new'), 'json')}
                                  >
                                    JSON
                                  </button>
                                </div>
                              </div>

                              {expectedJsonMode(dataSetModeKey('new')) === 'builder' ? (
                                <div className="mt-4 grid gap-3 md:grid-cols-2">
                                  <label className="grid gap-2">
                                    <span className="text-sm text-slate-600">Kiểu target mong muốn</span>
                                    <select
                                      className="rounded-2xl border border-slate-200 px-4 py-3"
                                      name="newExpectedSelectorKind"
                                      value={expectedSelectorKind(dataSetModeKey('new'), 'kind=css::.dashboard')}
                                      onChange={(event) => setExpectedSelectorKind(dataSetModeKey('new'), event.target.value)}
                                    >
                                      <option value="css">CSS selector</option>
                                      <option value="text">Text</option>
                                      <option value="button">Button</option>
                                      <option value="link">Link</option>
                                      <option value="label">Label</option>
                                      <option value="placeholder">Placeholder</option>
                                      <option value="auto">Auto</option>
                                    </select>
                                  </label>
                                  <label className="grid gap-2">
                                    <span className="text-sm text-slate-600">{expectedTargetLabel(expectedSelectorKind(dataSetModeKey('new'), 'kind=css::.dashboard'))}</span>
                                    <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue=".dashboard" name="newExpectedSelectorValue" placeholder={expectedTargetPlaceholder(expectedSelectorKind(dataSetModeKey('new'), 'kind=css::.dashboard'))} />
                                  </label>
                                  <label className="grid gap-2">
                                    <span className="text-sm text-slate-600">Expected value</span>
                                    <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue="visible" name="newExpectedValue" placeholder="VD: visible" />
                                  </label>
                                  {expectedSelectorKind(dataSetModeKey('new'), 'kind=css::.dashboard') === 'link' ? (
                                    <label className="grid gap-2">
                                      <span className="text-sm text-slate-600">Expected URL</span>
                                      <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue="/dashboard" name="newExpectedUrl" placeholder="VD: /dashboard" />
                                    </label>
                                  ) : null}
                                </div>
                              ) : (
                                <label className="mt-4 grid gap-2">
                                  <span className="text-sm text-slate-600">Expected JSON</span>
                                  <textarea
                                    className="min-h-40 rounded-2xl border border-slate-200 p-4 font-mono text-sm"
                                    defaultValue={JSON.stringify({ result: { selector: 'kind=css::.dashboard', value: 'visible', url: '/dashboard' } }, null, 2)}
                                    name="newExpectedJson"
                                  />
                                </label>
                              )}
                            </div>
                          </div>
                        ) : null}
                        <button
                          className="mt-4 rounded-2xl bg-slate-900 px-5 py-3 font-bold text-white disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={addingDataSetForTestCaseId === testCase.id}
                          type="button"
                          onClick={() => {
                            setAddingDataSetForTestCaseId(testCase.id);
                            setExpandedDataSetsForTestCaseId((current) => ({ ...current, [testCase.id]: true }));
                            setExpandedDataJsonKeys((current) => ({ ...current, [dataSetModeKey('new')]: true }));
                          }}
                        >
                          {addingDataSetForTestCaseId === testCase.id ? 'Đang tạo dataSet mới' : 'Tạo dataSet'}
                        </button>
                      </div>
                      <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <h4 className="font-bold">Data step của test case</h4>
                            <p className="mt-1 text-sm text-slate-500">Sửa từng bước thao tác đã lưu trong bảng test_case_steps.</p>
                          </div>
                          <button
                            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 font-bold text-slate-700"
                            type="button"
                            onClick={() => setExpandedStepsForTestCaseId((value) => value === testCase.id ? null : testCase.id)}
                          >
                            {expandedStepsForTestCaseId === testCase.id ? 'Thu gọn dataStep' : `Edit dataStep (${steps.length})`}
                          </button>
                        </div>
                        {expandedStepsForTestCaseId === testCase.id && steps.length ? (
                          <div className="mt-4 grid gap-4">
                            {steps.map((step) => {
                              const isClickStep = step.actionType.toLowerCase() === 'click';
                              const isLoginSubmitStep = isClickStep && step.stepOrder === 4;
                              const parsedStepTarget = parseTargetHint(step.target);
                              return (
                              <div className="rounded-2xl border border-slate-200 bg-white p-4" key={step.id}>
                                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                                  <strong>Step {step.stepOrder}</strong>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-500">{step.actionType}</span>
                                    <button
                                      className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-xs font-bold text-red-700"
                                      disabled={submitting}
                                      type="button"
                                      onClick={() => void onDeleteTestCaseStep(step)}
                                    >
                                      Xóa dataStep
                                    </button>
                                  </div>
                                </div>
                                <div className="grid gap-3 md:grid-cols-2">
                                  <label className="grid gap-2">
                                    <span className="text-sm text-slate-600">Thứ tự</span>
                                    <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={step.stepOrder} min={1} name={`stepOrder-${step.id}`} required type="number" />
                                  </label>
                                  <label className="grid gap-2">
                                    <span className="text-sm text-slate-600">Action type</span>
                                    <select className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={step.actionType} name={`actionType-${step.id}`} required>
                                      <option value="goto">goto</option>
                                      <option value="hover">hover</option>
                                      <option value="fill">fill</option>
                                      <option value="click">click</option>
                                      <option value="press">press</option>
                                      <option value="waitFor">waitFor</option>
                                      <option value="waitForUrl">waitForUrl</option>
                                      <option value="payViaVnpay">payViaVnpay</option>
                                      <option value="assertVisible">assertVisible</option>
                                      <option value="assertText">assertText</option>
                                      <option value="assertUrlContains">assertUrlContains</option>
                                    </select>
                                  </label>
                                  <div className="grid gap-3 md:grid-cols-[0.45fr_1fr]">
                                    <label className="grid gap-2">
                                      <span className="text-sm text-slate-600">Target type</span>
                                      <select className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={parsedStepTarget.kind} name={`targetKind-${step.id}`}>
                                        <option value="raw">Raw / giữ nguyên</option>
                                        <option value="text">Text hiển thị</option>
                                        <option value="button">Button</option>
                                        <option value="link">Link</option>
                                        <option value="label">Label</option>
                                        <option value="placeholder">Placeholder</option>
                                        <option value="css">CSS selector</option>
                                      </select>
                                    </label>
                                    <label className="grid gap-2">
                                      <span className="text-sm text-slate-600">{isLoginSubmitStep ? 'Nội dung nút / selector nút' : 'Target'}</span>
                                      <input
                                        className="rounded-2xl border border-slate-200 px-4 py-3"
                                        defaultValue={parsedStepTarget.target}
                                        name={`target-${step.id}`}
                                        placeholder={isLoginSubmitStep ? 'VD: Login, Submit, #submit hoặc button[type="submit"]' : 'VD: Email đã tồn tại, .dashboard hoặc /login'}
                                      />
                                      {isLoginSubmitStep ? (
                                        <span className="text-xs text-slate-500">
                                          Chỉ cần nhập nội dung nút như Login hoặc Submit. Runner sẽ tự fallback thêm #submit và button[type=&quot;submit&quot;].
                                        </span>
                                      ) : null}
                                      {step.actionType === 'assertVisible' ? (
                                        <span className="text-xs text-slate-500">
                                          Nếu điều kiện pass là text xuất hiện, chọn Target type = Text hiển thị và nhập nội dung text.
                                        </span>
                                      ) : null}
                                    </label>
                                  </div>
                                  <label className="grid gap-2">
                                    <span className="text-sm text-slate-600">Value</span>
                                    <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={step.value || ''} name={`value-${step.id}`} placeholder="VD: admin@test.com" />
                                  </label>
                                  <label className="grid gap-2">
                                    <span className="text-sm text-slate-600">Expected value</span>
                                    <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue={step.expectedValue || ''} name={`expectedValue-${step.id}`} placeholder="VD: visible" />
                                  </label>
                                </div>
                                <label className="mt-3 grid gap-2">
                                  <span className="text-sm text-slate-600">Mô tả step</span>
                                  <textarea className="min-h-20 rounded-2xl border border-slate-200 px-4 py-3" defaultValue={step.description || ''} name={`stepDescription-${step.id}`} />
                                </label>
                              </div>
                              );
                            })}
                            <div className="rounded-2xl border border-dashed border-blue-200 bg-blue-50/60 p-4">
                              <div className="mb-3">
                                <strong>Thêm dataStep mới</strong>
                                <p className="mt-1 text-sm text-slate-600">
                                  Dùng để bổ sung expected result sau recorder, ví dụ assertVisible nút Đăng xuất hoặc text thông báo.
                                </p>
                              </div>
                              <div className="grid gap-3 md:grid-cols-2">
                                <label className="grid gap-2">
                                  <span className="text-sm text-slate-600">Thứ tự</span>
                                  <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue={steps.length + 1} min={1} name="newStepOrder" type="number" />
                                </label>
                                <label className="grid gap-2">
                                  <span className="text-sm text-slate-600">Action type</span>
                                  <select className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue="" name="newStepActionType">
                                    <option value="">Không thêm step mới</option>
                                    <option value="assertVisible">assertVisible</option>
                                    <option value="assertText">assertText</option>
                                    <option value="assertUrlContains">assertUrlContains</option>
                                    <option value="waitFor">waitFor</option>
                                    <option value="waitForUrl">waitForUrl</option>
                                    <option value="payViaVnpay">payViaVnpay</option>
                                    <option value="goto">goto</option>
                                    <option value="fill">fill</option>
                                    <option value="click">click</option>
                                    <option value="press">press</option>
                                  </select>
                                </label>
                                <div className="grid gap-3 md:grid-cols-[0.45fr_1fr]">
                                  <label className="grid gap-2">
                                    <span className="text-sm text-slate-600">Target type</span>
                                    <select className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue="text" name="newStepTargetKind">
                                      <option value="text">Text hiển thị</option>
                                      <option value="button">Button</option>
                                      <option value="link">Link</option>
                                      <option value="label">Label</option>
                                      <option value="placeholder">Placeholder</option>
                                      <option value="css">CSS selector</option>
                                      <option value="raw">Raw / giữ nguyên</option>
                                    </select>
                                  </label>
                                  <label className="grid gap-2">
                                    <span className="text-sm text-slate-600">Nội dung / target</span>
                                    <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" name="newStepTarget" placeholder="VD: Email qa@gmail.com đã tồn tại!" />
                                    <span className="text-xs text-slate-500">Nếu chọn Text hiển thị, bạn chỉ cần nhập nội dung text, FE sẽ tự lưu đúng định dạng.</span>
                                  </label>
                                </div>
                                <label className="grid gap-2">
                                  <span className="text-sm text-slate-600">Value</span>
                                  <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" name="newStepValue" placeholder="VD: visible hoặc text cần kiểm tra" />
                                </label>
                                <label className="grid gap-2">
                                  <span className="text-sm text-slate-600">Expected value</span>
                                  <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue="visible" name="newStepExpectedValue" placeholder="VD: visible" />
                                </label>
                                <label className="grid gap-2">
                                  <span className="text-sm text-slate-600">Mô tả step</span>
                                  <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue="Kiểm tra kết quả mong muốn" name="newStepDescription" />
                                </label>
                              </div>
                            </div>
                          </div>
                        ) : expandedStepsForTestCaseId === testCase.id ? (
                          <div className="mt-4 rounded-2xl border border-dashed border-blue-200 bg-blue-50/60 p-4 text-sm text-slate-600">
                            <p>Test case này chưa có step nào được lưu. Chọn action type bên dưới để thêm step đầu tiên.</p>
                            <div className="mt-4 grid gap-3 md:grid-cols-2">
                              <label className="grid gap-2">
                                <span className="text-sm text-slate-600">Thứ tự</span>
                                <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue={1} min={1} name="newStepOrder" type="number" />
                              </label>
                              <label className="grid gap-2">
                                <span className="text-sm text-slate-600">Action type</span>
                                <select className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue="" name="newStepActionType">
                                  <option value="">Không thêm step mới</option>
                                  <option value="assertVisible">assertVisible</option>
                                  <option value="assertText">assertText</option>
                                  <option value="assertUrlContains">assertUrlContains</option>
                                  <option value="waitFor">waitFor</option>
                                  <option value="waitForUrl">waitForUrl</option>
                                  <option value="payViaVnpay">payViaVnpay</option>
                                  <option value="goto">goto</option>
                                  <option value="fill">fill</option>
                                  <option value="click">click</option>
                                  <option value="press">press</option>
                                </select>
                              </label>
                              <div className="grid gap-3 md:grid-cols-[0.45fr_1fr]">
                                <label className="grid gap-2">
                                  <span className="text-sm text-slate-600">Target type</span>
                                  <select className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue="text" name="newStepTargetKind">
                                    <option value="text">Text hiển thị</option>
                                    <option value="button">Button</option>
                                    <option value="link">Link</option>
                                    <option value="label">Label</option>
                                    <option value="placeholder">Placeholder</option>
                                    <option value="css">CSS selector</option>
                                    <option value="raw">Raw / giữ nguyên</option>
                                  </select>
                                </label>
                                <label className="grid gap-2">
                                  <span className="text-sm text-slate-600">Nội dung / target</span>
                                  <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" name="newStepTarget" placeholder="VD: Email qa@gmail.com đã tồn tại!" />
                                  <span className="text-xs text-slate-500">Nếu chọn Text hiển thị, bạn chỉ cần nhập nội dung text, FE sẽ tự lưu đúng định dạng.</span>
                                </label>
                              </div>
                              <label className="grid gap-2">
                                <span className="text-sm text-slate-600">Value</span>
                                <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" name="newStepValue" placeholder="VD: visible hoặc text cần kiểm tra" />
                              </label>
                              <label className="grid gap-2">
                                <span className="text-sm text-slate-600">Expected value</span>
                                <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue="visible" name="newStepExpectedValue" placeholder="VD: visible" />
                              </label>
                              <label className="grid gap-2">
                                <span className="text-sm text-slate-600">Mô tả step</span>
                                <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue="Kiểm tra kết quả mong muốn" name="newStepDescription" />
                              </label>
                            </div>
                          </div>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-3">
                        <button className="rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white" disabled={submitting} type="submit">
                          Lưu thay đổi
                        </button>
                        <button className="rounded-2xl border border-slate-200 bg-white px-5 py-3 font-bold" disabled={submitting} type="button" onClick={() => {
                          setEditingTestCaseId(null);
                          setExpandedStepsForTestCaseId(null);
                        }}>
                          Hủy
                        </button>
                      </div>
                      {editError ? <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700">{editError}</div> : null}
                    </form>
                  ) : (
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <label className="mt-1 flex items-center">
                          <input
                            checked={selectedTestCaseIds.includes(testCase.id)}
                            className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                            disabled={runningTestCaseId !== null}
                            type="checkbox"
                            onChange={() => toggleSelectedTestCase(testCase.id)}
                          />
                        </label>
                        <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <strong>{testCase.name}</strong>
                          {requiresManualRun ? (
                            <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700">
                              Cần thao tác thủ công
                            </span>
                          ) : null}
                          {isRunningThisTest ? (
                            <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-700">
                              Đang chạy
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 text-slate-600">{testCase.description || 'Không có mô tả'}</p>
                        {requiresManualRun ? (
                          <p className="mt-2 text-sm font-medium text-amber-700">
                            Flow này sẽ mở browser và chờ bạn thao tác thủ công ở bước gateway/thanh toán trước khi quay lại kiểm tra điều kiện pass.
                          </p>
                        ) : null}
                        </div>
                      </div>
                      <div className="flex flex-wrap justify-end gap-2 text-xs text-slate-500">
                        <span className="rounded-full border border-slate-200 px-3 py-2">{testCase.code}</span>
                        <span className="rounded-full border border-slate-200 px-3 py-2">{testCase.type || 'CUSTOM'}</span>
                        <span className="rounded-full border border-slate-200 px-3 py-2">{testCase.status || 'ACTIVE'}</span>
                        <button
                          className="rounded-full border border-slate-200 bg-white px-3 py-2 font-bold text-slate-700"
                          type="button"
                          onClick={() => {
                            setEditError('');
                            setEditingTestCaseId(testCase.id);
                            setExpandedTestCaseInfoForId((current) => ({ ...current, [testCase.id]: true }));
                            setExpandedDataSetsForTestCaseId((current) => ({ ...current, [testCase.id]: true }));
                            setExpandedStepsForTestCaseId(null);
                          }}
                        >
                          Sửa
                        </button>
                        <button
                          className="rounded-full border border-red-200 bg-red-50 px-3 py-2 font-bold text-red-700"
                          type="button"
                          disabled={runningTestCaseId !== null}
                          onClick={() => void onDeleteTestCase(testCase)}
                        >
                          Xóa
                        </button>
                        {isRunningThisTest ? (
                          <button
                            className="rounded-full border border-red-200 bg-red-600 px-3 py-2 font-bold text-white"
                            type="button"
                            onClick={onStopTestRun}
                          >
                            Dừng test
                          </button>
                        ) : (
                          <button
                            className="rounded-full bg-blue-600 px-3 py-2 font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                            disabled={isAnotherTestRunning}
                            type="button"
                            onClick={() => void onRunTestCase(testCase)}
                          >
                            {isAnotherTestRunning ? 'Đang chạy case khác' : 'Chạy test'}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </article>
              );
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-slate-500">Chưa có test case nào cho dự án này. Bấm Tạo test case để bắt đầu.</div>
          )}
        </div>
      </div>

      {createPanelOpen ? (
        <div className="mt-6 rounded-3xl border border-blue-100 bg-blue-50/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold">Tạo test case mới</h3>
              <p className="mt-1 text-sm text-slate-600">Chọn tạo từ template có sẵn hoặc dùng recorder để ghi thao tác thực tế.</p>
            </div>
            <div className="flex rounded-2xl border border-slate-200 bg-white p-1">
              <button
                className={`rounded-xl px-4 py-2 text-sm font-bold ${createMode === 'template' ? 'bg-blue-600 text-white' : 'text-slate-600'}`}
                type="button"
                onClick={() => setCreateMode('template')}
              >
                Template có sẵn
              </button>
              <button
                className={`rounded-xl px-4 py-2 text-sm font-bold ${createMode === 'recorder' ? 'bg-blue-600 text-white' : 'text-slate-600'}`}
                type="button"
                onClick={() => setCreateMode('recorder')}
              >
                Recorder
              </button>
            </div>
          </div>

          {createMode === 'recorder' ? (
            <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-5">
              <h4 className="font-bold">Tạo bằng recorder</h4>
              <p className="mt-2 text-slate-600">Recorder sẽ mở browser từ URL web của dự án để bạn thao tác thật, sau đó hệ thống sinh step để dùng lại trong test.</p>
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <span className="text-sm text-slate-500">Start URL</span>
                <strong className="mt-1 block break-words">{project.baseUrl || 'Chưa có Base URL. Hãy bấm Sửa URL web để thêm trước khi record.'}</strong>
              </div>
              <button className="mt-4 rounded-2xl bg-slate-900 px-5 py-3 font-bold text-white" type="button" onClick={onOpenRecorder}>
                Mở recorder
              </button>
            </div>
          ) : (
            <div className="mt-5 grid gap-5 lg:grid-cols-[1fr_0.75fr]">
              <div className="rounded-3xl border border-slate-200 bg-white/75 p-5">
                <h4 className="font-bold">Template hỗ trợ</h4>
                <div className="mt-4 grid gap-3">
                  {templates.length ? (
                    templates.map((template) => (
                      <button
                        className={`grid gap-2 rounded-2xl border p-4 text-left ${template.id === selectedTemplate?.id ? 'border-blue-400 bg-blue-50' : 'border-slate-200 bg-white hover:bg-slate-50'}`}
                        key={template.id}
                        type="button"
                        onClick={() => setSelectedTemplateId(template.id)}
                      >
                        <strong>{template.name}</strong>
                        <span className="text-sm text-slate-600">{template.description}</span>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-slate-500">Chưa có template nào sẵn sàng.</div>
                  )}
                </div>
              </div>

              <form className="grid gap-4" onSubmit={handleSubmit}>
                <label className="grid gap-2">
                  <span className="text-sm text-slate-600">Mã test case</span>
                  <input className="rounded-2xl border border-slate-200 px-4 py-3" name="code" placeholder="VD: LOGIN_001" required />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm text-slate-600">Tên test case</span>
                  <input className="rounded-2xl border border-slate-200 px-4 py-3" name="name" placeholder="VD: Đăng nhập thành công" required />
                </label>
                <label className="grid gap-2">
                  <span className="text-sm text-slate-600">Mô tả</span>
                  <textarea className="min-h-32 rounded-2xl border border-slate-200 px-4 py-3" name="description" placeholder="Mô tả mục tiêu test case" />
                </label>
                <div className="rounded-3xl border border-slate-200 bg-white/80 p-4">
                  <h4 className="font-bold">Cấu hình chức năng login</h4>
                  <div className="mt-4 grid gap-3">
                    <label className="grid gap-2">
                      <span className="text-sm text-slate-600">Trang login</span>
                      <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue="/login" name="pagePath" required />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm text-slate-600">Email selector</span>
                      <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue="#email" name="emailSelector" required />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm text-slate-600">Password selector</span>
                      <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue="#password" name="passwordSelector" required />
                    </label>
                    <div className="grid gap-3 md:grid-cols-[0.45fr_1fr]">
                      <label className="grid gap-2">
                        <span className="text-sm text-slate-600">Submit target type</span>
                        <select className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue="auto" name="submitSelectorKind">
                          <option value="auto">Auto fallback</option>
                          <option value="button">Button text</option>
                          <option value="css">CSS selector</option>
                          <option value="text">Text</option>
                          <option value="label">Label</option>
                          <option value="placeholder">Placeholder</option>
                          <option value="link">Link</option>
                        </select>
                      </label>
                      <label className="grid gap-2">
                        <span className="text-sm text-slate-600">Submit target value</span>
                        <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue="submit" name="submitSelector" placeholder="VD: Login, Submit, #submit hoặc button[type='submit']" required />
                      </label>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[0.45fr_1fr]">
                      <label className="grid gap-2">
                        <span className="text-sm text-slate-600">Success target type</span>
                        <select className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue="css" name="successSelectorKind">
                          <option value="css">CSS selector</option>
                          <option value="text">Text</option>
                          <option value="button">Button</option>
                          <option value="link">Link</option>
                          <option value="label">Label</option>
                          <option value="placeholder">Placeholder</option>
                          <option value="auto">Auto</option>
                        </select>
                      </label>
                      <label className="grid gap-2">
                        <span className="text-sm text-slate-600">Success target value</span>
                        <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue=".dashboard" name="successSelector" placeholder="VD: .dashboard hoặc Login success" required />
                      </label>
                    </div>
                    <label className="grid gap-2">
                      <span className="text-sm text-slate-600">Username hợp lệ</span>
                      <input className="rounded-2xl border border-slate-200 px-4 py-3" defaultValue="admin@test.com" name="username" required />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm text-slate-600">Password hợp lệ</span>
                      <div className="flex rounded-2xl border border-slate-200 bg-white">
                        <input className="min-w-0 flex-1 rounded-l-2xl px-4 py-3 outline-none" defaultValue="123456" name="password" required type={passwordType('createLoginPassword')} />
                        <button className="rounded-r-2xl border-l border-slate-200 px-4 py-3 text-sm font-bold text-slate-600" type="button" onClick={() => togglePassword('createLoginPassword')}>
                          {passwordToggleLabel('createLoginPassword')}
                        </button>
                      </div>
                    </label>
                  </div>
                </div>
                <div className="flex flex-wrap gap-3">
                  <button className="rounded-2xl bg-gradient-to-br from-blue-600 to-sky-400 px-5 py-3 font-bold text-white shadow-lg shadow-blue-700/20" disabled={submitting || !selectedTemplate} type="submit">
                    Tạo test case + steps + data
                  </button>
                  <button className="rounded-2xl border border-slate-200 bg-white px-5 py-3 font-bold" type="button" onClick={() => setCreatePanelOpen(false)}>
                    Hủy
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
