import { StatusTone } from '../types';

type StatusPillProps = {
  children: string;
  tone?: StatusTone;
};

const toneClassName: Record<StatusTone, string> = {
  running: 'bg-amber-100 text-amber-800 border-amber-200',
  passed: 'bg-emerald-100 text-emerald-800 border-emerald-200',
  failed: 'bg-rose-100 text-rose-800 border-rose-200',
};

export function StatusPill({ children, tone }: StatusPillProps) {
  return (
    <div className={`rounded-full border px-4 py-2 text-sm ${tone ? toneClassName[tone] : 'border-slate-200 bg-white text-slate-500'}`}>
      {children}
    </div>
  );
}
