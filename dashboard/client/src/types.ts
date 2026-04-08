export type TemplateField = {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number';
  required: boolean;
  defaultValue: string;
  selectorKinds?: Array<'auto' | 'text' | 'button' | 'link' | 'label' | 'placeholder' | 'css'>;
  selectorDefaultKind?: 'auto' | 'text' | 'button' | 'link' | 'label' | 'placeholder' | 'css';
};

export type TemplateSummary = {
  id: string;
  name: string;
  description: string;
  fields: TemplateField[];
};

export type Project = {
  id: number;
  code: string;
  name: string;
  description?: string | null;
  baseUrl?: string | null;
  status?: string | null;
};

export type ProjectRequest = {
  code: string;
  name: string;
  description: string;
  baseUrl: string;
  status: string;
};

export type TestCase = {
  id: number;
  projectId: number;
  code: string;
  name: string;
  description?: string | null;
  type?: string | null;
  status?: string | null;
};

export type TestCaseRequest = {
  projectId: number;
  code: string;
  name: string;
  description: string;
  type: string;
  status: string;
};

export type TestCaseStepRequest = {
  testCaseId: number;
  stepOrder: number;
  actionType: string;
  target: string | null;
  value: string | null;
  expectedValue: string | null;
  description: string;
};

export type TestCaseStep = TestCaseStepRequest & {
  id: number;
};

export type TestDataSetRequest = {
  projectId: number;
  code: string;
  name: string;
  description: string;
  dataJson: Record<string, unknown>;
  expectedJson: Record<string, unknown>;
  status: string;
};

export type TestDataSet = TestDataSetRequest & {
  id: number;
};

export type TestCaseDataSetRequest = {
  testCaseId: number;
  testDataSetId: number;
};

export type TestCaseDataSet = TestCaseDataSetRequest & {
  id: number;
};

export type LoginTemplateInput = {
  pagePath: string;
  emailSelector: string;
  passwordSelector: string;
  submitSelectorKind: 'auto' | 'text' | 'button' | 'link' | 'label' | 'placeholder' | 'css';
  submitSelector: string;
  successSelectorKind: 'auto' | 'text' | 'button' | 'link' | 'label' | 'placeholder' | 'css';
  successSelector: string;
  successUrl?: string;
  username: string;
  password: string;
};

export type FlowStep = {
  action: string;
  description?: string;
  selector?: string;
  url?: string;
  value?: string;
};

export type RunResult = {
  runId: string;
  durationMs: number;
  status: 'passed' | 'failed';
  currentUrl: string;
  errorMessage: string | null;
  flowName?: string;
  steps: Array<{
    name: string;
    status: 'passed' | 'failed';
    durationMs: number;
    error?: string;
    testDataSetId?: number | null;
    dataSetLabel?: string;
  }>;
  dataSets?: Array<{
    testDataSetId: number | null;
    label: string;
    status: 'passed' | 'failed';
    durationMs: number;
    stepCount: number;
    executedStepCount: number;
    failedStepCount: number;
    errorMessage?: string | null;
  }>;
  artifacts?: {
    video?: { url: string; label?: string; testDataSetId?: number | null } | null;
    videos?: Array<{ url: string; label?: string; testDataSetId?: number | null }>;
    screenshot?: { url: string } | null;
  };
};

export type RunProgressEvent =
  | {
      type: 'runStarted';
      runId: string;
      flowName: string;
    }
  | {
      type: 'dataSetStarted';
      testDataSetId: number | null;
      label: string;
      groupIndex: number;
      totalGroups: number;
    }
  | {
      type: 'stepStarted';
      testDataSetId: number | null;
      groupIndex: number;
      stepIndex: number;
      totalSteps: number;
      flowStepIndex: number;
      name: string;
      action: string;
    }
  | {
      type: 'stepFinished';
      testDataSetId: number | null;
      groupIndex: number;
      stepIndex: number;
      totalSteps: number;
      flowStepIndex: number;
      name: string;
      action: string;
      status: 'passed' | 'failed';
      durationMs: number;
      error?: string;
    }
  | {
      type: 'dataSetFinished';
      testDataSetId: number | null;
      label: string;
      groupIndex: number;
      totalGroups: number;
      status: 'passed' | 'failed';
    }
  | {
      type: 'runFinished';
      runId: string;
      status: 'passed' | 'failed';
    };

export type RunProgressState = {
  running: boolean;
  runId?: string;
  flowName?: string;
  testCaseName?: string;
  currentDataSetLabel?: string;
  currentDataSetIndex?: number;
  totalDataSets?: number;
  currentStepName?: string;
  currentStepIndex?: number;
  totalSteps?: number;
  completedSteps: number;
  failedSteps: number;
};

export type RecordingStartResult = {
  sessionId: string;
  message: string;
};

export type RecordingStopResult = {
  sessionId: string;
  currentUrl?: string;
  eventCount: number;
  stepCount: number;
  steps: FlowStep[];
  code: string;
  artifacts: {
    video: { url: string } | null;
  };
};

export type RecordingLiveResult = {
  sessionId: string;
  createdAt: string;
  currentUrl: string;
  eventCount: number;
  stepCount: number;
  steps: FlowStep[];
  code: string;
};

export type ViewMode = 'home' | 'project' | 'recorder' | 'custom';

export type StatusTone = 'running' | 'passed' | 'failed';
