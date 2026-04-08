import { TemplateSummary } from '../types';
import { DASHBOARD_ENDPOINTS } from './endpoints';
import { getDashboardJson } from './httpService';

export async function getTemplates(): Promise<TemplateSummary[]> {
  const payload = await getDashboardJson<{ templates: TemplateSummary[] }>(DASHBOARD_ENDPOINTS.templates);
  return payload.templates || [];
}
