import { FormEvent, useEffect, useRef, useState } from 'react';
import { FlowStep, RecordingStopResult, StatusTone, TestCaseRequest } from '../types';
import { getRecordingSnapshotRequest, startRecordingRequest, stopRecordingRequest } from '../services/recordingService';
import { StatusPill } from './StatusPill';

type RecorderViewProps = {
  initialUrl?: string;
  autoStart?: boolean;
  projectName?: string;
  onSaveAsProjectTestCase?(recording: RecordingStopResult, payload: Omit<TestCaseRequest, 'projectId' | 'status'>): Promise<void>;
  onUseRecordedSteps(code: string): void;
};

export function RecorderView({ initialUrl, autoStart, projectName, onSaveAsProjectTestCase, onUseRecordedSteps }: RecorderViewProps) {
  const [url, setUrl] = useState(initialUrl || 'http://localhost:5173/signin');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ text: string; tone?: StatusTone }>({ text: 'Idle' });
  const [message, setMessage] = useState('Khi bật recorder, hệ thống sẽ mở browser headed. Thao tác xong quay lại dashboard và bấm Stop Recording.');
  const [code, setCode] = useState('');
  const [result, setResult] = useState<RecordingStopResult | null>(null);
  const [savingTestCase, setSavingTestCase] = useState(false);
  const [stepsTab, setStepsTab] = useState<'steps' | 'json'>('steps');
  const [editableSteps, setEditableSteps] = useState<FlowStep[]>([]);
  const [jsonError, setJsonError] = useState('');
  const autoStartedRef = useRef(false);

  useEffect(() => {
    if (!sessionId && initialUrl) {
      setUrl(initialUrl);
    }
  }, [initialUrl, sessionId]);

  useEffect(() => {
    if (!autoStart) {
      autoStartedRef.current = false;
      return;
    }
    if (autoStartedRef.current || sessionId) {
      return;
    }
    autoStartedRef.current = true;
    void start();
  }, [autoStart, sessionId, url]);

  useEffect(() => {
    if (!sessionId) return undefined;
    const handle = window.setInterval(() => {
      void getRecordingSnapshotRequest(sessionId)
        .then((snapshot) => {
          setEditableSteps(snapshot.steps);
          setCode(snapshot.code);
          setMessage(`Đang ghi ${snapshot.eventCount} event và tạo ${snapshot.stepCount} step. URL hiện tại: ${snapshot.currentUrl || '-'}`);
        })
        .catch((error) => {
          setMessage(`Live recorder bị gián đoạn: ${error instanceof Error ? error.message : String(error)}`);
          setSessionId(null);
        });
    }, 800);
    return () => window.clearInterval(handle);
  }, [sessionId]);

  async function start() {
    setStatus({ text: 'Starting', tone: 'running' });
    try {
      const started = await startRecordingRequest(url);
      setSessionId(started.sessionId);
      setMessage(started.message);
      setCode('');
      setEditableSteps([]);
      setJsonError('');
      setResult(null);
      setStatus({ text: 'Recording', tone: 'running' });
    } catch (error) {
      setMessage(`Không thể bật recorder: ${error instanceof Error ? error.message : String(error)}`);
      setStatus({ text: 'Failed', tone: 'failed' });
    }
  }

  async function stop() {
    if (!sessionId) return;
    setStatus({ text: 'Stopping', tone: 'running' });
    try {
      const stopped = await stopRecordingRequest(sessionId);
      setResult(stopped);
      setEditableSteps(stopped.steps);
      setCode(stopped.code);
      setMessage(`Đã ghi ${stopped.eventCount} event và tạo ${stopped.stepCount} step.`);
      setSessionId(null);
      setStatus({ text: 'Recorded', tone: 'passed' });
    } catch (error) {
      setMessage(`Không thể dừng recorder: ${error instanceof Error ? error.message : String(error)}`);
      setStatus({ text: 'Failed', tone: 'failed' });
    }
  }

  async function saveAsProjectTestCase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!result || !onSaveAsProjectTestCase) return;

    const data = new FormData(event.currentTarget);
    setSavingTestCase(true);
    try {
      const recordingToSave = {
        ...result,
        steps: editableSteps,
        stepCount: editableSteps.length,
        code: JSON.stringify(editableSteps, null, 2),
      };
      await onSaveAsProjectTestCase(recordingToSave, {
        code: String(data.get('recordedCode') || '').trim(),
        name: String(data.get('recordedName') || '').trim(),
        description: String(data.get('recordedDescription') || '').trim(),
        type: 'recorded',
      });
      setMessage(`Đã lưu recording thành test case trong dự án ${projectName || ''}.`);
    } finally {
      setSavingTestCase(false);
    }
  }

  function recordedSteps(): FlowStep[] {
    if (editableSteps.length) return editableSteps;
    try {
      const parsed = JSON.parse(code) as FlowStep[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  function stepTargetText(step: FlowStep): string {
    return step.selector || step.url || step.value || '-';
  }

  function syncEditableSteps(nextSteps: FlowStep[]): void {
    setEditableSteps(nextSteps);
    setCode(JSON.stringify(nextSteps, null, 2));
    setJsonError('');
    setResult((current) => current ? { ...current, steps: nextSteps, stepCount: nextSteps.length, code: JSON.stringify(nextSteps, null, 2) } : current);
  }

  function updateStep(index: number, patch: Partial<FlowStep>): void {
    syncEditableSteps(editableSteps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step));
  }

  function updateStepTarget(index: number, value: string): void {
    const current = editableSteps[index];
    if (!current) return;
    updateStep(index, current.action === 'goto' ? { url: value, selector: undefined } : { selector: value, url: undefined });
  }

  function updateStepAction(index: number, action: string): void {
    const current = editableSteps[index];
    if (!current) return;
    const target = stepTargetText(current) === '-' ? '' : stepTargetText(current);
    updateStep(index, action === 'goto' ? { action, url: target, selector: undefined } : { action, selector: target, url: undefined });
  }

  function handleJsonChange(value: string): void {
    setCode(value);
    try {
      const parsed = JSON.parse(value) as FlowStep[];
      if (!Array.isArray(parsed)) {
        throw new Error('JSON phải là một mảng step.');
      }
      setEditableSteps(parsed);
      setJsonError('');
      setResult((current) => current ? { ...current, steps: parsed, stepCount: parsed.length, code: value } : current);
    } catch (error) {
      setJsonError(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <section className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-2xl shadow-blue-900/10 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-blue-700">Codegen Style</p>
          <h2 className="text-3xl font-black tracking-tight">Custom Recorder</h2>
        </div>
        <StatusPill tone={status.tone}>{status.text}</StatusPill>
      </div>
      <div className="mt-5 grid gap-4">
        <label className="grid gap-2">
          <span className="text-sm text-slate-600">Start URL</span>
          <input className="rounded-2xl border border-slate-200 px-4 py-3" value={url} onChange={(event) => setUrl(event.target.value)} />
        </label>
        <div className="flex flex-wrap gap-3">
          <button className="rounded-2xl bg-gradient-to-br from-blue-600 to-sky-400 px-5 py-3 font-bold text-white" disabled={!!sessionId} type="button" onClick={start}>
            Start Recording
          </button>
          <button className="rounded-2xl border border-slate-200 bg-white px-5 py-3 font-bold" disabled={!sessionId} type="button" onClick={stop}>
            Stop Recording
          </button>
        </div>
        <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-slate-500">{message}</div>
        <div className="rounded-3xl border border-slate-200 bg-white/75 p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="font-bold">Recorded Steps</h3>
            <div className="flex flex-wrap gap-2">
              {onSaveAsProjectTestCase ? (
                <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700">
                  Có thể lưu vào {projectName || 'project'}
                </span>
              ) : null}
              {onSaveAsProjectTestCase ? null : (
                <button className="rounded-2xl border border-slate-200 bg-white px-4 py-2 font-bold" disabled={!code.trim()} type="button" onClick={() => onUseRecordedSteps(code)}>
                  Use In Custom Flow
                </button>
              )}
            </div>
          </div>
          <div className="mt-4 flex w-fit rounded-2xl border border-slate-200 bg-white p-1">
            <button
              className={`rounded-xl px-4 py-2 text-sm font-bold ${stepsTab === 'steps' ? 'bg-blue-600 text-white' : 'text-slate-600'}`}
              type="button"
              onClick={() => setStepsTab('steps')}
            >
              Các bước
            </button>
            <button
              className={`rounded-xl px-4 py-2 text-sm font-bold ${stepsTab === 'json' ? 'bg-blue-600 text-white' : 'text-slate-600'}`}
              type="button"
              onClick={() => setStepsTab('json')}
            >
              JSON
            </button>
          </div>
          {stepsTab === 'steps' ? (
            <div className="mt-3 grid gap-3">
              {recordedSteps().length ? (
                recordedSteps().map((step, index) => (
                  <div className="rounded-2xl border border-slate-200 bg-white p-4" key={`${step.action}-${stepTargetText(step)}-${index}`}>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong>Step {index + 1}</strong>
                      <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-bold text-slate-600">{step.action}</span>
                    </div>
                    <div className="mt-3 grid gap-3 md:grid-cols-2">
                      <label className="grid gap-2">
                        <span className="text-sm text-slate-600">Action</span>
                        <select className="rounded-2xl border border-slate-200 px-4 py-3" value={step.action} onChange={(event) => updateStepAction(index, event.target.value)}>
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
                      <label className="grid gap-2">
                        <span className="text-sm text-slate-600">Target</span>
                        <input className="rounded-2xl border border-slate-200 px-4 py-3" value={stepTargetText(step) === '-' ? '' : stepTargetText(step)} onChange={(event) => updateStepTarget(index, event.target.value)} />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-sm text-slate-600">Value</span>
                        <input className="rounded-2xl border border-slate-200 px-4 py-3" value={step.value || ''} onChange={(event) => updateStep(index, { value: event.target.value })} />
                      </label>
                      <label className="grid gap-2">
                        <span className="text-sm text-slate-600">Mô tả</span>
                        <input className="rounded-2xl border border-slate-200 px-4 py-3" value={step.description || ''} onChange={(event) => updateStep(index, { description: event.target.value })} />
                      </label>
                      <button
                        className="w-fit rounded-2xl border border-red-200 bg-red-50 px-4 py-2 text-sm font-bold text-red-700"
                        type="button"
                        onClick={() => syncEditableSteps(editableSteps.filter((_, stepIndex) => stepIndex !== index))}
                      >
                        Xóa step
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-slate-500">Chưa có step nào được ghi nhận.</div>
              )}
            </div>
          ) : (
            <>
              <textarea className="mt-3 min-h-64 w-full rounded-2xl border border-slate-200 p-4 font-mono text-sm" value={code} onChange={(event) => handleJsonChange(event.target.value)}></textarea>
              {jsonError ? <div className="mt-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{jsonError}</div> : null}
            </>
          )}
        </div>
        {result && onSaveAsProjectTestCase ? (
          <form className="rounded-3xl border border-blue-100 bg-blue-50/70 p-5" onSubmit={(event) => void saveAsProjectTestCase(event)}>
            <h3 className="font-bold">Lưu recording thành test case</h3>
            <p className="mt-2 text-sm text-slate-600">
              Recording này sẽ được lưu vào project {projectName || 'đang chọn'} với {editableSteps.length} dataStep.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="grid gap-2">
                <span className="text-sm text-slate-600">Mã test case</span>
                <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue={`REC_${result.sessionId.slice(-6).toUpperCase()}`} name="recordedCode" required />
              </label>
              <label className="grid gap-2">
                <span className="text-sm text-slate-600">Tên test case</span>
                <input className="rounded-2xl border border-slate-200 bg-white px-4 py-3" defaultValue="Recorded flow" name="recordedName" required />
              </label>
              <label className="grid gap-2 md:col-span-2">
                <span className="text-sm text-slate-600">Mô tả</span>
                <textarea
                  className="min-h-24 rounded-2xl border border-slate-200 bg-white px-4 py-3"
                  defaultValue={`Recorded from ${url}${result.currentUrl ? `, ended at ${result.currentUrl}` : ''}`}
                  name="recordedDescription"
                />
              </label>
            </div>
            <button className="mt-4 rounded-2xl bg-blue-600 px-5 py-3 font-bold text-white" disabled={savingTestCase || !editableSteps.length || !!jsonError} type="submit">
              Lưu test case vào {projectName || 'project'}
            </button>
          </form>
        ) : null}
        {result?.artifacts.video ? (
          <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
            <h4 className="mb-3 font-bold">Recorder Video</h4>
            <video className="w-full rounded-2xl border border-slate-200" controls src={result.artifacts.video.url}></video>
          </div>
        ) : null}
      </div>
    </section>
  );
}
