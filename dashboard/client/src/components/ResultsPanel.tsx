import { useState } from 'react';
import { RunProgressState, RunResult } from '../types';
import { StatusPill } from './StatusPill';

type ResultsPanelProps = {
  result: RunResult | null;
  runningLabel?: string;
  progress?: RunProgressState | null;
};

export function ResultsPanel({ result, runningLabel, progress }: ResultsPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const videos = result?.artifacts?.videos?.length
    ? result.artifacts.videos
    : result?.artifacts?.video
      ? [result.artifacts.video]
      : [];
  const stepsForDataSet = (testDataSetId: number | null, label: string) => {
    if (!result) {
      return [];
    }

    const matchingSteps = result.steps.filter((step) => {
      if (step.testDataSetId !== testDataSetId) {
        return false;
      }

      return testDataSetId !== null || !label || step.dataSetLabel === label;
    });

    return matchingSteps.length || result.dataSets?.length !== 1 ? matchingSteps : result.steps;
  };

  return (
    <section className="rounded-[28px] border border-white/70 bg-white/90 p-6 shadow-2xl shadow-blue-900/10 backdrop-blur">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="mb-2 text-xs uppercase tracking-[0.18em] text-blue-700">Execution</p>
          <h2 className="text-3xl font-black tracking-tight">Latest Result</h2>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            className="rounded-2xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold text-slate-600"
            onClick={() => setExpanded((value) => !value)}
            type="button"
          >
            {expanded ? 'Thu gọn' : 'Mở rộng'}
          </button>
          <StatusPill tone={result ? result.status : runningLabel ? 'running' : undefined}>
            {result ? (result.status === 'passed' ? 'Passed' : 'Failed') : runningLabel || 'Waiting'}
          </StatusPill>
        </div>
      </div>

      {expanded ? (result ? (
        <>
          {progress?.running ? (
            <div className="mt-5 rounded-3xl border border-blue-200 bg-blue-50/80 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Running now</p>
                  <h3 className="mt-1 text-xl font-black text-slate-900">{progress.testCaseName || progress.flowName || 'Test case'}</h3>
                </div>
                <div className="rounded-full bg-blue-600 px-4 py-2 text-sm font-bold text-white">Loading</div>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-blue-100 bg-white/80 p-4">
                  <span className="text-sm text-slate-500">Test case set hiện tại</span>
                  <strong className="mt-2 block">
                    {progress.currentDataSetLabel || 'Đang chuẩn bị'}
                    {` (${progress.currentDataSetIndex}/${progress.totalDataSets})` }
                  </strong>
                </div>
                <div className="rounded-2xl border border-blue-100 bg-white/80 p-4">
                  <span className="text-sm text-slate-500">Step hiện tại</span>
                  <strong className="mt-2 block break-words">
                    {progress.currentStepName || 'Đang load steps'}
                    {progress.currentStepIndex && progress.totalSteps ? ` (${progress.currentStepIndex}/${progress.totalSteps})` : ''}
                  </strong>
                </div>
                <div className="rounded-2xl border border-blue-100 bg-white/80 p-4">
                  <span className="text-sm text-slate-500">Tiến độ</span>
                  <strong className="mt-2 block">{progress.completedSteps} step xong, {progress.failedSteps} lỗi</strong>
                </div>
              </div>
              {progress.currentStepName?.toLowerCase().includes('vnpay') ? (
                <div className="mt-4 rounded-2xl border border-amber-200 bg-amber-50/90 p-4 text-sm text-amber-900">
                  Đang ở bước thanh toán VNPAY sandbox. Hãy hoàn tất thanh toán thủ công trên browser đang mở; sau khi quay lại hệ thống, flow sẽ tự chạy tiếp và đánh giá điều kiện pass.
                </div>
              ) : null}
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-blue-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-blue-600 to-sky-400 transition-all"
                  style={{
                    width: progress.totalSteps && progress.currentStepIndex
                      ? `${Math.max(8, Math.min(100, (progress.currentStepIndex / progress.totalSteps) * 100))}%`
                      : '12%',
                  }}
                />
              </div>
            </div>
          ) : null}
          <div className="mt-5 grid gap-3 md:grid-cols-4">
            {[
              ['Status', result.status],
              ['Flow', result.flowName || '-'],
              ['Duration', `${result.durationMs} ms`],
              ['Current URL', result.currentUrl || '-'],
            ].map(([label, value]) => (
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-4" key={label}>
                <span className="text-sm text-slate-500">{label}</span>
                <strong className="mt-2 block break-words">{value}</strong>
              </div>
            ))}
          </div>
          <p className="mt-4 text-slate-600">
            Run ID: {result.runId}
            <br />
            {result.errorMessage ? `Error: ${result.errorMessage}` : 'Flow completed without runtime errors.'}
          </p>
          {result.dataSets?.length ? (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-white/80 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-700">Test Case Set Results</p>
                  <h4 className="mt-1 text-lg font-black text-slate-900">Kết quả theo từng test case set</h4>
                </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-sm font-semibold text-slate-600">
                  {result.dataSets.length} test case set
                </span>
              </div>
              <div className="mt-4 grid gap-4">
                {result.dataSets.map((dataSet, index) => {
                  const dataSetSteps = stepsForDataSet(dataSet.testDataSetId, dataSet.label);

                  return (
                    <div
                      className={`rounded-2xl border bg-white/90 p-4 ${
                        dataSet.status === 'passed'
                          ? 'border-l-4 border-l-emerald-600'
                          : 'border-l-4 border-l-rose-600'
                      }`}
                      key={`${dataSet.testDataSetId ?? 'run'}-${dataSet.label}-${index}`}
                    >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <strong className="block text-slate-900">
                          {dataSet.label}
                        </strong>
                        <p className="mt-1 text-sm text-slate-500">
                          Đã chạy {dataSet.executedStepCount}/{dataSet.stepCount} step trong {dataSet.durationMs} ms
                        </p>
                      </div>
                      <StatusPill tone={dataSet.status}>{dataSet.status === 'passed' ? 'Passed' : 'Failed'}</StatusPill>
                    </div>
                    {dataSet.failedStepCount ? (
                      <p className="mt-3 text-sm font-semibold text-rose-700">{dataSet.failedStepCount} step lỗi</p>
                    ) : (
                      <p className="mt-3 text-sm font-semibold text-emerald-700">Tất cả step đã pass</p>
                    )}
                    {dataSet.errorMessage ? <p className="mt-2 break-words text-sm text-rose-700">{dataSet.errorMessage}</p> : null}
                    <div className="mt-4 grid gap-2">
                      {dataSetSteps.length ? (
                        dataSetSteps.map((step, stepIndex) => (
                          <div
                            className={`rounded-xl border bg-slate-50/80 p-3 ${
                              step.status === 'passed' ? 'border-l-4 border-l-emerald-500' : 'border-l-4 border-l-rose-500'
                            }`}
                            key={`${dataSet.label}-${step.name}-${stepIndex}`}
                          >
                            <div className="flex flex-wrap items-start justify-between gap-2">
                              <strong className="break-words text-sm text-slate-900">{step.name}</strong>
                              <span className={step.status === 'passed' ? 'text-sm font-bold text-emerald-700' : 'text-sm font-bold text-rose-700'}>
                                {step.status}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-slate-500">{step.durationMs} ms</p>
                            {step.error ? <p className="mt-2 break-words text-sm text-rose-700">{step.error}</p> : null}
                          </div>
                        ))
                      ) : (
                        <div className="rounded-xl border border-dashed border-slate-300 p-3 text-sm text-slate-500">
                          Không có step nào được ghi nhận cho test case set này.
                        </div>
                      )}
                    </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}
          {!result.dataSets?.length ? (
            <div className="mt-5 grid gap-3">
              {result.steps.length ? (
                result.steps.map((step, index) => (
                  <div className={`rounded-2xl border bg-white/80 p-4 ${step.status === 'passed' ? 'border-l-4 border-l-emerald-600' : 'border-l-4 border-l-rose-600'}`} key={`${step.name}-${index}`}>
                    <strong>{step.name}</strong>
                    <p className="text-sm text-slate-500">{step.status} in {step.durationMs} ms</p>
                    {step.error ? <p className="mt-2 text-rose-700">{step.error}</p> : null}
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-300 p-4 text-slate-500">Không có step nào được ghi nhận.</div>
              )}
            </div>
          ) : null}
          <div className="mt-5 grid gap-4">
            {videos.length ? (
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                <h4 className="mb-3 font-bold">{videos.length > 1 ? 'Execution Videos' : 'Execution Video'}</h4>
                <div className="grid gap-4">
                  {videos.map((video, index) => (
                    <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-3" key={`${video.url}-${index}`}>
                      <p className="mb-2 text-sm font-semibold text-slate-700">
                        {video.label }
                      </p>
                      <video className="w-full rounded-2xl border border-slate-200" controls src={video.url}></video>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {result.artifacts?.screenshot ? (
              <div className="rounded-2xl border border-slate-200 bg-white/80 p-4">
                <h4 className="mb-3 font-bold">Failure Screenshot</h4>
                <img className="w-full rounded-2xl border border-slate-200" src={result.artifacts.screenshot.url} alt="Failure screenshot" />
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <div className="mt-5 rounded-2xl border border-dashed border-slate-300 p-4 text-slate-500">
          {progress?.running ? (
            <div>
              <strong className="text-slate-800">{progress.testCaseName || 'Test case'} đang chạy</strong>
              <p className="mt-2">
                Test case set: {progress.currentDataSetLabel || 'Đang chuẩn bị'}
                {progress.currentDataSetIndex && progress.totalDataSets ? ` (${progress.currentDataSetIndex}/${progress.totalDataSets})` : ''}
              </p>
              <p>
                Step: {progress.currentStepName || 'Đang load steps'}
                {progress.currentStepIndex && progress.totalSteps ? ` (${progress.currentStepIndex}/${progress.totalSteps})` : ''}
              </p>
            </div>
          ) : 'Chưa có lần chạy nào.'}
        </div>
      )) : (
        <div className="mt-4 text-sm text-slate-500">
          {result
            ? `Run ${result.runId} - ${result.status === 'passed' ? 'Passed' : 'Failed'}`
            : progress?.running
              ? `${progress.testCaseName || 'Test case'} đang chạy`
              : 'Chưa có lần chạy nào.'}
        </div>
      )}
    </section>
  );
}
