import { create } from 'zustand';
import type { TestCase, Job, ChatMessage, RunRequest } from './types';
import { resourceMeta, RESOURCE_TABS } from './resourceMeta';

/* ─── Planner Store ────────────────────────────────────── */

interface BaseEnvelope {
  subscriptionId: string;
  resourceGroup: string;
  location: string;
  customLocationId: string;
}

export interface PlannerState {
  /* Generation */
  prompt: string;
  caseCount: number;
  selectedResourceTypes: Set<string>;
  allCases: TestCase[];
  currentPage: number;
  model: string;
  /* Acceptance */
  acceptedCommands: Map<string, string>;
  initialCommands: Map<string, string>;
  /* Execution */
  runningJobs: Map<string, string | null>;
  completedJobData: Map<string, { jobId: string; job: Job }>;
  caseStatuses: Map<string, { text: string; tone: 'neutral' | 'error' | 'success' }>;
  bulkRunMode: 'parallel' | 'sequential';
  /* Azure target */
  baseEnvelope: BaseEnvelope;
  /* Uploaded Files */
  uploadedFiles: { name: string; size: number; content: string }[];
  /* Status */
  status: string;
  statusTone: 'neutral' | 'error' | 'success';
  generating: boolean;
}

export interface PlannerActions {
  setPrompt(s: string): void;
  setCaseCount(n: number): void;
  toggleResourceType(tab: string): void;
  selectAllResourceTypes(): void;
  setAllCases(cases: TestCase[]): void;
  setCurrentPage(n: number): void;
  setModel(m: string): void;
  acceptCase(caseId: string, value: string): void;
  clearAcceptance(caseId: string): void;
  clearAllAcceptance(): void;
  acceptAll(): void;
  setInitialCommand(caseId: string, value: string): void;
  setRunningJob(caseId: string, jobId: string | null): void;
  clearRunningJob(caseId: string): void;
  setCompletedJob(caseId: string, jobId: string, job: Job): void;
  setCaseStatus(caseId: string, text: string, tone?: 'neutral' | 'error' | 'success'): void;
  clearCaseStatus(caseId: string): void;
  clearAllCaseStatuses(): void;
  setBulkRunMode(m: 'parallel' | 'sequential'): void;
  setBaseEnvelope(partial: Partial<BaseEnvelope>): void;
  addFile(f: { name: string; size: number; content: string }): void;
  removeFile(idx: number): void;
  setStatus(text: string, tone?: 'neutral' | 'error' | 'success'): void;
  setGenerating(v: boolean): void;
}

export const usePlannerStore = create<PlannerState & PlannerActions>((set, get) => ({
  prompt: 'I want to test admission failures, overlap behavior, immutability, and cleanup safety with operator-ready CLI flows',
  caseCount: 8,
  selectedResourceTypes: new Set<string>(),
  allCases: [],
  currentPage: 1,
  model: '',
  acceptedCommands: new Map(),
  initialCommands: new Map(),
  runningJobs: new Map(),
  completedJobData: new Map(),
  caseStatuses: new Map(),
  bulkRunMode: 'parallel',
  baseEnvelope: {
    subscriptionId: '',
    resourceGroup: '',
    location: '',
    customLocationId: '',
  },
  uploadedFiles: [],
  status: 'Planner ready. Describe the behavior you want to pressure-test.',
  statusTone: 'success',
  generating: false,

  setPrompt: (s) => set({ prompt: s }),
  setCaseCount: (n) => set({ caseCount: n }),
  toggleResourceType: (tab) => set((s) => {
    const next = new Set(s.selectedResourceTypes);
    if (tab === 'e2e') return { selectedResourceTypes: new Set(['e2e']) };
    next.delete('e2e');
    if (next.has(tab)) next.delete(tab); else next.add(tab);
    const individual = RESOURCE_TABS.filter(t => t !== 'e2e');
    if (individual.every(t => next.has(t))) return { selectedResourceTypes: new Set(['e2e']) };
    return { selectedResourceTypes: next };
  }),
  selectAllResourceTypes: () => set({ selectedResourceTypes: new Set(['e2e']) }),
  setAllCases: (cases) => set({ allCases: cases, currentPage: 1 }),
  setCurrentPage: (n) => set({ currentPage: n }),
  setModel: (m) => set({ model: m }),
  acceptCase: (caseId, value) => set((s) => { const m = new Map(s.acceptedCommands); m.set(caseId, value); return { acceptedCommands: m }; }),
  clearAcceptance: (caseId) => set((s) => { const m = new Map(s.acceptedCommands); m.delete(caseId); return { acceptedCommands: m }; }),
  clearAllAcceptance: () => set({ acceptedCommands: new Map() }),
  acceptAll: () =>
    set((s) => {
      const m = new Map(s.acceptedCommands);
      s.allCases.forEach((tc, i) => {
        const caseId = tc.caseId || `case-${i + 1}`;
        if (!m.has(caseId)) m.set(caseId, s.initialCommands.get(caseId) || '');
      });
      return { acceptedCommands: m };
    }),
  setInitialCommand: (caseId, value) => set((s) => { const m = new Map(s.initialCommands); m.set(caseId, value); return { initialCommands: m }; }),
  setRunningJob: (caseId, jobId) => set((s) => { const m = new Map(s.runningJobs); m.set(caseId, jobId); return { runningJobs: m }; }),
  clearRunningJob: (caseId) => set((s) => { const m = new Map(s.runningJobs); m.delete(caseId); return { runningJobs: m }; }),
  setCompletedJob: (caseId, jobId, job) => set((s) => { const m = new Map(s.completedJobData); m.set(caseId, { jobId, job }); return { completedJobData: m }; }),
  setCaseStatus: (caseId, text, tone = 'neutral') => set((s) => {
    const m = new Map(s.caseStatuses);
    m.set(caseId, { text, tone });
    return { caseStatuses: m };
  }),
  clearCaseStatus: (caseId) => set((s) => {
    const m = new Map(s.caseStatuses);
    m.delete(caseId);
    return { caseStatuses: m };
  }),
  clearAllCaseStatuses: () => set({ caseStatuses: new Map() }),
  setBulkRunMode: (m) => set({ bulkRunMode: m }),
  setBaseEnvelope: (partial) => set((s) => ({ baseEnvelope: { ...s.baseEnvelope, ...partial } })),
  addFile: (f) =>
    set((s) => {
      if (s.uploadedFiles.length >= 10) return s;
      if (s.uploadedFiles.some((x) => x.name === f.name)) return s;
      return { uploadedFiles: [...s.uploadedFiles, f] };
    }),
  removeFile: (idx) => set((s) => ({ uploadedFiles: s.uploadedFiles.filter((_, i) => i !== idx) })),
  setStatus: (text, tone = 'neutral') => set({ status: text, statusTone: tone }),
  setGenerating: (v) => set({ generating: v }),
}));

export function buildDefaultBaseline(state: PlannerState): Record<string, unknown> {
  const types = state.selectedResourceTypes;
  if (types.has('e2e')) {
    const meta = resourceMeta['e2e'];
    return { ...state.baseEnvelope, resources: meta.resources };
  }
  const resources: Record<string, unknown> = {};
  for (const t of types) {
    const meta = resourceMeta[t];
    if (meta.resources) Object.assign(resources, meta.resources);
    else if (meta.key) resources[meta.key] = meta.baseline;
  }
  return { ...state.baseEnvelope, resources };
}

export function buildDefaultLayers(state: PlannerState): Record<string, unknown> {
  const types = state.selectedResourceTypes;
  if (types.has('e2e')) return { azureDocs: [{ url: resourceMeta['e2e'].docsUrl }] };
  const docs = [...types].map(t => ({ url: resourceMeta[t].docsUrl }));
  return { azureDocs: docs };
}

/* ─── Runs Store ───────────────────────────────────────── */

export interface RunsState {
  jobs: Job[];
  selectedJobId: string | null;
  selectedJob: Job | null;
  chatHistoryMap: Map<string, ChatMessage[]>;
}

export interface RunsActions {
  setJobs(jobs: Job[]): void;
  selectJob(jobId: string, job: Job): void;
  updateSelectedJob(job: Job): void;
  pushChatMessage(jobId: string, msg: ChatMessage): void;
  getChatHistory(jobId: string): ChatMessage[];
}

export const useRunsStore = create<RunsState & RunsActions>((set, get) => ({
  jobs: [],
  selectedJobId: null,
  selectedJob: null,
  chatHistoryMap: new Map(),

  setJobs: (jobs) => set({ jobs }),
  selectJob: (jobId, job) => set({ selectedJobId: jobId, selectedJob: job }),
  updateSelectedJob: (job) => set({ selectedJob: job }),
  pushChatMessage: (jobId, msg) =>
    set((s) => {
      const m = new Map(s.chatHistoryMap);
      const arr = [...(m.get(jobId) || []), msg];
      m.set(jobId, arr);
      return { chatHistoryMap: m };
    }),
  getChatHistory: (jobId) => get().chatHistoryMap.get(jobId) || [],
}));
