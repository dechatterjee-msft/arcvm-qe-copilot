# arcvm-qe-copilot

AI-driven QE test planner for Azure Local resources. Generates structured test plans with phased CLI command flows (Provision → Verify → Cleanup) for Logical Networks, NICs, NSGs, Storage Paths, VMs, VHDs, Storage Containers, Gallery Images, and full E2E stacks.

## Features

- **AI test plan generation** — Azure OpenAI-powered planning with retrieval-augmented generation (RAG) and ensemble model fanout
- **9 resource tabs** — Logical Networks, NICs, NSGs, Storage Paths, VMs, VHDs, Storage Containers, Gallery Images, and E2E
- **Depth presets** — Quick (4), Standard (8), and Thorough (12) test case generation
- **Phased CLI commands** — Auto-generated `az` commands in Provision → Verify → Cleanup order
- **Editable & runnable** — Edit generated commands inline, run individually or in bulk
- **Save & load plans** — Persist test plans to SQLite for later retrieval
- **Embedding cache** — SQLite-backed vector cache for Azure Docs retrieval
- **Provision & longevity harness** — Run provisioning or longevity test loops via API
- **Structured logging** — Bracket-tagged log output (`[Azure OpenAI]`, `[Server]`, `[Planner]`, etc.)

## Project structure

```
arcvm-qe-copilot/
├── cmd/
│   ├── bootstrap/main.go    # First-time setup CLI (schemas, seeds, env)
│   └── server/main.go       # HTTP server entry point
├── internal/
│   ├── ai/                   # Azure OpenAI client, planner, knowledge retrieval
│   ├── api/                  # HTTP routes, request logging middleware
│   ├── azure/                # Azure CLI wrapper (az commands)
│   ├── config/               # Configuration helpers
│   ├── harness/              # Provision & longevity test harness
│   ├── jobs/                 # Async job manager
│   ├── logging/              # Tagged logger factory ([Component] prefixes)
│   ├── spec/                 # Request/resource spec types & validation
│   └── store/                # SQLite plan store
├── configs/                  # Configuration files
├── examples/                 # Sample request payloads
├── Makefile                  # Build, test, bootstrap targets
├── .env.example              # Template for environment variables
└── go.mod
```

## Quick start

### Prerequisites

- **Go 1.24+** — [install](https://go.dev/dl/)
- **Azure OpenAI resource** with chat + embedding deployments
- Works on **macOS**, **Linux**, and **WSL**

### 1. Clone and bootstrap

```bash
git clone <repo-url> && cd arcvm-qe-copilot
make bootstrap
```

This will:
- Install Go dependencies
- Copy `.env.example` → `.env` (if `.env` doesn't exist)
- Create `data/` and initialize SQLite schemas (embeddings + saved plans)
- Create `artifacts/` for longevity reports

### 2. Configure credentials

Edit `.env` with your Azure OpenAI details:

```bash
AZURE_OPENAI_ENABLED=true
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your-api-key
AZURE_OPENAI_DEPLOYMENT=your-chat-deployment
```

### 3. Seed embeddings and run

```bash
make bootstrap   # re-run to seed embeddings now that credentials are set
make run          # start the server on :8080
```

Open `http://localhost:8080` in your browser.

### WSL notes

- Use `localhost:8080` from a Windows browser pointed at the WSL network
- If `localhost` doesn't resolve, use `$(hostname -I | awk '{print $1}'):8080`
- The SQLite database in `data/` should live on the Linux filesystem (not `/mnt/c/`) for performance

## Make targets

| Command | Description |
|---|---|
| `make bootstrap` | First-time setup: deps, DB schemas, seed embeddings |
| `make run` | Start the server on `:8080` |
| `make build` | Compile binary to `bin/` |
| `make test` | Run all unit tests |
| `make seed` | Re-seed embeddings only (skips cached) |
| `make lint` | Format code with `gofmt` |
| `make clean` | Remove build artifacts |
| `make help` | Show all available targets |

## Environment variables

| Variable | Description | Default |
|---|---|---|
| `AZURE_OPENAI_ENABLED` | Enable AI features | `false` |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint URL | — |
| `AZURE_OPENAI_API_KEY` | API key | — |
| `AZURE_OPENAI_API_VERSION` | API version | `2024-12-01-preview` |
| `AZURE_OPENAI_DEPLOYMENT` | Primary chat deployment | — |
| `AZURE_OPENAI_DEPLOYMENT_FAST` | Fast model (ensemble) | same as primary |
| `AZURE_OPENAI_DEPLOYMENT_DEEP` | Deep model (ensemble) | same as primary |
| `AZURE_OPENAI_EMBEDDING_DEPLOYMENT` | Embedding model | `text-embedding-3-small` |
| `AZURE_OPENAI_EMBEDDING_DB_PATH` | SQLite path for embeddings | `./data/embeddings.db` |
| `AZURE_OPENAI_ADVISOR_ENSEMBLE_ENABLED` | Enable multi-model fanout | `false` |
| `HOST` | Bind host | `0.0.0.0` |
| `PORT` | Bind port | `8080` |
| `AZURE_CONFIG_DIR` | Per-job Azure CLI config directory | `./.azure` |
| `REPORT_BASE_DIR` | Longevity report output directory | `./artifacts/longevity` |

## API endpoints

```
GET  /healthz                       — Health check
GET  /                              — UI

POST /api/v1/ai/test-plan           — Generate AI test plan
POST /api/v1/provision-jobs         — Start provision job
POST /api/v1/longevity-jobs         — Start longevity job
GET  /api/v1/jobs                   — List all jobs
GET  /api/v1/jobs/{id}              — Get job status

POST /api/v1/plans                  — Save plan
GET  /api/v1/plans                  — List saved plans
GET  /api/v1/plans/{id}             — Get saved plan
DELETE /api/v1/plans/{id}           — Delete saved plan
```

## Logging

All components use bracket-tagged structured logging via `internal/logging`:

```
2026/03/26 10:15:03 [Server] 200 | 3.512ms | GET /api/v1/plans
2026/03/26 10:15:04 [Azure OpenAI] Request deployment: o4-mini | body: 2.1 KB
2026/03/26 10:15:06 [Azure OpenAI] Response 200 | 1.823s | body: 4.5 KB
2026/03/26 10:15:06 [Planner] Generated 8 test cases for logicalNetwork
2026/03/26 10:15:10 [Azure CLI] Running: az stack-hci-vm network lnet create ...
2026/03/26 10:15:10 [Bootstrap] Embedding store initialized: data/embeddings.db
```

## Examples

Sample request payloads are in `examples/`:

- `lnet-nic-request.json` — Logical network + NIC provisioning
- `static-lnet-request.json` — Static IP logical network
- `ai-static-plan-request.json` — AI test plan request
- `ai-ruleset-preview-azure-docs.json` — Azure Docs ruleset preview
- `ai-ruleset-preview-layered.json` — Layered multi-source ruleset

```bash
curl -X POST http://localhost:8080/api/v1/provision-jobs \
  -H 'Content-Type: application/json' \
  --data @examples/static-lnet-request.json
```

To run the same payload through longevity actions (`provision -> show -> cleanup`):

```bash
curl -X POST http://localhost:8080/api/v1/longevity-jobs \
  -H 'Content-Type: application/json' \
  --data @examples/static-lnet-request.json
```

## AI test planner

The AI planner is the core of this project — it takes a baseline Azure Local resource spec and generates a full test plan with mutated resource payloads, phased CLI commands, and evidence-backed citations.

### Pipeline overview

```
TestPlanRequest
       │
       ▼
┌──────────────────────────────────┐
│  1. Knowledge Loading            │
│  Azure Docs, ADO repos, local   │
│  Markdown, or layered sources    │
│  → parsed into rules with SHA1  │
│    content-addressed IDs         │
└──────────────┬───────────────────┘
               ▼
┌──────────────────────────────────┐
│  2. BM25 Retrieval               │
│  k1=1.2, b=0.75                 │
│  Domain boosting for Azure Local │
│  keywords (+0.1 for validation,  │
│  admission, stack-hci)           │
│  Default topK=18                 │
└──────────────┬───────────────────┘
               ▼
┌──────────────────────────────────┐
│  3. Embedding Rerank (optional)  │
│  Azure OpenAI embedding vectors  │
│  Cosine similarity scoring       │
│  SQLite-backed vector cache      │
└──────────────┬───────────────────┘
               ▼
┌──────────────────────────────────┐
│  4. Context Assembly             │
│  Merge retrieved rules + user    │
│  chunks + uploaded files         │
│  Build system + user prompt      │
└──────────────┬───────────────────┘
               ▼
┌──────────────────────────────────┐
│  5. Ensemble Fanout (optional)   │
│  Concurrent model tiers:         │
│  balanced (45s) + fast (20s)     │
│  Weighted scoring rubric         │
│  Winner = highest aggregate      │
└──────────────┬───────────────────┘
               ▼
┌──────────────────────────────────┐
│  6. Post-Processing              │
│  Citation validation + backfill  │
│  Case ID normalization (TC-001…) │
│  Resource backfill from baseline │
└──────────────┬───────────────────┘
               ▼
         TestPlanResponse
```

### Knowledge sources

| Source | Config | Description |
|---|---|---|
| **Azure Docs** | `docSource.type: "azure-docs"` or `layers.azureDocs[]` | Live HTTP scrape of Microsoft Learn URLs, HTML stripped to Markdown rules |
| **ADO Repository** | `docSource.type: "ado"` with `ado: {...}` | Fetches Markdown from Azure DevOps Git Items API (v7.1), PAT auth, branch-aware |
| **Local Markdown** | `docSource.type: "local"` with `localPath` | Reads a local file and parses bullet/numbered list rules |
| **Layered** | `layers: { azureDocs: [...], readmeArchitecture: {...} }` | Combines multiple Azure Docs URLs + an optional ADO/local readme. Rules deduped across layers |
| **User-uploaded files** | `fileContext: [{ fileName, content }]` | Raw text injected into the LLM prompt alongside documentation chunks |
| **Env var fallback** | `AZDO_*` or `AZURE_DOCS_URL` | Auto-resolved when no `docSource` is provided |

### Retrieval stack

**BM25 scoring** — Standard BM25 with `k1=1.2`, `b=0.75`. IDF calculated as `log(1 + (N - df + 0.5) / (df + 0.5))`. Domain-specific boosts of +0.1 applied for Azure Local keywords (`validation`, `admission`, `azure local`, `stack-hci`). Falls back to simple lexical token-match if `lexical` is not set to `"bm25"`.

**Embedding reranking** — When `retrieval.useEmbeddings: true` and an embedding deployment is configured, each rule is vectorized via Azure OpenAI's embedding API, scored by cosine similarity against the query vector, and re-sorted. Falls back gracefully to BM25-only on failure.

**Embedding cache** — SQLite table (`embeddings`) keyed by SHA1 of `deployment + text`. Avoids redundant API calls across requests. Seeded at bootstrap time from Azure Docs URLs.

### Ensemble model fanout

When `ensembleEnabled: true` (per-request or via `AZURE_OPENAI_ADVISOR_ENSEMBLE_ENABLED`), the planner fans out to multiple model tiers concurrently:

| Tier | Deployment | Timeout |
|---|---|---|
| `balanced` | `AZURE_OPENAI_DEPLOYMENT` | 45s |
| `fast` | `AZURE_OPENAI_DEPLOYMENT_FAST` | 20s |

Each candidate plan is scored using a weighted rubric:

| Metric | Weight | Logic |
|---|---|---|
| Completeness | 0.45 | % of fields filled (objective, mutation, expectedOutcome, resources) |
| Count fit | 0.25 | `1 - |actual - target| / target`, clamped to [0, 1] |
| Citations | 0.20 | % of cases with ≥1 citation (1.0 if no context provided) |
| Diversity | 0.10 | Unique caseID ratio |

The highest-scoring candidate wins. If all candidates fail, the planner falls back to a single-model call with the default deployment. Ensemble requires ≥2 unique deployments — if `balanced` and `fast` point to the same model, ensemble is skipped.

### Test case output

Each generated `PlannedTestCase` contains:

| Field | Description |
|---|---|
| `caseId` | Normalized sequential ID (`TC-001`, `TC-002`, …) |
| `objective` | What the test validates |
| `mutation` | Delta from the baseline resource spec |
| `expectedOutcome` | Pass/fail criteria |
| `citations` | Chunk IDs from documentation (validated against known IDs, backfilled if empty) |
| `runRequest` | Full executable resource spec — backfilled from baseline if the LLM omits resources or envelope fields |

### Post-processing

- **Citation normalization** — Validates each citation against known chunk IDs, removes duplicates, assigns first chunk ID as fallback if empty
- **Case ID normalization** — Rewrites LLM-generated IDs to sequential `TC-001`, `TC-002`, …
- **Resource backfill** — Copies baseline `resources`, `subscriptionId`, `resourceGroup`, `location`, and `customLocationId` into any case where the LLM omitted them

### Depth presets (UI)

The embedded UI offers three depth presets that set `caseCount`:

| Preset | Cases | Use case |
|---|---|---|
| Quick | 4 | Fast smoke test coverage |
| Standard | 8 | Balanced happy-path + negative |
| Thorough | 12 | Deep coverage with edge cases |

### Ruleset preview

Preview the retrieval pipeline without calling the LLM — useful for debugging which rules are being selected:

```bash
curl -X POST http://localhost:8080/api/v1/ai/rulesets/preview \
  -H 'Content-Type: application/json' \
  --data @examples/ai-ruleset-preview-azure-docs.json
```

Returns `RulesetMetadata` (content-addressed ID, version hash, source info, rule count) and the retrieved `RuleEntry` list with scores.

### Example: generate a test plan

```bash
curl -X POST http://localhost:8080/api/v1/ai/test-plan \
  -H 'Content-Type: application/json' \
  --data '{
    "baseline": {
      "subscriptionId": "00000000-0000-0000-0000-000000000000",
      "resourceGroup": "rg-arcvm-qe",
      "location": "eastus2",
      "customLocationId": "/subscriptions/.../customLocations/arc-local-cl",
      "resources": {
        "logicalNetwork": {
          "name": "qe-static-lnet-001",
          "addressPrefix": "192.168.201.0/24",
          "ipAllocationMethod": "Static",
          "ipPoolStart": "192.168.201.50",
          "ipPoolEnd": "192.168.201.100",
          "gateway": "192.168.201.1",
          "dnsServers": ["192.168.201.10"],
          "vlan": 201,
          "vmSwitchName": "ConvergedSwitch"
        }
      }
    },
    "caseCount": 8,
    "strategy": "balanced coverage of happy-path, idempotency, and negative scenarios",
    "layers": {
      "azureDocs": [
        { "url": "https://learn.microsoft.com/en-us/azure/azure-local/manage/create-logical-networks" }
      ]
    },
    "retrieval": {
      "query": "static lnet admission immutability overlap",
      "topK": 20,
      "useEmbeddings": true,
      "lexical": "bm25"
    }
  }'
```

### Example: layered RAG with ADO + Azure Docs

```bash
curl -X POST http://localhost:8080/api/v1/ai/test-plan \
  -H 'Content-Type: application/json' \
  --data '{
    "baseline": { ... },
    "caseCount": 10,
    "layers": {
      "azureDocs": [
        { "url": "https://learn.microsoft.com/en-us/azure/azure-local/manage/create-logical-networks" }
      ],
      "readmeArchitecture": {
        "type": "ado",
        "ado": {
          "organizationUrl": "https://dev.azure.com/<org>",
          "project": "One",
          "repository": "azlocal-overlay",
          "filePath": "/docs/implementation/.../README.md",
          "branch": "main"
        }
      }
    },
    "retrieval": { "topK": 20, "useEmbeddings": true, "lexical": "bm25" }
  }'
```

## Provision & longevity harness

Generated test cases produce `runRequest` payloads that can be submitted directly to the provision and longevity endpoints.

### Supported resource types

| Resource | Singular field | Plural field |
|---|---|---|
| Logical Network | `logicalNetwork` | `logicalNetworks` |
| Network Interface | `networkInterface` | `networkInterfaces` |
| Network Security Group | `networkSecurityGroup` | — |
| Storage Path | `storagePath` | — |
| Virtual Machine | `virtualMachine` | — |
| Virtual Hard Disk | `virtualHardDisk` | — |
| Storage Container | `storageContainer` | — |
| Gallery Image | `galleryImage` | — |

### Required fields

Every `runRequest` requires: `subscriptionId`, `resourceGroup`, `location`, `customLocationId`, and at least one resource in `resources`.

### Network reference rules

- If one logical network is supplied, NICs can omit `networkRef` — they attach to that logical network automatically
- If multiple logical networks are supplied, each NIC must set `networkRef`
- `networkRef` can reference an existing Azure resource ID or a logical network name created in the same request

### Longevity actions

| Action | Behavior |
|---|---|
| `provision` | Create resources (idempotent — attempts `show` first) |
| `show` | Verify all supplied resources exist |
| `cleanup` | Delete resources in reverse dependency order (NICs first, then LNETs) |

Longevity runs loop through the configured actions with configurable iterations, duration limits, intervals, jitter, and max failure thresholds.

### Running a provision job

```bash
curl -X POST http://localhost:8080/api/v1/provision-jobs \
  -H 'Content-Type: application/json' \
  --data @examples/static-lnet-request.json
```

### Running a longevity loop

```bash
curl -X POST http://localhost:8080/api/v1/longevity-jobs \
  -H 'Content-Type: application/json' \
  --data @examples/static-lnet-request.json
```

## Notes

- Jobs are asynchronous and stored in memory
- Create paths are idempotent: the harness attempts `show` before creating
- Each job gets an isolated `.azure` config directory to prevent concurrent CLI session conflicts
- The SQLite database uses [modernc.org/sqlite](https://pkg.go.dev/modernc.org/sqlite) (pure Go, no CGO required)
