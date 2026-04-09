import { useEffect, useMemo, useRef, useState } from "react";
import { checkProjectBaseUrl, createProject, getProjects, updateProject } from "./services/projectService";
import {
  getTestCaseDataSets,
  getTestCases,
  getTestCaseSteps,
  getTestDataSets,
  attachTestCaseDataSet,
  createTestCase,
  createTestCaseStep,
  createTestDataSet,
  deleteTestCase,
  deleteTestCaseDataSet,
  deleteTestCaseStep,
  deleteTestDataSet,
  updateTestCase,
  updateTestCaseStep,
  updateTestDataSet,
} from "./services/testCaseService";
import { createLoginFunctionalTest } from "./services/functionalTestService";
import { getLatestProjectRunResult, runBackendTestCaseRequest } from "./services/flowService";
import { uploadTestAsset } from "./services/testAssetService";
import { getTemplates } from "./services/templateService";
import {
  InitialTestCaseSetInput,
  LoginTemplateInput,
  Project,
  ProjectRequest,
  RecordingStopResult,
  RunProgressEvent,
  RunProgressState,
  RunResult,
  RunResultEntry,
  TemplateSummary,
  TestCase,
  TestCaseDataSet,
  TestCaseRequest,
  TestCaseStep,
  TestCaseStepRequest,
  TestDataSet,
  TestDataSetRequest,
  ViewMode,
} from "./types";
import { CustomFlowView } from "./components/CustomFlowView";
import { ProjectCreateView } from "./components/ProjectCreateView";
import { ProjectWorkspace } from "./components/ProjectWorkspace";
import { RecorderView } from "./components/RecorderView";
import { ResultsPanel } from "./components/ResultsPanel";
import { Sidebar } from "./components/Sidebar";

const LATEST_RESULT_STORAGE_KEY = "rat.latestRunResult";
const VNPAY_SANDBOX_PATTERN = /sandbox\.vnpayment\.vn\/paymentv2/i;

function toRunResultEntry(
  result: RunResult,
  meta?: {
    testCaseId?: number | null;
    testCaseCode?: string;
    testCaseName?: string;
  },
): RunResultEntry {
  return {
    testCaseId: meta?.testCaseId ?? result.testCaseId ?? null,
    testCaseCode: meta?.testCaseCode || "",
    testCaseName: meta?.testCaseName || result.flowName || "Test case",
    result,
  };
}

function loadStoredLatestResults(): RunResultEntry[] {
  try {
    const rawResult = window.localStorage.getItem(LATEST_RESULT_STORAGE_KEY);
    if (!rawResult) return [];

    const parsed = JSON.parse(rawResult) as RunResultEntry[] | RunResult;
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item) =>
          item &&
          typeof item === "object" &&
          item.result &&
          item.result.runId &&
          item.result.status &&
          Array.isArray(item.result.steps),
      );
    }

    return parsed && parsed.runId && parsed.status && Array.isArray(parsed.steps)
      ? [toRunResultEntry(parsed)]
      : [];
  } catch {
    return [];
  }
}

function isVnpayGatewayUrl(value: string | null | undefined): boolean {
  return VNPAY_SANDBOX_PATTERN.test(String(value || "").trim());
}

function sanitizeRecordedStep(step: RecordingStopResult["steps"][number]): RecordingStopResult["steps"][number] | null {
  if (step.action === "goto" && isVnpayGatewayUrl(step.url)) {
    return {
      action: "waitForUrl",
      value: "sandbox\\.vnpayment\\.vn/paymentv2/vpcpay\\.html",
      description: "Chờ backend redirect sang VNPAY sandbox của lần chạy hiện tại",
    };
  }

  if (step.action === "assertUrlContains" && isVnpayGatewayUrl(step.value)) {
    return {
      ...step,
      value: "sandbox.vnpayment.vn/paymentv2",
    };
  }

  return step;
}

function buildRuntimeRecordedSteps(recording: RecordingStopResult): RecordingStopResult["steps"] {
  const sanitizedRecordedSteps = recording.steps
    .map((step) => sanitizeRecordedStep(step))
    .filter((step): step is RecordingStopResult["steps"][number] => Boolean(step));

  if (!recordingTouchesVnpay(recording)) {
    return sanitizedRecordedSteps;
  }

  const alreadyHasPaymentStep = sanitizedRecordedSteps.some((step) => step.action === "payViaVnpay");
  if (alreadyHasPaymentStep) {
    return sanitizedRecordedSteps;
  }

  const firstSandboxWaitIndex = sanitizedRecordedSteps.findIndex(
    (step) => step.action === "waitForUrl" && String(step.value || "").includes("sandbox\\.vnpayment\\.vn"),
  );

  const paymentStep: RecordingStopResult["steps"][number] = {
    action: "payViaVnpay",
    description: "Chờ bạn hoàn tất thanh toán VNPAY sandbox thủ công rồi quay lại flow",
    value: "",
  };

  if (firstSandboxWaitIndex >= 0) {
    return [
      ...sanitizedRecordedSteps.slice(0, firstSandboxWaitIndex + 1),
      paymentStep,
      ...sanitizedRecordedSteps.slice(firstSandboxWaitIndex + 1),
    ];
  }

  return [...sanitizedRecordedSteps, paymentStep];
}

function recordingTouchesVnpay(recording: RecordingStopResult): boolean {
  if (isVnpayGatewayUrl(recording.currentUrl)) return true;
  return recording.steps.some(
    (step) =>
      (step.action === "waitForUrl" && isVnpayGatewayUrl(step.value)) ||
      isVnpayGatewayUrl(step.url) ||
      isVnpayGatewayUrl(step.selector) ||
      isVnpayGatewayUrl(step.value),
  );
}

function slugifyInputKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "input";
}

function deriveRecordedInputKey(step: RecordingStopResult["steps"][number], index: number): string {
  const source = String(step.selector || step.description || `step_${index + 1}`);
  const labelMatch =
    /kind=label::([^]+)$/i.exec(source) ||
    /kind=placeholder::([^]+)$/i.exec(source) ||
    /kind=text::([^]+)$/i.exec(source) ||
    /\[name="([^"]+)"\]/i.exec(source) ||
    /\[placeholder="([^"]+)"\]/i.exec(source) ||
    /\[aria-label="([^"]+)"\]/i.exec(source);

  return slugifyInputKey(labelMatch?.[1] || source);
}

async function dataUrlToFile(
  dataUrl: string,
  fileName: string,
  mimeType: string,
): Promise<File> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  return new File([blob], fileName, {
    type: mimeType || blob.type || "application/octet-stream",
  });
}

function isStableRecordedFieldSelector(selector: string | undefined): boolean {
  const normalized = String(selector || "").trim();
  if (!normalized) return false;
  if (normalized.startsWith("kind=")) return false;
  if (/^\[value=/i.test(normalized)) return false;
  return (
    normalized.startsWith("#") ||
    /^\[(data-testid|name|aria-label|placeholder)=/i.test(normalized)
  );
}

function optionValueFromSelector(selector: string | undefined): string {
  const normalized = String(selector || "").trim();
  const match = /^kind=option::(.+)$/i.exec(normalized);
  return String(match?.[1] || "").trim();
}

function buildRecordedInputData(
  steps: RecordingStopResult["steps"],
): Record<string, Record<string, string>> {
  const grouped: Record<string, Record<string, string>> = {};
  const lastFieldSelectorByScreen: Record<string, string> = {};

  steps.forEach((step, index) => {
    const screenKey =
      String(step.screenKey || "").trim().replace(/[^a-zA-Z0-9_]+/g, "_") ||
      "screen";
    const selector = String(step.selector || "").trim();

    if (isStableRecordedFieldSelector(selector)) {
      lastFieldSelectorByScreen[screenKey] = selector;
    }

    if (step.action === "fill" && String(step.value || "").trim()) {
      const effectiveSelector =
        /^\[value=/i.test(selector) && lastFieldSelectorByScreen[screenKey]
          ? lastFieldSelectorByScreen[screenKey]
          : selector;
      const inputKey = deriveRecordedInputKey(
        { ...step, selector: effectiveSelector },
        index,
      );
      if (!grouped[screenKey]) {
        grouped[screenKey] = {};
      }
      grouped[screenKey][inputKey] = String(step.value || "").trim();
      return;
    }

    if (step.action === "click") {
      const optionValue = optionValueFromSelector(selector);
      const lastFieldSelector = lastFieldSelectorByScreen[screenKey];
      if (optionValue && lastFieldSelector) {
        const inputKey = deriveRecordedInputKey(
          { ...step, selector: lastFieldSelector },
          index,
        );
        if (!grouped[screenKey]) {
          grouped[screenKey] = {};
        }
        grouped[screenKey][inputKey] = optionValue;
      }
    }
  });

  return grouped;
}

async function buildRecordedFileAssetData(
  projectId: number,
  recording: RecordingStopResult,
): Promise<Record<string, Record<string, { assetId: number; fileName: string; mimeType: string }>>> {
  const grouped: Record<
    string,
    Record<string, { assetId: number; fileName: string; mimeType: string }>
  > = {};

  for (const uploadedFile of recording.uploadedFiles || []) {
    if (!uploadedFile.dataUrl) {
      continue;
    }

    const file = await dataUrlToFile(
      uploadedFile.dataUrl,
      uploadedFile.fileName,
      uploadedFile.mimeType,
    );
    const uploadedAsset = await uploadTestAsset(projectId, file);
    const screenKey =
      String(uploadedFile.screenKey || "")
        .trim()
        .replace(/[^a-zA-Z0-9_]+/g, "_") || "screen";
    if (!grouped[screenKey]) {
      grouped[screenKey] = {};
    }
    grouped[screenKey][uploadedFile.inputKey] = {
      assetId: uploadedAsset.id,
      fileName: uploadedAsset.originalName || uploadedFile.fileName,
      mimeType: uploadedAsset.mimeType || uploadedFile.mimeType,
    };
  }

  return grouped;
}

export function App() {
  const [collapsed, setCollapsed] = useState(false);
  const [projectsExpanded, setProjectsExpanded] = useState(true);
  const [activeView, setActiveView] = useState<ViewMode>("home");
  const [projects, setProjects] = useState<Project[]>([]);
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [testCases, setTestCases] = useState<TestCase[]>([]);
  const [testCaseSteps, setTestCaseSteps] = useState<TestCaseStep[]>([]);
  const [testDataSets, setTestDataSets] = useState<TestDataSet[]>([]);
  const [testCaseDataSets, setTestCaseDataSets] = useState<TestCaseDataSet[]>(
    [],
  );
  const [selectedProjectId, setSelectedProjectId] = useState<number | null>(
    null,
  );
  const [projectStatus, setProjectStatus] = useState<{
    text: string;
    tone?: "running" | "passed" | "failed";
  }>({ text: "Ready" });
  const [testCaseStatus, setTestCaseStatus] = useState<{
    text: string;
    tone?: "running" | "passed" | "failed";
  }>({ text: "Ready" });
  const [stageMeta, setStageMeta] = useState(
    "Tạo dự án mới hoặc chọn dự án đã lưu trong sidebar",
  );
  const [latestResults, setLatestResults] = useState<RunResultEntry[]>([]);
  const [runningLabel, setRunningLabel] = useState<string | undefined>();
  const [runProgress, setRunProgress] = useState<RunProgressState | null>(null);
  const [runningTestCaseId, setRunningTestCaseId] = useState<number | null>(null);
  const [recordedSteps, setRecordedSteps] = useState("");
  const [recorderStartUrl, setRecorderStartUrl] = useState("http://localhost:5173/signin");
  const [recorderAutoStart, setRecorderAutoStart] = useState(false);
  const runAbortControllerRef = useRef<AbortController | null>(null);
  const stopQueuedRunsRef = useRef(false);
  const runQueueActiveRef = useRef(false);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId) || null,
    [projects, selectedProjectId],
  );

  useEffect(() => {
    if (activeView !== "recorder") {
      setRecorderAutoStart(false);
    }
  }, [activeView]);

  const selectedProjectTestCases = useMemo(
    () =>
      selectedProject
        ? testCases.filter(
            (testCase) => testCase.projectId === selectedProject.id,
          ).sort((left, right) => left.id - right.id)
        : [],
    [selectedProject, testCases],
  );

  useEffect(() => {
    setLatestResults(loadStoredLatestResults());
    void Promise.all([refreshProjects(), refreshTemplates()]).catch((error) => {
      setStageMeta(
        `Không thể load dữ liệu dashboard: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    void loadLatestProjectRun(selectedProjectId);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedProjectTestCases.length) return;

    setLatestResults((current) => {
      let changed = false;
      const nextResults = current.map((entry) => {
        const testCaseId = entry.testCaseId ?? entry.result.testCaseId ?? null;
        if (!testCaseId) {
          return entry;
        }

        const matchedTestCase = selectedProjectTestCases.find(
          (item) => item.id === testCaseId,
        );
        if (!matchedTestCase) {
          return entry;
        }

        const nextCode = matchedTestCase.code || "";
        const nextName = matchedTestCase.name || entry.testCaseName || "";
        if (
          entry.testCaseId === testCaseId &&
          entry.testCaseCode === nextCode &&
          entry.testCaseName === nextName
        ) {
          return entry;
        }

        changed = true;
        return {
          ...entry,
          testCaseId,
          testCaseCode: nextCode,
          testCaseName: nextName,
        };
      });

      if (!changed) {
        return current;
      }

      try {
        window.localStorage.setItem(
          LATEST_RESULT_STORAGE_KEY,
          JSON.stringify(nextResults),
        );
      } catch {
        // Browser storage is optional.
      }

      return nextResults;
    });
  }, [selectedProjectTestCases]);

  function rememberLatestResult(
    result: RunResult,
    meta?: {
      testCaseId?: number | null;
      testCaseCode?: string;
      testCaseName?: string;
      append?: boolean;
    },
  ) {
    const nextEntry = toRunResultEntry(result, meta);
    setLatestResults((current) => {
      const nextResults = meta?.append
        ? [
            ...current.filter(
              (item) => item.testCaseId !== nextEntry.testCaseId,
            ),
            nextEntry,
          ]
        : [nextEntry];
      try {
        window.localStorage.setItem(
          LATEST_RESULT_STORAGE_KEY,
          JSON.stringify(nextResults),
        );
      } catch {
        // The run result should still be visible in memory even if browser storage is unavailable.
      }
      return nextResults;
    });
  }

  async function refreshProjects() {
    const nextProjects = await getProjects();
    setProjects(nextProjects);
    if (!selectedProjectId && nextProjects.length) {
      setSelectedProjectId(nextProjects[0].id);
    }
  }

  async function refreshTemplates() {
    setTemplates(await getTemplates());
  }

  async function loadLatestProjectRun(projectId: number) {
    try {
      const result = await getLatestProjectRunResult(projectId);
      const matchedTestCase =
        result?.testCaseId != null
          ? testCases.find((item) => item.id === result.testCaseId) || null
          : null;
      const nextResults = result
        ? [
            toRunResultEntry(result, {
              testCaseId: matchedTestCase?.id ?? result.testCaseId ?? null,
              testCaseCode: matchedTestCase?.code || "",
              testCaseName: matchedTestCase?.name || result.flowName || "Test case",
            }),
          ]
        : [];
      setLatestResults(nextResults);
      if (result) {
        try {
          window.localStorage.setItem(
            LATEST_RESULT_STORAGE_KEY,
            JSON.stringify(nextResults),
          );
        } catch {
          // Browser storage is optional; the BE response is already in state.
        }
      } else {
        try {
          window.localStorage.removeItem(LATEST_RESULT_STORAGE_KEY);
        } catch {
          // Browser storage is optional.
        }
      }
    } catch (error) {
      setLatestResults([]);
      setStageMeta(
        `Không thể load lần chạy gần nhất của dự án: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async function refreshTestCases() {
    const [nextTestCases, nextTestCaseSteps, nextTestDataSets, nextTestCaseDataSets] =
      await Promise.all([
        getTestCases(),
        getTestCaseSteps(),
        getTestDataSets(),
        getTestCaseDataSets(),
      ]);
    setTestCases(nextTestCases);
    setTestCaseSteps(nextTestCaseSteps);
    setTestDataSets(nextTestDataSets);
    setTestCaseDataSets(nextTestCaseDataSets);
  }

  async function handleCreateProject(payload: ProjectRequest) {
    setProjectStatus({ text: "Creating", tone: "running" });
    try {
      const project = await createProject(payload);
      await refreshProjects();
      setSelectedProjectId(project.id);
      setActiveView("project");
      await refreshTestCases();
      setProjectStatus({ text: "Created", tone: "passed" });
      setStageMeta(`Đã tạo dự án ${project.name}`);
    } catch (error) {
      setProjectStatus({ text: "Failed", tone: "failed" });
      setStageMeta(
        `Không thể tạo dự án: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async function handleUpdateProject(project: Project, payload: ProjectRequest) {
    setProjectStatus({ text: "Updating", tone: "running" });
    try {
      const updatedProject = await updateProject(project.id, payload);
      await refreshProjects();
      setSelectedProjectId(updatedProject.id);
      setProjectStatus({ text: "Updated", tone: "passed" });
      setStageMeta(
        `Đã cập nhật URL web của dự án ${updatedProject.name}${updatedProject.baseUrl ? `: ${updatedProject.baseUrl}` : ""}`,
      );
    } catch (error) {
      setProjectStatus({ text: "Failed", tone: "failed" });
      setStageMeta(
        `Không thể cập nhật dự án: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async function handleSelectProject(project: Project) {
    setSelectedProjectId(project.id);
    setActiveView("project");
    setStageMeta(
      `${project.name}${project.baseUrl ? ` - ${project.baseUrl}` : ""}`,
    );
    if (!templates.length) await refreshTemplates();
    await refreshTestCases();
  }

  async function handleCreateTestCase(
    payload: Omit<TestCaseRequest, "projectId" | "type" | "status">,
    template: TemplateSummary,
    input: LoginTemplateInput,
    initialDataSet: InitialTestCaseSetInput,
  ) {
    if (!selectedProject) return;
    if (template.id !== "login") {
      const message = `Template ${template.name} chưa có builder tạo steps/data chi tiết. Hiện tại đã hỗ trợ Login.`;
      setTestCaseStatus({ text: "Failed", tone: "failed" });
      setStageMeta(message);
      throw new Error(message);
    }

    setTestCaseStatus({ text: "Creating", tone: "running" });
    try {
      const testCase = await createLoginFunctionalTest(
        selectedProject,
        payload,
        input,
        initialDataSet,
      );
      await refreshTestCases();
      setTestCaseStatus({ text: "Created", tone: "passed" });
      setStageMeta(
        `Đã tạo test case ${testCase.name} kèm steps, data set và mapping data set`,
      );
    } catch (error) {
      setTestCaseStatus({ text: "Failed", tone: "failed" });
      setStageMeta(
        `Không thể tạo test case: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async function handleUpdateTestCase(
    testCase: TestCase,
    payload: TestCaseRequest,
    dataSetUpdates: Array<{ id: number; payload: TestDataSetRequest }> = [],
    stepUpdates: Array<{ id: number; payload: TestCaseStepRequest }> = [],
    newDataSet?: TestDataSetRequest,
    newStep?: TestCaseStepRequest,
  ) {
    setTestCaseStatus({ text: "Updating", tone: "running" });
    try {
      const updatedTestCase = await updateTestCase(testCase.id, payload);
      if (dataSetUpdates.length) {
        await Promise.all(dataSetUpdates.map((dataSetUpdate) => updateTestDataSet(dataSetUpdate.id, dataSetUpdate.payload)));
      }
      if (stepUpdates.length) {
        await Promise.all(stepUpdates.map((stepUpdate) => updateTestCaseStep(stepUpdate.id, stepUpdate.payload)));
      }
      if (newDataSet) {
        const createdDataSet = await createTestDataSet(newDataSet);
        await attachTestCaseDataSet({
          testCaseId: testCase.id,
          testDataSetId: createdDataSet.id,
        });
      }
      if (newStep) {
        await createTestCaseStep(newStep);
      }
      await refreshTestCases();
      setTestCaseStatus({ text: "Updated", tone: "passed" });
      setStageMeta(`Đã cập nhật test case ${updatedTestCase.name}`);
    } catch (error) {
      setTestCaseStatus({ text: "Failed", tone: "failed" });
      setStageMeta(
        `Không thể cập nhật test case: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async function handleDeleteTestCase(testCase: TestCase) {
    if (!window.confirm(`Xóa test case "${testCase.name}"? Data step sẽ không còn chạy được cho test case này.`)) return;
    setTestCaseStatus({ text: "Deleting", tone: "running" });
    try {
      await deleteTestCase(testCase.id);
      await refreshTestCases();
      setTestCaseStatus({ text: "Deleted", tone: "passed" });
      setStageMeta(`Đã xóa test case ${testCase.name}`);
    } catch (error) {
      setTestCaseStatus({ text: "Failed", tone: "failed" });
      setStageMeta(
        `Không thể xóa test case: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async function handleDeleteTestCaseStep(step: TestCaseStep) {
    if (!window.confirm(`Xóa dataStep ${step.stepOrder}?`)) return;
    setTestCaseStatus({ text: "Deleting step", tone: "running" });
    try {
      await deleteTestCaseStep(step.id);
      await refreshTestCases();
      setTestCaseStatus({ text: "Deleted step", tone: "passed" });
      setStageMeta(`Đã xóa dataStep ${step.stepOrder}`);
    } catch (error) {
      setTestCaseStatus({ text: "Failed", tone: "failed" });
      setStageMeta(
        `Không thể xóa dataStep: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async function handleDeleteTestDataSet(testCase: TestCase, dataSet: TestDataSet) {
    if (!window.confirm(`Xóa dataSet "${dataSet.code}" khỏi test case "${testCase.name}"?`)) return;
    setTestCaseStatus({ text: "Deleting dataSet", tone: "running" });
    try {
      const mappings = testCaseDataSets.filter(
        (mapping) => mapping.testCaseId === testCase.id && mapping.testDataSetId === dataSet.id,
      );
      await Promise.all(mappings.map((mapping) => deleteTestCaseDataSet(mapping.id)));
      await deleteTestDataSet(dataSet.id);
      await refreshTestCases();
      setTestCaseStatus({ text: "Deleted dataSet", tone: "passed" });
      setStageMeta(`Đã xóa dataSet ${dataSet.code}`);
    } catch (error) {
      setTestCaseStatus({ text: "Failed", tone: "failed" });
      setStageMeta(
        `Không thể xóa dataSet: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async function handleSaveRecordingAsTestCase(
    recording: RecordingStopResult,
    payload: Omit<TestCaseRequest, "projectId" | "status">,
  ) {
    if (!selectedProject) return;
    if (!recording.steps.length) {
      throw new Error("Recorder chưa có step nào để lưu thành test case.");
    }

    setTestCaseStatus({ text: "Saving recording", tone: "running" });
    try {
      const sanitizedRecordedSteps = buildRuntimeRecordedSteps(recording);
      const hasVnpayInRecording = recordingTouchesVnpay(recording);
      const recordedInputs = buildRecordedInputData(sanitizedRecordedSteps);
      const recordedFileAssets = await buildRecordedFileAssetData(
        selectedProject.id,
        recording,
      );
      const combinedInputs = Object.entries(recordedFileAssets).reduce<
        Record<string, Record<string, unknown>>
      >((accumulator, [screenKey, assetFields]) => {
        accumulator[screenKey] = {
          ...(recordedInputs[screenKey] || {}),
          ...assetFields,
        };
        return accumulator;
      }, { ...recordedInputs });
      const recordedData = {
        ...(Object.keys(combinedInputs).length
          ? {
              inputs: combinedInputs,
            }
          : {}),
        recorded: Object.fromEntries(
          sanitizedRecordedSteps.map((step, index) => [
            `step${index + 1}`,
            {
              action: step.action,
              target: step.selector || step.url || '',
              value: step.value || '',
              ...(step.screenKey
                ? {
                    screenKey: step.screenKey,
                  }
                : {}),
            },
          ]),
        ),
        ...(hasVnpayInRecording
          ? {
              payment: {
                vnpay: {
                  provider: "vnpay",
                  mode: "manual-complete",
                },
              },
            }
          : {}),
      };
      const testCase = await createTestCase({
        ...payload,
        projectId: selectedProject.id,
        status: "active",
      });

      const dataSet = await createTestDataSet({
        projectId: selectedProject.id,
        code: `${payload.code}_DATA_001`,
        name: `${payload.name} - Recorded data`,
        description: `Data được sinh từ recorder cho ${payload.name}`,
        dataJson: recordedData,
        expectedJson: {},
        status: "active",
      });

      await attachTestCaseDataSet({
        testCaseId: testCase.id,
        testDataSetId: dataSet.id,
      });

      await Promise.all(
        sanitizedRecordedSteps.map((step, index) => {
          const stepKey = `recorded.step${index + 1}`;
          const normalizedScreenKey =
            String(step.screenKey || "")
              .trim()
              .replace(/[^a-zA-Z0-9_]+/g, "_") || "screen";
          const uploadValuePlaceholder =
            step.action === "upload"
              ? `\${inputs.${normalizedScreenKey}.${deriveRecordedInputKey(step, index)}.assetId}`
              : null;
          return createTestCaseStep({
            testCaseId: testCase.id,
            stepOrder: index + 1,
            actionType: step.action,
            target:
              step.action === "payViaVnpay"
                ? null
                : step.action === "upload"
                  ? (step.selector || null)
                  : `\${${stepKey}.target}`,
            value:
              step.action === "goto" || step.action === "payViaVnpay"
                ? null
                : step.action === "upload"
                  ? uploadValuePlaceholder
                : `\${${stepKey}.value}`,
            expectedValue: null,
            description: step.description || `${step.action} ${step.selector || step.url || ""}`.trim(),
          });
        }),
      );

      await refreshTestCases();
      setActiveView("project");
      setTestCaseStatus({ text: "Saved recording", tone: "passed" });
      setStageMeta(
        `Đã lưu recording thành test case ${testCase.name} kèm dataSet ${dataSet.code}${
          hasVnpayInRecording ? " và bật chế độ payment VNPAY động" : ""
        }`,
      );
    } catch (error) {
      setTestCaseStatus({ text: "Failed", tone: "failed" });
      setStageMeta(
        `Không thể lưu recording thành test case: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async function executeTestCaseRun(testCase: TestCase, queueMeta?: { index: number; total: number }) {
    if (!queueMeta && (runningTestCaseId !== null || runQueueActiveRef.current)) {
      setTestCaseStatus({ text: "Busy", tone: "running" });
      return null;
    }
    const abortController = new AbortController();
    runAbortControllerRef.current = abortController;
    setRunningTestCaseId(testCase.id);
    setTestCaseStatus({ text: "Running", tone: "running" });
    setRunningLabel(
      queueMeta
        ? `Running ${testCase.code} (${queueMeta.index}/${queueMeta.total})`
        : `Running ${testCase.code}`,
    );
    setRunProgress({
      running: true,
      testCaseName: testCase.name,
      completedSteps: 0,
      failedSteps: 0,
    });
    setStageMeta(
      queueMeta
        ? `Đang chạy test case ${testCase.name} (${queueMeta.index}/${queueMeta.total})`
        : `Đang chạy test case ${testCase.name}`,
    );
    try {
      const result = await runBackendTestCaseRequest(
        testCase.id,
        (event) => handleRunProgressEvent(event, testCase),
        abortController.signal,
      );
      rememberLatestResult(result, {
        testCaseId: testCase.id,
        testCaseCode: testCase.code,
        testCaseName: testCase.name,
        append: Boolean(queueMeta),
      });
      setRunningLabel(undefined);
      runAbortControllerRef.current = null;
      setRunningTestCaseId(null);
      setRunProgress((current) => current ? { ...current, running: false } : null);
      setTestCaseStatus({
        text: result.status === "passed" ? "Passed" : "Failed",
        tone: result.status,
      });
      setStageMeta(`Đã chạy xong test case ${testCase.name}: ${result.status}`);
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const stoppedByUser = message === "Đã dừng chạy test.";
      runAbortControllerRef.current = null;
      setRunningTestCaseId(null);
      setRunningLabel(undefined);
      setRunProgress((current) => current ? { ...current, running: false } : null);
      setTestCaseStatus({
        text: stoppedByUser ? "Stopped" : "Failed",
        tone: stoppedByUser ? undefined : "failed",
      });
      setStageMeta(
        stoppedByUser
          ? `Đã dừng test case ${testCase.name}.`
          : `Không thể chạy test case: ${message}`,
      );
      if (!stoppedByUser) {
        throw error;
      }
      return null;
    }
  }

  async function handleRunTestCase(testCase: TestCase) {
    stopQueuedRunsRef.current = false;
    setLatestResults([]);
    await executeTestCaseRun(testCase);
  }

  async function handleRunMultipleTestCases(testCasesToRun: TestCase[]) {
    if (!testCasesToRun.length || runningTestCaseId !== null || runQueueActiveRef.current) return;
    stopQueuedRunsRef.current = false;
    runQueueActiveRef.current = true;
    setLatestResults([]);
    setStageMeta(`Chuẩn bị chạy ${testCasesToRun.length} test case theo thứ tự.`);
    const failedCaseNames: string[] = [];
    try {
      for (const [index, testCase] of testCasesToRun.entries()) {
        if (stopQueuedRunsRef.current) {
          break;
        }
        try {
          const result = await executeTestCaseRun(testCase, {
            index: index + 1,
            total: testCasesToRun.length,
          });
          if (result?.status === "failed") {
            failedCaseNames.push(testCase.name);
          }
        } catch (error) {
          failedCaseNames.push(testCase.name);
          setStageMeta(
            `Test case ${testCase.name} lỗi hệ thống: ${error instanceof Error ? error.message : String(error)}. Dashboard sẽ tiếp tục case kế tiếp.`,
          );
        }
        if (stopQueuedRunsRef.current) {
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 150));
      }
    } finally {
      runQueueActiveRef.current = false;
      if (stopQueuedRunsRef.current) {
        setStageMeta("Đã dừng chuỗi test case đang chạy.");
      } else if (failedCaseNames.length) {
        setStageMeta(
          `Đã chạy xong ${testCasesToRun.length} test case. Có ${failedCaseNames.length} case failed: ${failedCaseNames.join(", ")}`,
        );
      } else {
        setStageMeta(`Đã chạy xong ${testCasesToRun.length} test case theo thứ tự.`);
      }
    }
  }

  function handleStopRunningTest(): void {
    stopQueuedRunsRef.current = true;
    if (!runAbortControllerRef.current) return;
    runAbortControllerRef.current.abort();
    runAbortControllerRef.current = null;
    setRunningLabel(undefined);
    setRunProgress((current) =>
      current
        ? {
            ...current,
            running: false,
          }
        : null,
    );
    setRunningTestCaseId(null);
    setStageMeta("Đã gửi yêu cầu dừng test đang chạy.");
  }

  function handleRunProgressEvent(event: RunProgressEvent, testCase: TestCase) {
    setRunProgress((current) => {
      const base: RunProgressState = current || {
        running: true,
        testCaseName: testCase.name,
        completedSteps: 0,
        failedSteps: 0,
      };

      if (event.type === "runStarted") {
        return {
          ...base,
          running: true,
          runId: event.runId,
          flowName: event.flowName,
          testCaseName: testCase.name,
        };
      }

      if (event.type === "dataSetStarted") {
        return {
          ...base,
          running: true,
          currentDataSetLabel: event.label,
          currentDataSetIndex: event.groupIndex,
          totalDataSets: event.totalGroups,
          currentStepName: undefined,
          currentStepIndex: undefined,
          totalSteps: undefined,
        };
      }

      if (event.type === "stepStarted") {
        return {
          ...base,
          running: true,
          currentDataSetIndex: event.groupIndex,
          currentStepName: event.name,
          currentStepIndex: event.stepIndex,
          totalSteps: event.totalSteps,
        };
      }

      if (event.type === "stepFinished") {
        return {
          ...base,
          completedSteps: base.completedSteps + 1,
          failedSteps: event.status === "failed" ? base.failedSteps + 1 : base.failedSteps,
        };
      }

      if (event.type === "dataSetFinished") {
        return {
          ...base,
          currentDataSetLabel: `${event.label} ${event.status}`,
          currentDataSetIndex: event.groupIndex,
          totalDataSets: event.totalGroups,
        };
      }

      return {
        ...base,
        running: false,
      };
    });
  }

  function stageTitle(): string {
    if (activeView === "project")
      return selectedProject ? `Dự án ${selectedProject.name}` : "Dự án";
    if (activeView === "recorder")
      return "Record thao tác thật và sinh step test";
    if (activeView === "custom") return "Run custom flow từ JSON step";
    return "Quản lý dự án automation";
  }

  return (
    <div
      className={`grid min-h-screen ${collapsed ? "grid-cols-[92px_minmax(0,1fr)]" : "grid-cols-[300px_minmax(0,1fr)]"}`}
    >
      <Sidebar
        activeView={activeView}
        collapsed={collapsed}
        onSelectProject={(project) => void handleSelectProject(project)}
        onSelectView={setActiveView}
        onToggleProjects={() => setProjectsExpanded((value) => !value)}
        onToggleSidebar={() => setCollapsed((value) => !value)}
        projects={projects}
        projectsExpanded={projectsExpanded}
        selectedProjectId={selectedProjectId}
      />
      <main className="mx-auto w-[min(1600px,calc(100%-24px))] py-7">
        <header className="flex flex-wrap items-start justify-between gap-5 px-1 pb-6">
          <div>
            <p className="mb-2 text-xs uppercase tracking-[0.18em] text-blue-700">
              Reusable Automation Testing
            </p>
            <h1 className="max-w-xl text-5xl font-black tracking-tight text-slate-900">
              {stageTitle()}
            </h1>
          </div>
          <div className="max-w-sm rounded-3xl border border-slate-200 bg-white/70 px-5 py-4 text-slate-600">
            {selectedProject ? (
              <div className="grid gap-1">
                <strong className="text-slate-900">{selectedProject.name}</strong>
                {selectedProject.baseUrl ? (
                  <a
                    className="break-words text-sm font-semibold text-blue-700 underline-offset-4 hover:underline"
                    href={selectedProject.baseUrl}
                    rel="noreferrer"
                    target="_blank"
                  >
                    {selectedProject.baseUrl}
                  </a>
                ) : (
                  <span className="text-sm text-slate-500">Chưa có URL web</span>
                )}
              </div>
            ) : (
              stageMeta
            )}
          </div>
        </header>

        <div className="grid gap-5">
          {activeView === "home" ? (
            <ProjectCreateView
              checkBaseUrl={checkProjectBaseUrl}
              onCreate={handleCreateProject}
              status={projectStatus.text}
              statusTone={projectStatus.tone}
            />
          ) : null}

          {activeView === "project" && selectedProject ? (
            <ProjectWorkspace
              checkBaseUrl={checkProjectBaseUrl}
              onCreateTestCase={handleCreateTestCase}
              onOpenRecorder={() => {
                setRecorderStartUrl(selectedProject.baseUrl || "http://localhost:5173/signin");
                setRecorderAutoStart(true);
                setActiveView("recorder");
                setStageMeta(`Recorder cho dự án ${selectedProject.name}${selectedProject.baseUrl ? ` - ${selectedProject.baseUrl}` : ""}`);
              }}
              onRunTestCase={handleRunTestCase}
              onRunMultipleTestCases={handleRunMultipleTestCases}
              onStopTestRun={handleStopRunningTest}
              onDeleteTestCase={handleDeleteTestCase}
              onDeleteTestCaseStep={handleDeleteTestCaseStep}
              onDeleteTestDataSet={handleDeleteTestDataSet}
              onUpdateProject={handleUpdateProject}
              onUpdateTestCase={handleUpdateTestCase}
              project={selectedProject}
              status={testCaseStatus.text}
              statusTone={testCaseStatus.tone}
              templates={templates}
              testCaseDataSets={testCaseDataSets}
              testCaseSteps={testCaseSteps}
              testCases={selectedProjectTestCases}
              testDataSets={testDataSets}
              runningTestCaseId={runningTestCaseId}
            />
          ) : null}

          {activeView === "recorder" ? (
            <RecorderView
              autoStart={recorderAutoStart}
              initialUrl={recorderStartUrl}
              projectName={selectedProject?.name}
              onSaveAsProjectTestCase={handleSaveRecordingAsTestCase}
              onUseRecordedSteps={(code) => {
                setRecorderAutoStart(false);
                setRecordedSteps(code);
                setActiveView("custom");
              }}
            />
          ) : null}

          {activeView === "custom" ? (
            <CustomFlowView
              initialSteps={recordedSteps}
              onResult={(result) => {
                rememberLatestResult(result);
                setRunningLabel(undefined);
              }}
              onRunning={() => setRunningLabel("Running")}
            />
          ) : null}

          <ResultsPanel results={latestResults} runningLabel={runningLabel} progress={runProgress} />
        </div>
      </main>
    </div>
  );
}
