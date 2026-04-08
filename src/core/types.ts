export type ActionType =
  | 'goto'
  | 'waitForUrl'
  | 'payViaVnpay'
  | 'hover'
  | 'click'
  | 'fill'
  | 'press'
  | 'waitFor'
  | 'assertVisible'
  | 'assertText'
  | 'assertUrlContains';

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

export interface Step {
  action: ActionType;
  selector?: string;
  target?: string;
  url?: string;
  value?: string;
  description?: string;
  timeout?: number;
  backend?: {
    testCaseStepId: number;
    testCaseId: number;
    testDataSetId?: number;
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
  description?: string;
  timeoutMs?: number | string;
  steps: Step[];
  backend?: {
    projectId: number;
    testCaseId: number;
    testDataSetIds: number[];
  };
}
