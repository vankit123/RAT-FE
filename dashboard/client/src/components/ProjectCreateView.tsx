import { FormEvent, useState } from 'react';
import { ProjectRequest, StatusTone } from '../types';
import { StatusPill } from './StatusPill';

type ProjectCreateViewProps = {
  status: string;
  statusTone?: StatusTone;
  checkBaseUrl(url: string): Promise<{ ok: boolean; status?: number; error?: string }>;
  onCreate(payload: ProjectRequest): Promise<void>;
};

export function ProjectCreateView({ status, statusTone, checkBaseUrl, onCreate }: ProjectCreateViewProps) {
  const [submitting, setSubmitting] = useState(false);
  const [urlCheckMessage, setUrlCheckMessage] = useState('');
  const [urlCheckTone, setUrlCheckTone] = useState<'running' | 'passed' | 'failed' | undefined>();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const baseUrl = String(data.get('baseUrl') || '').trim();
    setSubmitting(true);
    setUrlCheckMessage('');
    setUrlCheckTone('running');
    try {
      const urlCheck = await checkBaseUrl(baseUrl);
      if (!urlCheck.ok) {
        setUrlCheckTone('failed');
        setUrlCheckMessage(`Không thể truy cập Base URL${urlCheck.status ? ` (HTTP ${urlCheck.status})` : ''}: ${urlCheck.error || 'Vui lòng kiểm tra lại URL.'}`);
        return;
      }

      setUrlCheckTone('passed');
      setUrlCheckMessage(baseUrl ? `Base URL truy cập được${urlCheck.status ? ` (HTTP ${urlCheck.status})` : ''}.` : '');
      await onCreate({
        code: String(data.get('code') || '').trim(),
        name: String(data.get('name') || '').trim(),
        baseUrl,
        description: String(data.get('description') || '').trim(),
        status: 'ACTIVE',
      });
      form.reset();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="overflow-hidden rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-2xl shadow-blue-900/10 backdrop-blur">
      <div className="grid gap-8 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-blue-700">Start Here</p>
          <h2 className="max-w-md text-4xl font-black tracking-tight text-slate-900">Tạo dự án đầu tiên để bắt đầu automation</h2>
          <p className="mt-4 text-slate-600">
            RAT-FE xử lý giao diện và Playwright. Dự án và test case được lưu tại RAT-BE thông qua API.
          </p>

          <form className="mt-6 grid gap-4 rounded-3xl border border-slate-200 bg-white/75 p-5 sm:grid-cols-2" onSubmit={handleSubmit}>
            <label className="grid gap-2">
              <span className="text-sm text-slate-600">Mã dự án</span>
              <input className="rounded-2xl border border-slate-200 px-4 py-3" name="code" placeholder="VD: basico-web" required />
            </label>
            <label className="grid gap-2">
              <span className="text-sm text-slate-600">Tên dự án</span>
              <input className="rounded-2xl border border-slate-200 px-4 py-3" name="name" placeholder="VD: Basico Web" required />
            </label>
            <label className="grid gap-2 sm:col-span-2">
              <span className="text-sm text-slate-600">Base URL</span>
              <input className="rounded-2xl border border-slate-200 px-4 py-3" name="baseUrl" placeholder="http://localhost:5173" />
              {urlCheckMessage ? (
                <span className={`text-sm font-semibold ${urlCheckTone === 'failed' ? 'text-red-700' : urlCheckTone === 'passed' ? 'text-emerald-700' : 'text-blue-700'}`}>
                  {urlCheckMessage}
                </span>
              ) : null}
            </label>
            <label className="grid gap-2 sm:col-span-2">
              <span className="text-sm text-slate-600">Mô tả</span>
              <textarea className="min-h-28 rounded-2xl border border-slate-200 px-4 py-3" name="description" placeholder="Ghi chú ngắn về dự án" />
            </label>
            <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
              <button className="rounded-2xl bg-gradient-to-br from-blue-600 to-sky-400 px-5 py-3 font-bold text-white shadow-lg shadow-blue-700/20" disabled={submitting} type="submit">
                Tạo dự án
              </button>
              <StatusPill tone={statusTone}>{status}</StatusPill>
            </div>
          </form>
        </div>

        <div className="grid gap-4">
          {[
            ['Storage', 'Project được lưu tại RAT-BE'],
            ['Sidebar', 'Danh sách dự án cập nhật sau khi tạo'],
            ['Execution', 'Playwright runner vẫn nằm ở RAT-FE'],
          ].map(([label, text]) => (
            <div className="rounded-3xl bg-gradient-to-br from-slate-800 to-blue-700 p-6 text-white shadow-xl" key={label}>
              <p className="text-white/70">{label}</p>
              <strong className="block max-w-xs text-xl">{text}</strong>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
