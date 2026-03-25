const promptEl = document.getElementById("prompt");
const caseCountEl = document.getElementById("caseCount");
const caseCountDisplayEl = document.getElementById("caseCountDisplay");
const promptLengthHintEl = document.getElementById("promptLengthHint");
const generateBtn = document.getElementById("generateBtn");
const statusEl = document.getElementById("status");
const runMetaEl = document.getElementById("runMeta");
const generationInfoEl = document.getElementById("generationInfo");
const resultsEl = document.getElementById("results");
const bulkActionsEl = document.getElementById("bulkActions");
const acceptedSummaryEl = document.getElementById("acceptedSummary");
const acceptAllBtn = document.getElementById("acceptAllBtn");
const clearAcceptedBtn = document.getElementById("clearAcceptedBtn");
const copyAcceptedBtn = document.getElementById("copyAcceptedBtn");
const quickPromptsEl = document.getElementById("quickPrompts");
const runDetailsEl = document.getElementById("runDetails");
const evidenceSummaryEl = document.getElementById("evidenceSummary");
const rulesListEl = document.getElementById("rulesList");
const ensemblePanelEl = document.getElementById("ensemblePanel");
const ensembleSelectedEl = document.getElementById("ensembleSelected");
const ensembleListEl = document.getElementById("ensembleList");
const splitLayoutEl = document.getElementById("splitLayout");
const runAllBtn = document.getElementById("runAllBtn");
const modeParallelBtn = document.getElementById("modeParallelBtn");
const modeSequentialBtn = document.getElementById("modeSequentialBtn");
const bulkRunStatusEl = document.getElementById("bulkRunStatus");
const fileInputEl = document.getElementById("fileInput");
const fileUploadZoneEl = document.getElementById("fileUploadZone");
const fileChipsEl = document.getElementById("fileChips");
const savePlanBtn = document.getElementById("savePlanBtn");
const saveModal = document.getElementById("saveModal");
const planNameInput = document.getElementById("planNameInput");
const saveCancelBtn = document.getElementById("saveCancelBtn");
const saveConfirmBtn = document.getElementById("saveConfirmBtn");
const savedPlansList = document.getElementById("savedPlansList");
const paginationEl = document.getElementById("pagination");

const acceptedCommands = new Map();
const initialCommands = new Map();
const runningJobs = new Map();
const completedJobData = new Map(); // caseId → { jobId, job }

const PAGE_SIZE = 4;
let allCases = [];
let currentPage = 1;
let bulkRunMode = "parallel";
let bulkRunAbort = null;

const uploadedFiles = [];
const MAX_FILE_SIZE = 512 * 1024; // 512 KB per file
const MAX_FILES = 10;

// --- Per-resource-type metadata ---
const resourceMeta = {
  lnet: {
    label: "Logical Network",
    key: "logicalNetwork",
    docsUrl: "https://learn.microsoft.com/en-us/azure/azure-local/manage/create-logical-networks?view=azloc-2602&tabs=azurecli",
    placeholder: "Test invalid gateway and DNS combinations, subnet overlap across VLAN boundaries, immutable field updates after create, and cleanup safety across repeated runs",
    quickPrompts: [
      { label: "Admission", desc: "Invalid required fields and malformed network inputs.", prompt: "I want to test admission failures, missing required fields, and rejection messaging quality" },
      { label: "Overlap", desc: "Subnet collisions, adjacency, and VLAN separation.", prompt: "I want to test overlap behavior across subnets, VLAN boundaries, and isolation guarantees" },
      { label: "Immutability", desc: "Fields that must remain locked after creation.", prompt: "I want to test immutability constraints and update rejection after the logical network is provisioned" },
      { label: "Lifecycle", desc: "Provision, inspect, repeat, and clean up safely.", prompt: "I want to test end-to-end lifecycle, repeated runs, show operations, and cleanup safety under partial failure" },
    ],
    baseline: {
      name: "qe-lnet-test",
      addressPrefix: "192.168.201.0/24",
      ipAllocationMethod: "Static",
      ipPoolStart: "192.168.201.50",
      ipPoolEnd: "192.168.201.100",
      gateway: "192.168.201.1",
      dnsServers: ["192.168.201.10"],
      vlan: 201,
      vmSwitchName: "ConvergedSwitch",
    },
  },
  nic: {
    label: "Network Interface",
    key: "networkInterface",
    docsUrl: "https://learn.microsoft.com/en-us/azure/azure-local/manage/create-network-interfaces?view=azloc-2602&tabs=azurecli",
    placeholder: "Test NIC creation with invalid subnet refs, duplicate MAC addresses, IP conflicts, NSG attachment, and cleanup when the parent network is missing",
    quickPrompts: [
      { label: "Admission", desc: "Missing subnet refs and invalid NIC parameters.", prompt: "I want to test NIC admission failures with missing subnet references, invalid IP configurations, and malformed parameters" },
      { label: "MAC Conflicts", desc: "Duplicate MAC addresses and collision detection.", prompt: "I want to test duplicate MAC address assignment, conflict detection across NICs, and error messaging" },
      { label: "IP Conflicts", desc: "Duplicate static IPs and pool exhaustion.", prompt: "I want to test static IP conflicts, pool exhaustion scenarios, and overlapping IP assignments across NICs" },
      { label: "Lifecycle", desc: "Create, attach, detach, and cleanup NIC flows.", prompt: "I want to test NIC lifecycle including creation, VM attachment, detachment, re-attachment, and cleanup safety" },
    ],
    baseline: {
      name: "qe-nic-test",
      networkRef: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-arcvm-qe/providers/Microsoft.AzureStackHCI/logicalNetworks/qe-lnet-test",
      ipAddress: "192.168.201.60",
    },
  },
  nsg: {
    label: "Network Security Group",
    key: "networkSecurityGroup",
    docsUrl: "https://learn.microsoft.com/en-us/azure/azure-local/manage/manage-network-security-groups?view=azloc-2602&tabs=azurecli",
    placeholder: "Test NSG rule priority conflicts, invalid protocol/direction combinations, overlapping port ranges, and cleanup when attached to an active network",
    quickPrompts: [
      { label: "Rule Conflicts", desc: "Priority clashes and overlapping port ranges.", prompt: "I want to test NSG rule priority conflicts, overlapping port ranges, and duplicate rule detection" },
      { label: "Protocol Mix", desc: "Invalid protocol and direction combinations.", prompt: "I want to test invalid protocol/direction combinations, wildcard rules, and mixed TCP/UDP/ICMP scenarios" },
      { label: "Attachment", desc: "NSG binding to subnets and NICs.", prompt: "I want to test NSG attachment to subnets, NICs, detachment behavior, and cascading effects on traffic" },
      { label: "Lifecycle", desc: "Create, update rules, and clean up safely.", prompt: "I want to test NSG lifecycle including creation, rule additions, rule deletions, and cleanup when attached to active resources" },
    ],
    baseline: {
      name: "qe-nsg-test",
      rules: [
        { name: "allow-ssh", priority: 100, direction: "Inbound", access: "Allow", protocol: "Tcp", destinationPortRange: "22" },
      ],
    },
  },
  storagepath: {
    label: "Storage Path",
    key: "storagePath",
    docsUrl: "https://learn.microsoft.com/en-us/azure/azure-local/manage/create-storage-path?view=azloc-2602&tabs=azurecli",
    placeholder: "Test storage path creation with invalid paths, duplicate names, path length limits, and cleanup safety when VMs reference the path",
    quickPrompts: [
      { label: "Invalid Paths", desc: "Non-existent volumes and malformed path strings.", prompt: "I want to test storage path creation with non-existent volumes, invalid characters, and malformed path strings" },
      { label: "Duplicates", desc: "Conflicting names and path collisions.", prompt: "I want to test duplicate storage path names, path collisions on the same volume, and conflict resolution" },
      { label: "In-Use Deletion", desc: "Delete paths referenced by VMs or VHDs.", prompt: "I want to test deletion of storage paths that are referenced by VMs or VHDs, and verify proper error handling" },
      { label: "Lifecycle", desc: "Create, verify, and clean up storage paths.", prompt: "I want to test storage path lifecycle including creation, show operations, updates, and cleanup safety" },
    ],
    baseline: {
      name: "qe-storagepath-test",
      path: "C:\\ClusterStorage\\Volume1\\qe-tests",
    },
  },
  vm: {
    label: "Virtual Machine",
    key: "virtualMachine",
    docsUrl: "https://learn.microsoft.com/en-us/azure/azure-local/manage/create-arc-virtual-machines?view=azloc-2602&tabs=azurecli",
    placeholder: "Test VM creation with invalid image refs, resource exhaustion, missing network/storage refs, startup and stop lifecycle, and forced cleanup",
    quickPrompts: [
      { label: "Admission", desc: "Missing image refs and invalid VM parameters.", prompt: "I want to test VM admission failures with missing image references, invalid vCPU/memory values, and malformed parameters" },
      { label: "Resource Limits", desc: "vCPU and memory exhaustion scenarios.", prompt: "I want to test VM creation under resource exhaustion, exceeding vCPU and memory limits, and capacity error handling" },
      { label: "Start/Stop", desc: "Power state transitions and forced stops.", prompt: "I want to test VM start, stop, restart, force-stop, and power state transition edge cases" },
      { label: "Lifecycle", desc: "Provision, run, and clean up VMs.", prompt: "I want to test full VM lifecycle including creation, running workloads, stopping, and cleanup with dependency verification" },
    ],
    baseline: {
      name: "qe-vm-test",
      imageRef: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-arcvm-qe/providers/Microsoft.AzureStackHCI/galleryImages/ubuntu-2204",
      vCPUs: 2,
      memoryMB: 4096,
      osType: "Linux",
      adminUsername: "azureuser",
      sshPublicKeyPath: "~/.ssh/id_rsa.pub",
      networkRefs: ["/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-arcvm-qe/providers/Microsoft.AzureStackHCI/networkInterfaces/qe-nic-test"],
    },
  },
  vhd: {
    label: "Virtual Hard Disk",
    key: "virtualHardDisk",
    docsUrl: "https://learn.microsoft.com/en-us/azure/azure-local/manage/virtual-hard-disks?view=azloc-2602&tabs=azurecli",
    placeholder: "Test VHD creation with invalid sizes, unsupported formats, duplicate names, storage path conflicts, and cleanup when attached to a VM",
    quickPrompts: [
      { label: "Invalid Sizes", desc: "Zero, negative, and oversized disk values.", prompt: "I want to test VHD creation with invalid sizes including zero, negative, and exceeding maximum allowed values" },
      { label: "Format Issues", desc: "Unsupported formats and type mismatches.", prompt: "I want to test VHD creation with unsupported disk formats, invalid format strings, and type mismatches" },
      { label: "Attached Delete", desc: "Delete VHDs still attached to VMs.", prompt: "I want to test deletion of VHDs that are currently attached to VMs and verify proper error handling and protection" },
      { label: "Lifecycle", desc: "Create, attach, detach, and clean up VHDs.", prompt: "I want to test VHD lifecycle including creation, VM attachment, detachment, resize operations, and cleanup" },
    ],
    baseline: {
      name: "qe-vhd-test",
      sizeGB: 32,
      diskFileFormat: "vhdx",
    },
  },
  storagecontainer: {
    label: "Storage Container",
    key: "storageContainer",
    docsUrl: "https://learn.microsoft.com/en-us/azure/azure-local/manage/create-storage-path?view=azloc-2602&tabs=azurecli",
    placeholder: "Test storage container creation with invalid paths, naming conflicts, path accessibility, and cleanup when VHDs reference it",
    quickPrompts: [
      { label: "Path Validation", desc: "Invalid volume paths and access issues.", prompt: "I want to test storage container creation with invalid volume paths, inaccessible locations, and path format validation" },
      { label: "Naming Conflicts", desc: "Duplicate names and character restrictions.", prompt: "I want to test storage container naming conflicts, duplicate names, special characters, and length limits" },
      { label: "In-Use Deletion", desc: "Delete containers referenced by VHDs.", prompt: "I want to test deletion of storage containers that are referenced by VHDs and verify dependency protection" },
      { label: "Lifecycle", desc: "Create, verify, and clean up containers.", prompt: "I want to test storage container lifecycle including creation, listing, show operations, and cleanup safety" },
    ],
    baseline: {
      name: "qe-sc-test",
      path: "C:\\ClusterStorage\\Volume1\\qe-containers",
    },
  },
  galleryimage: {
    label: "Gallery Image",
    key: "galleryImage",
    docsUrl: "https://learn.microsoft.com/en-us/azure/azure-local/manage/virtual-machine-image-azure-marketplace?view=azloc-2602&tabs=azurecli",
    placeholder: "Test gallery image creation with invalid OS types, unsupported Hyper-V generations, missing image paths, and cleanup when VMs reference the image",
    quickPrompts: [
      { label: "OS Types", desc: "Invalid OS types and generation mismatches.", prompt: "I want to test gallery image creation with invalid OS types, wrong Hyper-V generations, and type/generation mismatches" },
      { label: "Image Paths", desc: "Missing and invalid image file locations.", prompt: "I want to test gallery image creation with missing image paths, invalid file locations, and unsupported file formats" },
      { label: "Referenced Delete", desc: "Delete images referenced by VMs.", prompt: "I want to test deletion of gallery images that are referenced by running VMs and verify dependency protection" },
      { label: "Lifecycle", desc: "Create, list, and clean up gallery images.", prompt: "I want to test gallery image lifecycle including creation, listing, show operations, updates, and cleanup safety" },
    ],
    baseline: {
      name: "qe-image-test",
      imagePath: "C:\\ClusterStorage\\Volume1\\images\\ubuntu-2204.vhdx",
      osType: "Linux",
      hyperVGeneration: "V2",
    },
  },
  e2e: {
    label: "E2E (Full VM Stack)",
    resources: {
      logicalNetwork: {
        name: "qe-e2e-lnet",
        addressPrefix: "192.168.210.0/24",
        ipAllocationMethod: "Static",
        ipPoolStart: "192.168.210.50",
        ipPoolEnd: "192.168.210.100",
        gateway: "192.168.210.1",
        dnsServers: ["192.168.210.10"],
        vlan: 210,
        vmSwitchName: "ConvergedSwitch",
      },
      networkInterface: {
        name: "qe-e2e-nic",
        networkRef: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-arcvm-qe/providers/Microsoft.AzureStackHCI/logicalNetworks/qe-e2e-lnet",
        ipAddress: "192.168.210.60",
      },
      virtualHardDisk: {
        name: "qe-e2e-vhd",
        sizeGB: 64,
        diskFileFormat: "vhdx",
      },
      virtualMachine: {
        name: "qe-e2e-vm",
        imageRef: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-arcvm-qe/providers/Microsoft.AzureStackHCI/galleryImages/ubuntu-2204",
        vCPUs: 4,
        memoryMB: 8192,
        osType: "Linux",
        adminUsername: "azureuser",
        sshPublicKeyPath: "~/.ssh/id_rsa.pub",
        networkRefs: ["/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-arcvm-qe/providers/Microsoft.AzureStackHCI/networkInterfaces/qe-e2e-nic"],
      },
    },
    docsUrl: "https://learn.microsoft.com/en-us/azure/azure-local/manage/create-arc-virtual-machines?view=azloc-2602&tabs=azurecli",
    placeholder: "Test full VM stack: LNET \u2192 NIC \u2192 VHD \u2192 VM creation order, cross-resource dependency failures, partial provisioning recovery, cascading cleanup, and end-to-end lifecycle under repeated runs",
    quickPrompts: [
      { label: "Dependency Order", desc: "Create resources in correct dependency order.", prompt: "I want to test E2E resource creation order: LNET before NIC, VHD before VM, and verify failures when order is violated" },
      { label: "Partial Failure", desc: "Recovery when mid-stack provisioning fails.", prompt: "I want to test partial provisioning failure recovery when a mid-stack resource fails and earlier resources need cleanup" },
      { label: "Cascading Cleanup", desc: "Delete stack in reverse dependency order.", prompt: "I want to test cascading cleanup in reverse dependency order: VM, then NIC, then VHD, then LNET, with failure handling" },
      { label: "Full Lifecycle", desc: "End-to-end provision, verify, and teardown.", prompt: "I want to test the full E2E lifecycle: provision all resources, verify connectivity and functionality, then clean up everything" },
    ],
  },
};

let activeResourceTab = "lnet";

const baseEnvelope = {
  subscriptionId: "00000000-0000-0000-0000-000000000000",
  resourceGroup: "rg-arcvm-qe",
  location: "eastus2",
  customLocationId:
    "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-arcvm-qe/providers/Microsoft.ExtendedLocation/customLocations/arc-local-cl",
  longevity: {
    iterations: 1,
    actions: ["provision", "show", "cleanup"],
  },
};

function buildDefaultBaseline() {
  const meta = resourceMeta[activeResourceTab];
  // E2E and multi-resource tabs supply `resources` directly
  if (meta.resources) {
    return { ...baseEnvelope, resources: meta.resources };
  }
  return { ...baseEnvelope, resources: { [meta.key]: meta.baseline } };
}

function buildDefaultLayers() {
  const meta = resourceMeta[activeResourceTab];
  return { azureDocs: [{ url: meta.docsUrl }] };
}

// Keep these as live references so generate() picks up the current tab
let defaultBaseline = buildDefaultBaseline();
let defaultLayers = buildDefaultLayers();

// ─── Azure target picker (cascade dropdowns with search) ──────────────────

const azPicker = {
  sub: {
    trigger: document.getElementById("subTrigger"),
    dropdown: document.getElementById("subDropdown"),
    search: document.getElementById("subSearch"),
    list: document.getElementById("subList"),
    items: [],
    selected: null,
    highlighted: -1,
    emptyMsg: 'No subscriptions found — ensure <code style="color:#6ee7d2">az login</code> is run on the server',
  },
  rg: {
    trigger: document.getElementById("rgTrigger"),
    dropdown: document.getElementById("rgDropdown"),
    search: document.getElementById("rgSearch"),
    list: document.getElementById("rgList"),
    items: [],
    selected: null,
    highlighted: -1,
    emptyMsg: "No resource groups found",
  },
  cl: {
    trigger: document.getElementById("clTrigger"),
    dropdown: document.getElementById("clDropdown"),
    search: document.getElementById("clSearch"),
    list: document.getElementById("clList"),
    items: [],
    selected: null,
    highlighted: -1,
    emptyMsg: "No custom locations found",
  },
};

function azSetTriggerText(picker, text, isPlaceholder) {
  const chevron = picker.trigger.querySelector(".chevron");
  const oldSpinner = picker.trigger.querySelector(".spinner");
  if (oldSpinner) oldSpinner.remove();
  picker.trigger.innerHTML = "";
  const span = document.createElement("span");
  if (isPlaceholder) span.className = "placeholder";
  span.textContent = text;
  picker.trigger.appendChild(span);
  if (chevron) picker.trigger.appendChild(chevron);
}

function azSetLoading(picker, loading) {
  if (loading) {
    picker.trigger.disabled = true;
    const chevron = picker.trigger.querySelector(".chevron");
    const spin = document.createElement("span");
    spin.className = "spinner";
    if (chevron) picker.trigger.insertBefore(spin, chevron);
    else picker.trigger.appendChild(spin);
  } else {
    picker.trigger.disabled = false;
    const spin = picker.trigger.querySelector(".spinner");
    if (spin) spin.remove();
  }
}

function azRenderList(picker, filterText) {
  const q = (filterText || "").toLowerCase();
  const filtered = picker.items.filter((item) => {
    const haystack = (item.label + " " + (item.sub || "")).toLowerCase();
    return !q || haystack.includes(q);
  });
  picker.list.innerHTML = "";
  picker.highlighted = -1;

  // If search has text but no items match, offer to use the typed value directly
  if (filtered.length === 0) {
    if (q && picker.items.length === 0) {
      // No items at all — let user type a value manually
      const el = document.createElement("div");
      el.className = "az-dropdown-item";
      el.innerHTML = `<span>Use "<strong>${escapeHtml(q)}</strong>"</span><span class="item-sub">Enter a value manually</span>`;
      el.addEventListener("click", () => {
        azSelect(picker, { value: q, label: q, sub: "manual" });
      });
      picker.list.appendChild(el);
    } else if (q) {
      picker.list.innerHTML = '<div class="az-dropdown-empty">No matches</div>';
    } else {
      picker.list.innerHTML = `<div class="az-dropdown-empty">${picker.emptyMsg}</div>`;
    }
    return;
  }
  filtered.forEach((item, idx) => {
    const el = document.createElement("div");
    el.className = "az-dropdown-item" + (picker.selected && picker.selected.value === item.value ? " selected" : "");
    el.setAttribute("role", "option");
    el.dataset.index = idx;
    el.dataset.value = item.value;
    el.innerHTML = `<span>${escapeHtml(item.label)}</span>` + (item.sub ? `<span class="item-sub">${escapeHtml(item.sub)}</span>` : "");
    el.addEventListener("click", () => azSelect(picker, item));
    el.addEventListener("mouseenter", () => {
      picker.highlighted = idx;
      azHighlight(picker, idx);
    });
    picker.list.appendChild(el);
  });
}

function azHighlight(picker, idx) {
  picker.list.querySelectorAll(".az-dropdown-item").forEach((el, i) => {
    el.classList.toggle("highlighted", i === idx);
  });
}

function azOpen(picker) {
  // close others
  for (const p of Object.values(azPicker)) {
    if (p !== picker) azClose(p);
  }
  picker.dropdown.classList.add("visible");
  picker.trigger.classList.add("open");
  picker.search.value = "";
  azRenderList(picker, "");
  setTimeout(() => picker.search.focus(), 0);
}

function azClose(picker) {
  picker.dropdown.classList.remove("visible");
  picker.trigger.classList.remove("open");
  picker.highlighted = -1;
}

function azToggle(picker) {
  if (picker.dropdown.classList.contains("visible")) azClose(picker);
  else azOpen(picker);
}

function azSelect(picker, item) {
  picker.selected = item;
  azSetTriggerText(picker, item.label, false);
  azClose(picker);

  if (picker === azPicker.sub) {
    baseEnvelope.subscriptionId = item.value;
    // reset downstream
    azPicker.rg.selected = null;
    azPicker.rg.items = [];
    azSetTriggerText(azPicker.rg, "Select resource group", true);
    azPicker.rg.trigger.disabled = false;
    azPicker.cl.selected = null;
    azPicker.cl.items = [];
    azSetTriggerText(azPicker.cl, "Select custom location", true);
    azPicker.cl.trigger.disabled = true;
    baseEnvelope.resourceGroup = "";
    baseEnvelope.customLocationId = "";
    baseEnvelope.location = "";
    fetchResourceGroups(item.value);
  } else if (picker === azPicker.rg) {
    baseEnvelope.resourceGroup = item.value;
    baseEnvelope.location = item.location || baseEnvelope.location;
    // reset custom location
    azPicker.cl.selected = null;
    azPicker.cl.items = [];
    azSetTriggerText(azPicker.cl, "Select custom location", true);
    azPicker.cl.trigger.disabled = false;
    baseEnvelope.customLocationId = "";
    fetchCustomLocations(baseEnvelope.subscriptionId, item.value);
  } else if (picker === azPicker.cl) {
    baseEnvelope.customLocationId = item.value;
    baseEnvelope.location = item.location || baseEnvelope.location;
  }
  // Rebuild baseline for the active tab
  defaultBaseline = buildDefaultBaseline();
}

function azSearchHandler(picker) {
  picker.search.addEventListener("input", () => {
    azRenderList(picker, picker.search.value);
  });
  picker.search.addEventListener("keydown", (e) => {
    const listItems = picker.list.querySelectorAll(".az-dropdown-item");
    if (e.key === "ArrowDown") {
      e.preventDefault();
      picker.highlighted = Math.min(picker.highlighted + 1, listItems.length - 1);
      azHighlight(picker, picker.highlighted);
      listItems[picker.highlighted]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      picker.highlighted = Math.max(picker.highlighted - 1, 0);
      azHighlight(picker, picker.highlighted);
      listItems[picker.highlighted]?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (picker.highlighted >= 0 && listItems[picker.highlighted]) {
        const val = listItems[picker.highlighted].dataset.value;
        const match = picker.items.find((i) => i.value === val);
        if (match) {
          azSelect(picker, match);
        } else {
          // manual entry
          const typed = picker.search.value.trim();
          if (typed) azSelect(picker, { value: typed, label: typed, sub: "manual" });
        }
      } else {
        // No item highlighted — use typed text as manual entry
        const typed = picker.search.value.trim();
        if (typed) azSelect(picker, { value: typed, label: typed, sub: "manual" });
      }
    } else if (e.key === "Escape") {
      azClose(picker);
      picker.trigger.focus();
    }
  });
}

// Wire trigger clicks
for (const [, picker] of Object.entries(azPicker)) {
  picker.trigger.addEventListener("click", () => {
    if (!picker.trigger.disabled) azToggle(picker);
  });
  azSearchHandler(picker);
}

// Close dropdowns on outside click
document.addEventListener("click", (e) => {
  for (const picker of Object.values(azPicker)) {
    if (!picker.trigger.contains(e.target) && !picker.dropdown.contains(e.target)) {
      azClose(picker);
    }
  }
});

async function fetchSubscriptions() {
  azSetLoading(azPicker.sub, true);
  azSetTriggerText(azPicker.sub, "Loading...", true);
  try {
    const res = await fetch("/api/v1/azure/subscriptions");
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    azPicker.sub.items = (data || [])
      .filter((s) => s.state === "Enabled")
      .map((s) => ({ value: s.id, label: s.name, sub: s.id }));
    if (azPicker.sub.items.length > 0) {
      azSetTriggerText(azPicker.sub, `Select subscription (${azPicker.sub.items.length})`, true);
    } else {
      azSetTriggerText(azPicker.sub, "No subscriptions — type to enter manually", true);
    }
  } catch (err) {
    azPicker.sub.items = [];
    azSetTriggerText(azPicker.sub, "Could not load — click to enter manually", true);
    console.error("fetchSubscriptions:", err);
  }
  azSetLoading(azPicker.sub, false);
}

async function fetchResourceGroups(subscriptionId) {
  azSetLoading(azPicker.rg, true);
  azSetTriggerText(azPicker.rg, "Loading...", true);
  try {
    const res = await fetch(`/api/v1/azure/resource-groups?subscriptionId=${encodeURIComponent(subscriptionId)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    azPicker.rg.items = (data || []).map((g) => ({ value: g.name, label: g.name, sub: g.location, location: g.location }));
    if (azPicker.rg.items.length > 0) {
      azSetTriggerText(azPicker.rg, `Select resource group (${azPicker.rg.items.length})`, true);
    } else {
      azSetTriggerText(azPicker.rg, "No resource groups — type to enter manually", true);
    }
  } catch (err) {
    azPicker.rg.items = [];
    azSetTriggerText(azPicker.rg, "Could not load — click to enter manually", true);
    console.error("fetchResourceGroups:", err);
  }
  azSetLoading(azPicker.rg, false);
}

async function fetchCustomLocations(subscriptionId, resourceGroup) {
  azSetLoading(azPicker.cl, true);
  azSetTriggerText(azPicker.cl, "Loading...", true);
  try {
    const res = await fetch(`/api/v1/azure/custom-locations?subscriptionId=${encodeURIComponent(subscriptionId)}&resourceGroup=${encodeURIComponent(resourceGroup)}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
    azPicker.cl.items = (data || []).map((c) => ({ value: c.id, label: c.name, sub: c.location, location: c.location }));
    if (azPicker.cl.items.length > 0) {
      azSetTriggerText(azPicker.cl, `Select custom location (${azPicker.cl.items.length})`, true);
    } else {
      azSetTriggerText(azPicker.cl, "No custom locations — type to enter manually", true);
    }
  } catch (err) {
    azPicker.cl.items = [];
    azSetTriggerText(azPicker.cl, "Could not load — click to enter manually", true);
    console.error("fetchCustomLocations:", err);
  }
  azSetLoading(azPicker.cl, false);
}

// Load subscriptions on page load
fetchSubscriptions();

// ──────────────────────────────────────────────────────────────────────

const uiState = {
  totalCases: 0,
  elapsed: "",
  model: "",
  prompt: "",
};

let generationTicker = null;
let refineTargetCaseId = null;

function startGenerationTicker(caseCount) {
  stopGenerationTicker();

  const startedAt = Date.now();
  const stages = [
    "Indexing evidence chunks",
    "Planning scenario coverage",
    "Drafting command-ready test cases",
    "Scoring and finalizing outputs",
  ];

  let stageIndex = 0;
  let tokenEstimate = 120;
  const targetCases = Math.max(1, Number(caseCount) || 1);

  const tick = () => {
    const elapsedMs = Date.now() - startedAt;
    const elapsedSec = Math.max(1, Math.floor(elapsedMs / 1000));
    tokenEstimate += Math.floor(35 + Math.random() * 30);

    if (elapsedSec % 4 === 0 && stageIndex < stages.length - 1) {
      stageIndex += 1;
    }

    const stage = stages[stageIndex];
    const dots = ".".repeat((elapsedSec % 3) + 1);
    setStatus(`${stage}${dots}`);
    setGenerationInfo([
      `target ${targetCases} cases`,
      `elapsed ${elapsedSec}s`,
      `tokens ~${tokenEstimate}`,
    ]);
  };

  tick();
  generationTicker = setInterval(tick, 1000);
}

function stopGenerationTicker() {
  if (generationTicker) {
    clearInterval(generationTicker);
    generationTicker = null;
  }
}

function setStatus(text, tone = "neutral") {
  statusEl.textContent = text;
  statusEl.classList.remove("error", "success");
  if (tone === "error") {
    statusEl.classList.add("error");
  }
  if (tone === "success") {
    statusEl.classList.add("success");
  }
}

function setGenerateBusy(isBusy) {
  generateBtn.disabled = isBusy;
  generateBtn.textContent = isBusy ? "Generating..." : "Generate Test Cases";
}

function refreshRunMeta() {
  const parts = [];
  if (uiState.totalCases > 0) {
    parts.push(`${uiState.totalCases} cases`);
  }
  if (uiState.elapsed) {
    parts.push(`${uiState.elapsed}s`);
  }
  runMetaEl.textContent = parts.length > 0 ? parts.join(" • ") : "Ready to generate";
}

function updatePromptHint() {
  const text = (promptEl.value || "").trim();
  uiState.prompt = text;

  if (!text) {
    promptLengthHintEl.textContent = "Planner ready";
    return;
  }
  if (text.length < 60) {
    promptLengthHintEl.textContent = "Concise prompt";
    return;
  }
  if (text.length < 180) {
    promptLengthHintEl.textContent = "Good detail";
    return;
  }
  promptLengthHintEl.textContent = "Detailed prompt";
}

const depthLabels = { 4: "Quick", 8: "Standard", 12: "Thorough" };

function updateCaseCountDisplay() {
  const count = Number(caseCountEl.value) || 8;
  const label = depthLabels[count] || `${count}`;
  caseCountDisplayEl.textContent = `${count} cases`;
}

function selectDepth(count) {
  caseCountEl.value = String(count);
  document.querySelectorAll(".depth-btn").forEach(b => {
    b.classList.toggle("active", Number(b.dataset.count) === count);
  });
  updateCaseCountDisplay();
}

function setBulkActionsVisibility(visible) {
  bulkActionsEl.classList.toggle("visible", !!visible);
}

function updateAcceptedSummary(totalCases) {
  acceptedSummaryEl.textContent = `Accepted ${acceptedCommands.size} of ${totalCases} cases`;
  copyAcceptedBtn.disabled = acceptedCommands.size === 0;
}

function setGenerationInfo(items) {
  if (!Array.isArray(items) || items.length === 0) {
    generationInfoEl.classList.remove("visible");
    generationInfoEl.innerHTML = "";
    return;
  }

  generationInfoEl.classList.add("visible");
  generationInfoEl.innerHTML = items
    .filter(Boolean)
    .map((item) => `<span class="info-pill">${escapeHtml(item)}</span>`)
    .join("");
}

function renderEmptyState(title, copy) {
  resultsEl.innerHTML = `
    <article class="empty-state">
      <h3>${escapeHtml(title)}</h3>
      ${copy ? `<p>${escapeHtml(copy)}</p>` : ""}
    </article>
  `;
}

function renderLoadingState(count) {
  const cards = Math.max(2, Math.min(3, Number(count) || 3));
  resultsEl.innerHTML = Array.from({ length: cards }, () => `
    <article class="skeleton-card">
      <div class="skeleton-line short"></div>
      <div class="skeleton-line medium"></div>
      <div class="skeleton-line long"></div>
      <div class="skeleton-line long"></div>
    </article>
  `).join("");
}

function clearCaseAcceptance(caseId, card, acceptBtn, totalCases) {
  acceptedCommands.delete(caseId);
  card.classList.remove("is-accepted");
  if (acceptBtn) {
    acceptBtn.classList.remove("accepted");
    acceptBtn.textContent = "Accept";
  }
  updateAcceptedSummary(totalCases);
}

function acceptCase(caseId, value, card, acceptBtn, totalCases) {
  acceptedCommands.set(caseId, value);
  card.classList.add("is-accepted");
  if (acceptBtn) {
    acceptBtn.classList.add("accepted");
    acceptBtn.textContent = "Accepted";
  }
  updateAcceptedSummary(totalCases);
}

function setSplitMode(active) {
  if (splitLayoutEl) {
    splitLayoutEl.classList.toggle("has-results", !!active);
  }
}

function renderCases(cases) {
  resultsEl.innerHTML = "";
  acceptedCommands.clear();
  initialCommands.clear();
  allCases = Array.isArray(cases) ? cases : [];
  currentPage = 1;
  uiState.totalCases = allCases.length;
  refreshRunMeta();
  updateAcceptedSummary(uiState.totalCases);

  if (allCases.length === 0) {
    setBulkActionsVisibility(false);
    hidePagination();
    setSplitMode(false);
    renderEmptyState(
      "No test cases returned",
      "The planner finished, but no cases were produced. Tighten the prompt or request fewer cases and try again.",
    );
    return;
  }

  setBulkActionsVisibility(true);
  setSplitMode(true);

  // Pre-generate initial commands for ALL cases so accept-all works across pages
  allCases.forEach((testCase, index) => {
    const caseId = String(testCase.caseId || `case-${index + 1}`);
    const commands = buildRelevantAzCliCommands(testCase.runRequest || {}).join("\n");
    initialCommands.set(caseId, commands);
  });

  renderPage(currentPage);
}

function renderPage(page) {
  const totalPages = Math.ceil(allCases.length / PAGE_SIZE);
  currentPage = Math.max(1, Math.min(page, totalPages));

  const start = (currentPage - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, allCases.length);
  const pageCases = allCases.slice(start, end);

  resultsEl.innerHTML = "";

  pageCases.forEach((testCase, pageIndex) => {
    const globalIndex = start + pageIndex;
    const card = document.createElement("article");
    card.className = "result";

    const runRequest = testCase.runRequest || {};
    const resourcePills = extractResourcePills(runRequest);
    const actions = Array.isArray(runRequest?.longevity?.actions) ? runRequest.longevity.actions : [];
    const citations = Array.isArray(testCase.citations) ? testCase.citations : [];
    const caseId = String(testCase.caseId || `case-${globalIndex + 1}`);
    const commands = initialCommands.get(caseId) || buildRelevantAzCliCommands(runRequest).join("\n");

    // If user already accepted this case (and navigated away/back), restore state
    const isAccepted = acceptedCommands.has(caseId);
    const editedCommands = isAccepted ? acceptedCommands.get(caseId) : commands;

    if (isAccepted) {
      card.classList.add("is-accepted");
    }

    card.innerHTML = `
      <div class="result-head">
        <div>
          <span class="case-tag"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg> Generated Case ${globalIndex + 1}</span>
          <h3>${escapeHtml(caseId)}</h3>
        </div>
        <div class="case-pills">
          ${actions.length > 0 ? `<span class="case-pill">${escapeHtml(actions.join(" • "))}</span>` : ""}
          ${resourcePills.map(p => `<span class="case-pill">${escapeHtml(p)}</span>`).join("")}
        </div>
      </div>

      <div class="result-grid">
        <article class="meta-card">
          <strong><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> Objective</strong>
          <span>${escapeHtml(testCase.objective || "-")}</span>
        </article>
        <article class="meta-card">
          <strong><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg> Mutation</strong>
          <span>${escapeHtml(testCase.mutation || "-")}</span>
        </article>
        <article class="meta-card">
          <strong><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> Expected</strong>
          <span>${escapeHtml(testCase.expectedOutcome || "-")}</span>
        </article>
      </div>

      ${citations.length > 0 ? `
        <div class="citation-row">
          ${citations.map((citation) => `<span class="citation-pill">${escapeHtml(citation)}</span>`).join("")}
        </div>
      ` : ""}

      <section class="command-shell">
        <div class="command-head">
          <div>
            <strong><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg> Azure CLI flow</strong>
            <span>Edit before accepting if you need to refine the run.</span>
          </div>
          <div class="command-actions">
            <button type="button" class="secondary-btn run-btn${runningJobs.has(caseId) ? " running" : ""}" data-role="run-case"${runningJobs.has(caseId) ? " disabled" : ""}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> ${runningJobs.has(caseId) ? "Running..." : "Run"}</button>
            <button type="button" class="secondary-btn" data-role="refine-case"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg> Refine</button>
            <button type="button" class="secondary-btn${isAccepted ? " accepted" : ""}" data-role="accept-case"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> ${isAccepted ? "Accepted" : "Accept"}</button>
            <button type="button" class="secondary-btn" data-role="reset-case"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg> Reset</button>
            <button type="button" class="secondary-btn" data-role="copy-case"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> Copy</button>
          </div>
        </div>
        <textarea class="cli-editor" data-role="cli-editor">${escapeHtml(editedCommands)}</textarea>
        <div class="run-status${runningJobs.has(caseId) ? " visible running" : ""}" data-role="run-status">${runningJobs.has(caseId) ? "Job submitted — polling for status..." : ""}</div>
        <div class="flight-recorder" data-role="flight-recorder"></div>
      </section>
    `;

    resultsEl.appendChild(card);

    const editorEl = card.querySelector('[data-role="cli-editor"]');
    const acceptBtn = card.querySelector('[data-role="accept-case"]');
    const resetBtn = card.querySelector('[data-role="reset-case"]');
    const copyBtn = card.querySelector('[data-role="copy-case"]');
    const refineBtn = card.querySelector('[data-role="refine-case"]');

    if (refineBtn) {
      refineBtn.addEventListener("click", () => {
        const objective = testCase.objective || "";
        const mutation = testCase.mutation || "";
        const expected = testCase.expectedOutcome || "";
        const refineParts = [`Refine ${caseId}:`];
        if (objective) refineParts.push(`Objective was: ${objective}.`);
        if (mutation) refineParts.push(`Mutation was: ${mutation}.`);
        if (expected) refineParts.push(`Expected was: ${expected}.`);
        refineParts.push("The issue is: ");
        promptEl.value = refineParts.join(" ");
        selectDepth(4);
        refineTargetCaseId = caseId;
        updatePromptHint();
        promptEl.focus();
        promptEl.setSelectionRange(promptEl.value.length, promptEl.value.length);
        setStatus(`Refining ${caseId} — describe the issue and hit Generate. Other cases will stay intact.`, "success");
      });
    }

    if (editorEl instanceof HTMLTextAreaElement) {
      editorEl.addEventListener("input", () => {
        if (acceptedCommands.has(caseId)) {
          clearCaseAcceptance(caseId, card, acceptBtn, allCases.length);
        }
      });
    }

    if (acceptBtn && editorEl instanceof HTMLTextAreaElement) {
      acceptBtn.addEventListener("click", () => {
        acceptCase(caseId, editorEl.value, card, acceptBtn, allCases.length);
      });
    }

    if (resetBtn && editorEl instanceof HTMLTextAreaElement) {
      resetBtn.addEventListener("click", () => {
        editorEl.value = initialCommands.get(caseId) || "";
        clearCaseAcceptance(caseId, card, acceptBtn, allCases.length);
      });
    }

    if (copyBtn && editorEl instanceof HTMLTextAreaElement) {
      copyBtn.addEventListener("click", async () => {
        const ok = await copyText(editorEl.value);
        setStatus(ok ? `Copied commands for ${caseId}.` : "Clipboard copy failed in this browser context.", ok ? "success" : "error");
      });
    }

    const runBtn = card.querySelector('[data-role="run-case"]');
    const runStatusEl = card.querySelector('[data-role="run-status"]');
    if (runBtn) {
      runBtn.addEventListener("click", () => {
        runTestCase(caseId, runRequest, runBtn, runStatusEl);
      });
    }

    // Restore flight recorder for previously completed jobs
    const completed = completedJobData.get(caseId);
    if (completed && runStatusEl) {
      const st = (completed.job?.status || "").toLowerCase();
      const isFail = st === "failed" || st === "error";
      runStatusEl.className = `run-status visible ${isFail ? "failed" : "succeeded"}`;
      runStatusEl.textContent = `Job ${completed.jobId}: ${isFail ? "failed" : "succeeded"}${isFail && completed.job?.error ? ` — ${completed.job.error}` : ""}`;
      renderFlightRecorder(runStatusEl, completed.jobId, completed.job);
    }
  });

  renderPagination(totalPages);
  resultsEl.scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderPagination(totalPages) {
  if (!paginationEl) {
    return;
  }

  if (totalPages <= 1) {
    hidePagination();
    return;
  }

  paginationEl.classList.add("visible");
  paginationEl.innerHTML = "";

  const prevBtn = document.createElement("button");
  prevBtn.className = "page-btn";
  prevBtn.textContent = "Prev";
  prevBtn.disabled = currentPage === 1;
  prevBtn.addEventListener("click", () => renderPage(currentPage - 1));
  paginationEl.appendChild(prevBtn);

  for (let i = 1; i <= totalPages; i++) {
    const btn = document.createElement("button");
    btn.className = `page-btn${i === currentPage ? " active" : ""}`;
    btn.textContent = String(i);
    btn.addEventListener("click", () => renderPage(i));
    paginationEl.appendChild(btn);
  }

  const info = document.createElement("span");
  info.className = "page-info";
  const start = (currentPage - 1) * PAGE_SIZE + 1;
  const end = Math.min(currentPage * PAGE_SIZE, allCases.length);
  info.textContent = `${start}–${end} of ${allCases.length}`;
  paginationEl.appendChild(info);

  const nextBtn = document.createElement("button");
  nextBtn.className = "page-btn";
  nextBtn.textContent = "Next";
  nextBtn.disabled = currentPage === totalPages;
  nextBtn.addEventListener("click", () => renderPage(currentPage + 1));
  paginationEl.appendChild(nextBtn);
}

function hidePagination() {
  if (paginationEl) {
    paginationEl.classList.remove("visible");
    paginationEl.innerHTML = "";
  }
}

function buildRelevantAzCliCommands(runRequest) {
  const resources = runRequest?.resources || {};
  const rg = runRequest?.resourceGroup || "<resource-group>";
  const location = runRequest?.location || "<location>";
  const customLocation = runRequest?.customLocationId || "<custom-location-id>";
  const actions = Array.isArray(runRequest?.longevity?.actions) ? runRequest.longevity.actions : [];
  const actionSet = new Set(actions.map(a => String(a).toLowerCase()));

  // Collect command groups per resource in dependency order:
  // StoragePath → StorageContainer → GalleryImage → LNET → NSG → NIC → VHD → VM
  const cmdGroups = [];

  // Storage Path
  if (resources.storagePath) {
    const sp = resources.storagePath;
    const name = sp.name || "<storage-path-name>";
    const create = [
      "az stack-hci storagepath create",
      `  --resource-group ${shellQuote(rg)}`,
      `  --custom-location ${shellQuote(customLocation)}`,
      `  --name ${shellQuote(name)}`,
      `  --location ${shellQuote(location)}`,
    ];
    if (sp.path) create.push(`  --path ${shellQuote(sp.path)}`);
    cmdGroups.push({
      label: "Storage Path",
      create,
      show: `az stack-hci storagepath show --resource-group ${shellQuote(rg)} --name ${shellQuote(name)}`,
      del: `az stack-hci storagepath delete --resource-group ${shellQuote(rg)} --name ${shellQuote(name)} --yes`,
    });
  }

  // Storage Container
  if (resources.storageContainer) {
    const sc = resources.storageContainer;
    const name = sc.name || "<storage-container-name>";
    const create = [
      "az stack-hci storagepath create",
      `  --resource-group ${shellQuote(rg)}`,
      `  --custom-location ${shellQuote(customLocation)}`,
      `  --name ${shellQuote(name)}`,
      `  --location ${shellQuote(location)}`,
    ];
    if (sc.path) create.push(`  --path ${shellQuote(sc.path)}`);
    cmdGroups.push({
      label: "Storage Container",
      create,
      show: `az stack-hci storagepath show --resource-group ${shellQuote(rg)} --name ${shellQuote(name)}`,
      del: `az stack-hci storagepath delete --resource-group ${shellQuote(rg)} --name ${shellQuote(name)} --yes`,
    });
  }

  // Gallery Image
  if (resources.galleryImage) {
    const gi = resources.galleryImage;
    const name = gi.name || "<gallery-image-name>";
    const create = [
      "az stack-hci-vm image create",
      `  --resource-group ${shellQuote(rg)}`,
      `  --custom-location ${shellQuote(customLocation)}`,
      `  --name ${shellQuote(name)}`,
      `  --location ${shellQuote(location)}`,
    ];
    if (gi.imagePath) create.push(`  --image-path ${shellQuote(gi.imagePath)}`);
    if (gi.osType) create.push(`  --os-type ${shellQuote(gi.osType)}`);
    if (gi.hyperVGeneration) create.push(`  --hyper-v-generation ${shellQuote(gi.hyperVGeneration)}`);
    cmdGroups.push({
      label: "Gallery Image",
      create,
      show: `az stack-hci-vm image show --resource-group ${shellQuote(rg)} --name ${shellQuote(name)}`,
      del: `az stack-hci-vm image delete --resource-group ${shellQuote(rg)} --name ${shellQuote(name)} --yes`,
    });
  }

  // Logical Network
  if (resources.logicalNetwork) {
    const lnet = resources.logicalNetwork;
    const name = lnet.name || "<logical-network-name>";
    const create = [
      "az stack-hci-vm network lnet create",
      `  --resource-group ${shellQuote(rg)}`,
      `  --custom-location ${shellQuote(customLocation)}`,
      `  --name ${shellQuote(name)}`,
      `  --location ${shellQuote(location)}`,
    ];
    if (lnet.addressPrefix) create.push(`  --address-prefixes ${shellQuote(lnet.addressPrefix)}`);
    if (lnet.ipAllocationMethod) create.push(`  --ip-allocation-method ${shellQuote(lnet.ipAllocationMethod)}`);
    if (lnet.ipPoolType) create.push(`  --ip-pool-type ${shellQuote(lnet.ipPoolType)}`);
    if (lnet.ipPoolStart) create.push(`  --ip-pool-start ${shellQuote(lnet.ipPoolStart)}`);
    if (lnet.ipPoolEnd) create.push(`  --ip-pool-end ${shellQuote(lnet.ipPoolEnd)}`);
    if (lnet.vmSwitchName) create.push(`  --vm-switch-name ${shellQuote(lnet.vmSwitchName)}`);
    if (Array.isArray(lnet.dnsServers) && lnet.dnsServers.length > 0) create.push(`  --dns-servers ${lnet.dnsServers.map(shellQuote).join(" ")}`);
    if (lnet.gateway) create.push(`  --gateway ${shellQuote(lnet.gateway)}`);
    if (Number.isFinite(lnet.vlan) && lnet.vlan > 0) create.push(`  --vlan ${shellQuote(String(lnet.vlan))}`);
    cmdGroups.push({
      label: "Logical Network",
      create,
      show: `az stack-hci-vm network lnet show --resource-group ${shellQuote(rg)} --name ${shellQuote(name)}`,
      del: `az stack-hci-vm network lnet delete --resource-group ${shellQuote(rg)} --name ${shellQuote(name)} --yes`,
    });
  }

  // Network Security Group
  if (resources.networkSecurityGroup) {
    const nsg = resources.networkSecurityGroup;
    const name = nsg.name || "<nsg-name>";
    const create = [
      "az stack-hci-vm network nsg create",
      `  --resource-group ${shellQuote(rg)}`,
      `  --custom-location ${shellQuote(customLocation)}`,
      `  --name ${shellQuote(name)}`,
      `  --location ${shellQuote(location)}`,
    ];
    // Append NSG rule commands to the create block so they're part of provisioning
    const ruleLines = [];
    if (Array.isArray(nsg.rules)) {
      for (const rule of nsg.rules) {
        const rn = rule.name || "<rule-name>";
        const rc = [
          `az stack-hci-vm network nsg rule create`,
          `  --resource-group ${shellQuote(rg)}`,
          `  --nsg-name ${shellQuote(name)}`,
          `  --name ${shellQuote(rn)}`,
        ];
        if (rule.priority) rc.push(`  --priority ${shellQuote(String(rule.priority))}`);
        if (rule.direction) rc.push(`  --direction ${shellQuote(rule.direction)}`);
        if (rule.access) rc.push(`  --access ${shellQuote(rule.access)}`);
        if (rule.protocol) rc.push(`  --protocol ${shellQuote(rule.protocol)}`);
        if (rule.destinationPortRange) rc.push(`  --destination-port-ranges ${shellQuote(rule.destinationPortRange)}`);
        ruleLines.push("", ...rc);
      }
    }
    cmdGroups.push({
      label: "Network Security Group",
      create: [...create, ...ruleLines],
      show: `az stack-hci-vm network nsg show --resource-group ${shellQuote(rg)} --name ${shellQuote(name)}`,
      del: `az stack-hci-vm network nsg delete --resource-group ${shellQuote(rg)} --name ${shellQuote(name)} --yes`,
    });
  }

  // Network Interface
  if (resources.networkInterface) {
    const nic = resources.networkInterface;
    const name = nic.name || "<nic-name>";
    const create = [
      "az stack-hci-vm network nic create",
      `  --resource-group ${shellQuote(rg)}`,
      `  --custom-location ${shellQuote(customLocation)}`,
      `  --name ${shellQuote(name)}`,
      `  --location ${shellQuote(location)}`,
    ];
    if (nic.networkRef) create.push(`  --subnet-id ${shellQuote(nic.networkRef)}`);
    if (nic.ipAddress) create.push(`  --ip-address ${shellQuote(nic.ipAddress)}`);
    cmdGroups.push({
      label: "Network Interface",
      create,
      show: `az stack-hci-vm network nic show --resource-group ${shellQuote(rg)} --name ${shellQuote(name)}`,
      del: `az stack-hci-vm network nic delete --resource-group ${shellQuote(rg)} --name ${shellQuote(name)} --yes`,
    });
  }

  // Virtual Hard Disk
  if (resources.virtualHardDisk) {
    const vhd = resources.virtualHardDisk;
    const name = vhd.name || "<vhd-name>";
    const create = [
      "az stack-hci-vm disk create",
      `  --resource-group ${shellQuote(rg)}`,
      `  --custom-location ${shellQuote(customLocation)}`,
      `  --name ${shellQuote(name)}`,
      `  --location ${shellQuote(location)}`,
    ];
    if (vhd.sizeGB) create.push(`  --size-gb ${shellQuote(String(vhd.sizeGB))}`);
    if (vhd.diskFileFormat) create.push(`  --disk-file-format ${shellQuote(vhd.diskFileFormat)}`);
    if (vhd.storagePathRef) create.push(`  --storage-path-id ${shellQuote(vhd.storagePathRef)}`);
    cmdGroups.push({
      label: "Virtual Hard Disk",
      create,
      show: `az stack-hci-vm disk show --resource-group ${shellQuote(rg)} --name ${shellQuote(name)}`,
      del: `az stack-hci-vm disk delete --resource-group ${shellQuote(rg)} --name ${shellQuote(name)} --yes`,
    });
  }

  // Virtual Machine (last — depends on NIC, VHD, image)
  if (resources.virtualMachine) {
    const vm = resources.virtualMachine;
    const name = vm.name || "<vm-name>";
    const create = [
      "az stack-hci-vm create",
      `  --resource-group ${shellQuote(rg)}`,
      `  --custom-location ${shellQuote(customLocation)}`,
      `  --name ${shellQuote(name)}`,
      `  --location ${shellQuote(location)}`,
    ];
    if (vm.imageRef) create.push(`  --image ${shellQuote(vm.imageRef)}`);
    if (vm.vCPUs) create.push(`  --processors ${shellQuote(String(vm.vCPUs))}`);
    if (vm.memoryMB) create.push(`  --memory-mb ${shellQuote(String(vm.memoryMB))}`);
    if (vm.osType) create.push(`  --os-type ${shellQuote(vm.osType)}`);
    if (vm.adminUsername) create.push(`  --admin-username ${shellQuote(vm.adminUsername)}`);
    if (vm.sshPublicKeyPath) create.push(`  --ssh-key-values ${shellQuote(vm.sshPublicKeyPath)}`);
    if (Array.isArray(vm.networkRefs) && vm.networkRefs.length > 0) {
      for (const ref of vm.networkRefs) create.push(`  --nic-id ${shellQuote(ref)}`);
    }
    if (vm.storagePathRef) create.push(`  --storage-path-id ${shellQuote(vm.storagePathRef)}`);
    cmdGroups.push({
      label: "Virtual Machine",
      create,
      show: `az stack-hci-vm show --resource-group ${shellQuote(rg)} --name ${shellQuote(name)}`,
      del: `az stack-hci-vm delete --resource-group ${shellQuote(rg)} --name ${shellQuote(name)} --yes`,
    });
  }

  // Emit commands — phased when multi-resource, inline CRD when single-resource
  const lines = [];
  const wantProvision = actionSet.size === 0 || actionSet.has("provision");
  const wantShow = actionSet.size === 0 || actionSet.has("show");
  const wantCleanup = actionSet.size === 0 || actionSet.has("cleanup");

  if (cmdGroups.length > 1) {
    // Multi-resource: group by phase so dependencies are respected
    if (wantProvision) {
      lines.push("# --- Provision (dependency order) ---");
      for (const g of cmdGroups) {
        lines.push(`# ${g.label}`, joinCmd(g.create), "");
      }
    }
    if (wantShow) {
      lines.push("# --- Verify ---");
      for (const g of cmdGroups) {
        lines.push(splitCmd(g.show), "");
      }
    }
    if (wantCleanup) {
      lines.push("# --- Cleanup (reverse dependency order) ---");
      for (const g of [...cmdGroups].reverse()) {
        lines.push(splitCmd(g.del), "");
      }
    }
  } else if (cmdGroups.length === 1) {
    // Single resource: compact create → show → delete
    const g = cmdGroups[0];
    if (wantProvision) lines.push(joinCmd(g.create), "");
    if (wantShow) lines.push(splitCmd(g.show), "");
    if (wantCleanup) lines.push(splitCmd(g.del), "");
  }

  // Fallback: generic resource JSON dump
  if (lines.length === 0) {
    lines.push(`# Resource definition (JSON)`, JSON.stringify(resources, null, 2));
  }

  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function shellQuote(value) {
  return `'${String(value ?? "").replace(/'/g, `'\\''`)}'`;
}

/** Join a create-command array into a single copy-pasteable shell command with \ continuations. */
function joinCmd(parts) {
  if (!Array.isArray(parts) || parts.length === 0) return "";
  // Filter out empty strings that are used as spacers between sub-commands (e.g. NSG rule blocks)
  const blocks = [];
  let current = [];
  for (const line of parts) {
    if (line === "") {
      if (current.length > 0) { blocks.push(current); current = []; }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);

  return blocks.map(block =>
    block.length === 1 ? block[0] : block.slice(0, -1).map(l => l + " \\").join("\n") + "\n" + block[block.length - 1]
  ).join("\n\n");
}

/** Split a one-liner az command into multi-line \ continuation format. */
function splitCmd(cmd) {
  if (!cmd) return "";
  const tokens = cmd.match(/(?:--\S+\s+'[^']*'|--\S+\s+\S+|-\S+\s+'[^']*'|-\S+\s+\S+|\S+)/g);
  if (!tokens || tokens.length <= 1) return cmd;
  // First tokens form the base command (e.g. "az stack-hci-vm network lnet show")
  const parts = [];
  let base = [];
  for (const t of tokens) {
    if (t.startsWith("-")) {
      parts.push(t);
    } else if (parts.length === 0) {
      base.push(t);
    } else {
      // Attach to last part (shouldn't normally happen)
      parts[parts.length - 1] += " " + t;
    }
  }
  if (parts.length === 0) return cmd;
  const lines = [base.join(" "), ...parts.map(p => "  " + p)];
  return lines.slice(0, -1).map(l => l + " \\").join("\n") + "\n" + lines[lines.length - 1];
}

/** Extract display-worthy pills from any resource type in a runRequest. */
function extractResourcePills(runRequest) {
  const pills = [];
  const resources = runRequest?.resources || {};
  for (const [type, spec] of Object.entries(resources)) {
    if (!spec || typeof spec !== "object") continue;
    if (spec.name) pills.push(spec.name);
    if (spec.addressPrefix) pills.push(spec.addressPrefix);
    if (pills.length === 0) pills.push(type);
  }
  return pills;
}

function renderEvidence(ruleset, retrievedRules) {
  const rules = Array.isArray(retrievedRules) ? retrievedRules.slice(0, 4) : [];

  if (!ruleset && rules.length === 0) {
    evidenceSummaryEl.textContent = "Retrieved rules from the last run will appear here.";
    rulesListEl.innerHTML = "";
    updateRunDetailsVisibility(false);
    return;
  }

  const totalRules = Number(ruleset?.totalRules) || rules.length;
  const label = formatSourceType(ruleset?.sourceType || "evidence");
  evidenceSummaryEl.textContent = `${label} surfaced ${totalRules} rule${totalRules === 1 ? "" : "s"} for this run.`;

  rulesListEl.innerHTML = rules
    .map((rule) => `
      <article class="detail-item">
        <strong>${escapeHtml(rule.section || "General")}</strong>
        <span>${escapeHtml(rule.content || "")}</span>
      </article>
    `)
    .join("");
}

function renderEnsemble(ensemble) {
  if (!ensemble || !ensemble.enabled) {
    ensembleSelectedEl.textContent = "No ensemble data for this run.";
    ensembleListEl.innerHTML = "";
    ensemblePanelEl.style.display = "none";
    updateRunDetailsVisibility(Boolean(rulesListEl.innerHTML.trim()));
    return;
  }

  ensemblePanelEl.style.display = "block";
  const tier = ensemble.selectedTier || "-";
  const model = ensemble.selectedModel || "-";
  const reason = ensemble.reason ? ` • ${ensemble.reason}` : "";
  ensembleSelectedEl.textContent = `Selected ${tier} (${model})${reason}`;

  const candidates = Array.isArray(ensemble.candidates) ? ensemble.candidates : [];
  ensembleListEl.innerHTML = candidates
    .map((candidate) => `
      <article class="detail-item">
        <strong>${escapeHtml(candidate.tier || "tier")} • ${escapeHtml(candidate.model || "model")}</strong>
        <span>score ${typeof candidate.score === "number" ? candidate.score.toFixed(2) : "-"} • latency ${Number.isFinite(candidate.latencyMs) ? `${candidate.latencyMs}ms` : "-"}${candidate.error ? ` • ${escapeHtml(candidate.error)}` : ""}</span>
      </article>
    `)
    .join("");

  updateRunDetailsVisibility(true);
}

function updateRunDetailsVisibility(visible) {
  runDetailsEl.classList.toggle("visible", !!visible);
  if (!visible) {
    runDetailsEl.open = false;
  }
}

function formatSourceType(value) {
  const normalized = String(value || "").trim().toLowerCase();
  switch (normalized) {
    case "azure-docs":
      return "Azure Docs";
    case "ado":
      return "ADO";
    case "layered":
      return "Layered sources";
    default:
      return "Evidence";
  }
}

function buildAcceptedBundle() {
  return Array.from(acceptedCommands.entries())
    .map(([caseId, commands]) => `# ${caseId}\n${String(commands || "").trim()}`)
    .join("\n\n");
}

async function copyText(text) {
  const value = String(text || "").trim();
  if (!value) {
    return false;
  }

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (_err) {
    // Fall through to manual copy.
  }

  const helper = document.createElement("textarea");
  helper.value = value;
  helper.setAttribute("readonly", "");
  helper.style.position = "absolute";
  helper.style.left = "-9999px";
  document.body.appendChild(helper);
  helper.select();
  helper.setSelectionRange(0, helper.value.length);
  const ok = document.execCommand("copy");
  document.body.removeChild(helper);
  return ok;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// --- File upload ---
function initFileUpload() {
  if (!fileInputEl || !fileUploadZoneEl) return;

  fileInputEl.addEventListener("change", () => {
    handleFiles(fileInputEl.files);
    fileInputEl.value = "";
  });

  fileUploadZoneEl.addEventListener("dragover", (e) => {
    e.preventDefault();
    fileUploadZoneEl.classList.add("drag-over");
  });

  fileUploadZoneEl.addEventListener("dragleave", () => {
    fileUploadZoneEl.classList.remove("drag-over");
  });

  fileUploadZoneEl.addEventListener("drop", (e) => {
    e.preventDefault();
    fileUploadZoneEl.classList.remove("drag-over");
    handleFiles(e.dataTransfer.files);
  });
}

function handleFiles(fileList) {
  if (!fileList || fileList.length === 0) return;

  for (const file of fileList) {
    if (uploadedFiles.length >= MAX_FILES) {
      setStatus(`Max ${MAX_FILES} files allowed.`, "error");
      break;
    }
    if (file.size > MAX_FILE_SIZE) {
      setStatus(`${file.name} exceeds 512 KB limit — skipped.`, "error");
      continue;
    }
    if (uploadedFiles.some((f) => f.name === file.name)) {
      continue; // skip duplicates
    }

    const reader = new FileReader();
    reader.onload = () => {
      uploadedFiles.push({
        name: file.name,
        size: file.size,
        content: reader.result,
      });
      renderFileChips();
    };
    reader.readAsText(file);
  }
}

function removeFile(index) {
  uploadedFiles.splice(index, 1);
  renderFileChips();
}

function renderFileChips() {
  if (!fileChipsEl) return;

  if (uploadedFiles.length === 0) {
    fileChipsEl.innerHTML = "";
    return;
  }

  fileChipsEl.innerHTML = uploadedFiles
    .map((f, i) => {
      const sizeLabel = f.size < 1024 ? `${f.size} B` : `${(f.size / 1024).toFixed(1)} KB`;
      return `<span class="file-chip">
        ${escapeHtml(f.name)}
        <span class="file-size">(${sizeLabel})</span>
        <button type="button" class="remove-file" data-file-index="${i}">&times;</button>
      </span>`;
    })
    .join("");

  fileChipsEl.querySelectorAll(".remove-file").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.getAttribute("data-file-index"));
      removeFile(idx);
    });
  });
}

function buildFileContext() {
  return uploadedFiles.map((f) => ({
    fileName: f.name,
    content: f.content,
  }));
}

async function runTestCase(caseId, runRequest, runBtn, runStatusEl) {
  if (runningJobs.has(caseId)) {
    return;
  }

  runBtn.disabled = true;
  runBtn.classList.add("running");
  runBtn.textContent = "Running...";
  runningJobs.set(caseId, null);

  if (runStatusEl) {
    runStatusEl.className = "run-status visible running";
    runStatusEl.textContent = "Submitting job...";
  }

  try {
    const response = await fetch("/api/v1/longevity-jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(runRequest),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || "Failed to submit job");
    }

    const jobId = data?.id;
    if (!jobId) {
      throw new Error("No job ID returned");
    }

    runningJobs.set(caseId, jobId);
    if (runStatusEl) {
      runStatusEl.textContent = `Job ${jobId} submitted — polling...`;
    }
    setStatus(`Started job ${jobId} for ${caseId}.`, "success");

    pollJobStatus(caseId, jobId, runBtn, runStatusEl);
  } catch (err) {
    runningJobs.delete(caseId);
    runBtn.disabled = false;
    runBtn.classList.remove("running");
    runBtn.textContent = "Run";
    if (runStatusEl) {
      runStatusEl.className = "run-status visible failed";
      runStatusEl.textContent = `Failed: ${err?.message || "Unknown error"}`;
    }
    setStatus(`Run failed for ${caseId}: ${err?.message || "Unknown error"}`, "error");
  }
}

function pollJobStatus(caseId, jobId, runBtn, runStatusEl) {
  let interval;
  async function tick() {
    try {
      const response = await fetch(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
      if (!response.ok) {
        throw new Error("Failed to fetch job status");
      }

      const job = await response.json();
      const status = (job?.status || "").toLowerCase();

      if (runStatusEl?.isConnected) {
        const elapsed = job?.startedAt
          ? `${((Date.now() - new Date(job.startedAt).getTime()) / 1000).toFixed(0)}s`
          : "";
        runStatusEl.textContent = `Job ${jobId}: ${job?.status || "unknown"}${elapsed ? ` (${elapsed})` : ""}`;
      }

      if (status === "succeeded" || status === "completed") {
        clearInterval(interval);
        runningJobs.delete(caseId);
        completedJobData.set(caseId, { jobId, job });
        if (runBtn?.isConnected) { runBtn.disabled = false; runBtn.classList.remove("running"); runBtn.textContent = "Run"; }
        if (runStatusEl?.isConnected) {
          runStatusEl.className = "run-status visible succeeded";
          runStatusEl.textContent = `Job ${jobId}: succeeded`;
          renderFlightRecorder(runStatusEl, jobId, job);
        }
        setStatus(`${caseId} completed successfully.`, "success");
      } else if (status === "failed" || status === "error") {
        clearInterval(interval);
        runningJobs.delete(caseId);
        completedJobData.set(caseId, { jobId, job });
        if (runBtn?.isConnected) { runBtn.disabled = false; runBtn.classList.remove("running"); runBtn.textContent = "Run"; }
        if (runStatusEl?.isConnected) {
          runStatusEl.className = "run-status visible failed";
          runStatusEl.textContent = `Job ${jobId}: failed${job?.error ? ` — ${job.error}` : ""}`;
          renderFlightRecorder(runStatusEl, jobId, job);
        }
        setStatus(`${caseId} failed.${job?.error ? ` ${job.error}` : ""}`, "error");
      }
    } catch (_err) {
      // Polling errors are transient — keep trying.
    }
  }
  tick();
  interval = setInterval(tick, 800);
}

// --- Flight Recorder ---
function renderFlightRecorder(runStatusEl, jobId, job) {
  if (!runStatusEl) return;
  const card = runStatusEl.closest(".result");
  if (!card) return;
  const container = card.querySelector('[data-role="flight-recorder"]');
  if (!container) return;

  const result = job?.result;
  // Support both longevity (iterations) and provision (prereqSteps) results
  const iterations = Array.isArray(result?.iterations) ? result.iterations : [];
  const prereqSteps = Array.isArray(result?.prereqSteps) ? result.prereqSteps : [];
  const jobStatus = (job?.status || "").toLowerCase();
  const jobSuccess = jobStatus === "succeeded" || jobStatus === "completed";

  // Collect all actions across iterations (most jobs have 1 iteration)
  const allActions = [];
  for (const iter of iterations) {
    const acts = Array.isArray(iter.actions) ? iter.actions : [];
    for (const a of acts) {
      allActions.push({ ...a, iteration: iter.index });
    }
  }

  // For provision results with prereqSteps but no iterations, synthesize a prereqs action
  if (allActions.length === 0 && prereqSteps.length > 0) {
    allActions.push({
      name: "prereqs",
      success: jobSuccess,
      error: job?.error || "",
      steps: prereqSteps,
      startedAt: job?.startedAt,
      finishedAt: job?.finishedAt,
    });
  }

  // If still no data and job has an error, synthesize a minimal action
  if (allActions.length === 0 && job?.error) {
    allActions.push({
      name: "setup",
      success: false,
      error: job.error,
      steps: [],
      startedAt: job?.startedAt,
      finishedAt: job?.finishedAt,
    });
  }

  if (allActions.length === 0) {
    container.innerHTML = "";
    container.classList.remove("visible");
    return;
  }

  // Calculate total elapsed
  let totalMs = 0;
  if (job?.startedAt && job?.finishedAt) {
    totalMs = new Date(job.finishedAt).getTime() - new Date(job.startedAt).getTime();
  }
  const totalSec = (totalMs / 1000).toFixed(1);

  const passCount = allActions.filter(a => a.success).length;
  const failCount = allActions.filter(a => !a.success).length;
  const totalActions = allActions.length;

  // Planned actions from the job summary
  const planned = Array.isArray(job?.summary?.longevityActions) ? job.summary.longevityActions : [];
  const executedNames = new Set(allActions.map(a => (a.name || "").toLowerCase()));
  const skippedActions = planned.filter(a => !executedNames.has(a.toLowerCase()));

  // Build timeline HTML
  const actionsHtml = allActions.map((action, idx) => {
    const nodeClass = action.success ? "pass" : "fail";
    const steps = Array.isArray(action.steps) ? action.steps : [];
    const actionMs = action.startedAt && action.finishedAt
      ? new Date(action.finishedAt).getTime() - new Date(action.startedAt).getTime()
      : steps.reduce((s, st) => s + (st.durationMs || 0), 0);
    const actionSec = (actionMs / 1000).toFixed(1);
    const stepCountLabel = steps.length > 0 ? `${steps.length} cmd${steps.length > 1 ? "s" : ""}` : "";

    const stepsHtml = steps.map((step, si) => {
      const sClass = step.success ? "pass" : "fail";
      const durLabel = step.durationMs != null ? `${(step.durationMs / 1000).toFixed(1)}s` : "";
      const cmd = escapeHtml(step.command || "");
      const output = step.output ? escapeHtml(step.output) : "";
      return `<div class="fr-step" data-step-idx="${si}">
        <div class="fr-step-head">
          <span class="fr-step-indicator ${sClass}"></span>
          <span class="fr-step-cmd" title="${cmd}">${cmd}</span>
          <span class="fr-step-dur">${durLabel}</span>
        </div>
        ${output ? `<div class="fr-step-output${step.success ? "" : " fail-output"}">${output}</div>` : ""}
      </div>`;
    }).join("");

    const errorHtml = action.error && !action.success
      ? `<div class="fr-step" style="border-color:rgba(248,113,113,0.2)">
           <div class="fr-step-head"><span class="fr-step-indicator fail"></span><span class="fr-step-cmd" style="color:#fca5a5">Error: ${escapeHtml(action.error)}</span></div>
         </div>`
      : "";

    return `<div class="fr-action" data-action-idx="${idx}">
      <div class="fr-node ${nodeClass}"><div class="fr-node-dot"></div></div>
      <div class="fr-action-head">
        <span class="fr-action-name">${escapeHtml(action.name || "unknown")}</span>
        <span class="fr-action-meta">
          <span class="dur">${actionSec}s</span>
          ${stepCountLabel ? `<span>${stepCountLabel}</span>` : ""}
          <span class="fr-badge ${nodeClass}">${action.success ? "PASS" : "FAIL"}</span>
        </span>
      </div>
      <div class="fr-steps">
        ${stepsHtml}
        ${errorHtml}
      </div>
    </div>`;
  }).join("");

  // Skipped actions
  const skippedHtml = skippedActions.map(name => `
    <div class="fr-action">
      <div class="fr-node skip"><div class="fr-node-dot"></div></div>
      <div class="fr-action-head">
        <span class="fr-action-name" style="color:#64748b">${escapeHtml(name)}</span>
        <span class="fr-action-meta"><span style="color:#475569">skipped</span></span>
      </div>
    </div>
  `).join("");

  // Summary line
  const summaryParts = [];
  summaryParts.push(`${passCount}/${totalActions} action${totalActions !== 1 ? "s" : ""} passed`);
  if (failCount > 0) summaryParts.push(`stopped at ${allActions.find(a => !a.success)?.name || "unknown"}`);
  if (skippedActions.length > 0) summaryParts.push(`${skippedActions.length} skipped`);
  if (iterations.length > 0) summaryParts.push(`iteration ${iterations.length} of ${result?.iterationsRequested || iterations.length}`);

  const recorderIcon = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="10 8 16 12 10 16 10 8"/></svg>`;

  container.innerHTML = `
    <div class="fr-header" data-role="fr-toggle">
      <div class="fr-title">
        ${recorderIcon}
        Flight Recorder — Job ${escapeHtml(jobId.substring(0, 12))}
        <span class="fr-badge ${jobSuccess ? "pass" : "fail"}">${jobSuccess ? "PASS" : "FAIL"}</span>
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <span class="fr-elapsed">${totalSec}s</span>
        <button type="button" class="fr-close" data-role="fr-close" title="Close">&times;</button>
      </div>
    </div>
    <div class="fr-body">
      <div class="fr-timeline">
        ${actionsHtml}
        ${skippedHtml}
      </div>
      <div class="fr-summary">${summaryParts.join(" \u00b7 ")}</div>
    </div>
  `;

  container.classList.add("visible");

  // Wire up interactivity
  container.querySelector('[data-role="fr-close"]')?.addEventListener("click", (e) => {
    e.stopPropagation();
    container.classList.remove("visible");
  });

  // Click action head to expand/collapse steps
  container.querySelectorAll(".fr-action-head").forEach(head => {
    head.addEventListener("click", () => {
      const action = head.closest(".fr-action");
      if (action) action.classList.toggle("expanded");
    });
  });

  // Click step head to expand/collapse output
  container.querySelectorAll(".fr-step-head").forEach(head => {
    head.addEventListener("click", () => {
      const step = head.closest(".fr-step");
      if (step) step.classList.toggle("expanded");
    });
  });
}

async function generate() {
  const prompt = (promptEl.value || "").trim();
  if (!prompt) {
    setStatus("Add a prompt so the planner knows what to target.", "error");
    return;
  }

  const isRefine = refineTargetCaseId !== null;
  const refineCaseId = refineTargetCaseId;
  refineTargetCaseId = null;

  const caseCount = Math.max(1, Math.min(50, Number(caseCountEl.value) || 8));
  const startedAt = Date.now();
  uiState.prompt = prompt;
  uiState.elapsed = "";
  uiState.model = "";

  const payload = {
    baseline: defaultBaseline,
    caseCount: isRefine ? 1 : caseCount,
    strategy: prompt,
    ensembleEnabled: false,
    layers: defaultLayers,
    retrieval: {
      query: prompt,
      topK: Math.max(12, caseCount * 2),
      useEmbeddings: true,
      lexical: "bm25",
    },
    fileContext: buildFileContext(),
  };

  setGenerateBusy(true);
  startGenerationTicker(isRefine ? 1 : caseCount);

  if (!isRefine) {
    uiState.totalCases = 0;
    refreshRunMeta();
    renderLoadingState(caseCount);
    setBulkActionsVisibility(false);
    hidePagination();
    updateRunDetailsVisibility(false);
  } else {
    setStatus(`Refining ${refineCaseId}...`);
  }

  try {
    const response = await fetch("/api/v1/ai/test-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error || "Failed to generate test cases");
    }

    uiState.elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    uiState.model = data?.model || "";

    if (isRefine && refineCaseId && Array.isArray(data?.cases) && data.cases.length > 0) {
      const replacement = data.cases[0];
      const targetIndex = allCases.findIndex((tc, i) => String(tc.caseId || `case-${i + 1}`) === refineCaseId);
      if (targetIndex >= 0) {
        replacement.caseId = refineCaseId;
        allCases[targetIndex] = replacement;
        const newCommands = buildRelevantAzCliCommands(replacement.runRequest || {}).join("\n");
        initialCommands.set(refineCaseId, newCommands);
        acceptedCommands.delete(refineCaseId);
        renderPage(currentPage);
        setStatus(`Refined ${refineCaseId} in ${uiState.elapsed}s. Other cases unchanged.`, "success");
      } else {
        allCases.push(replacement);
        const newId = String(replacement.caseId || `case-${allCases.length}`);
        initialCommands.set(newId, buildRelevantAzCliCommands(replacement.runRequest || {}).join("\n"));
        uiState.totalCases = allCases.length;
        refreshRunMeta();
        updateAcceptedSummary(allCases.length);
        const lastPage = Math.ceil(allCases.length / PAGE_SIZE);
        renderPage(lastPage);
        setStatus(`Could not find ${refineCaseId}; appended refined case. ${uiState.elapsed}s.`, "success");
      }
    } else {
      renderCases(data?.cases || []);
      renderEvidence(data?.ruleset, data?.retrievedRules);
      renderEnsemble(data?.ensemble);
      setGenerationInfo([
        uiState.model,
        `${Array.isArray(data?.cases) ? data.cases.length : 0} cases`,
        `${uiState.elapsed}s`,
        data?.ruleset?.totalRules ? `${data.ruleset.totalRules} rules` : "",
      ]);
      setStatus(`Generated ${Array.isArray(data?.cases) ? data.cases.length : 0} test cases in ${uiState.elapsed}s.`, "success");
    }
  } catch (err) {
    if (!isRefine) {
      renderEmptyState("Generation failed", err?.message || "The planner request failed before cases were returned.");
      renderEvidence(null, null);
      renderEnsemble(null);
      setGenerationInfo([]);
      setSplitMode(false);
    }
    setStatus(err?.message || "Request failed", "error");
  } finally {
    stopGenerationTicker();
    setGenerateBusy(false);
    refreshRunMeta();
  }
}

// --- Run mode toggle ---
function setRunMode(mode) {
  bulkRunMode = mode;
  if (modeParallelBtn) modeParallelBtn.classList.toggle("active", mode === "parallel");
  if (modeSequentialBtn) modeSequentialBtn.classList.toggle("active", mode === "sequential");
}

if (modeParallelBtn) {
  modeParallelBtn.addEventListener("click", () => setRunMode("parallel"));
}
if (modeSequentialBtn) {
  modeSequentialBtn.addEventListener("click", () => setRunMode("sequential"));
}

// --- Bulk run ---
function setBulkRunStatus(text, tone) {
  if (!bulkRunStatusEl) return;
  bulkRunStatusEl.textContent = text || "";
  bulkRunStatusEl.className = "bulk-run-status" + (text ? " visible" : "") + (tone ? " " + tone : "");
}

function setBulkRunBusy(busy) {
  if (runAllBtn) {
    runAllBtn.disabled = busy;
    runAllBtn.classList.toggle("running", busy);
    runAllBtn.textContent = busy ? "Running..." : "Run All";
  }
}

async function submitOneJob(caseId, runRequest) {
  const response = await fetch("/api/v1/longevity-jobs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(runRequest),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error || "Failed to submit job");
  const jobId = data?.id;
  if (!jobId) throw new Error("No job ID returned");
  return jobId;
}

async function waitForJob(jobId) {
  return new Promise((resolve) => {
    let interval;
    async function tick() {
      try {
        const res = await fetch(`/api/v1/jobs/${encodeURIComponent(jobId)}`);
        if (!res.ok) return;
        const job = await res.json();
        const st = (job?.status || "").toLowerCase();
        if (st === "succeeded" || st === "completed") {
          clearInterval(interval);
          resolve({ status: "succeeded", job });
        } else if (st === "failed" || st === "error") {
          clearInterval(interval);
          resolve({ status: "failed", job });
        }
      } catch (_e) { /* transient */ }
    }
    tick();
    interval = setInterval(tick, 800);
  });
}

function updateCardRunStatus(caseId, status, message, jobId, job) {
  // Store completed job data for re-rendering on page navigation
  if (job && (status === "succeeded" || status === "failed")) {
    completedJobData.set(caseId, { jobId: jobId || "", job });
  }
  // Find the card on the current page
  const cards = resultsEl.querySelectorAll(".result");
  const start = (currentPage - 1) * PAGE_SIZE;
  cards.forEach((card, pageIdx) => {
    const globalIdx = start + pageIdx;
    const tc = allCases[globalIdx];
    if (!tc) return;
    const id = String(tc.caseId || `case-${globalIdx + 1}`);
    if (id !== caseId) return;
    const btn = card.querySelector('[data-role="run-case"]');
    const el = card.querySelector('[data-role="run-status"]');
    if (status === "running") {
      runningJobs.set(caseId, message);
      if (btn) { btn.disabled = true; btn.classList.add("running"); btn.textContent = "Running..."; }
      if (el) { el.className = "run-status visible running"; el.textContent = message || "Running..."; }
    } else if (status === "succeeded") {
      runningJobs.delete(caseId);
      if (btn) { btn.disabled = false; btn.classList.remove("running"); btn.textContent = "Run"; }
      if (el) { el.className = "run-status visible succeeded"; el.textContent = message || "Succeeded"; }
      if (el && job) renderFlightRecorder(el, jobId || "", job);
    } else if (status === "failed") {
      runningJobs.delete(caseId);
      if (btn) { btn.disabled = false; btn.classList.remove("running"); btn.textContent = "Run"; }
      if (el) { el.className = "run-status visible failed"; el.textContent = message || "Failed"; }
      if (el && job) renderFlightRecorder(el, jobId || "", job);
    }
  });
}

async function bulkRunAll() {
  if (allCases.length === 0) {
    setStatus("No cases to run.", "error");
    return;
  }

  setBulkRunBusy(true);
  const total = allCases.length;
  let succeeded = 0;
  let failed = 0;
  const startedAt = Date.now();

  const entries = allCases.map((tc, i) => ({
    caseId: String(tc.caseId || `case-${i + 1}`),
    runRequest: tc.runRequest || {},
  }));

  const updateSummary = () => {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
    setBulkRunStatus(
      `${succeeded + failed}/${total} done (${succeeded} ok, ${failed} err) — ${elapsed}s — ${bulkRunMode}`,
      "running"
    );
  };

  setStatus(`Running all ${total} cases (${bulkRunMode})...`);
  updateSummary();

  if (bulkRunMode === "parallel") {
    const promises = entries.map(async ({ caseId, runRequest }) => {
      try {
        updateCardRunStatus(caseId, "running", "Submitting...");
        const jobId = await submitOneJob(caseId, runRequest);
        runningJobs.set(caseId, jobId);
        updateCardRunStatus(caseId, "running", `Job ${jobId} running...`);
        const result = await waitForJob(jobId);
        if (result.status === "succeeded") {
          succeeded++;
          updateCardRunStatus(caseId, "succeeded", `Job ${jobId}: succeeded`, jobId, result.job);
        } else {
          failed++;
          updateCardRunStatus(caseId, "failed", `Job ${jobId}: failed${result.job?.error ? " \u2014 " + result.job.error : ""}`, jobId, result.job);
        }
      } catch (err) {
        failed++;
        updateCardRunStatus(caseId, "failed", `Failed: ${err?.message || "Unknown error"}`);
      }
      updateSummary();
    });
    await Promise.all(promises);
  } else {
    for (const { caseId, runRequest } of entries) {
      try {
        updateCardRunStatus(caseId, "running", "Submitting...");
        const jobId = await submitOneJob(caseId, runRequest);
        runningJobs.set(caseId, jobId);
        updateCardRunStatus(caseId, "running", `Job ${jobId} running...`);
        updateSummary();
        const result = await waitForJob(jobId);
        if (result.status === "succeeded") {
          succeeded++;
          updateCardRunStatus(caseId, "succeeded", `Job ${jobId}: succeeded`, jobId, result.job);
        } else {
          failed++;
          updateCardRunStatus(caseId, "failed", `Job ${jobId}: failed${result.job?.error ? " \u2014 " + result.job.error : ""}`, jobId, result.job);
        }
      } catch (err) {
        failed++;
        updateCardRunStatus(caseId, "failed", `Failed: ${err?.message || "Unknown error"}`);
      }
      updateSummary();
    }
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  setBulkRunBusy(false);
  setBulkRunStatus(
    `Bulk run complete: ${succeeded} succeeded, ${failed} failed out of ${total} — ${elapsed}s`,
    "done"
  );
  setStatus(
    `Bulk run done: ${succeeded}/${total} succeeded in ${elapsed}s.`,
    failed === 0 ? "success" : "error"
  );
}

if (runAllBtn) {
  runAllBtn.addEventListener("click", bulkRunAll);
}

if (acceptAllBtn) {
  acceptAllBtn.addEventListener("click", () => {
    // Accept all cases across all pages using stored initial commands
    allCases.forEach((testCase, index) => {
      const caseId = String(testCase.caseId || `case-${index + 1}`);
      if (!acceptedCommands.has(caseId)) {
        acceptedCommands.set(caseId, initialCommands.get(caseId) || "");
      }
    });
    updateAcceptedSummary(allCases.length);
    renderPage(currentPage); // Re-render current page to reflect accepted state
    setStatus("Accepted all generated command flows.", "success");
  });
}

if (clearAcceptedBtn) {
  clearAcceptedBtn.addEventListener("click", () => {
    acceptedCommands.clear();
    updateAcceptedSummary(allCases.length);
    renderPage(currentPage); // Re-render current page to clear accepted state
    setStatus("Cleared accepted selections.", "success");
  });
}

if (copyAcceptedBtn) {
  copyAcceptedBtn.addEventListener("click", async () => {
    const bundle = buildAcceptedBundle();
    if (!bundle) {
      setStatus("Accept at least one case before copying.", "error");
      return;
    }
    const ok = await copyText(bundle);
    setStatus(ok ? "Copied accepted command bundle." : "Clipboard copy failed in this browser context.", ok ? "success" : "error");
  });
}

const qpIcons = {
  Admission: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',
  Overlap: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="12" r="7"/><circle cx="15" cy="12" r="7"/></svg>',
  Immutability: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>',
  Lifecycle: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"/></svg>',
  default: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
};

function renderQuickPrompts() {
  if (!quickPromptsEl) return;
  const meta = resourceMeta[activeResourceTab];
  const chips = meta.quickPrompts || [];
  quickPromptsEl.innerHTML = chips.map(c => {
    const icon = qpIcons[c.label] || qpIcons.default;
    return `<button type="button" class="chip" data-prompt="${c.prompt.replace(/"/g, '&quot;')}">
      <strong>${icon} ${c.label}</strong>
      <span>${c.desc}</span>
    </button>`;
  }).join("");
}

renderQuickPrompts();

if (quickPromptsEl) {
  quickPromptsEl.addEventListener("click", (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }
    const target = event.target.closest("[data-prompt]");
    if (!(target instanceof HTMLElement)) {
      return;
    }
    const prompt = target.getAttribute("data-prompt");
    if (!prompt) {
      return;
    }
    promptEl.value = prompt;
    updatePromptHint();
    promptEl.focus();
  });
}

generateBtn.addEventListener("click", generate);

// --- Resource Tab Switching ---
const resourceTabsEl = document.getElementById("resourceTabs");
if (resourceTabsEl) {
  resourceTabsEl.addEventListener("click", (e) => {
    const tab = e.target.closest(".resource-tab");
    if (!tab) return;
    const res = tab.dataset.resource;
    if (!res || !resourceMeta[res] || res === activeResourceTab) return;

    activeResourceTab = res;
    defaultBaseline = buildDefaultBaseline();
    defaultLayers = buildDefaultLayers();

    // Update active class
    resourceTabsEl.querySelectorAll(".resource-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");

    // Update placeholder
    promptEl.placeholder = resourceMeta[res].placeholder;

    // Update quick prompt chips for new tab
    renderQuickPrompts();
  });
}

// --- Saved Plans ---
async function refreshSavedPlans() {
  try {
    const res = await fetch("/api/v1/plans");
    const plans = await res.json();
    if (!Array.isArray(plans) || plans.length === 0) {
      savedPlansList.innerHTML = '<p style="color:#8aa3ae;font-size:0.82rem;text-align:center;padding:12px 0;">No saved plans yet.</p>';
      return;
    }
    savedPlansList.innerHTML = plans.map(p => `
      <div class="saved-plan-row" data-id="${escapeHtml(p.id)}">
        <span class="plan-name">${escapeHtml(p.name)}</span>
        <span class="plan-meta">${p.caseCount} cases${p.model ? " \u00b7 " + escapeHtml(p.model) : ""}${p.createdAt ? " \u00b7 " + new Date(p.createdAt).toLocaleDateString() : ""}</span>
        <button type="button" class="load-btn">Load</button>
        <button type="button" class="delete-btn">Delete</button>
      </div>`).join("");
  } catch { /* silent */ }
}

if (savedPlansList) {
  savedPlansList.addEventListener("click", async (e) => {
    const row = e.target.closest(".saved-plan-row");
    if (!row) return;
    const id = row.dataset.id;
    if (e.target.closest(".load-btn")) {
      try {
        const res = await fetch(`/api/v1/plans/${encodeURIComponent(id)}`);
        if (!res.ok) throw new Error("Failed to load plan");
        const data = await res.json();
        if (Array.isArray(data.cases) && data.cases.length > 0) {
          allCases = data.cases;
          acceptedCommands.clear();
          initialCommands.clear();
          uiState.model = data.model || "";
          uiState.totalCases = allCases.length;
          refreshRunMeta();
          setBulkActionsVisibility(true);
          updateAcceptedSummary(allCases.length);
          renderPage(1);
          updateRunDetailsVisibility(true);
          setStatus(`Loaded plan "${escapeHtml(data.name)}" (${allCases.length} cases)`, "success");
        }
      } catch (err) {
        setStatus("Failed to load plan: " + err.message, "error");
      }
    }
    if (e.target.closest(".delete-btn")) {
      try {
        const res = await fetch(`/api/v1/plans/${encodeURIComponent(id)}`, { method: "DELETE" });
        if (!res.ok) throw new Error("Delete failed");
        refreshSavedPlans();
        setStatus("Plan deleted.", "success");
      } catch (err) {
        setStatus("Failed to delete plan: " + err.message, "error");
      }
    }
  });
}

if (savePlanBtn) {
  savePlanBtn.addEventListener("click", () => {
    if (allCases.length === 0) {
      setStatus("Generate test cases first.", "error");
      return;
    }
    planNameInput.value = "";
    saveModal.classList.add("visible");
    planNameInput.focus();
  });
}
if (saveCancelBtn) {
  saveCancelBtn.addEventListener("click", () => saveModal.classList.remove("visible"));
}
if (saveConfirmBtn) {
  saveConfirmBtn.addEventListener("click", async () => {
    const name = planNameInput.value.trim();
    if (!name) { planNameInput.focus(); return; }
    saveModal.classList.remove("visible");
    try {
      const res = await fetch("/api/v1/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          strategy: promptEl.value.trim(),
          model: uiState.model || "",
          cases: allCases,
        }),
      });
      if (!res.ok) throw new Error("Save failed");
      setStatus(`Plan "${escapeHtml(name)}" saved.`, "success");
      refreshSavedPlans();
    } catch (err) {
      setStatus("Failed to save plan: " + err.message, "error");
    }
  });
}
if (saveModal) {
  saveModal.addEventListener("click", (e) => {
    if (e.target === saveModal) saveModal.classList.remove("visible");
  });
}

refreshSavedPlans();
promptEl.addEventListener("input", updatePromptHint);
promptEl.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    event.preventDefault();
    generate();
  }
});
document.getElementById("depthToggle").addEventListener("click", (e) => {
  const btn = e.target.closest(".depth-btn");
  if (!btn) return;
  selectDepth(Number(btn.dataset.count));
});

promptEl.value =
  "I want to test admission failures, overlap behavior, immutability, and cleanup safety with operator-ready CLI flows";

updateCaseCountDisplay();
updatePromptHint();
updateAcceptedSummary(0);
refreshRunMeta();
renderEvidence(null, null);
renderEnsemble(null);
initFileUpload();
setStatus("Planner ready. Describe the behavior you want to pressure-test.", "success");
