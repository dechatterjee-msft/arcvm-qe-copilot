/* ─── Job / Run types ───────────────────────────────────── */

export interface JobSummary {
  resourceGroup?: string;
  resourceKinds?: string[];
}

export interface StepResult {
  command: string;
  success: boolean;
  output?: string;
  durationMs?: number;
}

export interface ActionResult {
  name: string;
  success: boolean;
  error?: string;
  steps: StepResult[];
  startedAt?: string;
  finishedAt?: string;
  iteration?: number;
}

export interface IterationResult {
  index: number;
  actions: ActionResult[];
}

export interface JobResult {
  iterations?: IterationResult[];
  prereqSteps?: StepResult[];
  iterationsRequested?: number;
}

export interface ProgressAction {
  name: string;
  done: boolean;
  success: boolean;
  error?: string;
  steps: StepResult[];
  started?: string;
}

export interface JobProgress {
  actions: ProgressAction[];
}

export interface Job {
  id: string;
  type: string;
  status: string;
  caseId?: string;
  description?: string;
  error?: string;
  submittedAt?: string;
  startedAt?: string;
  finishedAt?: string;
  summary?: JobSummary;
  result?: JobResult;
  progress?: JobProgress;
}

/* ─── Test Plan types ──────────────────────────────────── */

export interface RunRequest {
  subscriptionId?: string;
  resourceGroup?: string;
  location?: string;
  customLocationId?: string;
  caseId?: string;
  description?: string;
  resources?: Record<string, Record<string, unknown>>;
}

export interface TestCase {
  caseId: string;
  objective?: string;
  mutation?: string;
  expectedOutcome?: string;
  citations?: string[];
  runRequest?: RunRequest;
}

export interface Ruleset {
  sourceType?: string;
  totalRules?: number;
}

export interface RetrievedRule {
  section?: string;
  content?: string;
}

export interface EnsembleCandidate {
  tier: string;
  model: string;
  score?: number;
  latencyMs?: number;
  error?: string;
}

export interface EnsembleInfo {
  enabled: boolean;
  selectedTier?: string;
  selectedModel?: string;
  reason?: string;
  candidates?: EnsembleCandidate[];
}

export interface TestPlanResponse {
  cases: TestCase[];
  model?: string;
  ruleset?: Ruleset;
  retrievedRules?: RetrievedRule[];
  ensemble?: EnsembleInfo;
}

export interface FileContextItem {
  fileName: string;
  content: string;
}

export interface TestPlanRequest {
  baseline: Record<string, unknown>;
  caseCount: number;
  strategy: string;
  ensembleEnabled: boolean;
  layers: Record<string, unknown>;
  retrieval: {
    query: string;
    topK: number;
    useEmbeddings: boolean;
    lexical: string;
  };
  fileContext?: FileContextItem[];
}

/* ─── Azure Discovery types ────────────────────────────── */

export interface AzureSubscription {
  id: string;
  name: string;
  state: string;
}

export interface AzureResourceGroup {
  name: string;
  location: string;
}

export interface AzureCustomLocation {
  id: string;
  name: string;
  location: string;
}

/* ─── Plan Store types ─────────────────────────────────── */

export interface SavedPlan {
  id: string;
  name: string;
  strategy?: string;
  model?: string;
  caseCount?: number;
  cases?: TestCase[];
  createdAt?: string;
}

/* ─── Chat types ───────────────────────────────────────── */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/* ─── Operator Log Analysis types ──────────────────────── */

export interface OperatorInfo {
  name: string;
  namespace: string;
  labelSelector: string;
  controllers?: string[];
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  controller?: string;
  reconcileId?: string;
  resource?: string;
  operator: string;
  pod?: string;
  raw?: string;
}

export interface OperatorLogSummary {
  operator: string;
  entryCount: number;
  errorCount: number;
  warnCount: number;
  hasError: boolean;
}

export interface JobLogSummary {
  jobId: string;
  operators: OperatorLogSummary[];
}
