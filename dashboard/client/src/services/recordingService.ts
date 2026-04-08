import { RecordingLiveResult, RecordingStartResult, RecordingStopResult } from '../types';
import { DASHBOARD_ENDPOINTS } from './endpoints';
import { getDashboardJson, postDashboardJson } from './httpService';

export function startRecordingRequest(url: string): Promise<RecordingStartResult> {
  return postDashboardJson<RecordingStartResult>(DASHBOARD_ENDPOINTS.recordings.start, { url });
}

export function stopRecordingRequest(sessionId: string): Promise<RecordingStopResult> {
  return postDashboardJson<RecordingStopResult>(DASHBOARD_ENDPOINTS.recordings.stop, { sessionId });
}

export function getRecordingSnapshotRequest(sessionId: string): Promise<RecordingLiveResult> {
  return getDashboardJson<RecordingLiveResult>(DASHBOARD_ENDPOINTS.recordings.byId(sessionId));
}
