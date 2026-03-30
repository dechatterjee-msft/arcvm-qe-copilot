import { useState, useRef, useEffect } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { usePlannerStore } from '../store';
import * as api from '../api';
import { buildScaleCliSummary, buildRelevantAzCliCommands } from '../cliBuilder';
import {
  generateScaleTestCases,
  SCALE_PRESETS,
  BATCH_SIZES,
  SCALE_RESOURCE_LABELS,
  type ScaleResourceType,
} from '../scaleGenerator';
import FlightRecorder from '../components/FlightRecorder';
import type { TestCase, Job, RunRequest } from '../types';

/* ─── Clipboard helper ─────────────────────────────────── */
async function copyText(text: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/* ─── Azure Picker Item ────────────────────────────────── */
interface PickerItem { value: string; label: string; sub?: string; location?: string }

export default function ScaleView() {
  const store = usePlannerStore();

  // Scale config
  const [scaleType, setScaleType] = useState<ScaleResourceType>('lnet');
  const [scaleCount, setScaleCount] = useState<number>(SCALE_PRESETS[0]);
  const [scaleBatch, setScaleBatch] = useState<number>(BATCH_SIZES[2]);
  const [scalePrefix, setScalePrefix] = useState('qe-scale');

  // Local results state (separate from planner)
  const [scaleCases, setScaleCases] = useState<TestCase[]>([]);
  const [scaleCaseCommands, setScaleCaseCommands] = useState<Map<string, string>>(new Map());
  const [runningJobs, setRunningJobs] = useState<Map<string, string | null>>(new Map());
  const [completedJobData, setCompletedJobData] = useState<Map<string, { jobId: string; job: Job }>>(new Map());
  const [bulkRunBusy, setBulkRunBusy] = useState(false);
  const [bulkRunStatus, setBulkRunStatus] = useState('');

  // Status
  const [status, setStatus] = useState('');
  const [statusTone, setStatusTone] = useState<'neutral' | 'error' | 'success'>('neutral');
  const [validationError, setValidationError] = useState('');

  function updateStatus(text: string, tone: 'neutral' | 'error' | 'success' = 'neutral') {
    setStatus(text);
    setStatusTone(tone);
  }

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

  const pollIntervals = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  // Load subscriptions on mount
  useEffect(() => {
    setSubLoading(true);
    api.fetchSubscriptions().then(subs => {
      const items = subs.filter(s => s.state === 'Enabled').map(s => ({ value: s.id, label: s.name, sub: s.id }));
      setSubItems(items);
      setSubLabel(items.length > 0 ? `Select subscription (${items.length})` : 'No subscriptions — type to enter');
    }).catch(() => setSubLabel('Could not load — click to enter')).finally(() => setSubLoading(false));

    // If baseEnvelope is already set (from planner tab), reflect in labels
    const { subscriptionId, resourceGroup } = store.baseEnvelope;
    if (subscriptionId) {
      setSubLabel(subscriptionId);
      setRgDisabled(false);
      if (resourceGroup) {
        setRgLabel(resourceGroup);
        setClDisabled(false);
      }
    }
  }, []);

  useEffect(() => {
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

  /* ─── Validation ─────────────────────────────────────── */
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

  /* ─── Generate Scale Plan ────────────────────────────── */
  function generateScale() {
    if (!validateAzureTarget()) return;
    const { subscriptionId, resourceGroup, location, customLocationId } = store.baseEnvelope;
    const cases = generateScaleTestCases({
      resourceType: scaleType,
      totalCount: scaleCount,
      batchSize: scaleBatch,
      prefix: scalePrefix,

    });

    const cmds = new Map<string, string>();
    cases.forEach(tc => {
      if (tc.runRequest) {
        tc.runRequest.subscriptionId = subscriptionId;
        tc.runRequest.resourceGroup = resourceGroup;
        tc.runRequest.location = location;
        tc.runRequest.customLocationId = customLocationId;
      }
      cmds.set(tc.caseId, buildScaleCliSummary(tc.runRequest || {}));
    });

    setScaleCases(cases);
    setScaleCaseCommands(cmds);
    setRunningJobs(new Map());
    setCompletedJobData(new Map());
    setBulkRunStatus('');
    updateStatus(`Generated ${cases.length} scale batches for ${scaleCount} ${SCALE_RESOURCE_LABELS[scaleType]}.`, 'success');
  }

  /* ─── Run a single batch ─────────────────────────────── */
  async function runBatch(caseId: string, rr: RunRequest) {
    if (runningJobs.has(caseId)) return;
    if (!validateAzureTarget()) return;

    const payload = { ...rr, caseId, description: `Scale batch: ${caseId}` };
    setRunningJobs(m => { const n = new Map(m); n.set(caseId, null); return n; });

    try {
      const { id: jobId } = await api.submitProvisionJob(payload);
      setRunningJobs(m => { const n = new Map(m); n.set(caseId, jobId); return n; });
      startPolling(caseId, jobId);
    } catch (err: unknown) {
      setRunningJobs(m => { const n = new Map(m); n.delete(caseId); return n; });
      updateStatus(`Run failed for ${caseId}: ${(err as Error)?.message || 'Unknown'}`, 'error');
    }
  }

  function startPolling(caseId: string, jobId: string) {
    const iv = setInterval(async () => {
      try {
        const job = await api.getJob(jobId);
        const st = (job.status || '').toLowerCase();
        if (['succeeded', 'completed', 'cancelled', 'failed', 'error'].includes(st)) {
          clearInterval(iv);
          pollIntervals.current.delete(caseId);
          setRunningJobs(m => { const n = new Map(m); n.delete(caseId); return n; });
          setCompletedJobData(m => { const n = new Map(m); n.set(caseId, { jobId, job }); return n; });
        } else {
          setCompletedJobData(m => { const n = new Map(m); n.set(caseId, { jobId, job }); return n; });
        }
      } catch { /* transient */ }
    }, 800);
    pollIntervals.current.set(caseId, iv);
  }

  /* ─── Run All Batches ────────────────────────────────── */
  async function runAllBatches() {
    if (scaleCases.length === 0) return;
    if (!validateAzureTarget()) return;
    setBulkRunBusy(true);
    const total = scaleCases.length;
    let succeeded = 0, failed = 0;
    const startedAt = Date.now();

    const update = () => {
      const el = ((Date.now() - startedAt) / 1000).toFixed(0);
      setBulkRunStatus(`${succeeded + failed}/${total} done (${succeeded} ok, ${failed} err) — ${el}s`);
    };
    update();

    for (const tc of scaleCases) {
      const caseId = tc.caseId;
      const rr: RunRequest = { ...tc.runRequest, caseId, description: `Scale batch: ${caseId}` };
      try {
        setRunningJobs(m => { const n = new Map(m); n.set(caseId, null); return n; });
        const { id: jobId } = await api.submitProvisionJob(rr);
        setRunningJobs(m => { const n = new Map(m); n.set(caseId, jobId); return n; });
        const job = await waitForJob(jobId);
        setRunningJobs(m => { const n = new Map(m); n.delete(caseId); return n; });
        setCompletedJobData(m => { const n = new Map(m); n.set(caseId, { jobId, job }); return n; });
        if (['succeeded', 'completed'].includes((job.status || '').toLowerCase())) succeeded++; else failed++;
      } catch {
        failed++;
        setRunningJobs(m => { const n = new Map(m); n.delete(caseId); return n; });
      }
      update();
    }

    const el = ((Date.now() - startedAt) / 1000).toFixed(1);
    setBulkRunBusy(false);
    setBulkRunStatus(`Scale run complete: ${succeeded} succeeded, ${failed} failed out of ${total} — ${el}s`);
    updateStatus(`Scale run complete: ${succeeded}/${total} succeeded.`, succeeded === total ? 'success' : 'error');
  }

  async function waitForJob(jobId: string): Promise<Job> {
    return new Promise((resolve) => {
      const iv = setInterval(async () => {
        try {
          const job = await api.getJob(jobId);
          const st = (job.status || '').toLowerCase();
          if (['succeeded', 'completed', 'cancelled', 'failed', 'error'].includes(st)) {
            clearInterval(iv);
            resolve(job);
          }
        } catch { /* transient */ }
      }, 800);
    });
  }

  /* ─── Derived ────────────────────────────────────────── */
  const contextReady = Boolean(store.baseEnvelope.subscriptionId && store.baseEnvelope.resourceGroup && store.baseEnvelope.customLocationId);
  const batchCount = Math.ceil(scaleCount / scaleBatch);
  const batchResourceCount = Math.min(scaleBatch, scaleCount);

  return (
    <div className="scale-page">
      {/* Azure Context */}
      <section className="surface context-shell">
        <div className="context-shell-head">
          <div>
            <span className="section-label">Azure Context</span>
            <h2>Target environment</h2>
            <p>Select the Azure scope for the scale test.</p>
          </div>
          <span className={`context-required${contextReady ? ' ready' : ''}`}>
            {contextReady ? 'Ready' : 'Required'}
          </span>
        </div>
        <div className="azure-target-bar">
          {renderPicker('Subscription', subItems, subLabel, subOpen, setSubOpen, subSearch, setSubSearch, selectSub, false, subLoading)}
          {renderPicker('Resource Group', rgItems, rgLabel, rgOpen, setRgOpen, rgSearch, setRgSearch, selectRg, rgDisabled, false)}
          {renderPicker('Custom Location', clItems, clLabel, clOpen, setClOpen, clSearch, setClSearch, selectCl, clDisabled, false)}
        </div>
        {validationError && <div className="azure-validation-error">{validationError}</div>}
      </section>

      {/* Scale Configuration */}
      <section className="surface scale-config-shell">
        <div className="scale-config-head">
          <div>
            <span className="section-label">Scale Configuration</span>
            <h2>Define the scale test</h2>
            <p>Choose a resource type, target count, and batch size. The backend will execute each batch as a single job with all resources inside.</p>
          </div>
        </div>

        <div className="scale-config-body">
          <div className="scale-field">
            <label className="scale-label">Resource type</label>
            <select className="scale-select" value={scaleType} onChange={e => setScaleType(e.target.value as ScaleResourceType)}>
              {(Object.keys(SCALE_RESOURCE_LABELS) as ScaleResourceType[]).map(t => (
                <option key={t} value={t}>{SCALE_RESOURCE_LABELS[t]}</option>
              ))}
            </select>
          </div>

          <div className="scale-field">
            <label className="scale-label">Total count</label>
            <div className="depth-toggle scale-toggle">
              {SCALE_PRESETS.map(n => (
                <button key={n} type="button" className={`depth-btn${scaleCount === n ? ' active' : ''}`} onClick={() => setScaleCount(n)}>
                  {n >= 1000 ? `${n / 1000}K` : n}
                </button>
              ))}
            </div>
          </div>

          <div className="scale-field">
            <label className="scale-label">Batch size</label>
            <div className="depth-toggle scale-toggle">
              {BATCH_SIZES.map(n => (
                <button key={n} type="button" className={`depth-btn${scaleBatch === n ? ' active' : ''}`} onClick={() => setScaleBatch(n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>

          <div className="scale-field">
            <label className="scale-label">Name prefix</label>
            <input
              className="scale-prefix-input"
              type="text"
              value={scalePrefix}
              onChange={e => setScalePrefix(e.target.value)}
              placeholder="qe-scale"
              maxLength={40}
            />
          </div>

        </div>

        <div className="scale-config-footer">
          <div className="scale-summary-bar">
            <span className="scale-summary-item">{SCALE_RESOURCE_LABELS[scaleType]}</span>
            <span className="scale-summary-item">{scaleCount} total</span>
            <span className="scale-summary-item">{batchCount} batch{batchCount !== 1 ? 'es' : ''} &times; {batchResourceCount} each</span>
          </div>
          <button type="button" className="primary-btn" onClick={generateScale}>
            Generate Scale Plan
          </button>
        </div>
      </section>

      {/* Status */}
      {status && (
        <div className={`status${statusTone === 'error' ? ' error' : statusTone === 'success' ? ' success' : ''}`} style={{ marginTop: 12 }}>
          {status}
        </div>
      )}

      {/* Results */}
      {scaleCases.length > 0 && (
        <section className="surface scale-results-shell">
          <div className="scale-results-head">
            <div>
              <span className="section-label">Scale Plan</span>
              <h2>{scaleCases.length} batch{scaleCases.length !== 1 ? 'es' : ''} ready</h2>
              <p>Each batch contains up to {batchResourceCount} {SCALE_RESOURCE_LABELS[scaleType]} resources. Run individually or all at once.</p>
            </div>
            <div className="scale-results-actions">
              <button
                type="button"
                className={`primary-btn${bulkRunBusy ? ' running' : ''}`}
                disabled={bulkRunBusy}
                onClick={runAllBatches}
              >
                {bulkRunBusy ? 'Running...' : 'Run All Batches'}
              </button>
              <button
                type="button"
                className="secondary-btn"
                onClick={() => { setScaleCases([]); setScaleCaseCommands(new Map()); setCompletedJobData(new Map()); setRunningJobs(new Map()); setBulkRunStatus(''); updateStatus('Plan cleared.', 'success'); }}
              >
                Clear
              </button>
            </div>
          </div>

          {bulkRunStatus && (
            <div className="bulk-run-status visible">{bulkRunStatus}</div>
          )}

          <div className="scale-batch-list">
            {scaleCases.map((tc, i) => {
              const caseId = tc.caseId;
              const commands = scaleCaseCommands.get(caseId) || '';
              const isRunning = runningJobs.has(caseId);
              const completed = completedJobData.get(caseId);
              const jobStatus = completed ? (completed.job.status || '').toLowerCase() : '';
              const statusClass = jobStatus === 'succeeded' || jobStatus === 'completed' ? 'succeeded' : jobStatus === 'failed' || jobStatus === 'error' ? 'failed' : jobStatus === 'cancelled' ? 'cancelled' : '';

              return (
                <ScaleBatchCard
                  key={caseId}
                  index={i}
                  testCase={tc}
                  commands={commands}
                  isRunning={isRunning}
                  completed={completed || null}
                  statusClass={statusClass}
                  onRun={() => runBatch(caseId, tc.runRequest || {})}
                  onCopy={async (val: string) => {
                    const ok = await copyText(val);
                    updateStatus(ok ? `Copied commands for ${caseId}.` : 'Clipboard copy failed.', ok ? 'success' : 'error');
                  }}
                />
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/* ─── Batch Card ───────────────────────────────────────── */
interface ScaleBatchCardProps {
  index: number;
  testCase: TestCase;
  commands: string;
  isRunning: boolean;
  completed: { jobId: string; job: Job } | null;
  statusClass: string;
  onRun: () => void;
  onCopy: (val: string) => void;
}

function ScaleBatchCard({ index, testCase, commands, isRunning, completed, statusClass, onRun, onCopy }: ScaleBatchCardProps) {
  const [collapsed, setCollapsed] = useState(true);
  const [editorValue, setEditorValue] = useState(commands);

  // Sync when commands change from outside (re-generate)
  useEffect(() => { setEditorValue(commands); }, [commands]);

  const resourceCounts: string[] = [];
  const resources = testCase.runRequest?.resources || {};
  for (const [key, val] of Object.entries(resources)) {
    if (Array.isArray(val)) resourceCounts.push(`${val.length} ${key}`);
  }

  return (
    <article className={`scale-batch-card${statusClass ? ' ' + statusClass : ''}`}>
      <div className="scale-batch-head" onClick={() => setCollapsed(c => !c)}>
        <div className="scale-batch-title">
          {collapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
          <div>
            <strong>Batch {index + 1}</strong>
            <span className="scale-batch-id">{testCase.caseId}</span>
          </div>
        </div>
        <div className="scale-batch-pills">
          {resourceCounts.map((rc, i) => <span key={i} className="case-pill">{rc}</span>)}
          {isRunning && <span className="case-pill running">Running</span>}
          {completed && !isRunning && <span className={`case-pill ${statusClass}`}>{completed.job.status}</span>}
        </div>
        <div className="scale-batch-actions" onClick={e => e.stopPropagation()}>
          <button type="button" className={`secondary-btn${isRunning ? ' running' : ''}`} disabled={isRunning} onClick={onRun}>
            {isRunning ? 'Running...' : 'Run'}
          </button>
          <button type="button" className="secondary-btn" onClick={() => setEditorValue(commands)}>Reset</button>
          <button type="button" className="secondary-btn" onClick={() => onCopy(editorValue)}>Copy</button>
        </div>
      </div>

      {!collapsed && (
        <div className="scale-batch-body">
          <div className="scale-batch-objective">{testCase.objective}</div>
          <textarea
            className="cli-editor"
            value={editorValue}
            onChange={e => setEditorValue(e.target.value)}
          />
          {completed && (
            <FlightRecorder jobId={completed.jobId} job={completed.job} />
          )}
        </div>
      )}
    </article>
  );
}
