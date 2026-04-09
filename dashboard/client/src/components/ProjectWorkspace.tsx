import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";
import {
  InitialTestCaseSetInput,
  LoginTemplateInput,
  Project,
  ProjectRequest,
  StatusTone,
  TemplateSummary,
  TestCase,
  TestCaseDataSet,
  TestCaseRequest,
  TestCaseStep,
  TestCaseStepRequest,
  TestDataSet,
  TestDataSetRequest,
} from "../types";
import { StatusPill } from "./StatusPill";

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
  checkBaseUrl(
    url: string,
  ): Promise<{ ok: boolean; status?: number; error?: string }>;
  onUpdateProject(project: Project, payload: ProjectRequest): Promise<void>;
  onCreateTestCase(
    payload: Omit<TestCaseRequest, "projectId" | "type" | "status">,
    template: TemplateSummary,
    input: LoginTemplateInput,
    initialDataSet: InitialTestCaseSetInput,
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
    newStep?: TestCaseStepRequest,
  ): Promise<void>;
  runningTestCaseId: number | null;
};

type VirtualTcSet = {
  id: string;
  testCaseId: number;
  name: string;
  code: string;
  description: string;
  status: string;
  dataTests: TestDataSet[];
};

function normalizeText(value: string | null | undefined, fallback = "-") {
  const trimmed = String(value || "").trim();
  return trimmed || fallback;
}

function objectKeyList(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.keys(value as Record<string, unknown>);
}

function formatJsonPreview(value: unknown): string {
  if (!value || typeof value !== "object") return "{}";
  return JSON.stringify(value, null, 2);
}

function hasStructuredData(value: unknown): boolean {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value as Record<string, unknown>).length,
  );
}

function requiresManualRunFromDataJson(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  const payment = (value as Record<string, unknown>).payment;
  if (!payment || typeof payment !== "object" || Array.isArray(payment)) {
    return false;
  }

  const vnpay = (payment as Record<string, unknown>).vnpay;
  if (!vnpay || typeof vnpay !== "object" || Array.isArray(vnpay)) {
    return false;
  }

  const mode = String((vnpay as Record<string, unknown>).mode || "").trim();
  return !mode || mode === "manual-complete" || mode === "manual";
}

function textLooksManualRun(value: string | null | undefined): boolean {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  return (
    normalized.includes("vnpay") ||
    normalized.includes("vnpayment") ||
    normalized.includes("thanh toán") ||
    normalized.includes("thanh toan") ||
    normalized.includes("payment") ||
    normalized.includes("paymethod") ||
    normalized.includes("paymentmethod") ||
    normalized.includes("otp") ||
    normalized.includes("cardholder") ||
    normalized.includes("card_holder") ||
    normalized.includes("cardnumber") ||
    normalized.includes("card_number") ||
    normalized.includes("carddate") ||
    normalized.includes("card_date") ||
    normalized.includes("btnpayment") ||
    normalized.includes("btnconfirm") ||
    normalized.includes("thủ công") ||
    normalized.includes("thu cong") ||
    normalized.includes("manual")
  );
}

function requiresManualRunFromDataSet(dataSet: TestDataSet): boolean {
  return (
    requiresManualRunFromDataJson(dataSet.dataJson) ||
    textLooksManualRun(dataSet.code) ||
    textLooksManualRun(dataSet.name) ||
    textLooksManualRun(dataSet.description) ||
    textLooksManualRun(JSON.stringify(dataSet.dataJson || {})) ||
    textLooksManualRun(JSON.stringify(dataSet.expectedJson || {}))
  );
}

function requiresManualRunFromStep(step: TestCaseStep): boolean {
  const actionType = normalizeText(step.actionType, "").toLowerCase();
  const target = String(step.target || "").toLowerCase();
  const value = String(step.value || "").toLowerCase();
  const expectedValue = String(step.expectedValue || "").toLowerCase();
  const description = String(step.description || "").toLowerCase();

  return (
    actionType === "payviavnpay" ||
    (actionType === "waitforurl" &&
      (value.includes("vnpayment") ||
        value.includes("sandbox\\.vnpayment") ||
        expectedValue.includes("vnpayment"))) ||
    textLooksManualRun(target) ||
    textLooksManualRun(value) ||
    textLooksManualRun(expectedValue) ||
    textLooksManualRun(description)
  );
}

function createEmptyStructureFromTemplate(
  value: unknown,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, itemValue]) => {
      if (
        itemValue &&
        typeof itemValue === "object" &&
        !Array.isArray(itemValue)
      ) {
        return [key, createEmptyStructureFromTemplate(itemValue)];
      }
      return [key, ""];
    }),
  );
}

function getExcelDataRoot(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const objectValue = value as Record<string, unknown>;
  const inputsValue = objectValue.inputs;
  if (
    inputsValue &&
    typeof inputsValue === "object" &&
    !Array.isArray(inputsValue)
  ) {
    return inputsValue as Record<string, unknown>;
  }

  return objectValue;
}

function hasInputsRoot(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const inputsValue = (value as Record<string, unknown>).inputs;
  return Boolean(
    inputsValue &&
      typeof inputsValue === "object" &&
      !Array.isArray(inputsValue),
  );
}

function flattenObject(
  value: unknown,
  prefix = "",
): Array<{ path: string; value: string }> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];

  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, itemValue]) => {
      const nextPath = prefix ? `${prefix}.${key}` : key;
      if (
        itemValue &&
        typeof itemValue === "object" &&
        !Array.isArray(itemValue)
      ) {
        return flattenObject(itemValue, nextPath);
      }
      return [{ path: nextPath, value: String(itemValue ?? "") }];
    },
  );
}

function flattenPaths(value: unknown): string[] {
  return flattenObject(value)
    .map((item) => item.path)
    .sort();
}

function validateDataAgainstTemplate(
  importedData: Record<string, unknown>,
  templateValue: unknown,
): string[] {
  const expectedRoot = getExcelDataRoot(templateValue);
  const importedRoot = getExcelDataRoot(importedData);

  const expectedPaths = flattenPaths(expectedRoot);
  if (!expectedPaths.length) {
    return ["Không tìm thấy test case set mẫu để đối chiếu cấu trúc import."];
  }

  const importedPaths = flattenPaths(importedRoot);
  const missingPaths = expectedPaths.filter(
    (path) => !importedPaths.includes(path),
  );
  const extraPaths = importedPaths.filter(
    (path) => !expectedPaths.includes(path),
  );

  return [
    ...missingPaths.map((path) => `Thiếu field bắt buộc: ${path}`),
    ...extraPaths.map((path) => `Field không thuộc mẫu: ${path}`),
  ];
}

function assignPathValue(
  target: Record<string, unknown>,
  path: string,
  value: string,
): void {
  const parts = path.split(".").filter(Boolean);
  if (!parts.length) return;

  let current: Record<string, unknown> = target;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    const isLeaf = index === parts.length - 1;

    if (isLeaf) {
      current[part] = value;
      return;
    }

    const nextValue = current[part];
    if (
      !nextValue ||
      typeof nextValue !== "object" ||
      Array.isArray(nextValue)
    ) {
      current[part] = {};
    }

    current = current[part] as Record<string, unknown>;
  }
}

function cloneJsonValue<T>(value: T): T {
  return JSON.parse(JSON.stringify(value ?? {})) as T;
}

function mergeJsonObjects(
  baseValue: unknown,
  patchValue: unknown,
): Record<string, unknown> {
  const base =
    baseValue && typeof baseValue === "object" && !Array.isArray(baseValue)
      ? cloneJsonValue(baseValue as Record<string, unknown>)
      : {};
  const patch =
    patchValue && typeof patchValue === "object" && !Array.isArray(patchValue)
      ? (patchValue as Record<string, unknown>)
      : {};

  Object.entries(patch).forEach(([key, patchEntry]) => {
    const currentBaseEntry = base[key];
    if (
      patchEntry &&
      typeof patchEntry === "object" &&
      !Array.isArray(patchEntry) &&
      currentBaseEntry &&
      typeof currentBaseEntry === "object" &&
      !Array.isArray(currentBaseEntry)
    ) {
      base[key] = mergeJsonObjects(currentBaseEntry, patchEntry);
      return;
    }

    base[key] = patchEntry;
  });

  return base;
}

function mergeEditableDataRoot(
  baseValue: unknown,
  editableDataRoot: Record<string, unknown>,
): Record<string, unknown> {
  if (hasInputsRoot(baseValue)) {
    return mergeJsonObjects(baseValue, {
      inputs: editableDataRoot,
    });
  }

  return mergeJsonObjects(baseValue, editableDataRoot);
}

function slugifyInputKey(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "input";
}

function encodeFieldSegment(value: string): string {
  return encodeURIComponent(String(value || "")).replace(/_/g, "%5F");
}

function decodeFieldSegment(value: string): string {
  return decodeURIComponent(String(value || ""));
}

function deriveInputKeyFromSelector(selector: string): string {
  const source = String(selector || "");
  const match =
    /kind=label::([^]+)$/i.exec(source) ||
    /kind=placeholder::([^]+)$/i.exec(source) ||
    /kind=text::([^]+)$/i.exec(source) ||
    /\[name="([^"]+)"\]/i.exec(source) ||
    /\[placeholder="([^"]+)"\]/i.exec(source) ||
    /\[aria-label="([^"]+)"\]/i.exec(source) ||
    /^#(.+)$/i.exec(source);

  return slugifyInputKey(match?.[1] || source);
}

function syncRecordedValuesFromInputs(
  dataJsonValue: Record<string, unknown>,
): Record<string, unknown> {
  const dataJson = cloneJsonValue(dataJsonValue);
  const inputsValue = dataJson.inputs;
  const recordedValue = dataJson.recorded;

  if (
    !inputsValue ||
    typeof inputsValue !== "object" ||
    Array.isArray(inputsValue) ||
    !recordedValue ||
    typeof recordedValue !== "object" ||
    Array.isArray(recordedValue)
  ) {
    return dataJson;
  }

  const inputsByScreen = inputsValue as Record<string, unknown>;
  const recordedSteps = recordedValue as Record<string, unknown>;
  const inputOccurrenceByKey: Record<string, number> = {};
  const orderedScreens = Object.entries(inputsByScreen).filter(
    ([, value]) => value && typeof value === "object" && !Array.isArray(value),
  );

  Object.entries(recordedSteps).forEach(([stepKey, stepValue]) => {
    if (!stepValue || typeof stepValue !== "object" || Array.isArray(stepValue)) {
      return;
    }

    const stepObject = stepValue as Record<string, unknown>;
    if (String(stepObject.action || "").trim().toLowerCase() !== "fill") {
      return;
    }

    const inputKey = deriveInputKeyFromSelector(String(stepObject.target || ""));
    const normalizedScreenKey =
      String(stepObject.screenKey || "")
        .trim()
        .replace(/[^a-zA-Z0-9_]+/g, "_") || "";

    let nextValue: unknown;
    if (
      normalizedScreenKey &&
      inputsByScreen[normalizedScreenKey] &&
      typeof inputsByScreen[normalizedScreenKey] === "object" &&
      !Array.isArray(inputsByScreen[normalizedScreenKey])
    ) {
      nextValue = (inputsByScreen[normalizedScreenKey] as Record<string, unknown>)[
        inputKey
      ];
    } else {
      const candidateScreens = orderedScreens.filter(([, screenInputs]) =>
        Object.prototype.hasOwnProperty.call(
          screenInputs as Record<string, unknown>,
          inputKey,
        ),
      );
      const currentOccurrence = inputOccurrenceByKey[inputKey] || 0;
      const candidateEntry =
        candidateScreens[currentOccurrence] ||
        candidateScreens[candidateScreens.length - 1];
      inputOccurrenceByKey[inputKey] = currentOccurrence + 1;
      nextValue = candidateEntry
        ? (candidateEntry[1] as Record<string, unknown>)[inputKey]
        : undefined;
    }

    if (typeof nextValue === "string") {
      recordedSteps[stepKey] = {
        ...stepObject,
        value: nextValue,
      };
    }
  });

  return dataJson;
}

function exportDataJsonAsXlsx(dataSet: TestDataSet): void {
  const rows = flattenObject(getExcelDataRoot(dataSet.dataJson));
  const worksheet = XLSX.utils.json_to_sheet(
    rows.length ? rows : [{ path: "", value: "" }],
  );
  worksheet["!cols"] = [{ wch: 36 }, { wch: 42 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "DataJson");
  XLSX.writeFile(workbook, `${dataSet.code || "test-case-set"}.xlsx`);
}

function parseXlsxFile(
  file: File,
): Promise<Array<{ rowNumber: number; path: string; value: string }>> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      try {
        const workbook = XLSX.read(reader.result, { type: "array" });
        const firstSheetName = workbook.SheetNames[0];
        if (!firstSheetName) {
          reject(new Error("File Excel không có sheet nào."));
          return;
        }

        const worksheet = workbook.Sheets[firstSheetName];
        const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(
          worksheet,
          {
            header: 1,
            raw: false,
            defval: "",
          },
        );

        const headerPath = String(rows[0]?.[0] ?? "")
          .trim()
          .toLowerCase();
        const headerValue = String(rows[0]?.[1] ?? "")
          .trim()
          .toLowerCase();
        if (headerPath !== "path" || headerValue !== "value") {
          reject(
            new Error(
              'Header file Excel phải là cột "path" và "value" ở hàng đầu tiên.',
            ),
          );
          return;
        }

        const parsedRows = rows.slice(1).map((row, index) => ({
          rowNumber: index + 2,
          path: String(row?.[0] ?? "").trim(),
          value: String(row?.[1] ?? ""),
        }));

        resolve(parsedRows.filter((row) => row.path));
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error("Không thể đọc file Excel."));
    reader.readAsArrayBuffer(file);
  });
}

function buildDataJsonFromImportedRows(
  rows: Array<{ rowNumber: number; path: string; value: string }>,
  templateValue: unknown,
): Record<string, unknown> {
  const importedDataJson = createEmptyStructureFromTemplate(
    getExcelDataRoot(templateValue),
  );

  rows.forEach((row) => {
    assignPathValue(importedDataJson, row.path, row.value);
  });

  return importedDataJson;
}

function validateImportedRowsAgainstTemplate(
  rows: Array<{ rowNumber: number; path: string; value: string }>,
  templateValue: unknown,
): string[] {
  const expectedPaths = flattenPaths(getExcelDataRoot(templateValue));
  if (!expectedPaths.length) {
    return ["Không tìm thấy test case set mẫu để đối chiếu cấu trúc import."];
  }

  const errors: string[] = [];
  const seenPaths = new Set<string>();

  rows.forEach((row) => {
    if (!row.path) {
      errors.push(`Dòng ${row.rowNumber}: cột A (path) đang trống.`);
      return;
    }

    if (!expectedPaths.includes(row.path)) {
      errors.push(
        `Dòng ${row.rowNumber}: field "${row.path}" không thuộc mẫu chuẩn.`,
      );
    }

    if (seenPaths.has(row.path)) {
      errors.push(`Dòng ${row.rowNumber}: field "${row.path}" bị trùng.`);
    }

    seenPaths.add(row.path);
  });

  expectedPaths.forEach((path) => {
    if (!seenPaths.has(path)) {
      errors.push(`Thiếu field bắt buộc "${path}".`);
    }
  });

  return errors;
}

function renderJsonUi(
  value: unknown,
  emptyLabel = "Không có dữ liệu",
): JSX.Element {
  if (!value || typeof value !== "object") {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
        {emptyLabel}
      </div>
    );
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([key]) => key !== "recorded",
  );
  if (!entries.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {entries.map(([key, entryValue]) => {
        if (
          entryValue &&
          typeof entryValue === "object" &&
          !Array.isArray(entryValue)
        ) {
          return (
            <div
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              key={key}
            >
              <div className="text-sm font-bold text-slate-900">{key}</div>
              <div className="mt-3">
                {renderJsonUi(entryValue, "Không có field con")}
              </div>
            </div>
          );
        }

        return (
          <div
            className="grid gap-1 rounded-2xl border border-slate-200 bg-slate-50 p-4"
            key={key}
          >
            <div className="text-xs uppercase tracking-[0.12em] text-slate-500">
              {key}
            </div>
            <div className="break-words text-sm font-medium text-slate-800">
              {String(entryValue ?? "") || "-"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function renderEditableJsonUi(
  value: unknown,
  templateValue: unknown,
  fieldPrefix: string,
  emptyLabel = "Không có dữ liệu",
): JSX.Element {
  const sourceRoot = getExcelDataRoot(value);
  const templateRoot = getExcelDataRoot(templateValue);
  const sourceValue = hasStructuredData(sourceRoot)
    ? sourceRoot
    : createEmptyStructureFromTemplate(templateRoot);

  if (!sourceValue || typeof sourceValue !== "object") {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
        {emptyLabel}
      </div>
    );
  }

  const entries = Object.entries(sourceValue as Record<string, unknown>).filter(
    ([key]) => key !== "recorded",
  );
  if (!entries.length) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-200 p-4 text-sm text-slate-400">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {entries.map(([key, entryValue]) => {
        if (
          entryValue &&
          typeof entryValue === "object" &&
          !Array.isArray(entryValue)
        ) {
          const nestedEntries = Object.entries(
            entryValue as Record<string, unknown>,
          );

          return (
            <div
              className="rounded-2xl border border-slate-200 bg-slate-50 p-4"
              key={key}
            >
              <div className="mb-3 text-sm font-bold text-slate-900">{key}</div>
              <div className="grid gap-3 md:grid-cols-2">
                {nestedEntries.map(([nestedKey, nestedValue]) =>
                  nestedValue &&
                  typeof nestedValue === "object" &&
                  !Array.isArray(nestedValue) ? (
                    <div
                      className="rounded-2xl border border-slate-200 bg-white p-3 md:col-span-2"
                      key={`${key}-${nestedKey}`}
                    >
                      <div className="mb-3 text-xs font-bold uppercase tracking-[0.12em] text-slate-500">
                        {nestedKey}
                      </div>
                      {renderEditableJsonUi(
                        nestedValue,
                        nestedValue,
                        `${fieldPrefix}__${encodeFieldSegment(key)}__${encodeFieldSegment(nestedKey)}`,
                        emptyLabel,
                      )}
                    </div>
                  ) : (
                    <label className="grid gap-2" key={`${key}-${nestedKey}`}>
                      <span className="text-xs uppercase tracking-[0.12em] text-slate-500">
                        {nestedKey}
                      </span>
                      <input
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800"
                        defaultValue={String(nestedValue ?? "")}
                        name={`${fieldPrefix}__${encodeFieldSegment(key)}__${encodeFieldSegment(nestedKey)}`}
                      />
                    </label>
                  ),
                )}
              </div>
            </div>
          );
        }

        return (
          <label
            className="grid gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4"
            key={key}
          >
            <span className="text-xs uppercase tracking-[0.12em] text-slate-500">
              {key}
            </span>
            <input
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-800"
              defaultValue={String(entryValue ?? "")}
              name={`${fieldPrefix}__${encodeFieldSegment(key)}`}
            />
          </label>
        );
      })}
    </div>
  );
}

function buildDataJsonFromUi(
  formData: FormData,
  prefix: string,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const [rawKey, rawValue] of formData.entries()) {
    if (!rawKey.startsWith(`${prefix}__`)) continue;

    const path = rawKey
      .slice(prefix.length + 2)
      .split("__")
      .map((item) => decodeFieldSegment(item))
      .filter(Boolean);
    if (!path.length) continue;

    const value = String(rawValue ?? "");
    assignPathValue(result, path.join("."), value);
  }

  return result;
}

function hasNonEmptyFormValueForPrefix(
  formData: FormData,
  prefix: string,
): boolean {
  for (const [rawKey, rawValue] of formData.entries()) {
    if (!rawKey.startsWith(`${prefix}__`)) continue;
    if (String(rawValue ?? "").trim()) {
      return true;
    }
  }
  return false;
}

function parseExpectedResult(value: unknown): {
  kind: "url" | "text" | "button" | "selector";
  target: string;
  expectedValue: string;
} {
  const result =
    value && typeof value === "object"
      ? (value as Record<string, unknown>).result
      : null;
  if (!result || typeof result !== "object") {
    return { kind: "text", target: "", expectedValue: "visible" };
  }

  const resultObject = result as Record<string, unknown>;
  const rawSelector = String(resultObject.selector || "").trim();
  const url = String(resultObject.url || "").trim();
  const expectedValue =
    String(resultObject.value || "visible").trim() || "visible";

  if (url) {
    return { kind: "url", target: url, expectedValue };
  }

  if (rawSelector.startsWith("kind=button::")) {
    return {
      kind: "button",
      target: rawSelector.replace("kind=button::", ""),
      expectedValue,
    };
  }

  if (rawSelector.startsWith("kind=text::")) {
    return {
      kind: "text",
      target: rawSelector.replace("kind=text::", ""),
      expectedValue,
    };
  }

  return {
    kind: rawSelector ? "selector" : "text",
    target: rawSelector,
    expectedValue,
  };
}

function buildExpectedJsonFromBuilder(
  kind: string,
  target: string,
  expectedValue: string,
): Record<string, unknown> {
  const normalizedKind =
    kind === "button" || kind === "selector" || kind === "url" ? kind : "text";
  const normalizedTarget = target.trim();
  const normalizedValue = expectedValue.trim() || "visible";

  if (normalizedKind === "url") {
    return {
      result: {
        url: normalizedTarget,
        value: normalizedValue,
      },
    };
  }

  const selector =
    normalizedKind === "button"
      ? `kind=button::${normalizedTarget}`
      : normalizedKind === "text"
        ? `kind=text::${normalizedTarget}`
        : normalizedTarget;

  return {
    result: {
      selector,
      value: normalizedValue,
    },
  };
}

function buildTestCasePayload(
  projectId: number,
  testCase: TestCase,
): TestCaseRequest {
  return {
    projectId,
    code: testCase.code,
    name: testCase.name,
    description: testCase.description || "",
    type: testCase.type || "custom",
    status: testCase.status || "active",
  };
}

export function ProjectWorkspace({
  project,
  templates,
  testCases,
  testCaseDataSets,
  testCaseSteps,
  testDataSets,
  status,
  statusTone,
  onOpenRecorder,
  checkBaseUrl,
  onUpdateProject,
  onCreateTestCase,
  onRunTestCase,
  onRunMultipleTestCases,
  onStopTestRun,
  onDeleteTestCase,
  onDeleteTestCaseStep,
  onDeleteTestDataSet,
  onUpdateTestCase,
  runningTestCaseId,
}: ProjectWorkspaceProps) {
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>(
    templates[0]?.id || "",
  );
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [createMode, setCreateMode] = useState<"template" | "recorder">(
    "template",
  );
  const [editingProjectUrl, setEditingProjectUrl] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [projectUrlCheckMessage, setProjectUrlCheckMessage] = useState("");
  const [projectUrlCheckTone, setProjectUrlCheckTone] = useState<
    "running" | "passed" | "failed" | undefined
  >();
  const [selectedTestCaseIds, setSelectedTestCaseIds] = useState<number[]>([]);
  const [expandedTestCaseIds, setExpandedTestCaseIds] = useState<
    Record<number, boolean>
  >({});
  const [expandedTcSetIds, setExpandedTcSetIds] = useState<
    Record<string, boolean>
  >({});
  const [expandedStepSections, setExpandedStepSections] = useState<
    Record<number, boolean>
  >({});
  const [editingTestCaseId, setEditingTestCaseId] = useState<number | null>(
    null,
  );
  const [editingDataSetId, setEditingDataSetId] = useState<number | null>(null);
  const [editingStepId, setEditingStepId] = useState<number | null>(null);
  const [creatingDataSetForTestCaseId, setCreatingDataSetForTestCaseId] =
    useState<number | null>(null);
  const [createDataJsonModes, setCreateDataJsonModes] = useState<
    Record<number, "json" | "preview">
  >({});
  const [createExpectedJsonModes, setCreateExpectedJsonModes] = useState<
    Record<number, "json" | "builder">
  >({});
  const [createDataJsonDrafts, setCreateDataJsonDrafts] = useState<
    Record<number, Record<string, unknown>>
  >({});
  const [createDataJsonImportedDrafts, setCreateDataJsonImportedDrafts] =
    useState<Record<number, boolean>>({});
  const [dataJsonModes, setDataJsonModes] = useState<
    Record<number, "json" | "preview">
  >({});
  const [expectedJsonModes, setExpectedJsonModes] = useState<
    Record<number, "json" | "builder">
  >({});
  const [editError, setEditError] = useState("");

  const selectedTemplate = useMemo(
    () =>
      templates.find((template) => template.id === selectedTemplateId) ||
      templates[0],
    [selectedTemplateId, templates],
  );

  useEffect(() => {
    if (!selectedTemplateId && templates[0]?.id) {
      setSelectedTemplateId(templates[0].id);
    }
  }, [selectedTemplateId, templates]);

  useEffect(() => {
    setSelectedTestCaseIds((current) =>
      current.filter((id) => testCases.some((testCase) => testCase.id === id)),
    );
  }, [testCases]);

  function getAttachedDataSets(testCaseId: number): TestDataSet[] {
    const dataSetIds = new Set(
      testCaseDataSets
        .filter((item) => item.testCaseId === testCaseId)
        .map((item) => item.testDataSetId),
    );

    return testDataSets
      .filter((dataSet) => dataSetIds.has(dataSet.id))
      .sort((left, right) => left.id - right.id);
  }

  function getStepsForTestCase(testCaseId: number): TestCaseStep[] {
    return testCaseSteps
      .filter((step) => step.testCaseId === testCaseId)
      .sort((left, right) => left.stepOrder - right.stepOrder);
  }

  const testCaseRows = useMemo(
    () =>
      testCases.map((testCase) => {
        const dataSets = getAttachedDataSets(testCase.id);
        const steps = getStepsForTestCase(testCase.id);
        const hasManualPaymentStep = steps.some((step) =>
          requiresManualRunFromStep(step),
        );
        const tcSets: VirtualTcSet[] = dataSets.map((dataSet) => ({
          id: `tc-set-${testCase.id}-${dataSet.id}`,
          testCaseId: testCase.id,
          name: dataSet.name || dataSet.code,
          code: dataSet.code,
          description: dataSet.description || "",
          status: dataSet.status || "active",
          dataTests: [dataSet],
        }));

        return {
          testCase,
          steps,
          tcSets,
          dataSets,
          requiresManualRun:
            hasManualPaymentStep ||
            dataSets.some((dataSet) => requiresManualRunFromDataSet(dataSet)),
          hasManualPaymentStep,
        };
      }),
    [testCases, testCaseDataSets, testCaseSteps, testDataSets],
  );

  const selectedCases = useMemo(
    () =>
      testCases.filter((testCase) => selectedTestCaseIds.includes(testCase.id)),
    [selectedTestCaseIds, testCases],
  );

  function toggleSelectedTestCase(testCaseId: number) {
    setSelectedTestCaseIds((current) =>
      current.includes(testCaseId)
        ? current.filter((id) => id !== testCaseId)
        : [...current, testCaseId],
    );
  }

  function selectAllTestCases() {
    setSelectedTestCaseIds(testCases.map((testCase) => testCase.id));
  }

  function clearSelectedTestCases() {
    setSelectedTestCaseIds([]);
  }

  function toggleExpandedTestCase(testCaseId: number) {
    setExpandedTestCaseIds((current) => ({
      ...current,
      [testCaseId]: !current[testCaseId],
    }));
  }

  function toggleExpandedTcSet(tcSetId: string) {
    setExpandedTcSetIds((current) => ({
      ...current,
      [tcSetId]: !current[tcSetId],
    }));
  }

  function toggleExpandedSteps(testCaseId: number) {
    setExpandedStepSections((current) => ({
      ...current,
      [testCaseId]: !current[testCaseId],
    }));
  }

  async function handleProjectUrlSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const baseUrl = String(data.get("projectBaseUrl") || "").trim();

    setSubmitting(true);
    setProjectUrlCheckMessage("");
    setProjectUrlCheckTone("running");

    try {
      const urlCheck = await checkBaseUrl(baseUrl);
      if (!urlCheck.ok) {
        setProjectUrlCheckTone("failed");
        setProjectUrlCheckMessage(
          `Không thể truy cập URL web${urlCheck.status ? ` (HTTP ${urlCheck.status})` : ""}: ${urlCheck.error || "Vui lòng kiểm tra lại URL."}`,
        );
        return;
      }

      setProjectUrlCheckTone("passed");
      setProjectUrlCheckMessage(
        baseUrl
          ? `URL web truy cập được${urlCheck.status ? ` (HTTP ${urlCheck.status})` : ""}.`
          : "",
      );
      await onUpdateProject(project, {
        code: project.code,
        name: project.name,
        description: project.description || "",
        baseUrl,
        status: project.status || "ACTIVE",
      });
      setEditingProjectUrl(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedTemplate) return;

    const form = event.currentTarget;
    const data = new FormData(form);
    setSubmitting(true);

    try {
      await onCreateTestCase(
        {
          code: String(data.get("code") || "").trim(),
          name: String(data.get("name") || "").trim(),
          description: String(data.get("description") || "").trim(),
        },
        selectedTemplate,
        {
          pagePath: String(data.get("pagePath") || "").trim(),
          emailSelector: String(data.get("emailSelector") || "").trim(),
          passwordSelector: String(data.get("passwordSelector") || "").trim(),
          submitSelectorKind: String(
            data.get("submitSelectorKind") || "auto",
          ) as LoginTemplateInput["submitSelectorKind"],
          submitSelector: String(data.get("submitSelector") || "").trim(),
          successSelectorKind: String(
            data.get("successSelectorKind") || "url",
          ) as LoginTemplateInput["successSelectorKind"],
          successSelector: String(data.get("successSelector") || "").trim(),
          username: String(data.get("username") || "").trim(),
          password: String(data.get("password") || "").trim(),
        },
        {
          code: String(data.get("dataSetCode") || "").trim(),
          name: String(data.get("dataSetName") || "").trim(),
          description: String(data.get("dataSetDescription") || "").trim(),
        },
      );

      form.reset();
      setCreatePanelOpen(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateTestCaseSubmit(
    event: FormEvent<HTMLFormElement>,
    testCase: TestCase,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    setSubmitting(true);
    setEditError("");

    try {
      await onUpdateTestCase(testCase, {
        projectId: project.id,
        code: String(data.get("code") || "").trim(),
        name: String(data.get("name") || "").trim(),
        description: String(data.get("description") || "").trim(),
        type: String(data.get("type") || testCase.type || "custom").trim(),
        status: String(
          data.get("status") || testCase.status || "active",
        ).trim(),
      });
      setEditingTestCaseId(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateDataSetSubmit(
    event: FormEvent<HTMLFormElement>,
    testCase: TestCase,
    dataSet: TestDataSet,
    templateValue: unknown,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const activeDataMode = dataJsonModes[dataSet.id] || "json";
    const activeExpectedMode = expectedJsonModes[dataSet.id] || "builder";

    setSubmitting(true);
    setEditError("");

    try {
      const dataJson =
        activeDataMode === "json"
          ? syncRecordedValuesFromInputs(
              data.has("dataJson")
                ? (JSON.parse(String(data.get("dataJson") || "{}")) as Record<
                    string,
                    unknown
                  >)
                : (dataSet.dataJson as Record<string, unknown>),
            )
          : syncRecordedValuesFromInputs(
              mergeEditableDataRoot(
                dataSet.dataJson,
                buildDataJsonFromUi(data, `dataUi${dataSet.id}`),
              ),
            );
      const expectedJson =
        activeExpectedMode === "builder"
          ? buildExpectedJsonFromBuilder(
              String(data.get("resultKind") || "text"),
              String(data.get("resultTarget") || ""),
              String(data.get("resultValue") || "visible"),
            )
          : data.has("expectedJson")
            ? (JSON.parse(String(data.get("expectedJson") || "{}")) as Record<
                string,
                unknown
              >)
            : (dataSet.expectedJson as Record<string, unknown>);

      if (hasStructuredData(templateValue)) {
        const errors = validateDataAgainstTemplate(dataJson, templateValue);
        if (errors.length) {
          throw new Error(errors.join(" "));
        }
      }

      await onUpdateTestCase(
        testCase,
        buildTestCasePayload(project.id, testCase),
        [
          {
            id: dataSet.id,
            payload: {
              projectId: project.id,
              code: String(data.get("code") || "").trim(),
              name: String(data.get("name") || "").trim(),
              description: String(data.get("description") || "").trim(),
              dataJson,
              expectedJson,
              status: String(
                data.get("status") || dataSet.status || "active",
              ).trim(),
            },
          },
        ],
      );
      setEditingDataSetId(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateStepSubmit(
    event: FormEvent<HTMLFormElement>,
    testCase: TestCase,
    step: TestCaseStep,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);

    setSubmitting(true);
    setEditError("");

    try {
      await onUpdateTestCase(
        testCase,
        buildTestCasePayload(project.id, testCase),
        [],
        [
          {
            id: step.id,
            payload: {
              testCaseId: testCase.id,
              stepOrder: Number(data.get("stepOrder") || step.stepOrder),
              actionType: String(data.get("actionType") || "").trim(),
              target:
                normalizeText(String(data.get("target") || ""), "") || null,
              value: normalizeText(String(data.get("value") || ""), "") || null,
              expectedValue:
                normalizeText(String(data.get("expectedValue") || ""), "") ||
                null,
              description: String(data.get("description") || "").trim(),
            },
          },
        ],
      );
      setEditingStepId(null);
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteStepClick(step: TestCaseStep) {
    setSubmitting(true);
    setEditError("");

    try {
      await onDeleteTestCaseStep(step);
      setEditingStepId((current) => (current === step.id ? null : current));
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCreateDataSetSubmit(
    event: FormEvent<HTMLFormElement>,
    testCase: TestCase,
    templateDataJson: unknown,
  ) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const activeCreateDataMode = createDataJsonModes[testCase.id] || "preview";
    const activeCreateExpectedMode =
      createExpectedJsonModes[testCase.id] || "builder";

    setSubmitting(true);
    setEditError("");

    try {
      const dataJson =
        activeCreateDataMode === "json"
          ? (JSON.parse(String(data.get("dataJson") || "{}")) as Record<
              string,
              unknown
            >)
          : hasNonEmptyFormValueForPrefix(data, `createDataUi${testCase.id}`) ||
              createDataJsonImportedDrafts[testCase.id]
            ? syncRecordedValuesFromInputs(
                mergeEditableDataRoot(
                  hasStructuredData(createDataJsonDrafts[testCase.id])
                    ? createDataJsonDrafts[testCase.id]
                    : templateDataJson,
                  buildDataJsonFromUi(data, `createDataUi${testCase.id}`),
                ),
              )
            : {};
      const expectedJson =
        activeCreateExpectedMode === "json"
          ? (JSON.parse(String(data.get("expectedJson") || "{}")) as Record<
              string,
              unknown
            >)
          : buildExpectedJsonFromBuilder(
              String(data.get("resultKind") || "text"),
              String(data.get("resultTarget") || ""),
              String(data.get("resultValue") || "visible"),
            );

      if (hasStructuredData(dataJson) && hasStructuredData(templateDataJson)) {
        const errors = validateDataAgainstTemplate(dataJson, templateDataJson);
        if (errors.length) {
          throw new Error(errors.join(" "));
        }
      }

      await onUpdateTestCase(
        testCase,
        buildTestCasePayload(project.id, testCase),
        [],
        [],
        {
          projectId: project.id,
          code: String(data.get("code") || "").trim(),
          name:
            String(data.get("name") || "").trim() ||
            String(data.get("code") || "").trim(),
          description: String(data.get("description") || "").trim(),
          dataJson,
          expectedJson,
          status: String(data.get("status") || "active").trim(),
        },
      );
      setCreatingDataSetForTestCaseId(null);
      setCreateDataJsonImportedDrafts((current) => ({
        ...current,
        [testCase.id]: false,
      }));
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleImportDataJsonFile(
    testCase: TestCase,
    dataSet: TestDataSet,
    templateValue: unknown,
    file: File | null,
  ) {
    if (!file) return;

    setSubmitting(true);
    setEditError("");

    try {
      const rows = await parseXlsxFile(file);
      const validationErrors = validateImportedRowsAgainstTemplate(
        rows,
        templateValue,
      );
      if (validationErrors.length) {
        throw new Error(validationErrors.join(" "));
      }
      const importedInputs = buildDataJsonFromImportedRows(
        rows,
        templateValue,
      );
      const importedDataJson = syncRecordedValuesFromInputs(
        mergeEditableDataRoot(dataSet.dataJson, importedInputs),
      );

      await onUpdateTestCase(
        testCase,
        buildTestCasePayload(project.id, testCase),
        [
          {
            id: dataSet.id,
            payload: {
              projectId: project.id,
              code: dataSet.code,
              name: dataSet.name,
              description: dataSet.description || "",
              dataJson: importedDataJson,
              expectedJson: (dataSet.expectedJson || {}) as Record<
                string,
                unknown
              >,
              status: dataSet.status || "active",
            },
          },
        ],
      );
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleImportCreateDataJsonFile(
    testCaseId: number,
    templateValue: unknown,
    file: File | null,
  ) {
    if (!file) return;

    setSubmitting(true);
    setEditError("");

    try {
      const rows = await parseXlsxFile(file);
      const validationErrors = validateImportedRowsAgainstTemplate(
        rows,
        templateValue,
      );
      if (validationErrors.length) {
        throw new Error(validationErrors.join(" "));
      }
      const importedInputs = buildDataJsonFromImportedRows(
        rows,
        templateValue,
      );
      const importedDataJson = syncRecordedValuesFromInputs(
        mergeEditableDataRoot(
          hasStructuredData(createDataJsonDrafts[testCaseId])
            ? createDataJsonDrafts[testCaseId]
            : templateValue,
          importedInputs,
        ),
      );
      setCreateDataJsonDrafts((current) => ({
        ...current,
        [testCaseId]: importedDataJson,
      }));
      setCreateDataJsonImportedDrafts((current) => ({
        ...current,
        [testCaseId]: true,
      }));
      setCreateDataJsonModes((current) => ({
        ...current,
        [testCaseId]: "preview",
      }));
    } catch (error) {
      setEditError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  }

  const totalDataSets = testCaseRows.reduce(
    (count, row) => count + row.dataSets.length,
    0,
  );
  const totalSteps = testCaseRows.reduce(
    (count, row) => count + row.steps.length,
    0,
  );

  return (
    <section className="grid gap-6">
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm font-semibold uppercase tracking-[0.18em] text-sky-700">
                Project Workspace
              </p>
              <h2 className="mt-2 text-3xl font-black tracking-tight text-slate-900">
                {project.name}
              </h2>
              <p className="mt-2 max-w-3xl text-sm text-slate-600">
                Giao diện được ưu tiên theo dạng bảng để dễ nhìn hơn. Trong
                RAT-BE, test case set đang tương ứng trực tiếp với entity{" "}
                <strong>test data set</strong>, nên mỗi test case bên dưới sẽ
                hiển thị danh sách test case set của nó.
              </p>
            </div>
            <StatusPill tone={statusTone}>{status}</StatusPill>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm text-slate-500">Test case</div>
              <div className="mt-2 text-3xl font-black text-slate-900">
                {testCaseRows.length}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm text-slate-500">Test case set</div>
              <div className="mt-2 text-3xl font-black text-slate-900">
                {totalDataSets}
              </div>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="text-sm text-slate-500">Data step</div>
              <div className="mt-2 text-3xl font-black text-slate-900">
                {totalSteps}
              </div>
            </div>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                Thông tin dự án
              </h3>
              <p className="mt-1 text-sm text-slate-500">
                Quản lý Base URL dùng cho recorder và các flow test.
              </p>
            </div>
            <button
              className="rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold text-slate-700"
              type="button"
              onClick={() => {
                setEditingProjectUrl((current) => !current);
                setProjectUrlCheckMessage("");
                setProjectUrlCheckTone(undefined);
              }}
            >
              {editingProjectUrl ? "Đóng" : "Sửa URL"}
            </button>
          </div>

          <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
            <div className="text-xs uppercase tracking-[0.16em] text-slate-500">
              Base URL
            </div>
            <div className="mt-2 break-words text-sm font-semibold text-slate-900">
              {project.baseUrl || "Chưa cấu hình"}
            </div>
          </div>

          {editingProjectUrl ? (
            <form className="mt-4 grid gap-3" onSubmit={handleProjectUrlSubmit}>
              <label className="grid gap-2">
                <span className="text-sm font-medium text-slate-700">
                  URL website
                </span>
                <input
                  className="rounded-2xl border border-slate-200 bg-white px-4 py-3 outline-none ring-0"
                  defaultValue={project.baseUrl || ""}
                  name="projectBaseUrl"
                  placeholder="https://example.com"
                />
              </label>
              <div className="flex flex-wrap gap-3">
                <button
                  className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white"
                  disabled={submitting}
                  type="submit"
                >
                  Kiểm tra và lưu
                </button>
                <button
                  className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700"
                  type="button"
                  onClick={() => {
                    setEditingProjectUrl(false);
                    setProjectUrlCheckMessage("");
                    setProjectUrlCheckTone(undefined);
                  }}
                >
                  Hủy
                </button>
              </div>
              {projectUrlCheckMessage ? (
                <div
                  className={`rounded-2xl border p-3 text-sm font-semibold ${
                    projectUrlCheckTone === "failed"
                      ? "border-rose-200 bg-rose-50 text-rose-700"
                      : projectUrlCheckTone === "passed"
                        ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                        : "border-amber-200 bg-amber-50 text-amber-700"
                  }`}
                >
                  {projectUrlCheckMessage}
                </div>
              ) : null}
            </form>
          ) : null}
        </div>
      </div>

      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-900">
              Danh sách test case
            </h3>
            <p className="mt-1 text-sm text-slate-500">
              Mở từng test case để xem các test case set và data step thuộc đúng
              test case đó.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700"
              type="button"
              onClick={() => setCreatePanelOpen((current) => !current)}
            >
              {createPanelOpen ? "Đóng tạo mới" : "Tạo test case"}
            </button>
            <button
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              disabled={!testCases.length || runningTestCaseId !== null}
              type="button"
              onClick={selectAllTestCases}
            >
              Chọn tất cả
            </button>
            <button
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-700 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400"
              disabled={!selectedCases.length || runningTestCaseId !== null}
              type="button"
              onClick={clearSelectedTestCases}
            >
              Bỏ chọn tất cả
            </button>

            <button
              className="rounded-2xl bg-sky-600 px-4 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
              disabled={!selectedCases.length || runningTestCaseId !== null}
              type="button"
              onClick={() => void onRunMultipleTestCases(selectedCases)}
            >
              Chạy{" "}
              {selectedCases.length
                ? `${selectedCases.length} case đã chọn`
                : "nhiều case"}
            </button>
            {runningTestCaseId !== null ? (
              <button
                className="rounded-2xl bg-rose-600 px-4 py-3 text-sm font-bold text-white"
                type="button"
                onClick={onStopTestRun}
              >
                Dừng chạy test
              </button>
            ) : null}
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-3xl border border-slate-200">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead className="bg-slate-900 text-left text-xs uppercase tracking-[0.16em] text-slate-200">
                <tr>
                  <th className="px-4 py-4">Mở</th>
                  <th className="px-4 py-4">Chọn</th>
                  <th className="px-4 py-4">Tên test case</th>
                  <th className="px-4 py-4">Loại</th>
                  <th className="px-4 py-4">Trạng thái</th>
                  <th className="px-4 py-4">Test case set</th>
                  <th className="px-4 py-4">Data step</th>
                  <th className="px-4 py-4 text-right">Thao tác</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 bg-white">
                {testCaseRows.length ? (
                  testCaseRows.map((row) => {
                    const isExpanded = Boolean(
                      expandedTestCaseIds[row.testCase.id],
                    );
                    const isRunningThisTest =
                      runningTestCaseId === row.testCase.id;
                    const isAnotherTestRunning =
                      runningTestCaseId !== null && !isRunningThisTest;

                    return (
                      <Fragment key={row.testCase.id}>
                        <tr
                          className={
                            isExpanded ? "bg-sky-50/70" : "hover:bg-slate-50"
                          }
                          key={row.testCase.id}
                        >
                          <td className="px-4 py-4 align-top">
                            <button
                              className="rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-700"
                              type="button"
                              onClick={() =>
                                toggleExpandedTestCase(row.testCase.id)
                              }
                            >
                              {isExpanded ? "Ẩn" : "Xem"}
                            </button>
                          </td>
                          <td className="px-4 py-4 align-top">
                            <input
                              checked={selectedTestCaseIds.includes(
                                row.testCase.id,
                              )}
                              className="mt-1 h-4 w-4 rounded border-slate-300 text-sky-600"
                              disabled={runningTestCaseId !== null}
                              type="checkbox"
                              onChange={() =>
                                toggleSelectedTestCase(row.testCase.id)
                              }
                            />
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                              <span>{row.testCase.name}</span>
                              {row.requiresManualRun ? (
                                <span className="rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-800">
                                  Cần chạy thủ công
                                </span>
                              ) : null}
                            </div>
                            <div className="mt-1 max-w-xl text-xs text-slate-500">
                              {row.testCase.description || "Không có mô tả"}
                            </div>
                          </td>
                          <td className="px-4 py-4 align-top text-slate-600">
                            {normalizeText(row.testCase.type, "custom")}
                          </td>
                          <td className="px-4 py-4 align-top text-slate-600">
                            {normalizeText(row.testCase.status, "active")}
                          </td>
                          <td className="px-4 py-4 align-top font-semibold text-slate-900">
                            {row.tcSets.length}
                          </td>
                          <td className="px-4 py-4 align-top text-slate-600">
                            {row.steps.length}
                          </td>
                          <td className="px-4 py-4 align-top">
                            <div className="flex flex-wrap justify-end gap-2">
                              <button
                                className="rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-700"
                                type="button"
                                onClick={() => {
                                  setExpandedTestCaseIds((current) => ({
                                    ...current,
                                    [row.testCase.id]: true,
                                  }));
                                  setEditingTestCaseId(row.testCase.id);
                                  setEditError("");
                                }}
                              >
                                Sửa
                              </button>
                              <button
                                className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 font-semibold text-rose-700"
                                disabled={runningTestCaseId !== null}
                                type="button"
                                onClick={() =>
                                  void onDeleteTestCase(row.testCase)
                                }
                              >
                                Xóa
                              </button>
                              {isRunningThisTest ? (
                                <button
                                  className="rounded-xl bg-rose-600 px-3 py-2 font-semibold text-white"
                                  type="button"
                                  onClick={onStopTestRun}
                                >
                                  Dừng
                                </button>
                              ) : (
                                <button
                                  className="rounded-xl bg-sky-600 px-3 py-2 font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                                  disabled={isAnotherTestRunning}
                                  type="button"
                                  onClick={() =>
                                    void onRunTestCase(row.testCase)
                                  }
                                >
                                  {isAnotherTestRunning ? "Đang bận" : "Chạy"}
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>

                        {isExpanded ? (
                          <tr key={`${row.testCase.id}-expanded`}>
                            <td className="bg-slate-50 px-4 py-5" colSpan={9}>
                              <div className="grid gap-5">
                                {editingTestCaseId === row.testCase.id ? (
                                  <form
                                    className="grid gap-4 rounded-3xl border border-slate-200 bg-white p-5"
                                    onSubmit={(event) =>
                                      void handleUpdateTestCaseSubmit(
                                        event,
                                        row.testCase,
                                      )
                                    }
                                  >
                                    <div className="flex items-center justify-between gap-3">
                                      <h4 className="text-base font-bold text-slate-900">
                                        Sửa nhanh test case
                                      </h4>
                                      <button
                                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
                                        type="button"
                                        onClick={() => {
                                          setEditingTestCaseId(null);
                                          setEditError("");
                                        }}
                                      >
                                        Đóng form
                                      </button>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                      <label className="grid gap-2">
                                        <span className="text-sm font-medium text-slate-700">
                                          Code
                                        </span>
                                        <input
                                          className="rounded-2xl border border-slate-200 px-4 py-3"
                                          defaultValue={row.testCase.code}
                                          name="code"
                                          required
                                        />
                                      </label>
                                      <label className="grid gap-2">
                                        <span className="text-sm font-medium text-slate-700">
                                          Tên test case
                                        </span>
                                        <input
                                          className="rounded-2xl border border-slate-200 px-4 py-3"
                                          defaultValue={row.testCase.name}
                                          name="name"
                                          required
                                        />
                                      </label>
                                    </div>
                                    <div className="grid gap-4 md:grid-cols-2">
                                      <label className="grid gap-2">
                                        <span className="text-sm font-medium text-slate-700">
                                          Loại
                                        </span>
                                        <input
                                          className="rounded-2xl border border-slate-200 px-4 py-3"
                                          defaultValue={
                                            row.testCase.type || "custom"
                                          }
                                          name="type"
                                        />
                                      </label>
                                      <label className="grid gap-2">
                                        <span className="text-sm font-medium text-slate-700">
                                          Trạng thái
                                        </span>
                                        <input
                                          className="rounded-2xl border border-slate-200 px-4 py-3"
                                          defaultValue={
                                            row.testCase.status || "active"
                                          }
                                          name="status"
                                        />
                                      </label>
                                    </div>
                                    <label className="grid gap-2">
                                      <span className="text-sm font-medium text-slate-700">
                                        Mô tả
                                      </span>
                                      <textarea
                                        className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3"
                                        defaultValue={
                                          row.testCase.description || ""
                                        }
                                        name="description"
                                      />
                                    </label>
                                    <div className="flex flex-wrap gap-3">
                                      <button
                                        className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white"
                                        disabled={submitting}
                                        type="submit"
                                      >
                                        Lưu thay đổi
                                      </button>
                                      <button
                                        className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700"
                                        type="button"
                                        onClick={() => {
                                          setEditingTestCaseId(null);
                                          setEditError("");
                                        }}
                                      >
                                        Hủy
                                      </button>
                                    </div>
                                  </form>
                                ) : null}

                                <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
                                  <div className="border-b border-slate-200 px-5 py-4">
                                    <div className="flex flex-wrap items-start justify-between gap-4">
                                      <div className="min-w-0 flex-1">
                                        <h4 className="text-base font-bold text-slate-900">
                                          Danh sách test case set
                                        </h4>
                                        <p className="mt-1 text-sm text-slate-500">
                                          Mỗi test case bên dưới có thể chứa
                                          nhiều test case set. Mở từng set để
                                          xem và sửa dữ liệu chi tiết.
                                        </p>
                                      </div>
                                      <button
                                        className="rounded-2xl border border-sky-200 bg-sky-50 px-5 py-3 text-sm font-bold text-sky-700 shadow-sm transition hover:bg-sky-100"
                                        type="button"
                                        onClick={() =>
                                          setCreatingDataSetForTestCaseId(
                                            creatingDataSetForTestCaseId ===
                                              row.testCase.id
                                              ? null
                                              : row.testCase.id,
                                          )
                                        }
                                      >
                                        {creatingDataSetForTestCaseId ===
                                        row.testCase.id
                                          ? "Đóng tạo test case set"
                                          : "Tạo test case set"}
                                      </button>
                                    </div>
                                  </div>

                                  {creatingDataSetForTestCaseId ===
                                  row.testCase.id ? (
                                    <div className="border-b border-slate-200 bg-slate-50 p-4">
                                      {(() => {
                                        const createDataMode =
                                          createDataJsonModes[
                                            row.testCase.id
                                          ] || "preview";
                                        const createExpectedMode =
                                          createExpectedJsonModes[
                                            row.testCase.id
                                          ] || "builder";
                                        const templateDataJson =
                                          row.dataSets[0]?.dataJson || {};
                                        const templateExpectedJson =
                                          row.dataSets[0]?.expectedJson || {};
                                        const createDataDraft =
                                          createDataJsonDrafts[
                                            row.testCase.id
                                          ] || {};
                                        const createExpectedResult =
                                          parseExpectedResult(
                                            templateExpectedJson,
                                          );

                                        return (
                                          <form
                                            className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4"
                                            onSubmit={(event) =>
                                              void handleCreateDataSetSubmit(
                                                event,
                                                row.testCase,
                                                templateDataJson,
                                              )
                                            }
                                          >
                                            <div className="grid gap-4 md:grid-cols-2">
                                              <label className="grid gap-2 md:col-span-2 lg:col-span-1">
                                                <span className="text-sm font-medium text-slate-700">
                                                  Mã test case set
                                                </span>
                                                <input
                                                  className="min-h-[56px] w-full rounded-2xl border border-slate-200 px-4 py-4"
                                                  defaultValue={`${row.testCase.code}_SET_${String(
                                                    row.tcSets.length + 1,
                                                  ).padStart(2, "0")}`}
                                                  name="code"
                                                  required
                                                />
                                              </label>
                                              <label className="grid gap-2">
                                                <span className="text-sm font-medium text-slate-700">
                                                  Tên test case set
                                                </span>
                                                <input
                                                  className="rounded-2xl border border-slate-200 px-4 py-3"
                                                  defaultValue={`${row.testCase.name} - Set ${row.tcSets.length + 1}`}
                                                  name="name"
                                                  required
                                                />
                                              </label>
                                            </div>
                                            <div className="grid gap-4 md:grid-cols-2">
                                              <label className="grid gap-2">
                                                <span className="text-sm font-medium text-slate-700">
                                                  Trạng thái
                                                </span>
                                                <input
                                                  className="rounded-2xl border border-slate-200 px-4 py-3"
                                                  defaultValue="active"
                                                  name="status"
                                                />
                                              </label>
                                              <label className="grid gap-2">
                                                <span className="text-sm font-medium text-slate-700">
                                                  Mô tả
                                                </span>
                                                <input
                                                  className="rounded-2xl border border-slate-200 px-4 py-3"
                                                  name="description"
                                                />
                                              </label>
                                            </div>
                                            <div className="grid gap-4 lg:grid-cols-2">
                                              <div className="grid gap-3 rounded-2xl border border-slate-200 p-4">
                                                <div className="flex items-center justify-between gap-3">
                                                  <span className="text-sm font-medium text-slate-700">
                                                    DataJson
                                                  </span>
                                                  <div className="flex items-center gap-2">
                                                    <label className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700">
                                                      Import Excel
                                                      <input
                                                        accept=".xlsx"
                                                        className="hidden"
                                                        type="file"
                                                        onChange={(event) => {
                                                          const file =
                                                            event.currentTarget
                                                              .files?.[0] ||
                                                            null;
                                                          void handleImportCreateDataJsonFile(
                                                            row.testCase.id,
                                                            templateDataJson,
                                                            file,
                                                          );
                                                          event.currentTarget.value =
                                                            "";
                                                        }}
                                                      />
                                                    </label>
                                                    <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                                                      <button
                                                        className={`rounded-lg px-3 py-1 text-xs font-semibold ${createDataMode === "json" ? "bg-slate-900 text-white" : "text-slate-600"}`}
                                                        type="button"
                                                        onClick={() =>
                                                          setCreateDataJsonModes(
                                                            (current) => ({
                                                              ...current,
                                                              [row.testCase.id]:
                                                                "json",
                                                            }),
                                                          )
                                                        }
                                                      >
                                                        JSON
                                                      </button>
                                                      <button
                                                        className={`rounded-lg px-3 py-1 text-xs font-semibold ${createDataMode === "preview" ? "bg-slate-900 text-white" : "text-slate-600"}`}
                                                        type="button"
                                                        onClick={() =>
                                                          setCreateDataJsonModes(
                                                            (current) => ({
                                                              ...current,
                                                              [row.testCase.id]:
                                                                "preview",
                                                            }),
                                                          )
                                                        }
                                                      >
                                                        UI
                                                      </button>
                                                    </div>
                                                  </div>
                                                </div>

                                                {createDataMode === "json" ? (
                                                  <textarea
                                                    key={`create-json-${row.testCase.id}-${JSON.stringify(createDataDraft)}`}
                                                    className="min-h-44 rounded-2xl border border-slate-200 px-4 py-3 font-mono text-xs"
                                                    defaultValue={formatJsonPreview(
                                                      createDataDraft,
                                                    )}
                                                    name="dataJson"
                                                  />
                                                ) : (
                                                  <div className="grid gap-3">
                                                    <div
                                                      className="min-h-44 rounded-2xl border border-slate-200 bg-white p-4"
                                                      key={`create-ui-${row.testCase.id}-${JSON.stringify(createDataDraft)}`}
                                                    >
                                                      {renderEditableJsonUi(
                                                        createDataDraft,
                                                        templateDataJson,
                                                        `createDataUi${row.testCase.id}`,
                                                        "Chưa có mẫu DataJson",
                                                      )}
                                                    </div>
                                                  </div>
                                                )}
                                              </div>

                                              <div className="grid gap-3 rounded-2xl border border-slate-200 p-4">
                                                <div className="flex items-center justify-between gap-3">
                                                  <span className="text-sm font-medium text-slate-700">
                                                    ExpectedJson
                                                  </span>
                                                  <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                                                    <button
                                                      className={`rounded-lg px-3 py-1 text-xs font-semibold ${createExpectedMode === "builder" ? "bg-slate-900 text-white" : "text-slate-600"}`}
                                                      type="button"
                                                      onClick={() =>
                                                        setCreateExpectedJsonModes(
                                                          (current) => ({
                                                            ...current,
                                                            [row.testCase.id]:
                                                              "builder",
                                                          }),
                                                        )
                                                      }
                                                    >
                                                      UI
                                                    </button>
                                                    <button
                                                      className={`rounded-lg px-3 py-1 text-xs font-semibold ${createExpectedMode === "json" ? "bg-slate-900 text-white" : "text-slate-600"}`}
                                                      type="button"
                                                      onClick={() =>
                                                        setCreateExpectedJsonModes(
                                                          (current) => ({
                                                            ...current,
                                                            [row.testCase.id]:
                                                              "json",
                                                          }),
                                                        )
                                                      }
                                                    >
                                                      JSON
                                                    </button>
                                                  </div>
                                                </div>

                                                {createExpectedMode ===
                                                "json" ? (
                                                  <textarea
                                                    className="min-h-44 rounded-2xl border border-slate-200 px-4 py-3 font-mono text-xs"
                                                    defaultValue={formatJsonPreview(
                                                      templateExpectedJson,
                                                    )}
                                                    name="expectedJson"
                                                  />
                                                ) : (
                                                  <div className="grid gap-4">
                                                    <label className="grid gap-2">
                                                      <span className="text-sm font-medium text-slate-700">
                                                        Kiểu kết quả mong đợi
                                                      </span>
                                                      <select
                                                        className="rounded-2xl border border-slate-200 px-4 py-3"
                                                        defaultValue={
                                                          createExpectedResult.kind
                                                        }
                                                        name="resultKind"
                                                      >
                                                        <option value="url">
                                                          URL chuyển tới
                                                        </option>
                                                        <option value="text">
                                                          Text xuất hiện
                                                        </option>
                                                        <option value="button">
                                                          Button xuất hiện
                                                        </option>
                                                        <option value="selector">
                                                          Selector tùy chỉnh
                                                        </option>
                                                      </select>
                                                    </label>
                                                    <label className="grid gap-2">
                                                      <span className="text-sm font-medium text-slate-700">
                                                        Giá trị kết quả
                                                      </span>
                                                      <input
                                                        className="rounded-2xl border border-slate-200 px-4 py-3"
                                                        defaultValue={
                                                          createExpectedResult.target
                                                        }
                                                        name="resultTarget"
                                                        placeholder="VD: /manager/dashboard hoặc Đăng nhập thành công"
                                                      />
                                                    </label>
                                                    <label className="grid gap-2">
                                                      <span className="text-sm font-medium text-slate-700">
                                                        Expected value
                                                      </span>
                                                      <input
                                                        className="rounded-2xl border border-slate-200 px-4 py-3"
                                                        defaultValue={
                                                          createExpectedResult.expectedValue
                                                        }
                                                        name="resultValue"
                                                      />
                                                    </label>
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                            {editError ? (
                                              <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                                                {editError}
                                              </div>
                                            ) : null}
                                            <div className="flex flex-wrap gap-3">
                                              <button
                                                className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white"
                                                disabled={submitting}
                                                type="submit"
                                              >
                                                Tạo test case set
                                              </button>
                                              <button
                                                className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700"
                                                type="button"
                                                onClick={() => {
                                                  setCreatingDataSetForTestCaseId(
                                                    null,
                                                  );
                                                  setCreateDataJsonImportedDrafts(
                                                    (current) => ({
                                                      ...current,
                                                      [row.testCase.id]: false,
                                                    }),
                                                  );
                                                }}
                                              >
                                                Hủy
                                              </button>
                                            </div>
                                          </form>
                                        );
                                      })()}
                                    </div>
                                  ) : null}

                                  <div className="overflow-x-auto">
                                    <table className="min-w-full divide-y divide-slate-200 text-sm">
                                      <thead className="bg-slate-100 text-left text-xs uppercase tracking-[0.14em] text-slate-500">
                                        <tr>
                                          <th className="px-4 py-3">Mở</th>
                                          <th className="px-4 py-3">
                                            Thuộc test case
                                          </th>
                                          <th className="px-4 py-3">
                                            Tên test case set
                                          </th>
                                          <th className="px-4 py-3">Code</th>
                                          <th className="px-4 py-3">
                                            Trạng thái
                                          </th>
                                          <th className="px-4 py-3">
                                            Data test
                                          </th>
                                        </tr>
                                      </thead>
                                      <tbody className="divide-y divide-slate-200">
                                        {row.tcSets.length ? (
                                          row.tcSets.map((tcSet) => {
                                            const isTcSetExpanded = Boolean(
                                              expandedTcSetIds[tcSet.id],
                                            );
                                            return (
                                              <Fragment key={tcSet.id}>
                                                <tr
                                                  className={
                                                    isTcSetExpanded
                                                      ? "bg-sky-50/60"
                                                      : "hover:bg-slate-50"
                                                  }
                                                  key={tcSet.id}
                                                >
                                                  <td className="px-4 py-3 align-top">
                                                    <button
                                                      className="rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-700"
                                                      type="button"
                                                      onClick={() =>
                                                        toggleExpandedTcSet(
                                                          tcSet.id,
                                                        )
                                                      }
                                                    >
                                                      {isTcSetExpanded
                                                        ? "Ẩn"
                                                        : "Xem"}
                                                    </button>
                                                  </td>
                                                  <td className="px-4 py-3 align-top text-slate-600">
                                                    <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                                                      <span>
                                                        {row.testCase.name}
                                                      </span>
                                                      {row.requiresManualRun ? (
                                                        <span className="rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                                                          Cần chạy thủ công
                                                        </span>
                                                      ) : null}
                                                    </div>
                                                  </td>
                                                  <td className="px-4 py-3 align-top">
                                                    {(() => {
                                                      const tcSetRequiresManualRun =
                                                        row.hasManualPaymentStep ||
                                                        tcSet.dataTests.some(
                                                          (dataTest) =>
                                                            requiresManualRunFromDataSet(
                                                              dataTest,
                                                            ),
                                                        );
                                                      return (
                                                        <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                                                          <span>
                                                            {tcSet.name}
                                                          </span>
                                                          {tcSetRequiresManualRun ? (
                                                            <span className="rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                                                              Cần chạy thủ công
                                                            </span>
                                                          ) : null}
                                                        </div>
                                                      );
                                                    })()}
                                                    <div className="mt-1 text-xs text-slate-500">
                                                      {tcSet.description ||
                                                        "Không có mô tả"}
                                                    </div>
                                                  </td>
                                                  <td className="px-4 py-3 align-top text-slate-600">
                                                    <div className="flex flex-wrap items-center gap-2">
                                                      <span>{tcSet.code}</span>
                                                      {row.hasManualPaymentStep ||
                                                      tcSet.dataTests.some(
                                                        (dataTest) =>
                                                          requiresManualRunFromDataSet(
                                                            dataTest,
                                                          ),
                                                      ) ? (
                                                        <span className="rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                                                          Cần chạy thủ công
                                                        </span>
                                                      ) : null}
                                                    </div>
                                                  </td>
                                                  <td className="px-4 py-3 align-top text-slate-600">
                                                    {tcSet.status}
                                                  </td>
                                                  <td className="px-4 py-3 align-top font-semibold text-slate-900">
                                                    {tcSet.dataTests.length}
                                                  </td>
                                                </tr>

                                                {isTcSetExpanded ? (
                                                  <tr
                                                    key={`${tcSet.id}-data-tests`}
                                                  >
                                                    <td
                                                      className="bg-slate-50 px-4 py-4"
                                                      colSpan={6}
                                                    >
                                                      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                                                        <div className="border-b border-slate-200 px-4 py-3">
                                                          <h5 className="font-bold text-slate-900">
                                                            Data test thuộc test
                                                            case set
                                                          </h5>
                                                        </div>
                                                        <div className="overflow-x-auto">
                                                          <table className="min-w-full divide-y divide-slate-200 text-sm">
                                                            <thead className="bg-slate-50 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                                                              <tr>
                                                                <th className="px-4 py-3">
                                                                  Code
                                                                </th>
                                                                <th className="px-4 py-3">
                                                                  Tên data test
                                                                </th>
                                                                <th className="px-4 py-3">
                                                                  Data keys
                                                                </th>
                                                                <th className="px-4 py-3">
                                                                  Expected keys
                                                                </th>
                                                                <th className="px-4 py-3">
                                                                  Mô tả
                                                                </th>
                                                                <th className="px-4 py-3 text-right">
                                                                  Thao tác
                                                                </th>
                                                              </tr>
                                                            </thead>
                                                            <tbody className="divide-y divide-slate-200">
                                                              {tcSet.dataTests.map(
                                                                (dataTest) => {
                                                                  const dataJsonTemplate =
                                                                    hasStructuredData(
                                                                      dataTest.dataJson,
                                                                    )
                                                                      ? dataTest.dataJson
                                                                      : row.dataSets.find(
                                                                          (
                                                                            item,
                                                                          ) =>
                                                                            item.id !==
                                                                              dataTest.id &&
                                                                            hasStructuredData(
                                                                              item.dataJson,
                                                                            ),
                                                                        )
                                                                          ?.dataJson ||
                                                                        {};

                                                                  return (
                                                                    <Fragment
                                                                      key={
                                                                        dataTest.id
                                                                      }
                                                                    >
                                                                      <tr className="align-top">
                                                                        <td className="px-4 py-3 font-semibold text-slate-900">
                                                                          <div className="flex flex-wrap items-center gap-2">
                                                                            <span>
                                                                              {
                                                                                dataTest.code
                                                                              }
                                                                            </span>
                                                                            {row.hasManualPaymentStep ||
                                                                            requiresManualRunFromDataSet(
                                                                              dataTest,
                                                                            ) ? (
                                                                              <span className="rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                                                                                Cần
                                                                                chạy
                                                                                thủ
                                                                                công
                                                                              </span>
                                                                            ) : null}
                                                                          </div>
                                                                        </td>
                                                                        <td className="px-4 py-3 text-slate-700">
                                                                          <div className="flex flex-wrap items-center gap-2">
                                                                            <span>
                                                                              {
                                                                                dataTest.name
                                                                              }
                                                                            </span>
                                                                            {row.hasManualPaymentStep ||
                                                                            requiresManualRunFromDataSet(
                                                                              dataTest,
                                                                            ) ? (
                                                                              <span className="rounded-full border border-amber-300 bg-amber-100 px-2.5 py-1 text-[11px] font-bold text-amber-800">
                                                                                Cần
                                                                                chạy
                                                                                thủ
                                                                                công
                                                                              </span>
                                                                            ) : null}
                                                                          </div>
                                                                        </td>
                                                                        <td className="px-4 py-3 text-slate-600">
                                                                          <div className="flex max-w-xs flex-wrap gap-2">
                                                                            {objectKeyList(
                                                                              dataTest.dataJson,
                                                                            )
                                                                              .length ? (
                                                                              objectKeyList(
                                                                                dataTest.dataJson,
                                                                              ).map(
                                                                                (
                                                                                  key,
                                                                                ) => (
                                                                                  <span
                                                                                    className="rounded-full border border-slate-200 px-2 py-1 text-xs"
                                                                                    key={
                                                                                      key
                                                                                    }
                                                                                  >
                                                                                    {
                                                                                      key
                                                                                    }
                                                                                  </span>
                                                                                ),
                                                                              )
                                                                            ) : (
                                                                              <span className="text-xs text-slate-400">
                                                                                Không
                                                                                có
                                                                                key
                                                                              </span>
                                                                            )}
                                                                          </div>
                                                                        </td>
                                                                        <td className="px-4 py-3 text-slate-600">
                                                                          <div className="flex max-w-xs flex-wrap gap-2">
                                                                            {objectKeyList(
                                                                              dataTest.expectedJson,
                                                                            )
                                                                              .length ? (
                                                                              objectKeyList(
                                                                                dataTest.expectedJson,
                                                                              ).map(
                                                                                (
                                                                                  key,
                                                                                ) => (
                                                                                  <span
                                                                                    className="rounded-full border border-slate-200 px-2 py-1 text-xs"
                                                                                    key={
                                                                                      key
                                                                                    }
                                                                                  >
                                                                                    {
                                                                                      key
                                                                                    }
                                                                                  </span>
                                                                                ),
                                                                              )
                                                                            ) : (
                                                                              <span className="text-xs text-slate-400">
                                                                                Không
                                                                                có
                                                                                key
                                                                              </span>
                                                                            )}
                                                                          </div>
                                                                        </td>
                                                                        <td className="px-4 py-3 text-slate-600">
                                                                          {dataTest.description ||
                                                                            "Không có mô tả"}
                                                                        </td>
                                                                        <td className="px-4 py-3">
                                                                          <div className="flex justify-end gap-2">
                                                                            {hasStructuredData(
                                                                              dataTest.dataJson,
                                                                            ) ? (
                                                                              <button
                                                                                className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 font-semibold text-emerald-700"
                                                                                type="button"
                                                                                onClick={() =>
                                                                                  exportDataJsonAsXlsx(
                                                                                    dataTest,
                                                                                  )
                                                                                }
                                                                              >
                                                                                Export
                                                                                Excel
                                                                              </button>
                                                                            ) : (
                                                                              <label className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 font-semibold text-amber-700">
                                                                                Import
                                                                                Excel
                                                                                <input
                                                                                  accept=".xlsx"
                                                                                  className="hidden"
                                                                                  type="file"
                                                                                  onChange={(
                                                                                    event,
                                                                                  ) => {
                                                                                    const file =
                                                                                      event
                                                                                        .currentTarget
                                                                                        .files?.[0] ||
                                                                                      null;
                                                                                    void handleImportDataJsonFile(
                                                                                      row.testCase,
                                                                                      dataTest,
                                                                                      dataJsonTemplate,
                                                                                      file,
                                                                                    );
                                                                                    event.currentTarget.value =
                                                                                      "";
                                                                                  }}
                                                                                />
                                                                              </label>
                                                                            )}
                                                                            <button
                                                                              className="rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-700"
                                                                              type="button"
                                                                              onClick={() => {
                                                                                setEditingDataSetId(
                                                                                  editingDataSetId ===
                                                                                    dataTest.id
                                                                                    ? null
                                                                                    : dataTest.id,
                                                                                );
                                                                                setEditError(
                                                                                  "",
                                                                                );
                                                                              }}
                                                                            >
                                                                              {editingDataSetId ===
                                                                              dataTest.id
                                                                                ? "Đóng"
                                                                                : "Sửa data"}
                                                                            </button>
                                                                            <button
                                                                              className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 font-semibold text-rose-700"
                                                                              disabled={
                                                                                runningTestCaseId !==
                                                                                null
                                                                              }
                                                                              type="button"
                                                                              onClick={() =>
                                                                                void onDeleteTestDataSet(
                                                                                  row.testCase,
                                                                                  dataTest,
                                                                                )
                                                                              }
                                                                            >
                                                                              Xóa
                                                                              data
                                                                            </button>
                                                                          </div>
                                                                        </td>
                                                                      </tr>
                                                                      {editingDataSetId ===
                                                                      dataTest.id ? (
                                                                        <tr>
                                                                          <td
                                                                            className="bg-slate-50 px-4 py-4"
                                                                            colSpan={
                                                                              6
                                                                            }
                                                                          >
                                                                            <form
                                                                              className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4"
                                                                              onSubmit={(
                                                                                event,
                                                                              ) =>
                                                                                void handleUpdateDataSetSubmit(
                                                                                  event,
                                                                                  row.testCase,
                                                                                  dataTest,
                                                                                  dataJsonTemplate,
                                                                                )
                                                                              }
                                                                            >
                                                                              {(() => {
                                                                                const expectedResult =
                                                                                  parseExpectedResult(
                                                                                    dataTest.expectedJson,
                                                                                  );
                                                                                const dataMode =
                                                                                  dataJsonModes[
                                                                                    dataTest
                                                                                      .id
                                                                                  ] ||
                                                                                  "json";
                                                                                const expectedMode =
                                                                                  expectedJsonModes[
                                                                                    dataTest
                                                                                      .id
                                                                                  ] ||
                                                                                  "builder";

                                                                                return (
                                                                                  <>
                                                                                    <div className="grid gap-4 md:grid-cols-2">
                                                                                      <label className="grid gap-2">
                                                                                        <span className="text-sm font-medium text-slate-700">
                                                                                          Mã
                                                                                          test
                                                                                          case
                                                                                          set
                                                                                        </span>
                                                                                        <input
                                                                                          className="rounded-2xl border border-slate-200 px-4 py-3"
                                                                                          defaultValue={
                                                                                            dataTest.code
                                                                                          }
                                                                                          name="code"
                                                                                          required
                                                                                        />
                                                                                      </label>
                                                                                      <label className="grid gap-2">
                                                                                        <span className="text-sm font-medium text-slate-700">
                                                                                          Tên
                                                                                          test
                                                                                          case
                                                                                          set
                                                                                        </span>
                                                                                        <input
                                                                                          className="rounded-2xl border border-slate-200 px-4 py-3"
                                                                                          defaultValue={
                                                                                            dataTest.name
                                                                                          }
                                                                                          name="name"
                                                                                          required
                                                                                        />
                                                                                      </label>
                                                                                    </div>
                                                                                    <div className="grid gap-4 md:grid-cols-2">
                                                                                      <label className="grid gap-2">
                                                                                        <span className="text-sm font-medium text-slate-700">
                                                                                          Trạng
                                                                                          thái
                                                                                        </span>
                                                                                        <input
                                                                                          className="rounded-2xl border border-slate-200 px-4 py-3"
                                                                                          defaultValue={
                                                                                            dataTest.status ||
                                                                                            "active"
                                                                                          }
                                                                                          name="status"
                                                                                        />
                                                                                      </label>
                                                                                      <label className="grid gap-2">
                                                                                        <span className="text-sm font-medium text-slate-700">
                                                                                          Mô
                                                                                          tả
                                                                                        </span>
                                                                                        <input
                                                                                          className="rounded-2xl border border-slate-200 px-4 py-3"
                                                                                          defaultValue={
                                                                                            dataTest.description ||
                                                                                            ""
                                                                                          }
                                                                                          name="description"
                                                                                        />
                                                                                      </label>
                                                                                    </div>
                                                                                    <div className="grid gap-4 lg:grid-cols-2">
                                                                                      <div className="grid gap-3 rounded-2xl border border-slate-200 p-4">
                                                                                        <div className="flex items-center justify-between gap-3">
                                                                                          <span className="text-sm font-medium text-slate-700">
                                                                                            DataJson
                                                                                          </span>
                                                                                          <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                                                                                            <button
                                                                                              className={`rounded-lg px-3 py-1 text-xs font-semibold ${dataMode === "json" ? "bg-slate-900 text-white" : "text-slate-600"}`}
                                                                                              type="button"
                                                                                              onClick={() =>
                                                                                                setDataJsonModes(
                                                                                                  (
                                                                                                    current,
                                                                                                  ) => ({
                                                                                                    ...current,
                                                                                                    [dataTest.id]:
                                                                                                      "json",
                                                                                                  }),
                                                                                                )
                                                                                              }
                                                                                            >
                                                                                              JSON
                                                                                            </button>
                                                                                            <button
                                                                                              className={`rounded-lg px-3 py-1 text-xs font-semibold ${dataMode === "preview" ? "bg-slate-900 text-white" : "text-slate-600"}`}
                                                                                              type="button"
                                                                                              onClick={() =>
                                                                                                setDataJsonModes(
                                                                                                  (
                                                                                                    current,
                                                                                                  ) => ({
                                                                                                    ...current,
                                                                                                    [dataTest.id]:
                                                                                                      "preview",
                                                                                                  }),
                                                                                                )
                                                                                              }
                                                                                            >
                                                                                              UI
                                                                                            </button>
                                                                                          </div>
                                                                                        </div>
                                                                                        {dataMode ===
                                                                                        "json" ? (
                                                                                          <textarea
                                                                                            className="min-h-72 rounded-2xl border border-slate-200 px-4 py-3 font-mono text-xs"
                                                                                            defaultValue={formatJsonPreview(
                                                                                              dataTest.dataJson,
                                                                                            )}
                                                                                            name="dataJson"
                                                                                          />
                                                                                        ) : (
                                                                                          <div className="grid gap-3">
                                                                                            <div
                                                                                              className="min-h-72 rounded-2xl border border-slate-200 bg-white p-4"
                                                                                              key={`edit-ui-${dataTest.id}-${JSON.stringify(dataTest.dataJson)}-${JSON.stringify(dataJsonTemplate)}`}
                                                                                            >
                                                                                              {renderEditableJsonUi(
                                                                                                dataTest.dataJson,
                                                                                                dataJsonTemplate,
                                                                                                `dataUi${dataTest.id}`,
                                                                                                "DataJson đang rỗng",
                                                                                              )}
                                                                                            </div>
                                                                                          </div>
                                                                                        )}
                                                                                      </div>

                                                                                      <div className="grid gap-3 rounded-2xl border border-slate-200 p-4">
                                                                                        <div className="flex items-center justify-between gap-3">
                                                                                          <span className="text-sm font-medium text-slate-700">
                                                                                            ExpectedJson
                                                                                          </span>
                                                                                          <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
                                                                                            <button
                                                                                              className={`rounded-lg px-3 py-1 text-xs font-semibold ${expectedMode === "builder" ? "bg-slate-900 text-white" : "text-slate-600"}`}
                                                                                              type="button"
                                                                                              onClick={() =>
                                                                                                setExpectedJsonModes(
                                                                                                  (
                                                                                                    current,
                                                                                                  ) => ({
                                                                                                    ...current,
                                                                                                    [dataTest.id]:
                                                                                                      "builder",
                                                                                                  }),
                                                                                                )
                                                                                              }
                                                                                            >
                                                                                              UI
                                                                                            </button>
                                                                                            <button
                                                                                              className={`rounded-lg px-3 py-1 text-xs font-semibold ${expectedMode === "json" ? "bg-slate-900 text-white" : "text-slate-600"}`}
                                                                                              type="button"
                                                                                              onClick={() =>
                                                                                                setExpectedJsonModes(
                                                                                                  (
                                                                                                    current,
                                                                                                  ) => ({
                                                                                                    ...current,
                                                                                                    [dataTest.id]:
                                                                                                      "json",
                                                                                                  }),
                                                                                                )
                                                                                              }
                                                                                            >
                                                                                              JSON
                                                                                            </button>
                                                                                          </div>
                                                                                        </div>

                                                                                        {expectedMode ===
                                                                                        "json" ? (
                                                                                          <textarea
                                                                                            className="min-h-72 rounded-2xl border border-slate-200 px-4 py-3 font-mono text-xs"
                                                                                            defaultValue={formatJsonPreview(
                                                                                              dataTest.expectedJson,
                                                                                            )}
                                                                                            name="expectedJson"
                                                                                          />
                                                                                        ) : (
                                                                                          <div className="grid gap-4">
                                                                                            <label className="grid gap-2">
                                                                                              <span className="text-sm font-medium text-slate-700">
                                                                                                Kiểu
                                                                                                kết
                                                                                                quả
                                                                                                mong
                                                                                                đợi
                                                                                              </span>
                                                                                              <select
                                                                                                className="rounded-2xl border border-slate-200 px-4 py-3"
                                                                                                defaultValue={
                                                                                                  expectedResult.kind
                                                                                                }
                                                                                                name="resultKind"
                                                                                              >
                                                                                                <option value="url">
                                                                                                  URL
                                                                                                  chuyển
                                                                                                  tới
                                                                                                </option>
                                                                                                <option value="text">
                                                                                                  Text
                                                                                                  xuất
                                                                                                  hiện
                                                                                                </option>
                                                                                                <option value="button">
                                                                                                  Button
                                                                                                  xuất
                                                                                                  hiện
                                                                                                </option>
                                                                                                <option value="selector">
                                                                                                  Selector
                                                                                                  tùy
                                                                                                  chỉnh
                                                                                                </option>
                                                                                              </select>
                                                                                            </label>
                                                                                            <label className="grid gap-2">
                                                                                              <span className="text-sm font-medium text-slate-700">
                                                                                                Giá
                                                                                                trị
                                                                                                kết
                                                                                                quả
                                                                                              </span>
                                                                                              <input
                                                                                                className="rounded-2xl border border-slate-200 px-4 py-3"
                                                                                                defaultValue={
                                                                                                  expectedResult.target
                                                                                                }
                                                                                                name="resultTarget"
                                                                                                placeholder="VD: /manager/dashboard hoặc Đăng nhập thành công"
                                                                                              />
                                                                                            </label>
                                                                                            <label className="grid gap-2">
                                                                                              <span className="text-sm font-medium text-slate-700">
                                                                                                Expected
                                                                                                value
                                                                                              </span>
                                                                                              <input
                                                                                                className="rounded-2xl border border-slate-200 px-4 py-3"
                                                                                                defaultValue={
                                                                                                  expectedResult.expectedValue
                                                                                                }
                                                                                                name="resultValue"
                                                                                              />
                                                                                            </label>
                                                                                            <div className="rounded-2xl border border-sky-200 bg-sky-50 p-3 text-sm text-sky-800">
                                                                                              Chế
                                                                                              độ
                                                                                              này
                                                                                              giúp
                                                                                              bạn
                                                                                              chọn
                                                                                              nhanh
                                                                                              kiểu
                                                                                              kết
                                                                                              quả
                                                                                              như
                                                                                              URL,
                                                                                              text,
                                                                                              button
                                                                                              hoặc
                                                                                              selector
                                                                                              mà
                                                                                              không
                                                                                              cần
                                                                                              tự
                                                                                              viết
                                                                                              raw
                                                                                              JSON.
                                                                                            </div>
                                                                                          </div>
                                                                                        )}
                                                                                      </div>
                                                                                    </div>
                                                                                    {editError ? (
                                                                                      <div className="rounded-2xl border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-700">
                                                                                        {
                                                                                          editError
                                                                                        }
                                                                                      </div>
                                                                                    ) : null}
                                                                                    <div className="flex flex-wrap gap-3">
                                                                                      <button
                                                                                        className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white"
                                                                                        disabled={
                                                                                          submitting
                                                                                        }
                                                                                        type="submit"
                                                                                      >
                                                                                        Lưu
                                                                                        data
                                                                                        test
                                                                                      </button>
                                                                                      <button
                                                                                        className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700"
                                                                                        type="button"
                                                                                        onClick={() =>
                                                                                          setEditingDataSetId(
                                                                                            null,
                                                                                          )
                                                                                        }
                                                                                      >
                                                                                        Hủy
                                                                                      </button>
                                                                                    </div>
                                                                                  </>
                                                                                );
                                                                              })()}
                                                                            </form>
                                                                          </td>
                                                                        </tr>
                                                                      ) : null}
                                                                    </Fragment>
                                                                  );
                                                                },
                                                              )}
                                                            </tbody>
                                                          </table>
                                                        </div>

                                                        <div className="grid gap-4 border-t border-slate-200 bg-slate-50 p-4 ">
                                                          {tcSet.dataTests.map(
                                                            (dataTest) => (
                                                              <div
                                                                className="rounded-2xl border border-slate-200 bg-white p-4"
                                                                key={`${dataTest.id}-json`}
                                                              >
                                                                <div className="text-xs uppercase tracking-[0.12em] text-slate-500">
                                                                  Mã test case
                                                                  set:{" "}
                                                                  {
                                                                    dataTest.code
                                                                  }
                                                                </div>
                                                                <div className="mt-3 grid gap-4 lg:grid-cols-2">
                                                                  <div>
                                                                    <div className="mb-2 text-sm font-semibold text-slate-700">
                                                                      Data JSON
                                                                    </div>
                                                                    <pre className="max-h-56 overflow-auto rounded-2xl bg-slate-900 p-4 text-xs text-slate-100">
                                                                      {formatJsonPreview(
                                                                        dataTest.dataJson,
                                                                      )}
                                                                    </pre>
                                                                  </div>
                                                                  <div>
                                                                    <div className="mb-2 text-sm font-semibold text-slate-700">
                                                                      Expected
                                                                      JSON
                                                                    </div>
                                                                    <pre className="max-h-56 overflow-auto rounded-2xl bg-slate-900 p-4 text-xs text-slate-100">
                                                                      {formatJsonPreview(
                                                                        dataTest.expectedJson,
                                                                      )}
                                                                    </pre>
                                                                  </div>
                                                                </div>
                                                              </div>
                                                            ),
                                                          )}
                                                        </div>
                                                      </div>
                                                    </td>
                                                  </tr>
                                                ) : null}
                                              </Fragment>
                                            );
                                          })
                                        ) : (
                                          <tr>
                                            <td
                                              className="px-4 py-5 text-slate-500"
                                              colSpan={6}
                                            >
                                              Test case này chưa có test case
                                              set nào.
                                            </td>
                                          </tr>
                                        )}
                                      </tbody>
                                    </table>
                                  </div>
                                </div>

                                <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
                                  <div className="border-b border-slate-200 px-5 py-4">
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                      <div>
                                        <h4 className="text-base font-bold text-slate-900">
                                          Danh sách data step
                                        </h4>
                                        <p className="mt-1 text-sm text-slate-500">
                                          Bảng tham chiếu nhanh các step hiện có
                                          của test case.
                                        </p>
                                      </div>
                                      <button
                                        className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold text-slate-700"
                                        type="button"
                                        onClick={() =>
                                          toggleExpandedSteps(row.testCase.id)
                                        }
                                      >
                                        {expandedStepSections[row.testCase.id]
                                          ? "Thu gọn data step"
                                          : "Mở data step"}
                                      </button>
                                    </div>
                                  </div>

                                  {expandedStepSections[row.testCase.id] ? (
                                    <div className="overflow-x-auto">
                                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                                        <thead className="bg-slate-100 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                                          <tr>
                                            <th className="px-4 py-3">#</th>
                                            <th className="px-4 py-3">
                                              Action
                                            </th>
                                            <th className="px-4 py-3">
                                              Target
                                            </th>
                                            <th className="px-4 py-3">Value</th>
                                            <th className="px-4 py-3">
                                              Expected
                                            </th>
                                            <th className="px-4 py-3">Mô tả</th>
                                            <th className="px-4 py-3 text-right">
                                              Thao tác
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-200">
                                          {row.steps.length ? (
                                            row.steps.map((step) => (
                                              <Fragment key={step.id}>
                                                <tr>
                                                  <td className="px-4 py-3 font-semibold text-slate-900">
                                                    {step.stepOrder}
                                                  </td>
                                                  <td className="px-4 py-3 text-slate-700">
                                                    {step.actionType}
                                                  </td>
                                                  <td className="px-4 py-3 text-slate-600">
                                                    {normalizeText(step.target)}
                                                  </td>
                                                  <td className="px-4 py-3 text-slate-600">
                                                    {normalizeText(step.value)}
                                                  </td>
                                                  <td className="px-4 py-3 text-slate-600">
                                                    {normalizeText(
                                                      step.expectedValue,
                                                    )}
                                                  </td>
                                                  <td className="px-4 py-3 text-slate-600">
                                                    {normalizeText(
                                                      step.description,
                                                    )}
                                                  </td>
                                                  <td className="px-4 py-3">
                                                    <div className="flex justify-end gap-2">
                                                      <button
                                                        className="rounded-xl border border-slate-200 px-3 py-2 font-semibold text-slate-700"
                                                        type="button"
                                                        onClick={() => {
                                                          setEditingStepId(
                                                            editingStepId ===
                                                              step.id
                                                              ? null
                                                              : step.id,
                                                          );
                                                          setEditError("");
                                                        }}
                                                      >
                                                        {editingStepId ===
                                                        step.id
                                                          ? "Đóng"
                                                          : "Sửa step"}
                                                      </button>
                                                      <button
                                                        className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 font-semibold text-rose-700"
                                                        disabled={
                                                          runningTestCaseId !==
                                                            null || submitting
                                                        }
                                                        type="button"
                                                        onClick={() =>
                                                          void handleDeleteStepClick(
                                                            step,
                                                          )
                                                        }
                                                      >
                                                        Xóa step
                                                      </button>
                                                    </div>
                                                  </td>
                                                </tr>
                                                {editingStepId === step.id ? (
                                                  <tr>
                                                    <td
                                                      className="bg-slate-50 px-4 py-4"
                                                      colSpan={7}
                                                    >
                                                      <form
                                                        className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4"
                                                        onSubmit={(event) =>
                                                          void handleUpdateStepSubmit(
                                                            event,
                                                            row.testCase,
                                                            step,
                                                          )
                                                        }
                                                      >
                                                        <div className="grid gap-4 md:grid-cols-2">
                                                          <label className="grid gap-2">
                                                            <span className="text-sm font-medium text-slate-700">
                                                              Step order
                                                            </span>
                                                            <input
                                                              className="rounded-2xl border border-slate-200 px-4 py-3"
                                                              defaultValue={
                                                                step.stepOrder
                                                              }
                                                              name="stepOrder"
                                                              type="number"
                                                            />
                                                          </label>
                                                          <label className="grid gap-2">
                                                            <span className="text-sm font-medium text-slate-700">
                                                              Action type
                                                            </span>
                                                            <input
                                                              className="rounded-2xl border border-slate-200 px-4 py-3"
                                                              defaultValue={
                                                                step.actionType
                                                              }
                                                              name="actionType"
                                                              required
                                                            />
                                                          </label>
                                                        </div>
                                                        <div className="grid gap-4 md:grid-cols-2">
                                                          <label className="grid gap-2">
                                                            <span className="text-sm font-medium text-slate-700">
                                                              Target
                                                            </span>
                                                            <input
                                                              className="rounded-2xl border border-slate-200 px-4 py-3"
                                                              defaultValue={
                                                                step.target ||
                                                                ""
                                                              }
                                                              name="target"
                                                            />
                                                          </label>
                                                          <label className="grid gap-2">
                                                            <span className="text-sm font-medium text-slate-700">
                                                              Value
                                                            </span>
                                                            <input
                                                              className="rounded-2xl border border-slate-200 px-4 py-3"
                                                              defaultValue={
                                                                step.value || ""
                                                              }
                                                              name="value"
                                                            />
                                                          </label>
                                                        </div>
                                                        <div className="grid gap-4 md:grid-cols-2">
                                                          <label className="grid gap-2">
                                                            <span className="text-sm font-medium text-slate-700">
                                                              Expected value
                                                            </span>
                                                            <input
                                                              className="rounded-2xl border border-slate-200 px-4 py-3"
                                                              defaultValue={
                                                                step.expectedValue ||
                                                                ""
                                                              }
                                                              name="expectedValue"
                                                            />
                                                          </label>
                                                          <label className="grid gap-2">
                                                            <span className="text-sm font-medium text-slate-700">
                                                              Mô tả
                                                            </span>
                                                            <input
                                                              className="rounded-2xl border border-slate-200 px-4 py-3"
                                                              defaultValue={
                                                                step.description ||
                                                                ""
                                                              }
                                                              name="description"
                                                            />
                                                          </label>
                                                        </div>
                                                        <div className="flex flex-wrap gap-3">
                                                          <button
                                                            className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white"
                                                            disabled={
                                                              submitting
                                                            }
                                                            type="submit"
                                                          >
                                                            Lưu step
                                                          </button>
                                                          <button
                                                            className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700"
                                                            type="button"
                                                            onClick={() =>
                                                              setEditingStepId(
                                                                null,
                                                              )
                                                            }
                                                          >
                                                            Hủy
                                                          </button>
                                                        </div>
                                                      </form>
                                                    </td>
                                                  </tr>
                                                ) : null}
                                              </Fragment>
                                            ))
                                          ) : (
                                            <tr>
                                              <td
                                                className="px-4 py-5 text-slate-500"
                                                colSpan={7}
                                              >
                                                Chưa có data step cho test case
                                                này.
                                              </td>
                                            </tr>
                                          )}
                                        </tbody>
                                      </table>
                                    </div>
                                  ) : (
                                    <div className="px-5 py-6 text-sm text-slate-500">
                                      Data step đang được thu gọn. Bấm "Mở data
                                      step" để xem chi tiết.
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                ) : (
                  <tr>
                    <td
                      className="px-4 py-8 text-center text-slate-500"
                      colSpan={9}
                    >
                      Chưa có test case nào cho project này. Bạn có thể tạo mới
                      hoặc dùng recorder để bắt đầu.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {createPanelOpen ? (
        <div className="rounded-3xl border border-sky-100 bg-sky-50/60 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-lg font-bold text-slate-900">
                Tạo test case mới
              </h3>
              <p className="mt-1 text-sm text-slate-600">
                Chọn tạo từ template có sẵn hoặc chuyển sang recorder để ghi
                thao tác thật.
              </p>
            </div>
            <div className="flex rounded-2xl border border-slate-200 bg-white p-1">
              <button
                className={`rounded-xl px-4 py-2 text-sm font-bold ${createMode === "template" ? "bg-slate-900 text-white" : "text-slate-600"}`}
                type="button"
                onClick={() => setCreateMode("template")}
              >
                Template
              </button>
              <button
                className={`rounded-xl px-4 py-2 text-sm font-bold ${createMode === "recorder" ? "bg-slate-900 text-white" : "text-slate-600"}`}
                type="button"
                onClick={() => setCreateMode("recorder")}
              >
                Recorder
              </button>
            </div>
          </div>

          {createMode === "recorder" ? (
            <div className="mt-5 rounded-3xl border border-slate-200 bg-white p-5">
              <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                <div>
                  <h4 className="text-base font-bold text-slate-900">
                    Tạo bằng recorder
                  </h4>
                  <p className="mt-2 text-sm text-slate-600">
                    Recorder sẽ mở browser theo Base URL của project để bạn thao
                    tác thực tế, sau đó lưu lại flow test.
                  </p>
                  <div className="mt-4 rounded-2xl border border-sky-200 bg-sky-50 p-4">
                    <div className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">
                      URL sẽ mở
                    </div>
                    <div className="mt-2 break-all text-sm font-semibold text-slate-900">
                      {project.baseUrl}
                    </div>
                  </div>
                </div>
                <button
                  className="rounded-2xl bg-slate-900 px-5 py-3 text-sm font-bold text-white"
                  type="button"
                  onClick={onOpenRecorder}
                >
                  Mở recorder
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <div className="rounded-3xl border border-slate-200 bg-white p-5">
                <h4 className="text-base font-bold text-slate-900">
                  Template hỗ trợ
                </h4>
                <div className="mt-4 grid gap-3">
                  {templates.length ? (
                    templates.map((template) => (
                      <button
                        className={`rounded-2xl border p-4 text-left ${template.id === selectedTemplate?.id ? "border-sky-400 bg-sky-50" : "border-slate-200 bg-white hover:bg-slate-50"}`}
                        key={template.id}
                        type="button"
                        onClick={() => setSelectedTemplateId(template.id)}
                      >
                        <div className="font-semibold text-slate-900">
                          {template.name}
                        </div>
                        <div className="mt-1 text-sm text-slate-600">
                          {template.description}
                        </div>
                      </button>
                    ))
                  ) : (
                    <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-sm text-slate-500">
                      Chưa có template nào sẵn sàng.
                    </div>
                  )}
                </div>
              </div>

              <form
                className="grid gap-5 rounded-3xl border border-slate-200 bg-white p-5"
                onSubmit={handleCreateSubmit}
              >
                <div className="rounded-3xl border border-slate-200 bg-white shadow-sm">
                  <div className="border-b border-slate-200 px-5 py-4">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-sky-700">
                      Test Case
                    </div>
                    <h4 className="mt-2 text-lg font-black text-slate-900">
                      Thông tin test case
                    </h4>
                    <p className="mt-1 text-sm text-slate-500">
                      Đây là kịch bản cha. Ví dụ: mã <strong>UC-LOGIN</strong>,
                      tên <strong>Login</strong>.
                    </p>
                  </div>
                  <div className="grid gap-4 p-5 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">
                        Mã test case
                      </span>
                      <input
                        className="rounded-2xl border border-slate-200 px-4 py-3"
                        name="code"
                        placeholder="VD: UC-LOGIN"
                        required
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">
                        Tên test case
                      </span>
                      <input
                        className="rounded-2xl border border-slate-200 px-4 py-3"
                        name="name"
                        placeholder="VD: Login"
                        required
                      />
                    </label>
                    <label className="grid gap-2 md:col-span-2">
                      <span className="text-sm font-medium text-slate-700">
                        Mô tả test case
                      </span>
                      <textarea
                        className="min-h-24 rounded-2xl border border-slate-200 px-4 py-3"
                        name="description"
                        placeholder="VD: Kiểm tra luồng đăng nhập"
                      />
                    </label>
                  </div>
                </div>

                <div className="rounded-3xl border border-sky-200 bg-sky-50/60 shadow-sm">
                  <div className="border-b border-sky-100 px-5 py-4">
                    <div className="text-xs font-bold uppercase tracking-[0.18em] text-sky-700">
                      Test Case Set
                    </div>
                    <h4 className="mt-2 text-lg font-black text-slate-900">
                      Test case set khởi tạo
                    </h4>
                    <p className="mt-1 text-sm text-slate-600">
                      Đây là bộ dữ liệu đầu tiên của test case. Ví dụ:{" "}
                      <strong>LOGIN_SUCCESS</strong> hoặc{" "}
                      <strong>LOGIN_FAIL</strong>.
                    </p>
                  </div>
                  <div className="grid gap-4 p-5 md:grid-cols-2">
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">
                        Mã test case set
                      </span>
                      <input
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                        name="dataSetCode"
                        placeholder="VD: LOGIN_SUCCESS"
                        required
                      />
                    </label>
                    <label className="grid gap-2">
                      <span className="text-sm font-medium text-slate-700">
                        Tên test case set
                      </span>
                      <input
                        className="rounded-2xl border border-slate-200 bg-white px-4 py-3"
                        name="dataSetName"
                        placeholder="VD: Login success"
                        required
                      />
                    </label>
                    <label className="grid gap-2 md:col-span-2">
                      <span className="text-sm font-medium text-slate-700">
                        Mô tả test case set
                      </span>
                      <textarea
                        className="min-h-20 rounded-2xl border border-slate-200 bg-white px-4 py-3"
                        name="dataSetDescription"
                        placeholder="VD: Bộ dữ liệu cho đăng nhập thành công"
                      />
                    </label>
                  </div>
                </div>

                <div className="grid gap-4 rounded-3xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-2">
                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-slate-700">
                      Trang login
                    </span>
                    <input
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                      defaultValue="/login"
                      name="pagePath"
                      required
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-slate-700">
                      Email selector
                    </span>
                    <input
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                      defaultValue="#email"
                      name="emailSelector"
                      required
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-slate-700">
                      Password selector
                    </span>
                    <input
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                      defaultValue="#password"
                      name="passwordSelector"
                      required
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-slate-700">
                      Submit target type
                    </span>
                    <select
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                      defaultValue="auto"
                      name="submitSelectorKind"
                    >
                      <option value="auto">Auto fallback</option>
                      <option value="button">Button text</option>
                      <option value="css">CSS selector</option>
                      <option value="text">Text</option>
                      <option value="label">Label</option>
                      <option value="placeholder">Placeholder</option>
                      <option value="link">Link</option>
                    </select>
                  </label>
                  <label className="grid gap-2 md:col-span-2">
                    <span className="text-sm font-medium text-slate-700">
                      Submit target value
                    </span>
                    <input
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                      defaultValue="submit"
                      name="submitSelector"
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-slate-700">
                      Kiểu kết quả mong đợi
                    </span>
                    <select
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                      defaultValue="url"
                      name="successSelectorKind"
                    >
                      <option value="url">URL chuyển tới</option>
                      <option value="text">Text xuất hiện</option>
                      <option value="button">Button xuất hiện</option>
                      <option value="selector">Selector tùy chỉnh</option>
                    </select>
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-slate-700">
                      Giá trị kết quả mong đợi
                    </span>
                    <input
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                      defaultValue="/manager/dashboard"
                      name="successSelector"
                    />
                  </label>
                  <div className="rounded-2xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800 md:col-span-2">
                    Chọn kiểu kết quả giống phần <strong>ExpectedJson</strong>{" "}
                    của test case set. Ví dụ: URL chuyển tới
                    <code className="ml-1 rounded bg-white px-1.5 py-0.5 text-xs text-sky-900">
                      /manager/dashboard
                    </code>
                    , hoặc Text xuất hiện như
                    <code className="ml-1 rounded bg-white px-1.5 py-0.5 text-xs text-sky-900">
                      Đăng nhập thành công
                    </code>
                    .
                  </div>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-slate-700">
                      Username hợp lệ
                    </span>
                    <input
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                      defaultValue="admin@test.com"
                      name="username"
                      required
                    />
                  </label>
                  <label className="grid gap-2">
                    <span className="text-sm font-medium text-slate-700">
                      Password hợp lệ
                    </span>
                    <input
                      className="rounded-2xl border border-slate-200 px-4 py-3"
                      defaultValue="123456"
                      name="password"
                      required
                      type="password"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-3">
                  <button
                    className="rounded-2xl bg-sky-600 px-5 py-3 text-sm font-bold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                    disabled={submitting || !selectedTemplate}
                    type="submit"
                  >
                    Tạo test case
                  </button>
                  <button
                    className="rounded-2xl border border-slate-200 px-5 py-3 text-sm font-bold text-slate-700"
                    type="button"
                    onClick={() => setCreatePanelOpen(false)}
                  >
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
