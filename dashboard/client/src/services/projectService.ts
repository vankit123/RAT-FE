import { Project, ProjectRequest } from '../types';
import { BACKEND_ENDPOINTS, DASHBOARD_ENDPOINTS } from './endpoints';
import { getBackendJson, postBackendJson, postDashboardJson, putBackendJson } from './httpService';

export function getProjects(): Promise<Project[]> {
  return getBackendJson<Project[]>(BACKEND_ENDPOINTS.projects);
}

export function createProject(payload: ProjectRequest): Promise<Project> {
  return postBackendJson<Project>(BACKEND_ENDPOINTS.projects, payload);
}

export function updateProject(projectId: number, payload: ProjectRequest): Promise<Project> {
  return putBackendJson<Project>(`${BACKEND_ENDPOINTS.projects}/${projectId}`, payload);
}

export function checkProjectBaseUrl(url: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  return postDashboardJson<{ ok: boolean; status?: number; error?: string }>(DASHBOARD_ENDPOINTS.checkUrl, { url });
}
