import { useState, useEffect, useRef, useCallback } from 'react';
import Markdown from 'react-markdown';
import { FileText, Info, Send } from 'lucide-react';
import { useRunsStore } from '../store';
import * as api from '../api';
import FlightRecorder from '../components/FlightRecorder';
import type { Job, ChatMessage, LogEntry, JobLogSummary, OperatorInfo } from '../types';

/* ─── Chat System Prompt Builder ───────────────────────── */
function buildSystemPrompt(job: Job): string {
  const st = (job.status || '').toLowerCase();
  const parts = ['You are an expert Azure Local QE assistant. The user is investigating a test case run.'];
  if (job.caseId) parts.push(`Test Case: ${job.caseId}`);
  if (job.description) parts.push(`Description: ${job.description}`);
  parts.push(`Job ID: ${job.id}`, `Status: ${st}`);
  if (job.type) parts.push(`Type: ${job.type}`);
  if (job.summary?.resourceKinds?.length) parts.push(`Resources: ${job.summary.resourceKinds.join(', ')}`);
  if (job.error) parts.push(`Error: ${job.error}`);

  const allSteps: { action: string; command?: string; success?: boolean; output?: string }[] = [];
  for (const iter of (job.result?.iterations || [])) for (const act of (iter.actions || [])) for (const step of (act.steps || [])) allSteps.push({ action: act.name, ...step });
  for (const step of (job.result?.prereqSteps || [])) allSteps.push({ action: 'prereqs', ...step });

  if (allSteps.length > 0) {
    const failed = allSteps.filter(s => !s.success);
    if (failed.length > 0) {
      parts.push('\nFailed commands:');
      for (const s of failed.slice(0, 10)) {
        parts.push(`  [${s.action}] $ ${s.command}`);
        if (s.output) parts.push(`    Output: ${s.output.substring(0, 500)}`);
      }
    }
    parts.push(`\n${allSteps.filter(s => s.success).length} of ${allSteps.length} commands passed.`);
  }

  parts.push('\nHelp the user understand failures, suggest fixes, and answer questions about the test run. Be concise and technical.');
  return parts.join('\n');
}

/* ─── Component ────────────────────────────────────────── */
export default function RunsView() {
  const store = useRunsStore();
  const [chatInput, setChatInput] = useState('');
  const [chatBusy, setChatBusy] = useState(false);
  const chatMessagesRef = useRef<HTMLDivElement>(null);
  const pollInterval = useRef<ReturnType<typeof setInterval> | null>(null);

  // Operator log analysis state
  const [allOperators, setAllOperators] = useState<OperatorInfo[]>([]);
  const [logSummary, setLogSummary] = useState<JobLogSummary | null>(null);
  const [logCollecting, setLogCollecting] = useState(false);
  const [selectedOperator, setSelectedOperator] = useState<string | null>(null);
  const [operatorEntries, setOperatorEntries] = useState<LogEntry[]>([]);
  const [logLevelFilter, setLogLevelFilter] = useState('');
  const [logResourceFilter, setLogResourceFilter] = useState('');
  const [logEntriesLoading, setLogEntriesLoading] = useState(false);

  // Fetch operator registry on mount (static list, no cluster needed)
  useEffect(() => {
    api.listOperators().then(ops => { if (Array.isArray(ops)) setAllOperators(ops); }).catch(() => {});
  }, []);

  // Fetch job list on mount + poll every 3s
  const refreshList = useCallback(async () => {
    try {
      const jobs = await api.listJobs();
      if (!Array.isArray(jobs)) return;
      const order: Record<string, number> = { running: 0, queued: 1 };
      jobs.sort((a, b) => {
        const oa = order[(a.status || '').toLowerCase()] ?? 2;
        const ob = order[(b.status || '').toLowerCase()] ?? 2;
        if (oa !== ob) return oa - ob;
        return new Date(b.submittedAt || '0').getTime() - new Date(a.submittedAt || '0').getTime();
      });
      store.setJobs(jobs);

      // Refresh selected job if running
      if (store.selectedJobId) {
        const current = jobs.find(j => j.id === store.selectedJobId);
        if (current) {
          const oldSt = (store.selectedJob?.status || '').toLowerCase();
          const newSt = (current.status || '').toLowerCase();
          if (oldSt !== newSt || newSt === 'running') {
            try {
              const full = await api.getJob(store.selectedJobId);
              store.updateSelectedJob(full);
            } catch { /* transient */ }
          }
        }
      }
    } catch { /* transient */ }
  }, [store.selectedJobId]);

  useEffect(() => {
    refreshList();
    pollInterval.current = setInterval(refreshList, 3000);
    return () => { if (pollInterval.current) clearInterval(pollInterval.current); };
  }, [refreshList]);

  // Scroll chat to bottom
  useEffect(() => {
    if (chatMessagesRef.current) chatMessagesRef.current.scrollTop = chatMessagesRef.current.scrollHeight;
  }, [store.selectedJobId, store.chatHistoryMap, chatBusy]);

  async function selectJob(jobId: string) {
    try {
      const job = await api.getJob(jobId);
      store.selectJob(jobId, job);
      // Reset log state and try to load existing log summary
      setLogSummary(null);
      setSelectedOperator(null);
      setOperatorEntries([]);
      try {
        const summary = await api.getJobLogSummary(jobId);
        if (summary?.operators?.length) setLogSummary(summary);
      } catch { /* no logs yet */ }
    } catch { /* */ }
  }

  async function collectLogs() {
    if (!store.selectedJobId) return;
    setLogCollecting(true);
    try {
      const summary = await api.collectJobLogs(store.selectedJobId);
      setLogSummary(summary);
    } catch { /* */ }
    setLogCollecting(false);
  }

  async function loadOperatorLogs(operator: string) {
    if (!store.selectedJobId) return;
    setSelectedOperator(operator);
    setLogEntriesLoading(true);
    try {
      const entries = await api.getOperatorLogs(store.selectedJobId, operator, {
        level: logLevelFilter || undefined,
        resource: logResourceFilter || undefined,
      });
      setOperatorEntries(entries);
    } catch { setOperatorEntries([]); }
    setLogEntriesLoading(false);
  }

  // Re-fetch when filters change
  useEffect(() => {
    if (selectedOperator && store.selectedJobId) loadOperatorLogs(selectedOperator);
  }, [logLevelFilter, logResourceFilter]);

  async function submitChat(rawText: string) {
    const text = rawText.trim();
    if (chatBusy) return;
    if (!text || !store.selectedJob || !store.selectedJobId) return;
    setChatInput('');
    store.pushChatMessage(store.selectedJobId, { role: 'user', content: text });
    setChatBusy(true);
    try {
      const history = store.getChatHistory(store.selectedJobId);
      const systemPrompt = buildSystemPrompt(store.selectedJob);
      const messages: ChatMessage[] = [{ role: 'system', content: systemPrompt }, ...history.filter(m => m.role !== 'system')];
      const { reply } = await api.sendChatMessage(messages);
      store.pushChatMessage(store.selectedJobId, { role: 'assistant', content: reply || '(no response)' });
    } catch (err: unknown) {
      store.pushChatMessage(store.selectedJobId, { role: 'assistant', content: `Error: ${(err as Error)?.message || 'Unknown'}` });
    }
    setChatBusy(false);
  }

  function sendChat() {
    void submitChat(chatInput);
  }

  const { jobs, selectedJobId, selectedJob } = store;
  const chatHistory = selectedJobId ? store.getChatHistory(selectedJobId) : [];
  const visibleChatHistory = chatHistory.filter(m => m.role !== 'system');
  const jobLabel = selectedJob?.caseId || selectedJobId?.substring(0, 12) || 'this run';
  const advisorSuggestions = selectedJob
    ? [
        {
          label: 'Root Cause',
          prompt: `Summarize the most likely root cause for ${jobLabel} and point me to the first failing command or strongest signal.`,
        },
        {
          label: 'Fix Plan',
          prompt: `Give me the top remediation steps for ${jobLabel}, ordered by likelihood and impact.`,
        },
        {
          label: 'Command Walkthrough',
          prompt: `Walk me through the key commands and actions in ${jobLabel}, and explain where the run deviated.`,
        },
        {
          label: 'Operator Signals',
          prompt: `Review the operator signals for ${jobLabel} and tell me what they imply about the failure or success of the run.`,
        },
      ]
    : [];

  // Build meta entries
  const meta: [string, string][] = [];
  if (selectedJob) {
    if (selectedJob.description) meta.push(['Description', selectedJob.description]);
    if (selectedJob.submittedAt) meta.push(['Submitted', new Date(selectedJob.submittedAt).toLocaleString()]);
    if (selectedJob.startedAt) meta.push(['Started', new Date(selectedJob.startedAt).toLocaleString()]);
    if (selectedJob.finishedAt) meta.push(['Finished', new Date(selectedJob.finishedAt).toLocaleString()]);
    if (selectedJob.startedAt && selectedJob.finishedAt) meta.push(['Duration', `${((new Date(selectedJob.finishedAt).getTime() - new Date(selectedJob.startedAt).getTime()) / 1000).toFixed(1)}s`]);
  }

  return (
    <div className="runs-layout">
      {/* Sidebar */}
      <section className="surface runs-sidebar">
        <div className="panel-header">
          <span className="section-label">Execution History</span>
          <h3>Test cases</h3>
        </div>
        <div className="run-list">
          {jobs.length === 0 && <div className="runs-empty">No test cases yet. Run a test case from the Planner.</div>}
          {jobs.map(job => {
            const jst = (job.status || 'unknown').toLowerCase();
            const label = job.caseId || job.id.substring(0, 10);
            const desc = job.description || '';
            const elapsed = job.startedAt && job.finishedAt
              ? `${((new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime()) / 1000).toFixed(1)}s`
              : job.startedAt
                ? `${((Date.now() - new Date(job.startedAt).getTime()) / 1000).toFixed(0)}s`
                : '';
            const kinds = job.summary?.resourceKinds?.join(', ') || job.type || '';
            return (
              <div key={job.id} className={`run-item${job.id === selectedJobId ? ' active' : ''}`} onClick={() => selectJob(job.id)}>
                <div className={`run-item-dot ${jst}`} />
                <div className="run-item-info">
                  <div className="run-item-id" title={job.id}>{label}</div>
                  <div className="run-item-meta">
                    {desc ? (desc.length > 80 ? desc.substring(0, 80) + '…' : desc) : kinds}
                    {elapsed ? ` · ${elapsed}` : ''}
                  </div>
                </div>
                <div className={`run-item-status ${jst}`}>{jst}</div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Detail Panel */}
      <section className="surface runs-detail">
        {!selectedJob ? (
          <div className="runs-detail-empty">Select a test case from the list to see details and discuss failures with the AI assistant.</div>
        ) : (() => {
          const st = (selectedJob.status || '').toLowerCase();
          return (
          <div className="runs-detail-content">
            <div className="run-detail-head">
              <div>
                <span className="section-label">Run Details</span>
                <h3>{selectedJob.caseId || selectedJobId?.substring(0, 12)}</h3>
              </div>
              <span className={`run-detail-badge ${st}`}>{st}</span>
            </div>

            <dl className="run-detail-meta">
              {meta.map(([k, v]) => (
                <div key={k} className={k === 'Description' ? 'wide' : ''}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>

            {selectedJob.error && st !== 'succeeded' && st !== 'completed' && (
              <div className="run-detail-error">{selectedJob.error}</div>
            )}

            {selectedJobId && (
              <FlightRecorder jobId={selectedJobId} job={selectedJob} showEmpty style={{ display: 'block' }} />
            )}

            {/* Operator Log Analysis */}
            <div className="operator-logs-panel">
              <div className="subpanel-head">
                <h4>
                  <FileText size={16} />
                  Operator logs
                </h4>
                <button
                  type="button"
                  className="collect-logs-btn"
                  disabled={logCollecting}
                  onClick={collectLogs}
                >
                  {logCollecting ? 'Collecting...' : 'Collect Logs'}
                </button>
              </div>

              {allOperators.length > 0 && (
                <div className="operator-tabs">
                  {allOperators.map(op => {
                    const summary = logSummary?.operators?.find(s => s.operator === op.name);
                    return (
                      <button
                        key={op.name}
                        type="button"
                        className={`operator-tab${selectedOperator === op.name ? ' active' : ''}${summary?.hasError ? ' has-error' : ''}`}
                        onClick={() => loadOperatorLogs(op.name)}
                      >
                        <span className="op-tab-name">{op.name.replace('-operator', '')}</span>
                        {summary && (
                          <span className="op-tab-counts">
                            {summary.entryCount}
                            {summary.errorCount > 0 && <span className="op-tab-err">{summary.errorCount}E</span>}
                            {summary.warnCount > 0 && <span className="op-tab-warn">{summary.warnCount}W</span>}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedOperator && logSummary ? (
                <div className="operator-log-viewer">
                  <div className="log-filters">
                    <select value={logLevelFilter} onChange={e => setLogLevelFilter(e.target.value)}>
                      <option value="">All levels</option>
                      <option value="error">Error</option>
                      <option value="warn">Warn</option>
                      <option value="info">Info</option>
                      <option value="debug">Debug</option>
                    </select>
                    <input
                      type="text"
                      placeholder="Filter by resource name..."
                      value={logResourceFilter}
                      onChange={e => setLogResourceFilter(e.target.value)}
                    />
                  </div>

                  {logEntriesLoading ? (
                    <div className="log-loading">Loading...</div>
                  ) : operatorEntries.length === 0 ? (
                    <div className="log-empty">No log entries match.</div>
                  ) : (
                    <div className="log-table">
                      <div className="log-table-head">
                        <span>Time</span>
                        <span>Level</span>
                        <span>Origin</span>
                        <span>Message</span>
                      </div>
                      <div className="log-entries">
                        {operatorEntries.slice(0, 200).map((entry, i) => (
                          <div key={i} className={`log-entry level-${entry.level}`}>
                            <span className="log-ts">{entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : '--'}</span>
                            <span className={`log-level ${entry.level}`}>{entry.level.toUpperCase()}</span>
                            <span className="log-origin">
                              {entry.controller && <span className="log-ctrl">{entry.controller}</span>}
                              {entry.resource && <span className="log-res">{entry.resource}</span>}
                              {!entry.controller && !entry.resource && <span className="log-ctrl">system</span>}
                            </span>
                            <span className="log-msg">{entry.message}</span>
                          </div>
                        ))}
                        {operatorEntries.length > 200 && (
                          <div className="log-truncated">Showing 200 of {operatorEntries.length} entries</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              ) : selectedOperator && !logSummary ? (
                <div className="operator-logs-empty">
                  Click "Collect Logs" to fetch logs for <strong>{selectedOperator}</strong>.
                </div>
              ) : !logSummary && !logCollecting ? (
                <div className="operator-logs-empty">
                  Select an operator tab, then click "Collect Logs" to fetch pod logs.
                </div>
              ) : null}
            </div>

            {/* Chat Panel */}
            <div className="chat-panel">
              <div className="chat-panel-head">
                <div className="chat-panel-title">
                  <Info size={16} />
                  <h4>Advisor</h4>
                </div>
                <div className="chat-status-meta">
                  <span className={`chat-status-dot${chatBusy ? ' busy' : ''}`} />
                  <span>{chatBusy ? 'Analyzing this run' : 'Ready for run-aware questions'}</span>
                </div>
              </div>

              <div className="chat-surface">
                <div className="chat-messages" ref={chatMessagesRef}>
                  {visibleChatHistory.length === 0 && (
                    <div className="chat-empty-state">
                      <span className="chat-empty-kicker">Run-aware assistant</span>
                      <h5>Ask about this execution</h5>
                      <p>Start with a quick prompt below or ask your own question. The advisor already has this run's commands, status, and failure context.</p>
                      <div className="chat-empty-actions">
                        {advisorSuggestions.map((item) => (
                          <button
                            key={item.label}
                            type="button"
                            className="chat-shortcut"
                            disabled={chatBusy}
                            onClick={() => { void submitChat(item.prompt); }}
                          >
                            {item.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                  {visibleChatHistory.map((m, i) => (
                    <div key={i} className={`chat-row ${m.role}`}>
                      <div className={`chat-avatar ${m.role}`}>{m.role === 'assistant' ? 'AI' : 'You'}</div>
                      <div className="chat-message">
                        <div className="chat-meta">
                          <span className="chat-author">{m.role === 'assistant' ? 'Advisor' : 'You'}</span>
                          <span className="chat-meta-sep">•</span>
                          <span className="chat-meta-note">{m.role === 'assistant' ? 'Run-aware analysis' : 'Prompt'}</span>
                        </div>
                        <div className={`chat-msg ${m.role}`}>
                          {m.role === 'assistant' ? <Markdown>{m.content}</Markdown> : m.content}
                        </div>
                      </div>
                    </div>
                  ))}
                  {chatBusy && (
                    <div className="chat-row assistant live">
                      <div className="chat-avatar assistant">AI</div>
                      <div className="chat-message">
                        <div className="chat-meta">
                          <span className="chat-author">Advisor</span>
                          <span className="chat-meta-sep">•</span>
                          <span className="chat-meta-note">Thinking</span>
                        </div>
                        <div className="chat-msg assistant typing">
                          <span className="typing-dots">
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                            <span className="typing-dot" />
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="chat-composer">
                  <textarea
                    className="chat-input"
                    value={chatInput}
                    onChange={e => setChatInput(e.target.value)}
                    placeholder="Ask what failed, what to retry, or what the logs imply..."
                    rows={1}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); } }}
                  />
                  <div className="chat-input-row">
                    <span className="chat-composer-hint">Enter to send · Shift+Enter for newline</span>
                    <button type="button" className="chat-send-btn" disabled={chatBusy || !chatInput.trim()} onClick={sendChat}>
                      <Send size={14} />
                      Send
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          );
        })()}
      </section>
    </div>
  );
}
