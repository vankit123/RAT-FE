export type StepAction =
  | 'goto'
  | 'waitForUrl'
  | 'payViaVnpay'
  | 'hover'
  | 'click'
  | 'fill'
  | 'press'
  | 'assertVisible'
  | 'assertText'
  | 'assertUrlContains'
  | 'waitFor';

export interface ExternalPaymentConfig {
  provider: 'vnpay';
  mode: 'auto' | 'manual-complete';
  bankText?: string;
  bankSelector?: string;
  cardNumber?: string;
  cardHolderName?: string;
  issueDate?: string;
  otp?: string;
  returnUrl?: string;
  timeoutMs?: number;
}

export interface FlowStep {
  action: StepAction;
  description?: string;
  selector?: string;
  url?: string;
  value?: string;
  screenKey?: string;
  backend?: {
    testCaseStepId: number;
    testCaseId: number;
    testDataSetId?: number;
    testDataSetCode?: string;
    testDataSetName?: string;
    stepOrder: number;
    actionType: string;
    target?: string | null;
    value?: string | null;
    expectedValue?: string | null;
    actualValue?: string | null;
    externalPayment?: ExternalPaymentConfig | null;
  };
}

export interface FlowDefinition {
  name: string;
  targetUrl?: string;
  timeoutMs?: number | string;
  steps: FlowStep[];
  backend?: {
    projectId: number;
    testCaseId: number;
    testDataSetIds: number[];
  };
}

export type FlowRunProgressEvent =
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
      action: StepAction;
    }
  | {
      type: 'stepFinished';
      testDataSetId: number | null;
      groupIndex: number;
      stepIndex: number;
      totalSteps: number;
      flowStepIndex: number;
      name: string;
      action: StepAction;
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

export interface FlowArtifact {
  absolutePath: string;
  url: string;
}

export interface FlowVideoArtifact extends FlowArtifact {
  testDataSetId?: number | null;
  label?: string;
}

export interface FlowRunDataSetSummary {
  testDataSetId: number | null;
  label: string;
  status: 'passed' | 'failed';
  durationMs: number;
  stepCount: number;
  executedStepCount: number;
  failedStepCount: number;
  errorMessage?: string | null;
}

export interface FlowRunSummary {
  runId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: 'passed' | 'failed';
  currentUrl: string;
  targetUrl: string;
  errorMessage: string | null;
  flowName: string;
  steps: Array<{
    name: string;
    status: 'passed' | 'failed';
    testDataSetId?: number | null;
    dataSetLabel?: string;
    flowStepIndex?: number;
    startedAt?: string;
    endedAt?: string;
    durationMs: number;
    error?: string;
  }>;
  dataSets?: FlowRunDataSetSummary[];
  artifacts: {
    screenshot: FlowArtifact | null;
    video: FlowVideoArtifact | null;
    videos?: FlowVideoArtifact[];
  };
  input: unknown;
}

export interface TemplateField {
  key: string;
  label: string;
  type: 'text' | 'password' | 'number';
  required: boolean;
  defaultValue: string;
  selectorKinds?: Array<'auto' | 'text' | 'button' | 'link' | 'label' | 'placeholder' | 'css' | 'option'>;
  selectorDefaultKind?: 'auto' | 'text' | 'button' | 'link' | 'label' | 'placeholder' | 'css' | 'option';
}

export interface TemplateSummary {
  id: string;
  name: string;
  description: string;
  fields: TemplateField[];
}

export interface RecorderEvent {
  type: 'hover' | 'click' | 'change' | 'navigation';
  selector: string;
  label?: string;
  inputType?: string;
  value?: string;
  screenKey?: string;
  url: string;
  timestamp: number;
}
