import {
  TestCase,
  TestCaseDataSet,
  TestCaseDataSetRequest,
  TestCaseRequest,
  TestCaseStep,
  TestCaseStepRequest,
  TestDataSet,
  TestDataSetRequest,
} from '../types';
import { BACKEND_ENDPOINTS } from './endpoints';
import { deleteBackendJson, getBackendJson, postBackendJson, putBackendJson } from './httpService';

export function getTestCases(): Promise<TestCase[]> {
  return getBackendJson<TestCase[]>(BACKEND_ENDPOINTS.testCases);
}

export function getTestDataSets(): Promise<TestDataSet[]> {
  return getBackendJson<TestDataSet[]>(BACKEND_ENDPOINTS.testDataSets);
}

export function getTestCaseDataSets(): Promise<TestCaseDataSet[]> {
  return getBackendJson<TestCaseDataSet[]>(BACKEND_ENDPOINTS.testCaseDataSets);
}

export function getTestCaseSteps(): Promise<TestCaseStep[]> {
  return getBackendJson<TestCaseStep[]>(BACKEND_ENDPOINTS.testCaseSteps);
}

export function createTestCase(payload: TestCaseRequest): Promise<TestCase> {
  return postBackendJson<TestCase>(BACKEND_ENDPOINTS.testCases, payload);
}

export function updateTestCase(id: number, payload: TestCaseRequest): Promise<TestCase> {
  return putBackendJson<TestCase>(`${BACKEND_ENDPOINTS.testCases}/${id}`, payload);
}

export function deleteTestCase(id: number): Promise<unknown> {
  return deleteBackendJson<unknown>(`${BACKEND_ENDPOINTS.testCases}/${id}`);
}

export function createTestCaseStep(payload: TestCaseStepRequest): Promise<TestCaseStep> {
  return postBackendJson<TestCaseStep>(BACKEND_ENDPOINTS.testCaseSteps, payload);
}

export function updateTestCaseStep(id: number, payload: TestCaseStepRequest): Promise<TestCaseStep> {
  return putBackendJson<TestCaseStep>(`${BACKEND_ENDPOINTS.testCaseSteps}/${id}`, payload);
}

export function deleteTestCaseStep(id: number): Promise<unknown> {
  return deleteBackendJson<unknown>(`${BACKEND_ENDPOINTS.testCaseSteps}/${id}`);
}

export function createTestDataSet(payload: TestDataSetRequest): Promise<TestDataSet> {
  return postBackendJson<TestDataSet>(BACKEND_ENDPOINTS.testDataSets, payload);
}

export function updateTestDataSet(id: number, payload: TestDataSetRequest): Promise<TestDataSet> {
  return putBackendJson<TestDataSet>(`${BACKEND_ENDPOINTS.testDataSets}/${id}`, payload);
}

export function deleteTestDataSet(id: number): Promise<unknown> {
  return deleteBackendJson<unknown>(`${BACKEND_ENDPOINTS.testDataSets}/${id}`);
}

export function attachTestCaseDataSet(payload: TestCaseDataSetRequest): Promise<TestCaseDataSet> {
  return postBackendJson<TestCaseDataSet>(BACKEND_ENDPOINTS.testCaseDataSets, payload);
}

export function deleteTestCaseDataSet(id: number): Promise<unknown> {
  return deleteBackendJson<unknown>(`${BACKEND_ENDPOINTS.testCaseDataSets}/${id}`);
}
