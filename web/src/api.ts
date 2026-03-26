import type {
  Job,
  TestPlanRequest,
  TestPlanResponse,
  AzureSubscription,
  AzureResourceGroup,
  AzureCustomLocation,
  SavedPlan,
  ChatMessage,
  JobLogSummary,
  LogEntry,
  OperatorInfo,
} from './types';

const BASE = '/api/v1';

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string })?.error || `HTTP ${res.status}`);
  return data as T;
}

/* ─── Jobs ─────────────────────────────────────────────── */

export function listJobs(): Promise<Job[]> {
  return request<Job[]>(`${BASE}/jobs`);
}

export function getJob(id: string): Promise<Job> {
  return request<Job>(`${BASE}/jobs/${encodeURIComponent(id)}`);
}

export function cancelJob(id: string): Promise<unknown> {
  return request(`${BASE}/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}

export function submitProvisionJob(body: unknown): Promise<{ id: string }> {
  return request<{ id: string }>(`${BASE}/provision-jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/* ─── Test Plan ────────────────────────────────────────── */

export function generateTestPlan(req: TestPlanRequest): Promise<TestPlanResponse> {
  return request<TestPlanResponse>(`${BASE}/ai/test-plan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  });
}

/* ─── Azure Discovery ──────────────────────────────────── */

export function fetchSubscriptions(): Promise<AzureSubscription[]> {
  return request<AzureSubscription[]>(`${BASE}/azure/subscriptions`);
}

export function fetchResourceGroups(subscriptionId: string): Promise<AzureResourceGroup[]> {
  return request<AzureResourceGroup[]>(
    `${BASE}/azure/resource-groups?subscriptionId=${encodeURIComponent(subscriptionId)}`,
  );
}

export function fetchCustomLocations(
  subscriptionId: string,
  resourceGroup: string,
): Promise<AzureCustomLocation[]> {
  return request<AzureCustomLocation[]>(
    `${BASE}/azure/custom-locations?subscriptionId=${encodeURIComponent(subscriptionId)}&resourceGroup=${encodeURIComponent(resourceGroup)}`,
  );
}

/* ─── Saved Plans ──────────────────────────────────────── */

export function listPlans(): Promise<SavedPlan[]> {
  return request<SavedPlan[]>(`${BASE}/plans`);
}

export function getPlan(id: string): Promise<SavedPlan> {
  return request<SavedPlan>(`${BASE}/plans/${encodeURIComponent(id)}`);
}

export function savePlan(body: {
  name: string;
  strategy: string;
  model: string;
  cases: unknown[];
}): Promise<unknown> {
  return request(`${BASE}/plans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function deletePlan(id: string): Promise<unknown> {
  return request(`${BASE}/plans/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

/* ─── Chat ─────────────────────────────────────────────── */

export function sendChatMessage(
  messages: ChatMessage[],
): Promise<{ reply: string }> {
  return request<{ reply: string }>(`${BASE}/ai/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages }),
  });
}

/* ─── Operator Log Analysis ────────────────────────────── */

export function getJobLogSummary(jobId: string): Promise<JobLogSummary> {
  return request<JobLogSummary>(`${BASE}/jobs/${encodeURIComponent(jobId)}/logs`);
}

export function getOperatorLogs(
  jobId: string,
  operator: string,
  opts?: { level?: string; resource?: string },
): Promise<LogEntry[]> {
  const params = new URLSearchParams();
  if (opts?.level) params.set('level', opts.level);
  if (opts?.resource) params.set('resource', opts.resource);
  const qs = params.toString();
  return request<LogEntry[]>(
    `${BASE}/jobs/${encodeURIComponent(jobId)}/logs/${encodeURIComponent(operator)}${qs ? '?' + qs : ''}`,
  );
}

export function collectJobLogs(jobId: string): Promise<JobLogSummary> {
  return request<JobLogSummary>(`${BASE}/jobs/${encodeURIComponent(jobId)}/logs/collect`, {
    method: 'POST',
  });
}

export function listOperators(): Promise<OperatorInfo[]> {
  return request<OperatorInfo[]>(`${BASE}/operators`);
}

export function getOperatorsForResources(types: string[]): Promise<string[]> {
  return request<string[]>(`${BASE}/operators/for-resources?types=${encodeURIComponent(types.join(','))}`);
}
