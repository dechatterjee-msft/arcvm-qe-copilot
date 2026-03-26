import { useState, useEffect, useMemo } from 'react';
import { PlayCircle } from 'lucide-react';
import type { Job } from '../types';

interface FlightRecorderProps {
  jobId: string;
  job: Job;
  showEmpty?: boolean;
  style?: React.CSSProperties;
}

interface FRAction {
  name: string;
  success?: boolean;
  error?: string;
  steps: FRStep[];
  startedAt?: string;
  finishedAt?: string;
  running?: boolean;
}

interface FRStep {
  command?: string;
  success?: boolean;
  output?: string;
  durationMs?: number;
}

export default function FlightRecorder({ jobId, job, showEmpty, style }: FlightRecorderProps) {
  const jobStatus = (job.status || '').toLowerCase();
  const jobSuccess = jobStatus === 'succeeded' || jobStatus === 'completed';
  const isLive = (jobStatus === 'running' || jobStatus === 'queued') && (job.progress?.actions?.length ?? 0) > 0;

  const allActions = useMemo<FRAction[]>(() => {
    const result = job.result;
    const iterations = result?.iterations || [];
    const prereqSteps = result?.prereqSteps || [];
    const actions: FRAction[] = [];

    if (isLive) {
      for (const pa of job.progress!.actions) {
        actions.push({
          name: pa.name,
          success: pa.done ? pa.success : undefined,
          error: pa.error || '',
          steps: pa.steps || [],
          startedAt: pa.started,
          finishedAt: pa.done ? pa.started : undefined,
          running: !pa.done,
        });
      }
    } else {
      for (const iter of iterations) {
        for (const a of (iter.actions || [])) {
          actions.push({ ...a, steps: a.steps || [] });
        }
      }
      if (actions.length === 0 && prereqSteps.length > 0) {
        actions.push({
          name: 'prereqs',
          success: jobSuccess,
          error: job.error || '',
          steps: prereqSteps,
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
        });
      }
      if (actions.length === 0 && job.error) {
        actions.push({
          name: 'setup',
          success: false,
          error: job.error,
          steps: [],
          startedAt: job.startedAt,
          finishedAt: job.finishedAt,
        });
      }
    }
    return actions;
  }, [job, isLive, jobSuccess]);

  const [expandedActions, setExpandedActions] = useState<Set<number>>(() => {
    if (isLive) return new Set(allActions.map((_, i) => i));
    return allActions.length > 0 ? new Set([0]) : new Set();
  });
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());

  // Auto-expand all actions when live, and expand new ones as they appear
  useEffect(() => {
    if (isLive) {
      setExpandedActions(new Set(allActions.map((_, i) => i)));
    }
  }, [allActions.length, isLive]);

  if (allActions.length === 0) {
    if (showEmpty) {
      return <div className="fr-empty">No execution data yet.</div>;
    }
    return null;
  }

  let totalMs = 0;
  if (job.startedAt && job.finishedAt) totalMs = new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
  else if (job.startedAt) totalMs = Date.now() - new Date(job.startedAt).getTime();
  const totalSec = (totalMs / 1000).toFixed(1);

  const passCount = allActions.filter(a => a.success === true).length;
  const failCount = allActions.filter(a => a.success === false).length;
  const runningCount = allActions.filter(a => a.running).length;

  const summaryParts: string[] = [];
  if (runningCount > 0) summaryParts.push(`${runningCount} running`);
  summaryParts.push(`${passCount}/${allActions.length} passed`);
  if (failCount > 0) summaryParts.push(`${failCount} failed`);

  const badgeClass = isLive ? 'running' : jobSuccess ? 'pass' : 'fail';
  const badgeText = isLive ? 'LIVE' : jobSuccess ? 'PASS' : 'FAIL';

  function toggleAction(idx: number) {
    setExpandedActions(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  }

  function toggleStep(key: string) {
    setExpandedSteps(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <div className="flight-recorder visible" style={style}>
      <div className="fr-header">
        <div className="fr-title">
          <PlayCircle size={14} />
          <span>Execution timeline</span>
          <span className="fr-job-id">{jobId.substring(0, 12)}</span>
          <span className={`fr-badge ${badgeClass}`}>{badgeText}</span>
        </div>
        <span className="fr-elapsed">{totalSec}s</span>
      </div>
      <div className="fr-body">
        <div className="fr-timeline">
          {allActions.map((action, idx) => {
            const nodeClass = action.running ? 'running' : action.success ? 'pass' : 'fail';
            const steps = action.steps || [];
            let actionMs = 0;
            if (action.startedAt && action.finishedAt) actionMs = new Date(action.finishedAt).getTime() - new Date(action.startedAt).getTime();
            else if (action.startedAt && action.running) actionMs = Date.now() - new Date(action.startedAt).getTime();
            else actionMs = steps.reduce((s, st) => s + (st.durationMs || 0), 0);
            const actionSec = (actionMs / 1000).toFixed(1);
            const stepCountLabel = steps.length > 0 ? `${steps.length} cmd${steps.length > 1 ? 's' : ''}` : '';
            const badgeLabel = action.running ? 'RUNNING' : action.success ? 'PASS' : 'FAIL';
            const isExpanded = expandedActions.has(idx);

            return (
              <div key={idx} className={`fr-action${isExpanded ? ' expanded' : ''}`}>
                <div className={`fr-node ${nodeClass}`}><div className="fr-node-dot" /></div>
                <div className="fr-action-head" onClick={() => toggleAction(idx)}>
                  <span className="fr-action-name">{action.name || 'unknown'}</span>
                  <span className="fr-action-meta">
                    <span className="dur">{actionSec}s</span>
                    {stepCountLabel && <span>{stepCountLabel}</span>}
                    <span className={`fr-badge ${nodeClass}`}>{badgeLabel}</span>
                  </span>
                </div>
                <div className="fr-steps">
                  {steps.map((step, si) => {
                    const sClass = step.success ? 'pass' : 'fail';
                    const durLabel = step.durationMs != null ? `${(step.durationMs / 1000).toFixed(1)}s` : '';
                    const stepKey = `${idx}-${si}`;
                    const stepExpanded = expandedSteps.has(stepKey);

                    return (
                      <div key={si} className={`fr-step${stepExpanded ? ' expanded' : ''}`} onClick={() => toggleStep(stepKey)}>
                        <div className="fr-step-head">
                          <span className={`fr-step-indicator ${sClass}`} />
                          <span className="fr-step-cmd">{step.command || ''}</span>
                          <span className="fr-step-dur">{durLabel}</span>
                        </div>
                        {step.output && (
                          <div className={`fr-step-output${step.success ? '' : ' fail-output'}`}>{step.output}</div>
                        )}
                      </div>
                    );
                  })}
                  {action.error && !action.success && (
                    <div className="fr-step fr-step-error">
                      <div className="fr-step-head">
                        <span className="fr-step-indicator fail" />
                        <span className="fr-step-cmd fr-step-cmd-error">Error: {action.error}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <div className="fr-summary">{summaryParts.join(' · ')}</div>
      </div>
    </div>
  );
}
