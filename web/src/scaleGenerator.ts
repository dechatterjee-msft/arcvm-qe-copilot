import type { TestCase } from './types';

/* ─── Types ────────────────────────────────────────────── */

export type ScaleResourceType =
  | 'lnet'
  | 'nic';

export const SCALE_PRESETS = [10, 50, 100, 500, 1000] as const;
export const BATCH_SIZES  = [10, 25, 50, 100] as const;

export const SCALE_RESOURCE_LABELS: Record<ScaleResourceType, string> = {
  lnet: 'Logical Network',
  nic: 'Network Interface',
};

/* ─── VM Topology — user-tunable peripheral counts ───── */

export interface VmTopology {
  lnetCount: number;
  nsgCount: number;
  storagePathCount: number;
  vlan: number;
  ipPoolBase: string;   // e.g. "192.168.0.0"
  ipsPerPool: number;   // IPs per LNET pool (auto-calculated)
}

export const DEFAULT_VM_TOPOLOGY: VmTopology = {
  lnetCount: 2,
  nsgCount: 1,
  storagePathCount: 1,
  vlan: 200,
  ipPoolBase: '192.168.0.0',
  ipsPerPool: 128,
};

/** Compute smart defaults based on VM count */
export function suggestTopology(vmCount: number): VmTopology {
  // ~50 VMs per LNET is a reasonable Azure Local default
  const lnets = Math.max(1, Math.ceil(vmCount / 50));
  // 1 NSG is typical, bump at 200+
  const nsgs = vmCount >= 200 ? 2 : 1;
  // 1 storage path is typical, bump at 500+
  const sps = vmCount >= 500 ? 2 : 1;
  const ipsPerPool = Math.ceil(vmCount / lnets) + 10; // headroom

  return {
    lnetCount: lnets,
    nsgCount: nsgs,
    storagePathCount: sps,
    vlan: 200,
    ipPoolBase: '192.168.0.0',
    ipsPerPool,
  };
}

export interface ScaleConfig {
  resourceType: ScaleResourceType;
  totalCount: number;
  batchSize: number;
  prefix: string;
  /** Only used when resourceType === 'vm' */
  vmTopology?: VmTopology;
}

/* ─── IP helpers ───────────────────────────────────────── */

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

function ipToNum(ip: string): number {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

function numToIp(n: number): string {
  return `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
}

function incrementIP(base: string, offset: number): string {
  return numToIp(ipToNum(base) + offset);
}

/**
 * Build subnet info for LNET index.
 * Each LNET gets its own /N subnet carved from the ipPoolBase.
 * Pool covers [gateway+49 .. gateway+49+poolSize-1].
 */
function buildSubnet(ipPoolBase: string, lnetIdx: number, poolSize: number, vlanBase: number) {
  // Each lnet gets a /24 block offset from the base
  const baseNum = ipToNum(ipPoolBase);
  // Offset by lnetIdx in the 3rd octet
  const subnetNum = baseNum + lnetIdx * 256;
  const gateway = numToIp(subnetNum + 1);
  const dns = numToIp(subnetNum + 10);
  const poolStart = numToIp(subnetNum + 50);
  const poolEnd = numToIp(subnetNum + 50 + Math.min(poolSize - 1, 200));

  return {
    prefix: numToIp(subnetNum) + '/24',
    gateway,
    dns,
    poolStart,
    poolEnd,
    vlan: vlanBase + lnetIdx,
  };
}

/* ─── Per-resource generators (standalone) ─────────────── */

function genLnets(start: number, count: number, prefix: string): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => {
    const idx = start + i;
    const s = buildSubnet('192.168.0.0', idx, 128, 200);
    return {
      name: `${prefix}-lnet-${pad4(idx + 1)}`,
      addressPrefix: s.prefix,
      ipAllocationMethod: 'Static',
      ipPoolStart: s.poolStart,
      ipPoolEnd: s.poolEnd,
      gateway: s.gateway,
      dnsServers: [s.dns],
      vlan: s.vlan,
      vmSwitchName: 'ConvergedSwitch',
    };
  });
}

function genNics(start: number, count: number, prefix: string): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => {
    const idx = start + i;
    return {
      name: `${prefix}-nic-${pad4(idx + 1)}`,
      networkRef: `${prefix}-lnet-0001`,
      ipAddress: incrementIP('192.168.0.50', idx),
    };
  });
}

function genNsgs(start: number, count: number, prefix: string): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => {
    const idx = start + i;
    return {
      name: `${prefix}-nsg-${pad4(idx + 1)}`,
      rules: [{ name: 'allow-ssh', priority: 100, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', destinationPortRange: '22' }],
    };
  });
}

function genNsrs(start: number, count: number, prefix: string): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => {
    const idx = start + i;
    return {
      name: `${prefix}-nsr-${pad4(idx + 1)}`,
      nsgRef: `${prefix}-nsg-0001`,
      priority: 200 + idx,
      direction: 'Inbound',
      access: 'Allow',
      protocol: 'Tcp',
      destinationPortRange: String(8000 + idx),
    };
  });
}

function genStoragePaths(start: number, count: number, prefix: string): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => {
    const idx = start + i;
    return {
      name: `${prefix}-sp-${pad4(idx + 1)}`,
      path: `C:\\ClusterStorage\\Volume1\\${prefix}-sp-${pad4(idx + 1)}`,
    };
  });
}

function genVhds(start: number, count: number, prefix: string): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => {
    const idx = start + i;
    return {
      name: `${prefix}-vhd-${pad4(idx + 1)}`,
      sizeGB: 64,
      diskFileFormat: 'vhdx',
    };
  });
}

function genStorageContainers(start: number, count: number, prefix: string): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => {
    const idx = start + i;
    return {
      name: `${prefix}-sc-${pad4(idx + 1)}`,
      path: `C:\\ClusterStorage\\Volume1\\${prefix}-sc-${pad4(idx + 1)}`,
    };
  });
}

function genGalleryImages(start: number, count: number, prefix: string): Record<string, unknown>[] {
  return Array.from({ length: count }, (_, i) => {
    const idx = start + i;
    return {
      name: `${prefix}-img-${pad4(idx + 1)}`,
      imagePath: `C:\\ClusterStorage\\Volume1\\images\\ubuntu-2204-${pad4(idx + 1)}.vhdx`,
      osType: 'Linux',
      hyperVGeneration: 'V2',
    };
  });
}

/* ─── Intelligent VM full-stack generator ──────────────── */

/**
 * Generates the full peripheral topology for a batch of VMs.
 *
 * Shared resources (LNETs, NSGs, StoragePaths) are created once for the
 * FIRST batch and referenced by name in subsequent batches. VMs, NICs,
 * and VHDs are per-VM as expected.
 *
 * NICs are distributed round-robin across LNETs, each assigned the next
 * available IP from that LNET's pool.
 */
function genVmsFullStack(
  globalVmStart: number,
  count: number,
  prefix: string,
  topo: VmTopology,
  isFirstBatch: boolean,
) {
  const resources: Record<string, unknown[]> = {};

  /* ── Shared infra: only emitted in the first batch ──── */
  if (isFirstBatch) {
    // Logical Networks
    resources.logicalNetworks = Array.from({ length: topo.lnetCount }, (_, li) => {
      const s = buildSubnet(topo.ipPoolBase, li, topo.ipsPerPool, topo.vlan);
      return {
        name: `${prefix}-lnet-${pad4(li + 1)}`,
        addressPrefix: s.prefix,
        ipAllocationMethod: 'Static',
        ipPoolStart: s.poolStart,
        ipPoolEnd: s.poolEnd,
        gateway: s.gateway,
        dnsServers: [s.dns],
        vlan: s.vlan,
        vmSwitchName: 'ConvergedSwitch',
      };
    });

    // NSGs
    resources.networkSecurityGroups = Array.from({ length: topo.nsgCount }, (_, ni) => ({
      name: `${prefix}-nsg-${pad4(ni + 1)}`,
      rules: [
        { name: 'allow-ssh', priority: 100, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', destinationPortRange: '22' },
        { name: 'allow-rdp', priority: 110, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', destinationPortRange: '3389' },
      ],
    }));

    // Storage Paths
    resources.storagePaths = Array.from({ length: topo.storagePathCount }, (_, si) => ({
      name: `${prefix}-sp-${pad4(si + 1)}`,
      path: `C:\\ClusterStorage\\Volume1\\${prefix}-sp-${pad4(si + 1)}`,
    }));
  }

  /* ── Per-VM resources ─────────────────────────────────── */

  // NICs — distributed round-robin across LNETs with IPs from each LNET's pool
  const nicIpCounters: number[] = new Array(topo.lnetCount).fill(0);
  // Offset counters to account for VMs in previous batches
  const vmsPerLnet = Math.ceil(globalVmStart / topo.lnetCount);
  for (let li = 0; li < topo.lnetCount; li++) {
    nicIpCounters[li] = vmsPerLnet;
  }

  resources.networkInterfaces = Array.from({ length: count }, (_, i) => {
    const vmIdx = globalVmStart + i;
    const lnetIdx = vmIdx % topo.lnetCount;
    const lnetName = `${prefix}-lnet-${pad4(lnetIdx + 1)}`;
    const ipOffset = nicIpCounters[lnetIdx]++;
    const subnetBase = ipToNum(topo.ipPoolBase) + lnetIdx * 256 + 50;
    const ipAddress = numToIp(subnetBase + ipOffset);

    return {
      name: `${prefix}-nic-${pad4(vmIdx + 1)}`,
      networkRef: lnetName,
      ipAddress,
    };
  });

  // VHDs — one per VM
  resources.virtualHardDisks = Array.from({ length: count }, (_, i) => {
    const vmIdx = globalVmStart + i;
    return {
      name: `${prefix}-vhd-${pad4(vmIdx + 1)}`,
      sizeGB: 64,
      diskFileFormat: 'vhdx',
      storagePathRef: `${prefix}-sp-${pad4((vmIdx % topo.storagePathCount) + 1)}`,
    };
  });

  // VMs
  resources.virtualMachines = Array.from({ length: count }, (_, i) => {
    const vmIdx = globalVmStart + i;
    return {
      name: `${prefix}-vm-${pad4(vmIdx + 1)}`,
      imageRef: 'ubuntu-2204',
      vCPUs: 2,
      memoryMB: 4096,
      osType: 'Linux',
      adminUsername: 'azureuser',
      sshPublicKeyPath: '~/.ssh/id_rsa.pub',
      networkRefs: [`${prefix}-nic-${pad4(vmIdx + 1)}`],
      storagePathRef: `${prefix}-sp-${pad4((vmIdx % topo.storagePathCount) + 1)}`,
    };
  });

  return resources;
}

/* ─── Resource key mapping ─────────────────────────────── */

const RESOURCE_KEY: Record<ScaleResourceType, string> = {
  lnet: 'logicalNetworks',
  nic: 'networkInterfaces',
};

const GENERATORS: Record<ScaleResourceType, (start: number, count: number, prefix: string) => Record<string, unknown>[]> = {
  lnet: genLnets,
  nic: genNics,
};

/* ─── Main generator ───────────────────────────────────── */

export function generateScaleTestCases(config: ScaleConfig): TestCase[] {
  const { resourceType, totalCount, batchSize, prefix } = config;
  const batches = Math.ceil(totalCount / batchSize);
  const cases: TestCase[] = [];

  for (let b = 0; b < batches; b++) {
    const start = b * batchSize;
    const count = Math.min(batchSize, totalCount - start);
    const batchLabel = batches === 1 ? '' : ` batch ${b + 1}/${batches}`;

    const key = RESOURCE_KEY[resourceType];
    const items = GENERATORS[resourceType](start, count, prefix);
    const resources: Record<string, unknown> = { [key]: items };

    cases.push({
      caseId: `scale-${resourceType}-${b + 1}`,
      objective: `Scale test: provision ${count} ${SCALE_RESOURCE_LABELS[resourceType]}${batchLabel} (${start + 1}–${start + count} of ${totalCount})`,
      mutation: `Bulk create ${count} resources with prefix "${prefix}"`,
      expectedOutcome: `All ${count} resources provisioned successfully without errors`,
      runRequest: { resources: resources as Record<string, Record<string, unknown>> },
    });
  }

  return cases;
}
