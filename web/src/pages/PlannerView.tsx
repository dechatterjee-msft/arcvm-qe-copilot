import { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight, Plus } from 'lucide-react';
import { usePlannerStore, buildDefaultBaseline, buildDefaultLayers } from '../store';
import { resourceMeta, RESOURCE_TABS } from '../resourceMeta';
import * as api from '../api';
import { buildRelevantAzCliCommands, extractResourcePills } from '../cliBuilder';
import FlightRecorder from '../components/FlightRecorder';
import type { TestCase, Job, RunRequest } from '../types';

const PAGE_SIZE = 4;
const MAX_FILE_SIZE = 512 * 1024;
const MAX_FILES = 10;
const DEFAULT_PLANNER_META = {
  label: 'Select resource coverage',
  placeholder: 'Describe the Azure Local scenario, failure modes, constraints, and success criteria you want the planner to cover. Then choose the resource types you want included.',
  quickPrompts: [
    {
      label: 'Admission',
      desc: 'Validate input rejection, required fields, and clear error messaging.',
      prompt: 'I want to test admission failures, invalid required fields, and operator-facing rejection messages across the selected Azure Local resources',
    },
    {
      label: 'Lifecycle',
      desc: 'Create, inspect, repeat, and clean up safely.',
      prompt: 'I want to test resource lifecycle including creation, verification, repeated runs, and cleanup safety under partial failure',
    },
    {
      label: 'Dependencies',
      desc: 'Cross-resource order, references, and protection checks.',
      prompt: 'I want to test cross-resource dependency handling, invalid references, ordering constraints, and cleanup behavior',
    },
  ],
} as const;

/* ─── Clipboard helper ─────────────────────────────────── */
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/* ─── Azure Picker Item ────────────────────────────────── */
interface PickerItem { value: string; label: string; sub?: string; location?: string }
interface UploadedFile { name: string; size: number; content: string }
interface PlannerChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
}
interface PlannerConversationThread {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: PlannerChatMessage[];
  snapshot: {
    prompt: string;
    caseCount: number;
    selectedResourceTypes: string[];
    uploadedFiles: UploadedFile[];
    allCases: TestCase[];
    model: string;
  };
}

const PLANNER_CONVERSATIONS_KEY = 'planner_conversations_v1';
const PLANNER_ACTIVE_CONVERSATION_KEY = 'planner_active_conversation_v1';

function makeId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `planner-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildConversationTitle(prompt: string, messages: PlannerChatMessage[]) {
  const firstUserMessage = messages.find(message => message.role === 'user')?.content.trim();
  const source = firstUserMessage || prompt.trim();
  if (!source) return 'New planner chat';
  return source.length > 48 ? `${source.slice(0, 48).trim()}...` : source;
}

function buildConversationPreview(thread: PlannerConversationThread) {
  const latestMessage = [...thread.messages]
    .reverse()
    .find(message => message.role === 'user' || message.role === 'assistant')?.content.trim();
  const source = latestMessage || thread.snapshot.prompt.trim();
  if (!source) return 'Start a new planner conversation';
  return source.length > 92 ? `${source.slice(0, 92).trim()}...` : source;
}

function createPlannerThread(): PlannerConversationThread {
  const now = new Date().toISOString();
  return {
    id: makeId(),
    title: 'New planner chat',
    createdAt: now,
    updatedAt: now,
    messages: [],
    snapshot: {
      prompt: '',
      caseCount: 8,
      selectedResourceTypes: [],
      uploadedFiles: [],
      allCases: [],
      model: '',
    },
  };
}

/* ─── Component ────────────────────────────────────────── */
export default function PlannerView() {
  const store = usePlannerStore();

  // Local UI state
  const [genInfo, setGenInfo] = useState<string[]>([]);
  const [elapsed, setElapsed] = useState('');
  const [refineTarget, setRefineTarget] = useState<string | null>(null);
  const [saveModalOpen, setSaveModalOpen] = useState(false);
  const [planName, setPlanName] = useState('');
  const [savedPlans, setSavedPlans] = useState<{ id: string; name: string; caseCount?: number; model?: string; createdAt?: string }[]>([]);
  const [bulkRunStatus, setBulkRunStatus] = useState('');
  const [bulkRunTone, setBulkRunTone] = useState<'running' | 'done' | ''>('');
  const [bulkRunBusy, setBulkRunBusy] = useState(false);
  const [validationError, setValidationError] = useState('');
  const [plannerThreads, setPlannerThreads] = useState<PlannerConversationThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState('');
  const [chatMessages, setChatMessages] = useState<PlannerChatMessage[]>([]);

  // Azure pickers
  const [subItems, setSubItems] = useState<PickerItem[]>([]);
  const [rgItems, setRgItems] = useState<PickerItem[]>([]);
  const [clItems, setClItems] = useState<PickerItem[]>([]);
  const [subOpen, setSubOpen] = useState(false);
  const [rgOpen, setRgOpen] = useState(false);
  const [clOpen, setClOpen] = useState(false);
  const [subSearch, setSubSearch] = useState('');
  const [rgSearch, setRgSearch] = useState('');
  const [clSearch, setClSearch] = useState('');
  const [subLabel, setSubLabel] = useState('Select subscription');
  const [rgLabel, setRgLabel] = useState('Select resource group');
  const [clLabel, setClLabel] = useState('Select custom location');
  const [subLoading, setSubLoading] = useState(false);
  const [rgDisabled, setRgDisabled] = useState(true);
  const [clDisabled, setClDisabled] = useState(true);

  // Refs for running jobs polling
  const pollIntervals = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const threadInitRef = useRef(false);

  // Load subscriptions on mount
  useEffect(() => {
    setSubLoading(true);
    api.fetchSubscriptions().then(subs => {
      const items = subs.filter(s => s.state === 'Enabled').map(s => ({ value: s.id, label: s.name, sub: s.id }));
      setSubItems(items);
      setSubLabel(items.length > 0 ? `Select subscription (${items.length})` : 'No subscriptions — type to enter');
    }).catch(() => setSubLabel('Could not load — click to enter')).finally(() => setSubLoading(false));
    refreshSavedPlans();
  }, []);

  // Keyboard shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); generate(); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  // On mount: resume polling for any jobs still marked as running (e.g. after tab switch)
  // On unmount: cleanup poll intervals
  useEffect(() => {
    const { runningJobs } = store;
    runningJobs.forEach((jobId, caseId) => {
      if (jobId && !pollIntervals.current.has(caseId)) {
        startPolling(caseId, jobId);
      } else if (!jobId) {
        // No job ID means submission was in-flight when we navigated away; clear stale entry
        store.clearRunningJob(caseId);
      }
    });
    return () => {
      pollIntervals.current.forEach(iv => clearInterval(iv));
      pollIntervals.current.clear();
    };
  }, []);

  /* ─── Azure Picker Helpers ───────────────────────────── */
  function selectSub(item: PickerItem) {
    setValidationError('');
    setSubLabel(item.label); setSubOpen(false);
    store.setBaseEnvelope({ subscriptionId: item.value, resourceGroup: '', customLocationId: '', location: item.location || '' });
    setRgItems([]); setRgLabel('Loading...'); setRgDisabled(false);
    setClItems([]); setClLabel('Select custom location'); setClDisabled(true);
    api.fetchResourceGroups(item.value).then(rgs => {
      const items = rgs.map(g => ({ value: g.name, label: g.name, sub: g.location, location: g.location }));
      setRgItems(items); setRgLabel(items.length > 0 ? `Select resource group (${items.length})` : 'No resource groups');
    }).catch(() => setRgLabel('Could not load'));
  }

  function selectRg(item: PickerItem) {
    setValidationError('');
    setRgLabel(item.label); setRgOpen(false);
    store.setBaseEnvelope({ resourceGroup: item.value, location: item.location || store.baseEnvelope.location, customLocationId: '' });
    setClItems([]); setClLabel('Loading...'); setClDisabled(false);
    api.fetchCustomLocations(store.baseEnvelope.subscriptionId, item.value).then(cls => {
      const items = cls.map(c => ({ value: c.id, label: c.name, sub: c.location, location: c.location }));
      setClItems(items); setClLabel(items.length > 0 ? `Select custom location (${items.length})` : 'No custom locations');
    }).catch(() => setClLabel('Could not load'));
  }

  function selectCl(item: PickerItem) {
    setValidationError('');
    setClLabel(item.label); setClOpen(false);
    store.setBaseEnvelope({ customLocationId: item.value, location: item.location || store.baseEnvelope.location });
  }

  function renderPicker(label: string, items: PickerItem[], triggerLabel: string, open: boolean, setOpen: (v: boolean) => void, search: string, setSearch: (v: string) => void, onSelect: (item: PickerItem) => void, disabled: boolean, loading: boolean) {
    const filtered = items.filter(i => !search || (i.label + ' ' + (i.sub || '')).toLowerCase().includes(search.toLowerCase()));
    return (
      <div className="az-picker">
        <div className="az-picker-label">{label}</div>
        <button type="button" className={`az-picker-trigger${open ? ' open' : ''}`} disabled={disabled || loading} onClick={() => !disabled && setOpen(!open)}>
          <span className={items.length === 0 && !loading ? 'placeholder' : ''}>{loading ? 'Loading...' : triggerLabel}</span>
          <ChevronDown className="chevron" size={14} />
        </button>
        {open && (
          <div className="az-dropdown visible">
            <input className="az-dropdown-search" type="text" placeholder={`Search ${label.toLowerCase()}...`} value={search} onChange={e => setSearch(e.target.value)} autoFocus />
            <div className="az-dropdown-list">
              {filtered.length === 0 && <div className="az-dropdown-empty">{search ? 'No matches' : 'No items'}</div>}
              {filtered.map(item => (
                <div key={item.value} className="az-dropdown-item" onClick={() => { onSelect(item); setSearch(''); }}>
                  <span>{item.label}</span>
                  {item.sub && <span className="item-sub">{item.sub}</span>}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ─── Azure Target Validation ────────────────────────── */
  function validateAzureTarget(): boolean {
    const { subscriptionId, resourceGroup, customLocationId } = store.baseEnvelope;
    const missing: string[] = [];
    if (!subscriptionId) missing.push('Subscription');
    if (!resourceGroup) missing.push('Resource Group');
    if (!customLocationId) missing.push('Custom Location');
    if (missing.length > 0) {
      setValidationError(`Please select ${missing.join(', ')} before proceeding.`);
      return false;
    }
    setValidationError('');
    return true;
  }

  /* ─── Generate ───────────────────────────────────────── */
  async function generate() {
    if (!validateAzureTarget()) return;
    const prompt = store.prompt.trim();
    if (!prompt) { store.setStatus('Add a prompt so the planner knows what to target.', 'error'); return; }
    const userMessage: PlannerChatMessage = {
      id: makeId(),
      role: 'user',
      content: prompt,
      createdAt: new Date().toISOString(),
    };
    setChatMessages(prev => [...prev, userMessage]);

    const isRefine = refineTarget !== null;
    const refineCaseId = refineTarget;
    setRefineTarget(null);

    const caseCount = Math.max(1, Math.min(50, store.caseCount));
    const startedAt = Date.now();

    const storeState = usePlannerStore.getState();
    const payload = {
      baseline: buildDefaultBaseline(storeState),
      caseCount: isRefine ? 1 : caseCount,
      strategy: prompt,
      ensembleEnabled: false,
      layers: buildDefaultLayers(storeState),
      retrieval: { query: prompt, topK: Math.max(12, caseCount * 2), useEmbeddings: true, lexical: 'bm25' },
      fileContext: storeState.uploadedFiles.map(f => ({ fileName: f.name, content: f.content })),
    };

    store.setGenerating(true);
    store.setStatus('Generating test cases...');
    setGenInfo([]);

    try {
      const data = await api.generateTestPlan(payload);
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      setElapsed(elapsedSec);
      store.setModel(data.model || '');

      if (isRefine && refineCaseId && data.cases?.length) {
        const replacement = data.cases[0];
        const idx = store.allCases.findIndex((tc, i) => (tc.caseId || `case-${i + 1}`) === refineCaseId);
        if (idx >= 0) {
          replacement.caseId = refineCaseId;
          const updated = [...store.allCases];
          updated[idx] = replacement;
          store.setAllCases(updated);
          const cmds = buildRelevantAzCliCommands(replacement.runRequest || {}).join('\n');
          store.setInitialCommand(refineCaseId, cmds);
          store.clearAcceptance(refineCaseId);
          store.setStatus(`Refined ${refineCaseId} in ${elapsedSec}s.`, 'success');
          setChatMessages(prev => [...prev, {
            id: makeId(),
            role: 'assistant',
            content: `Refined ${refineCaseId} in ${elapsedSec}s.\n\n${replacement.objective || replacement.expectedOutcome || 'Updated the draft case.'}`,
            createdAt: new Date().toISOString(),
          }]);
        }
      } else {
        const newCases = data.cases || [];
        // Re-number new cases to avoid ID collisions with existing ones
        const existingIds = new Set(store.allCases.map((tc, i) => tc.caseId || `case-${i + 1}`));
        let nextNum = store.allCases.length + 1;
        newCases.forEach(tc => {
          while (existingIds.has(`case-${nextNum}`)) nextNum++;
          tc.caseId = tc.caseId && !existingIds.has(tc.caseId) ? tc.caseId : `case-${nextNum}`;
          existingIds.add(tc.caseId);
          nextNum++;
        });
        // Prepend new cases before existing ones
        const merged = [...newCases, ...store.allCases];
        store.setAllCases(merged);
        // Build initial commands for the new cases only
        newCases.forEach(tc => {
          const caseId = tc.caseId!;
          store.setInitialCommand(caseId, buildRelevantAzCliCommands(tc.runRequest || {}).join('\n'));
        });
        setGenInfo([data.model || '', `+${newCases.length} cases (${merged.length} total)`, `${elapsedSec}s`].filter(Boolean));
        store.setStatus(`Generated ${newCases.length} new test cases in ${elapsedSec}s (${merged.length} total).`, 'success');
        const previewLines = newCases.slice(0, 3).map(tc => `- ${tc.caseId}: ${tc.objective || tc.expectedOutcome || 'Draft case ready for review.'}`);
        setChatMessages(prev => [...prev, {
          id: makeId(),
          role: 'assistant',
          content: `Generated ${newCases.length} test case${newCases.length === 1 ? '' : 's'} in ${elapsedSec}s.${previewLines.length > 0 ? `\n\n${previewLines.join('\n')}` : ''}`,
          createdAt: new Date().toISOString(),
        }]);
      }
    } catch (err: unknown) {
      const errorText = (err as Error)?.message || 'Request failed';
      store.setStatus(errorText, 'error');
      setChatMessages(prev => [...prev, {
        id: makeId(),
        role: 'assistant',
        content: `Error: ${errorText}`,
        createdAt: new Date().toISOString(),
      }]);
    } finally {
      store.setGenerating(false);
    }
  }

  /* ─── Run Test Case ──────────────────────────────────── */
  async function runTestCase(caseId: string, runRequest: RunRequest) {
    if (store.runningJobs.has(caseId)) return;
    if (!validateAzureTarget()) return;

    const rr = { ...runRequest, caseId, description: runRequest.description || store.allCases.find(c => c.caseId === caseId)?.objective || '' };
    store.clearCaseStatus(caseId);
    store.setRunningJob(caseId, null);

    try {
      const { id: jobId } = await api.submitProvisionJob(rr);
      store.setRunningJob(caseId, jobId);
      startPolling(caseId, jobId);
    } catch (err: unknown) {
      store.clearRunningJob(caseId);
      store.setCaseStatus(caseId, `Run failed: ${(err as Error)?.message || 'Unknown'}`, 'error');
    }
  }

  function startPolling(caseId: string, jobId: string) {
    const iv = setInterval(async () => {
      try {
        const job = await api.getJob(jobId);
        const st = (job.status || '').toLowerCase();
        if (st === 'succeeded' || st === 'completed') {
          clearInterval(iv); pollIntervals.current.delete(caseId);
          store.clearRunningJob(caseId);
          store.clearCaseStatus(caseId);
          store.setCompletedJob(caseId, jobId, job);
        } else if (st === 'cancelled') {
          clearInterval(iv); pollIntervals.current.delete(caseId);
          store.clearRunningJob(caseId);
          store.clearCaseStatus(caseId);
          store.setCompletedJob(caseId, jobId, job);
        } else if (st === 'failed' || st === 'error') {
          clearInterval(iv); pollIntervals.current.delete(caseId);
          store.clearRunningJob(caseId);
          store.clearCaseStatus(caseId);
          store.setCompletedJob(caseId, jobId, job);
        } else {
          // Still running – update completed data so FR re-renders with live progress
          store.setCompletedJob(caseId, jobId, job);
        }
      } catch { /* transient */ }
    }, 800);
    pollIntervals.current.set(caseId, iv);
  }

  /* ─── Bulk Run ───────────────────────────────────────── */
  async function bulkRunAll() {
    if (store.allCases.length === 0) return;
    setBulkRunBusy(true);
    const total = store.allCases.length;
    let succeeded = 0, failed = 0;
    const startedAt = Date.now();

    const entries = store.allCases.map((tc, i) => {
      const caseId = tc.caseId || `case-${i + 1}`;
      const rr: RunRequest = { ...tc.runRequest, caseId, description: tc.objective || tc.mutation || '' };
      return { caseId, rr };
    });

    const update = () => {
      const el = ((Date.now() - startedAt) / 1000).toFixed(0);
      setBulkRunStatus(`${succeeded + failed}/${total} done (${succeeded} ok, ${failed} err) — ${el}s`);
      setBulkRunTone('running');
    };
    update();

    const runOne = async (caseId: string, rr: RunRequest) => {
      try {
        store.setRunningJob(caseId, null);
        const { id: jobId } = await api.submitProvisionJob(rr);
        store.setRunningJob(caseId, jobId);
        const job = await waitForJob(jobId);
        store.clearRunningJob(caseId);
        store.setCompletedJob(caseId, jobId, job);
        if (['succeeded', 'completed'].includes((job.status || '').toLowerCase())) succeeded++; else failed++;
      } catch { failed++; store.clearRunningJob(caseId); }
      update();
    };

    if (store.bulkRunMode === 'parallel') {
      await Promise.all(entries.map(({ caseId, rr }) => runOne(caseId, rr)));
    } else {
      for (const { caseId, rr } of entries) await runOne(caseId, rr);
    }

    const el = ((Date.now() - startedAt) / 1000).toFixed(1);
    setBulkRunBusy(false);
    setBulkRunStatus(`Bulk run complete: ${succeeded} succeeded, ${failed} failed out of ${total} — ${el}s`);
    setBulkRunTone('done');
  }

  async function waitForJob(jobId: string): Promise<Job> {
    return new Promise((resolve) => {
      const iv = setInterval(async () => {
        try {
          const job = await api.getJob(jobId);
          const st = (job.status || '').toLowerCase();
          if (['succeeded', 'completed', 'cancelled', 'failed', 'error'].includes(st)) {
            clearInterval(iv); resolve(job);
          }
        } catch { /* transient */ }
      }, 800);
    });
  }

  /* ─── File Upload ────────────────────────────────────── */
  function handleFiles(files: FileList | null) {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (store.uploadedFiles.length >= MAX_FILES) break;
      if (file.size > MAX_FILE_SIZE) { store.setStatus(`${file.name} exceeds 512 KB limit.`, 'error'); continue; }
      const reader = new FileReader();
      reader.onload = () => store.addFile({ name: file.name, size: file.size, content: reader.result as string });
      reader.readAsText(file);
    }
  }

  /* ─── Saved Plans ────────────────────────────────────── */
  async function refreshSavedPlans() {
    try { const plans = await api.listPlans(); setSavedPlans(plans || []); } catch { /* */ }
  }

  async function doSavePlan() {
    if (!planName.trim()) return;
    setSaveModalOpen(false);
    try {
      await api.savePlan({ name: planName.trim(), strategy: store.prompt, model: store.model, cases: store.allCases });
      store.setStatus(`Plan "${planName}" saved.`, 'success');
      refreshSavedPlans();
    } catch (err: unknown) { store.setStatus(`Save failed: ${(err as Error)?.message}`, 'error'); }
  }

  async function loadPlan(id: string) {
    try {
      const data = await api.getPlan(id);
      if (data.cases?.length) {
        store.clearAllCaseStatuses();
        store.setAllCases(data.cases);
        store.clearAllAcceptance();
        store.setModel(data.model || '');
        data.cases.forEach((tc, i) => {
          const caseId = tc.caseId || `case-${i + 1}`;
          store.setInitialCommand(caseId, buildRelevantAzCliCommands(tc.runRequest || {}).join('\n'));
        });
        store.setStatus(`Loaded plan "${data.name}" (${data.cases.length} cases)`, 'success');
      }
    } catch (err: unknown) { store.setStatus(`Load failed: ${(err as Error)?.message}`, 'error'); }
  }

  async function deletePlan(id: string) {
    try { await api.deletePlan(id); refreshSavedPlans(); store.setStatus('Plan deleted.', 'success'); } catch { /* */ }
  }

  const restoreThread = useCallback((thread: PlannerConversationThread) => {
    store.resetPlannerDraft();
    store.setPrompt(thread.snapshot.prompt || '');
    store.setCaseCount(thread.snapshot.caseCount || 8);
    store.setSelectedResourceTypes(thread.snapshot.selectedResourceTypes || []);
    store.setUploadedFiles(thread.snapshot.uploadedFiles || []);
    store.setAllCases(thread.snapshot.allCases || []);
    store.setModel(thread.snapshot.model || '');
    (thread.snapshot.allCases || []).forEach((tc, index) => {
      const caseId = tc.caseId || `case-${index + 1}`;
      store.setInitialCommand(caseId, buildRelevantAzCliCommands(tc.runRequest || {}).join('\n'));
    });
    setChatMessages(thread.messages || []);
    setGenInfo([]);
    setElapsed('');
    setRefineTarget(null);
    setBulkRunStatus('');
    setBulkRunTone('');
  }, [store]);

  const persistThreads = useCallback((threads: PlannerConversationThread[], nextActiveId: string) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(PLANNER_CONVERSATIONS_KEY, JSON.stringify(threads));
    window.localStorage.setItem(PLANNER_ACTIVE_CONVERSATION_KEY, nextActiveId);
  }, []);

  const createNewConversation = useCallback(() => {
    const thread = createPlannerThread();
    setPlannerThreads(prev => {
      const next = [thread, ...prev];
      persistThreads(next, thread.id);
      return next;
    });
    setActiveThreadId(thread.id);
    setChatMessages([]);
    store.resetPlannerDraft();
    setGenInfo([]);
    setElapsed('');
    setRefineTarget(null);
    setBulkRunStatus('');
    setBulkRunTone('');
    store.setStatus('Planner ready. Describe the behavior you want to pressure-test.', 'success');
    promptRef.current?.focus();
  }, [persistThreads, store]);

  const selectConversation = useCallback((threadId: string) => {
    const thread = plannerThreads.find(item => item.id === threadId);
    if (!thread) return;
    setActiveThreadId(thread.id);
    restoreThread(thread);
    promptRef.current?.focus();
  }, [plannerThreads, restoreThread]);

  useEffect(() => {
    if (threadInitRef.current || typeof window === 'undefined') return;
    threadInitRef.current = true;
    try {
      const rawThreads = window.localStorage.getItem(PLANNER_CONVERSATIONS_KEY);
      const rawActiveId = window.localStorage.getItem(PLANNER_ACTIVE_CONVERSATION_KEY);
      const parsedThreads = rawThreads ? JSON.parse(rawThreads) as PlannerConversationThread[] : [];
      if (parsedThreads.length > 0) {
        const active = parsedThreads.find(thread => thread.id === rawActiveId) || parsedThreads[0];
        setPlannerThreads(parsedThreads);
        setActiveThreadId(active.id);
        restoreThread(active);
        return;
      }
    } catch { /* fallback to blank thread */ }
    const freshThread = createPlannerThread();
    setPlannerThreads([freshThread]);
    setActiveThreadId(freshThread.id);
    persistThreads([freshThread], freshThread.id);
  }, [persistThreads, restoreThread]);

  useEffect(() => {
    if (!threadInitRef.current || !activeThreadId) return;
    const snapshot = {
      prompt: store.prompt,
      caseCount: store.caseCount,
      selectedResourceTypes: [...store.selectedResourceTypes],
      uploadedFiles: store.uploadedFiles,
      allCases: store.allCases,
      model: store.model,
    };
    setPlannerThreads(prev => {
      const next = prev.map(thread => thread.id === activeThreadId ? {
        ...thread,
        title: buildConversationTitle(snapshot.prompt, chatMessages),
        updatedAt: new Date().toISOString(),
        messages: chatMessages,
        snapshot,
      } : thread).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      persistThreads(next, activeThreadId);
      return next;
    });
  }, [
    activeThreadId,
    chatMessages,
    persistThreads,
    store.allCases,
    store.caseCount,
    store.model,
    store.prompt,
    store.selectedResourceTypes,
    store.uploadedFiles,
  ]);

  const addStarterPrompt = useCallback((promptText: string) => {
    const nextPrompt = promptText.trim();
    const currentPrompt = store.prompt.trim();
    if (!currentPrompt) {
      store.setPrompt(nextPrompt);
      promptRef.current?.focus();
      return;
    }
    if (currentPrompt.includes(nextPrompt)) {
      promptRef.current?.focus();
      return;
    }
    store.setPrompt(`${currentPrompt}\n\n${nextPrompt}`);
    promptRef.current?.focus();
  }, [store]);

  /* ─── Derived state ──────────────────────────────────── */
  const { allCases, currentPage, acceptedCommands, initialCommands, runningJobs, completedJobData, caseStatuses, selectedResourceTypes, generating } = store;
  const isAllSelected = selectedResourceTypes.has('e2e');
  const primaryType = isAllSelected ? 'e2e' : ([...selectedResourceTypes][0] as keyof typeof resourceMeta | undefined);
  const meta = primaryType ? resourceMeta[primaryType] : DEFAULT_PLANNER_META;

  // Merge quick prompts from all selected resource types (deduplicated by label, tagged with resource)
  const mergedQuickPrompts = (() => {
    if (isAllSelected) return resourceMeta['e2e'].quickPrompts.map(qp => ({ ...qp, tag: 'E2E' }));
    const types = [...selectedResourceTypes];
    if (types.length === 0) return DEFAULT_PLANNER_META.quickPrompts.map(qp => ({ ...qp, tag: '' }));
    if (types.length === 1) return (resourceMeta[types[0]]?.quickPrompts || []).map(qp => ({ ...qp, tag: '' }));
    const prompts: { label: string; desc: string; prompt: string; tag: string }[] = [];
    for (const t of types) {
      const rm = resourceMeta[t];
      if (!rm) continue;
      const shortLabel = rm.label.replace(/ \(.*/, '');
      for (const qp of rm.quickPrompts) {
        prompts.push({ ...qp, tag: shortLabel });
      }
    }
    return prompts;
  })();

  const totalPages = Math.max(1, Math.ceil(allCases.length / PAGE_SIZE));
  const page = Math.max(1, Math.min(currentPage, totalPages));
  const pageStart = (page - 1) * PAGE_SIZE;
  const pageCases = allCases.slice(pageStart, pageStart + PAGE_SIZE);
  const depthLabels: Record<number, string> = { 4: 'Quick', 8: 'Standard', 12: 'Thorough' };
  const promptDetail = store.prompt.length < 60 ? 'Concise' : store.prompt.length < 180 ? 'Good detail' : 'Detailed';
  const resourceSummary = isAllSelected ? 'End-to-end' : selectedResourceTypes.size > 0 ? `${selectedResourceTypes.size} selected` : 'Choose scope';
  const attachmentSummary = store.uploadedFiles.length === 0 ? 'Optional' : `${store.uploadedFiles.length}/${MAX_FILES} attached`;
  const contextReady = Boolean(store.baseEnvelope.subscriptionId && store.baseEnvelope.resourceGroup && store.baseEnvelope.customLocationId);
  const contextProgress = [store.baseEnvelope.subscriptionId, store.baseEnvelope.resourceGroup, store.baseEnvelope.customLocationId].filter(Boolean).length;
  const selectedResourceLabels = isAllSelected
    ? ['End-to-end coverage']
    : [...selectedResourceTypes].map(type => resourceMeta[type].label.replace(/ \(.*/, ''));
  const plannerSummaryItems = [
    contextReady ? 'Azure context ready' : `${contextProgress}/3 Azure fields selected`,
    `Depth ${depthLabels[store.caseCount]}`,
    selectedResourceLabels.length > 0 ? `Scope ${selectedResourceLabels.join(', ')}` : 'Scope not set',
    store.uploadedFiles.length > 0 ? `${store.uploadedFiles.length} reference file${store.uploadedFiles.length === 1 ? '' : 's'}` : 'No reference files',
  ];
  const plannerOptionSummary = `${depthLabels[store.caseCount]} depth • ${resourceSummary}`;
  const promptMetaItems = [
    `${promptDetail} prompt`,
    `${store.prompt.length} chars`,
    contextReady ? 'Ready to generate' : 'Azure context required',
  ];
  const hasResults = allCases.length > 0 || generating;
  const isPromptEmpty = store.prompt.trim().length === 0;
  const starterPromptChoices = mergedQuickPrompts.filter((qp, index, arr) => arr.findIndex(candidate => candidate.prompt === qp.prompt) === index);
  const resultsMeta = generating && allCases.length === 0 ? 'Generating draft...' : `${allCases.length} cases${elapsed ? ` • ${elapsed}s` : ''}`;
  const sortedThreads = [...plannerThreads].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  const visibleThreads = sortedThreads;
  const activeThread = sortedThreads.find(thread => thread.id === activeThreadId) || null;

  return (
    <>
      <div className="planner-page-layout">
        <aside className="surface planner-chat-pane">
          <div className="planner-chat-bar">
            <div className="planner-chat-copy">
              <span className="section-label">Planner Chats</span>
              <p>Saved automatically in this browser, so you can come back to the same planning thread.</p>
            </div>
            <div className="planner-chat-actions">
              <button type="button" className="secondary-btn" onClick={createNewConversation}>New Chat</button>
            </div>
          </div>

          {visibleThreads.length > 0 && (
            <div className="planner-thread-list" aria-label="Saved planner conversations">
              {visibleThreads.map(thread => {
                const preview = buildConversationPreview(thread);
                return (
                  <button
                    key={thread.id}
                    type="button"
                    className={`planner-thread-chip${thread.id === activeThreadId ? ' active' : ''}`}
                    onClick={() => selectConversation(thread.id)}
                  >
                    <div className="planner-thread-meta">
                      <strong>{thread.title}</strong>
                      <span>{new Date(thread.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span>
                    </div>
                    <p className="planner-thread-preview">{preview}</p>
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <div className="planner-main-column">
          <section className="surface context-shell">
            <div className="context-shell-head">
              <div>
                <span className="section-label">Azure Context</span>
                <h2>Target environment</h2>
                <p>Select the Azure scope used by plan generation and execution.</p>
              </div>
              <span className={`context-required${contextReady ? ' ready' : ''}`}>
                {contextReady ? 'Ready to generate and run' : 'Required before generate or run'}
              </span>
            </div>

            <div className="azure-target-bar">
              {renderPicker('Subscription', subItems, subLabel, subOpen, setSubOpen, subSearch, setSubSearch, selectSub, false, subLoading)}
              {renderPicker('Resource Group', rgItems, rgLabel, rgOpen, setRgOpen, rgSearch, setRgSearch, selectRg, rgDisabled, false)}
              {renderPicker('Custom Location', clItems, clLabel, clOpen, setClOpen, clSearch, setClSearch, selectCl, clDisabled, false)}
            </div>
            {validationError && (
              <div className="azure-validation-error">{validationError}</div>
            )}
          </section>

          <div className={`split-layout${hasResults ? ' has-results' : ' is-idle'}`}>
        {/* ─── Composer ────────────────────────────────────── */}
        <section className="surface composer">
          <div className="composer-top">
            <div>
              <span className="section-label">Test Case Generator</span>
              <h2>Ask the planner for test cases</h2>
              <p>Write the scenario the way you would brief an operator. Keep the prompt natural, then use scope, depth, and files only where they sharpen the draft.</p>
            </div>
            <div className="planner-summary" aria-label="Planner summary">
              {activeThread && <span className="planner-summary-item">{activeThread.title}</span>}
              {plannerSummaryItems.map(item => (
                <span key={item} className="planner-summary-item">{item}</span>
              ))}
            </div>
          </div>

          <div className="composer-stack">
            <div className="planner-studio">
              <div className="prompt-shell">
                <div className="prompt-shell-head">
                  <div className="prompt-shell-copy">
                    <div className="prompt-shell-kicker">Planner Prompt</div>
                    <div className="prompt-shell-title">What should the planner generate?</div>
                    <p className="prompt-shell-description">Describe the scenario, failure modes, constraints, or success criteria. The planner will turn it into CLI-backed cases you can inspect, edit, and run.</p>
                    <div className="prompt-shell-meta">
                      {promptMetaItems.map(item => (
                        <span key={item} className="prompt-meta-item">{item}</span>
                      ))}
                    </div>
                  </div>
                </div>

                {chatMessages.length > 0 && (
                  <div className="planner-chat-log" aria-label="Planner conversation">
                    {chatMessages.map(message => (
                      <article key={message.id} className={`planner-chat-message ${message.role}`}>
                        <span className="planner-chat-role">{message.role === 'user' ? 'You' : 'Planner'}</span>
                        <p>{message.content}</p>
                      </article>
                    ))}
                  </div>
                )}

                <textarea
                  id="prompt"
                  ref={promptRef}
                  className="strategy-input"
                  value={store.prompt}
                  onChange={e => store.setPrompt(e.target.value)}
                  placeholder={meta.placeholder}
                />

                {starterPromptChoices.length > 0 && (
                  <div className={`composer-suggestions${isPromptEmpty ? '' : ' compact'}`}>
                    <div className="composer-suggestions-head">{isPromptEmpty ? 'Start with one of these' : 'Add more starter prompts'}</div>
                    <div className="composer-suggestions-row">
                      {starterPromptChoices.map((qp, i) => (
                        <button
                          key={`${qp.tag}-${qp.label}-${i}`}
                          type="button"
                          className="composer-suggestion-chip"
                          onClick={() => addStarterPrompt(qp.prompt)}
                        >
                          <strong>{qp.tag ? `${qp.tag}: ${qp.label}` : qp.label}</strong>
                          <span>{qp.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="prompt-composer-bar">
                  <input
                    ref={fileInputRef}
                    className="composer-file-input"
                    type="file"
                    multiple
                    accept=".json,.yaml,.yml,.txt,.md,.log,.csv,.xml,.toml,.sh,.ps1,.go,.py"
                    onChange={e => { handleFiles(e.target.files); e.target.value = ''; }}
                  />
                  <button type="button" className="attach-btn" onClick={() => fileInputRef.current?.click()} aria-label="Attach reference files">
                    <Plus size={16} />
                  </button>
                  <div className="attach-copy">
                    <strong>Add reference files</strong>
                    <span>{store.uploadedFiles.length > 0 ? `${store.uploadedFiles.length}/${MAX_FILES} attached` : 'Specs, logs, runbooks, or examples'}</span>
                  </div>
                </div>

                {store.uploadedFiles.length > 0 && (
                  <div className="file-chips composer-file-chips">
                    {store.uploadedFiles.map((f, i) => (
                      <span key={f.name} className="file-chip">
                        {f.name} <span className="file-size">({(f.size / 1024).toFixed(1)} KB)</span>
                        <button type="button" className="remove-file" onClick={() => store.removeFile(i)}>&times;</button>
                      </span>
                    ))}
                  </div>
                )}

                <div className="prompt-footer">
                  <div className="prompt-footer-copy">
                    <p className="prompt-hint">Use Cmd/Ctrl + Enter to generate. {meta.label}.</p>
                    <p className="selection-summary">
                      {selectedResourceLabels.length > 0
                        ? `Current scope: ${selectedResourceLabels.join(', ')}.`
                        : 'Current scope: choose the Azure Local surfaces the planner should cover.'}
                    </p>
                  </div>
                  <div className="prompt-footer-actions">
                    <button className="primary-btn composer-generate-btn" disabled={generating} onClick={generate}>
                      {generating ? 'Generating...' : 'Generate Plan'}
                    </button>
                  </div>
                </div>
              </div>

              <section className="planner-tools">
                <div className="planner-tools-panel-head">
                  <div className="planner-tools-head">
                    <span className="control-card-title">Planner options</span>
                    <span className="planner-tools-summary">{plannerOptionSummary}</span>
                  </div>
                </div>
                <div className="planner-tools-body">
                  <section className="planner-tool-section">
                    <div className="planner-tool-head">
                      <span className="control-card-title">Depth</span>
                      <span className="field-hint">{store.caseCount} cases</span>
                    </div>
                    <p className="control-card-copy">Choose how wide the first draft should go before you refine individual cases.</p>
                    <div className="depth-toggle">
                      {[4, 8, 12].map(n => (
                        <button key={n} type="button" className={`depth-btn${store.caseCount === n ? ' active' : ''}`} onClick={() => store.setCaseCount(n)}>
                          {depthLabels[n]}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="planner-tool-section">
                    <div className="planner-tool-head">
                      <span className="control-card-title">Resource coverage</span>
                      <span className="field-hint">{resourceSummary}</span>
                    </div>
                    <p className="control-card-copy">Pick the Azure Local surfaces the planner should cover. Keep it narrow for focused prompts.</p>
                    <div className="resource-checkboxes resource-checkboxes-compact">
                      <label className="resource-checkbox">
                        <input type="checkbox" checked={isAllSelected} onChange={() => store.selectAllResourceTypes()} />
                        <span>Select All (E2E)</span>
                      </label>
                      {RESOURCE_TABS.filter(t => t !== 'e2e').map(tab => (
                        <label key={tab} className="resource-checkbox">
                          <input
                            type="checkbox"
                            checked={isAllSelected || selectedResourceTypes.has(tab)}
                            onChange={() => store.toggleResourceType(tab)}
                          />
                          <span>{resourceMeta[tab].label.replace(/ \(.*/, '')}</span>
                        </label>
                      ))}
                    </div>
                  </section>

                </div>
              </section>
            </div>
          </div>

          {allCases.length === 0 && !generating && store.status && (
            <div className={`status${store.statusTone === 'error' ? ' error' : store.statusTone === 'success' ? ' success' : ''}`} style={{ marginTop: 16 }}>
              {store.status}
            </div>
          )}
        </section>

        {/* ─── Results Shell (only when cases exist or generating) ──────── */}
        {hasResults && (
          <section className="surface results-shell">
            <div className="results-top">
              <div>
                <span className="section-label">Generated Plan</span>
                <h2>Review the drafted cases</h2>
                <p>Edit the proposed execution flows, accept the ones you trust, and run them from the same workspace.</p>
              </div>
              <span className="run-meta">{resultsMeta}</span>
            </div>

            <div className={`status${store.statusTone === 'error' ? ' error' : store.statusTone === 'success' ? ' success' : ''}`}>
              {store.status}
            </div>

            {genInfo.length > 0 && (
              <div className="generation-info visible">
                {genInfo.map((item, i) => <span key={i} className="info-pill">{item}</span>)}
              </div>
            )}

            {allCases.length > 0 && (
              <section className="bulk-actions visible">
                <div className="left">Accepted {acceptedCommands.size} of {allCases.length} cases</div>
                <div className="right">
                  <div className="run-mode-toggle">
                    <button type="button" className={`mode-btn${store.bulkRunMode === 'parallel' ? ' active' : ''}`} onClick={() => store.setBulkRunMode('parallel')}>Parallel</button>
                    <button type="button" className={`mode-btn${store.bulkRunMode === 'sequential' ? ' active' : ''}`} onClick={() => store.setBulkRunMode('sequential')}>Sequential</button>
                  </div>
                  <button type="button" className={`secondary-btn run-all-btn${bulkRunBusy ? ' running' : ''}`} disabled={bulkRunBusy} onClick={bulkRunAll}>
                    {bulkRunBusy ? 'Running...' : 'Run All'}
                  </button>
                  <button type="button" className="secondary-btn" onClick={() => store.acceptAll()}>Accept All</button>
                  <button type="button" className="secondary-btn" onClick={() => store.clearAllAcceptance()}>Clear</button>
                  <button type="button" className="secondary-btn danger-btn" onClick={() => {
                    store.setAllCases([]);
                    store.clearAllAcceptance();
                    store.clearAllCaseStatuses();
                    setGenInfo([]);
                    setElapsed('');
                    setBulkRunStatus('');
                    setBulkRunTone('');
                    store.setStatus('All test cases cleared.', 'success');
                  }}>Reset All</button>
                  <button type="button" className="secondary-btn" disabled={acceptedCommands.size === 0} onClick={async () => {
                    const bundle = Array.from(acceptedCommands.entries()).map(([id, cmds]) => `# ${id}\n${cmds}`).join('\n\n');
                    const ok = await copyText(bundle);
                    store.setStatus(ok ? 'Copied accepted command bundle.' : 'Clipboard copy failed.', ok ? 'success' : 'error');
                  }}>Copy Accepted</button>
                  <button type="button" className="secondary-btn" onClick={() => { if (allCases.length > 0) { setPlanName(''); setSaveModalOpen(true); } }}>Save Plan</button>
                </div>
              </section>
            )}

            {bulkRunStatus && (
              <div className={`bulk-run-status visible${bulkRunTone ? ' ' + bulkRunTone : ''}`}>{bulkRunStatus}</div>
            )}

            <div className="results">
              {generating && allCases.length === 0 && [0, 1, 2].map(i => (
                <article key={i} className="skeleton-card">
                  <div className="skeleton-line short" /><div className="skeleton-line medium" /><div className="skeleton-line long" /><div className="skeleton-line long" />
                </article>
              ))}

              {pageCases.map((tc, pageIdx) => {
                const globalIdx = pageStart + pageIdx;
                const caseId = tc.caseId || `case-${globalIdx + 1}`;
                const runRequest = tc.runRequest || {};
                const pills = extractResourcePills(runRequest);
                const citations = tc.citations || [];
                const isAccepted = acceptedCommands.has(caseId);
                const isRunning = runningJobs.has(caseId);
                const completed = completedJobData.get(caseId);
                const caseStatus = caseStatuses.get(caseId) || null;
                const commands = isAccepted ? acceptedCommands.get(caseId)! : (initialCommands.get(caseId) || buildRelevantAzCliCommands(runRequest).join('\n'));

                let runStatusText = '';
                let runStatusClass = '';
                if (isRunning) {
                  const jobId = runningJobs.get(caseId);
                  runStatusText = jobId ? `Job ${jobId} running...` : 'Submitting...';
                  runStatusClass = 'visible running';
                } else if (completed) {
                  const st = (completed.job.status || '').toLowerCase();
                  const cssClass = st === 'cancelled' ? 'cancelled' : (st === 'failed' || st === 'error') ? 'failed' : 'succeeded';
                  runStatusText = `Job ${completed.jobId}: ${cssClass}${completed.job.error && cssClass !== 'succeeded' ? ` — ${completed.job.error}` : ''}`;
                  runStatusClass = `visible ${cssClass}`;
                } else if (caseStatus) {
                  runStatusText = caseStatus.text;
                  runStatusClass = `visible ${caseStatus.tone === 'success' ? 'succeeded' : caseStatus.tone === 'error' ? 'failed' : ''}`.trim();
                }

                return (
                  <CaseCard
                    key={caseId}
                    caseId={caseId}
                    globalIndex={globalIdx}
                    testCase={tc}
                    commands={commands}
                    isAccepted={isAccepted}
                    isRunning={isRunning}
                    runStatusText={runStatusText}
                    runStatusClass={runStatusClass}
                    completedData={completed || null}
                    pills={pills}
                    citations={citations}
                    startCollapsed={allCases.length > 1 && !isRunning}
                    onAccept={(val) => store.acceptCase(caseId, val)}
                    onClearAcceptance={() => store.clearAcceptance(caseId)}
                    onReset={() => {
                      const fresh = buildRelevantAzCliCommands(runRequest).join('\n');
                      store.setInitialCommand(caseId, fresh);
                      store.clearAcceptance(caseId);
                    }}
                    onRun={() => runTestCase(caseId, runRequest)}
                    onStop={async () => {
                      const jobId = runningJobs.get(caseId);
                      if (jobId) try { await api.cancelJob(jobId); } catch { /* */ }
                    }}
                    onRefine={() => {
                      const parts = [`Refine ${caseId}:`];
                      if (tc.objective) parts.push(`Objective was: ${tc.objective}.`);
                      if (tc.mutation) parts.push(`Mutation was: ${tc.mutation}.`);
                      if (tc.expectedOutcome) parts.push(`Expected was: ${tc.expectedOutcome}.`);
                      parts.push('The issue is: ');
                      store.setPrompt(parts.join(' '));
                      store.setCaseCount(4);
                      setRefineTarget(caseId);
                      promptRef.current?.focus();
                      store.setStatus(`Refining ${caseId} — describe the issue and hit Generate.`, 'success');
                    }}
                    onCopy={async (val) => {
                      const ok = await copyText(val);
                      store.setStatus(ok ? `Copied commands for ${caseId}.` : 'Clipboard copy failed.', ok ? 'success' : 'error');
                    }}
                    initialCommands={initialCommands.get(caseId) || buildRelevantAzCliCommands(runRequest).join('\n')}
                  />
                );
              })}
            </div>

            {totalPages > 1 && (
              <nav className="pagination visible">
                <button className="page-btn" disabled={page === 1} onClick={() => store.setCurrentPage(page - 1)}>Prev</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                  <button key={p} className={`page-btn${p === page ? ' active' : ''}`} onClick={() => store.setCurrentPage(p)}>{p}</button>
                ))}
                <span className="page-info">{pageStart + 1}–{Math.min(pageStart + PAGE_SIZE, allCases.length)} of {allCases.length}</span>
                <button className="page-btn" disabled={page === totalPages} onClick={() => store.setCurrentPage(page + 1)}>Next</button>
              </nav>
            )}
          </section>
        )}
          </div>
        </div>
      </div>

      <details className="saved-plans planner-library">
        <summary>Saved plan library</summary>
        <div className="saved-plans-list">
          {savedPlans.length === 0 && <p className="saved-plans-empty">No saved plans yet.</p>}
          {savedPlans.map(p => (
            <div key={p.id} className="saved-plan-row">
              <span className="plan-name">{p.name}</span>
              <span className="plan-meta">{p.caseCount} cases{p.model ? ` · ${p.model}` : ''}{p.createdAt ? ` · ${new Date(p.createdAt).toLocaleDateString()}` : ''}</span>
              <button type="button" onClick={() => loadPlan(p.id)}>Load</button>
              <button type="button" className="delete-btn" onClick={() => deletePlan(p.id)}>Delete</button>
            </div>
          ))}
        </div>
      </details>

      {/* Save Modal */}
      {saveModalOpen && (
        <div className="save-modal-overlay visible" onClick={e => { if (e.target === e.currentTarget) setSaveModalOpen(false); }}>
          <div className="save-modal">
            <h3>Save Plan</h3>
            <label>Plan name</label>
            <input type="text" value={planName} onChange={e => setPlanName(e.target.value)} placeholder="e.g. Smoke tests — logical network" maxLength={120} autoFocus />
            <div className="save-modal-actions">
              <button type="button" onClick={() => setSaveModalOpen(false)}>Cancel</button>
              <button type="button" className="confirm-btn" onClick={doSavePlan}>Save</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

/* ─── Case Card Sub-component ──────────────────────────── */
interface CaseCardProps {
  caseId: string;
  globalIndex: number;
  testCase: TestCase;
  commands: string;
  isAccepted: boolean;
  isRunning: boolean;
  runStatusText: string;
  runStatusClass: string;
  completedData: { jobId: string; job: Job } | null;
  pills: string[];
  citations: string[];
  startCollapsed: boolean;
  onAccept: (val: string) => void;
  onClearAcceptance: () => void;
  onReset: () => void;
  onRun: () => void;
  onStop: () => void;
  onRefine: () => void;
  onCopy: (val: string) => void;
  initialCommands: string;
}

function CaseCard({ caseId, globalIndex, testCase, commands, isAccepted, isRunning, runStatusText, runStatusClass, completedData, pills, citations, startCollapsed, onAccept, onClearAcceptance, onReset, onRun, onStop, onRefine, onCopy, initialCommands }: CaseCardProps) {
  const [editorValue, setEditorValue] = useState(commands);
  const [collapsed, setCollapsed] = useState(startCollapsed);
  const previewText = testCase.objective || testCase.expectedOutcome || testCase.mutation || 'Open to review the draft details and CLI flow.';
  const visiblePills = pills.slice(0, 2);
  const hiddenPillCount = Math.max(0, pills.length - visiblePills.length);

  // Sync editor when commands change from outside (e.g. initial load, acceptance change)
  useEffect(() => { setEditorValue(commands); }, [commands]);

  return (
    <article className={`result${isAccepted ? ' is-accepted' : ''}${collapsed ? ' collapsed' : ''}`}>
      <div className="result-head" onClick={() => setCollapsed(c => !c)}>
        <div className="case-title-group">
          {collapsed ? <ChevronRight size={16} className="collapse-chevron" /> : <ChevronDown size={16} className="collapse-chevron" />}
          <div>
            <span className="case-tag">Draft Case {globalIndex + 1}</span>
            <h3>{caseId}</h3>
            <p className="case-preview">{previewText}</p>
          </div>
        </div>
        <div className="case-pills">
          {isAccepted && <span className="case-pill accepted">Accepted</span>}
          {visiblePills.map((p, i) => <span key={i} className="case-pill">{p}</span>)}
          {hiddenPillCount > 0 && <span className="case-pill">+{hiddenPillCount} more</span>}
          {collapsed && runStatusText && <span className={`case-pill ${runStatusClass.includes('succeeded') ? 'pass' : runStatusClass.includes('failed') ? 'fail' : ''}`}>{isRunning ? 'Running' : completedData ? (completedData.job.status || '').toLowerCase() : ''}</span>}
        </div>
      </div>

      {!collapsed && (
        <>
          <div className="result-grid">
            <article className="meta-card meta-card-wide"><strong>Objective</strong><span>{testCase.objective || '-'}</span></article>
            <article className="meta-card"><strong>Mutation</strong><span>{testCase.mutation || '-'}</span></article>
            <article className="meta-card"><strong>Expected</strong><span>{testCase.expectedOutcome || '-'}</span></article>
          </div>

          {citations.length > 0 && (
            <div className="citation-row">
              {citations.map((c, i) => <span key={i} className="citation-pill">{c}</span>)}
            </div>
          )}

          <section className="command-shell">
            <div className="command-head">
              <div className="command-copy">
                <strong>Execution draft</strong>
                <span>Review the proposed Azure CLI flow, then accept or run it when it looks right.</span>
              </div>
              <div className="command-actions">
                <button type="button" className={`secondary-btn run-btn${isRunning ? ' running' : ''}`} disabled={isRunning} onClick={onRun}>
                  {isRunning ? 'Running...' : 'Run'}
                </button>
                {isRunning && (
                  <button type="button" className="secondary-btn stop-btn visible" onClick={onStop}>Stop</button>
                )}
                <button type="button" className="secondary-btn" onClick={onRefine}>Refine</button>
                <button type="button" className={`secondary-btn${isAccepted ? ' accepted' : ''}`} onClick={() => onAccept(editorValue)}>
                  {isAccepted ? 'Accepted' : 'Accept'}
                </button>
                <button type="button" className="secondary-btn" onClick={() => { setEditorValue(initialCommands); onReset(); }}>Reset</button>
                <button type="button" className="secondary-btn" onClick={() => onCopy(editorValue)}>Copy</button>
              </div>
            </div>
            <textarea
              className="cli-editor"
              value={editorValue}
              onChange={e => {
                setEditorValue(e.target.value);
                if (isAccepted) onClearAcceptance();
              }}
            />
            {runStatusText && (
              <div className={`run-status ${runStatusClass}`}>{runStatusText}</div>
            )}
            {completedData && (
              <FlightRecorder jobId={completedData.jobId} job={completedData.job} />
            )}
          </section>
        </>
      )}
    </article>
  );
}
