import { LoginTemplateInput, Project, TestCase, TestCaseRequest } from '../types';
import { attachTestCaseDataSet, createTestCase, createTestCaseStep, createTestDataSet } from './testCaseService';

function formatSelector(kind: LoginTemplateInput['successSelectorKind'], value: string): string {
  const trimmedValue = value.trim();
  return kind === 'auto' ? trimmedValue : `kind=${kind}::${trimmedValue}`;
}

export async function createLoginFunctionalTest(
  project: Project,
  testCasePayload: Omit<TestCaseRequest, 'projectId' | 'type' | 'status'>,
  input: LoginTemplateInput
): Promise<TestCase> {
  const successTarget = formatSelector(input.successSelectorKind, input.successSelector);
  const submitTarget = formatSelector(input.submitSelectorKind, input.submitSelector);
  const testCase = await createTestCase({
    ...testCasePayload,
    projectId: project.id,
    type: 'login',
    status: 'active',
  });

  const steps = [
    {
      stepOrder: 1,
      actionType: 'goto',
      target: input.pagePath,
      value: null,
      expectedValue: null,
      description: 'Đi tới trang login',
    },
    {
      stepOrder: 2,
      actionType: 'fill',
      target: input.emailSelector,
      value: '${validUser.username}',
      expectedValue: null,
      description: 'Nhập username hợp lệ',
    },
    {
      stepOrder: 3,
      actionType: 'fill',
      target: input.passwordSelector,
      value: '${validUser.password}',
      expectedValue: null,
      description: 'Nhập password hợp lệ',
    },
    {
      stepOrder: 4,
      actionType: 'click',
      target: submitTarget,
      value: null,
      expectedValue: null,
      description: 'Click nút đăng nhập',
    },
    {
      stepOrder: 5,
      actionType: 'assertVisible',
      target: '${expected.result.selector}',
      value: null,
      expectedValue: '${expected.result.value}',
      description: 'Kiểm tra dashboard hiển thị',
    },
  ];

  await Promise.all(steps.map((step) => createTestCaseStep({ ...step, testCaseId: testCase.id })));

  const testDataSet = await createTestDataSet({
    projectId: project.id,
    code: `${testCase.code}`,
    name: `${testCase.name} `,
    description:  `${testCase.description} `,
    dataJson: {
      validUser: {
        username: input.username,
        password: input.password,
      },
    },
    expectedJson: {
      result: {
        selector: successTarget,
        value: 'visible',
      },
    },
    status: 'active',
  });

  await attachTestCaseDataSet({
    testCaseId: testCase.id,
    testDataSetId: testDataSet.id,
  });

  return testCase;
}
