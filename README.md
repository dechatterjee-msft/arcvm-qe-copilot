# arcvm-qe-copilot

AI-driven QE test planner for Azure Local resources. Generates structured test plans with CLI command flows for Logical Networks, NICs, NSGs, Storage Paths, VMs, VHDs, Storage Containers, Gallery Images, and full E2E stacks.

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
- Create the `data/` directory and initialize SQLite schemas (embeddings + saved plans)
- Create the `artifacts/` directory for longevity reports

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
| `AZURE_OPENAI_EMBEDDING_DB_PATH` | SQLite path | `./data/embeddings.db` |
| `HOST` | Bind host | `0.0.0.0` |
| `PORT` | Bind port | `8080` |

## Endpoints

```text
GET  /healthz
GET  /                              — UI
POST /api/v1/ai/test-plan           — Generate test plan
POST /api/v1/provision-jobs
POST /api/v1/longevity-jobs
POST /api/v1/plans                  — Save plan
GET  /api/v1/plans                  — List plans
GET  /api/v1/plans/{id}             — Get plan
DELETE /api/v1/plans/{id}           — Delete plan
GET  /api/v1/jobs
GET  /api/v1/jobs/{id}
```

## Static LNET quick start

Use [static-lnet-request.json](/Users/debankurchatterjee/go/arcvm-qe-copilot/examples/static-lnet-request.json#L1) to run a single Static logical network flow.

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

## AI planner (Static LNET)

If Azure OpenAI is enabled in `.env`, you can generate a Static LNET test plan from a baseline request:

```bash
curl -X POST http://localhost:8080/api/v1/ai/static-lnet-test-plan \
  -H 'Content-Type: application/json' \
  --data '{
    "baseline": {
      "subscriptionId": "00000000-0000-0000-0000-000000000000",
      "resourceGroup": "rg-arcvm-qe",
      "location": "eastus2",
      "customLocationId": "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-arcvm-qe/providers/Microsoft.ExtendedLocation/customLocations/arc-local-cl",
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
      },
      "longevity": {
        "iterations": 1,
        "actions": ["provision", "show", "cleanup"]
      }
    },
    "caseCount": 10,
    "strategy": "balanced"
  }'
```

The response includes generated test cases with mutated `runRequest` payloads that can be submitted to `/api/v1/provision-jobs` or `/api/v1/longevity-jobs`.

You can also pass Microsoft documentation snippets as context:

```bash
curl -X POST http://localhost:8080/api/v1/ai/static-lnet-test-plan \
  -H 'Content-Type: application/json' \
  --data '{
    "baseline": {
      "subscriptionId": "00000000-0000-0000-0000-000000000000",
      "resourceGroup": "rg-arcvm-qe",
      "location": "eastus2",
      "customLocationId": "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-arcvm-qe/providers/Microsoft.ExtendedLocation/customLocations/arc-local-cl",
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
    "caseCount": 5,
    "strategy": "focus on static LNET edge cases from docs",
    "contextChunks": [
      {
        "chunkId": "ms-static-lnet-required-fields",
        "sourceUrl": "https://learn.microsoft.com/en-us/azure/azure-local/manage/create-logical-networks?view=azloc-2602&tabs=azurecli",
        "section": "Create a static logical network via CLI",
        "content": "For static IP, required parameters include gateway, dns-servers, and vlan.",
        "lastUpdated": "2026-01-23"
      },
      {
        "chunkId": "ms-static-lnet-overlap",
        "sourceUrl": "https://learn.microsoft.com/en-us/azure/azure-local/manage/create-logical-networks?view=azloc-2602&tabs=azurecli",
        "section": "Create logical network via CLI",
        "content": "Creating logical networks with overlapping IP pools on the same VLAN is not permitted."
      }
    ]
  }'
```

When context chunks are provided, each generated test case includes `citations` that map back to the supplied `chunkId` values.

## ADO docs to ruleset (automatic)

Use Azure DevOps markdown directly as a source so the planner builds a ruleset and retrieves top rules automatically.

Set PAT via env:

```bash
export AZDO_PAT='<your-pat>'
```

Preview retrieved rules before generation:

```bash
curl -X POST http://localhost:8080/api/v1/ai/rulesets/preview \
  -H 'Content-Type: application/json' \
  --data '{
    "docSource": {
      "type": "ado",
      "ado": {
        "organizationUrl": "https://dev.azure.com/<org>",
        "project": "One",
        "repository": "azlocal-overlay",
        "filePath": "/docs/implementation/Microsoft.AzureStackHCI/logicalNetworks/windows/README.md",
        "branch": "main"
      }
    },
    "retrieval": {
      "query": "static lnet admission immutability overlap",
      "topK": 20,
      "useEmbeddings": true
    }
  }'
```

Generate a static-lnet plan from ADO docs:

```bash
curl -X POST http://localhost:8080/api/v1/ai/static-lnet-test-plan \
  -H 'Content-Type: application/json' \
  --data '{
    "baseline": {
      "subscriptionId": "00000000-0000-0000-0000-000000000000",
      "resourceGroup": "rg-arcvm-qe",
      "location": "eastus2",
      "customLocationId": "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-arcvm-qe/providers/Microsoft.ExtendedLocation/customLocations/arc-local-cl",
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
    "docSource": {
      "type": "ado",
      "ado": {
        "organizationUrl": "https://dev.azure.com/<org>",
        "project": "One",
        "repository": "azlocal-overlay",
        "filePath": "/docs/implementation/Microsoft.AzureStackHCI/logicalNetworks/windows/README.md",
        "branch": "main"
      }
    },
    "retrieval": {
      "query": "static lnet rules",
      "topK": 20,
      "useEmbeddings": true
    },
    "caseCount": 20,
    "strategy": "high coverage"
  }'
```

## Layered RAG retrieval (Azure Docs + README Architecture)

You can run embeddings-based retrieval from two layers now:

1. Azure Docs
2. README Architecture (ADO or local)

Preview Azure Docs only:

```bash
curl -X POST http://localhost:8080/api/v1/ai/rulesets/preview \
  -H 'Content-Type: application/json' \
  --data @examples/ai-ruleset-preview-azure-docs.json
```

Preview layered retrieval:

```bash
curl -X POST http://localhost:8080/api/v1/ai/rulesets/preview \
  -H 'Content-Type: application/json' \
  --data @examples/ai-ruleset-preview-layered.json
```

Layered request body shape:

```json
{
  "layers": {
    "azureDocs": [
      { "url": "https://learn.microsoft.com/..." }
    ],
    "readmeArchitecture": {
      "type": "ado",
      "ado": {
        "organizationUrl": "https://msazure.visualstudio.com/One",
        "project": "One",
        "repository": "azlocal-overlay",
        "filePath": "/docs/implementation/Microsoft.AzureStackHCI/logicalNetworks/windows/README.md",
        "branch": "main"
      }
    }
  },
  "retrieval": {
    "query": "static lnet admission immutability overlap",
    "topK": 20,
    "useEmbeddings": true,
    "lexical": "bm25"
  }
}
```

## Request contract

Required top-level fields:

- `subscriptionId`
- `resourceGroup`
- `location`
- `customLocationId`
- `resources`

Supported `resources` fields:

- `logicalNetwork`
- `logicalNetworks`
- `networkInterface`
- `networkInterfaces`

Bulk rules:

- If one logical network is supplied, NICs can omit `networkRef` and they will attach to that logical network.
- If multiple logical networks are supplied, each NIC must set `networkRef`.
- `networkRef` can point to an existing logical network reference or to a logical network name created in the same request.
- The Azure CLI still expects that value via `--subnet-id`; the API keeps it named `networkRef` because that is the clearer contract at this layer.

## Longevity behavior

Supported actions:

- `provision`
- `show`
- `cleanup`

`show` verifies all supplied resources. `cleanup` deletes NIC first and then logical network.

## Notes

- Jobs are asynchronous and stored in memory for now.
- Create paths are idempotent: the service attempts `show` first and only creates missing resources.
- The implementation is currently aligned only to `az stack-hci-vm network lnet` and `az stack-hci-vm network nic`.
