import { FormEvent, useState } from 'react';
import { RunResult } from '../types';
import { runCustomFlowRequest } from '../services/flowService';
import { StatusPill } from './StatusPill';

type CustomFlowViewProps = {
  initialSteps: string;
  onResult(result: RunResult): void;
  onRunning(): void;
};

const defaultSteps = JSON.stringify(
  [
    { action: 'goto', url: 'http://localhost:5173/signin', description: 'Open login page' },
    { action: 'fill', selector: 'input[placeholder="stuwme@gmail.com"]', value: 'admin@basico.local', description: 'Fill username' },
    { action: 'fill', selector: 'input[type="password"]', value: 'Admin@123', description: 'Fill password' },
    { action: 'click', selector: 'button:has-text("Đăng nhập")', description: 'Submit login form' },
    { action: 'assertVisible', selector: 'button:has-text("Đăng xuất")', description: 'Verify login success' },
  ],
  null,
  2
);

export function CustomFlowView({ initialSteps, onResult, onRunning }: CustomFlowViewProps) {
  const [flowName, setFlowName] = useState('Custom Flow');
  const [timeoutMs, setTimeoutMs] = useState(10000);
  const [steps, setSteps] = useState(initialSteps || defaultSteps);
  const [status, setStatus] = useState<{ text: string; tone?: 'running' | 'passed' | 'failed' }>({ text: 'Ready' });

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ text: 'Running', tone: 'running' });
    onRunning();
    try {
      const result = await runCustomFlowRequest({
        name: flowName,
        timeoutMs,
        steps: JSON.parse(steps) as unknown[],
      });
      onResult(result);
      setStatus({ text: result.status === 'passed' ? 'Passed' : 'Failed', tone: result.status });
    } catch {
      setStatus({ text: 'Failed', tone: 'failed' });
      throw new Error('Không thể chạy custom flow. Kiểm tra lại JSON steps.');
    }
  }

  return (
    <section className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-2xl shadow-blue-900/10 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-blue-700">Run Anything</p>
          <h2 className="text-3xl font-black tracking-tight">Custom Flow Runner</h2>
        </div>
        <StatusPill tone={status.tone}>{status.text}</StatusPill>
      </div>
      <form className="mt-5 grid gap-4" onSubmit={handleSubmit}>
        <label className="grid gap-2">
          <span className="text-sm text-slate-600">Flow Name</span>
          <input className="rounded-2xl border border-slate-200 px-4 py-3" value={flowName} onChange={(event) => setFlowName(event.target.value)} />
        </label>
        <label className="grid gap-2">
          <span className="text-sm text-slate-600">Timeout (ms)</span>
          <input className="rounded-2xl border border-slate-200 px-4 py-3" min={1000} step={500} type="number" value={timeoutMs} onChange={(event) => setTimeoutMs(Number(event.target.value))} />
        </label>
        <label className="grid gap-2">
          <span className="text-sm text-slate-600">Steps JSON</span>
          <textarea className="min-h-72 rounded-2xl border border-slate-200 p-4 font-mono text-sm" value={steps} onChange={(event) => setSteps(event.target.value)} />
        </label>
        <button className="w-fit rounded-2xl bg-gradient-to-br from-blue-600 to-sky-400 px-5 py-3 font-bold text-white" type="submit">
          Run Custom Flow
        </button>
      </form>
    </section>
  );
}
