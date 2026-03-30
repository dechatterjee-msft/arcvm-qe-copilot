import type { TestCase } from './types';

/* ─── Types ────────────────────────────────────────────── */

export type ScaleResourceType = 'lnet' | 'nic';

export const SCALE_PRESETS = [10, 50, 100, 500, 1000] as const;
export const BATCH_SIZES  = [10, 25, 50, 100] as const;

export const SCALE_RESOURCE_LABELS: Record<ScaleResourceType, string> = {
  lnet: 'Logical Network',
  nic: 'Network Interface',
};

/* ─── IP Pool model ────────────────────────────────────── */

export interface IPPool {
  start: string;
  end: string;
}

/* ─── Editable LNET row model ──────────────────────────── */

export interface LnetRow {
  name: string;
  addressPrefix: string;
  ipAllocationMethod: string;
  ipPools: IPPool[];
  gateway: string;
  dns: string;
  vlan: number;
  vmSwitchName: string;
}

/* ─── IP helpers ───────────────────────────────────────── */

function pad4(n: number): string {
  return String(n).padStart(4, '0');
}

export function ipToNum(ip: string): number {
  const p = ip.split('.').map(Number);
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

export function numToIp(n: number): string {
  return `${(n >>> 24) & 0xff}.${(n >>> 16) & 0xff}.${(n >>> 8) & 0xff}.${n & 0xff}`;
}

function buildSubnet(ipPoolBase: string, lnetIdx: number, poolSize: number, vlanBase: number) {
  const baseNum = ipToNum(ipPoolBase);
  const subnetNum = baseNum + lnetIdx * 256;
  return {
    prefix: numToIp(subnetNum) + '/24',
    gateway: numToIp(subnetNum + 1),
    dns: numToIp(subnetNum + 10),
    poolStart: numToIp(subnetNum + 50),
    poolEnd: numToIp(subnetNum + 50 + Math.min(poolSize - 1, 200)),
    vlan: vlanBase + lnetIdx,
  };
}

/** Generate default LNET rows with auto-populated subnets */
export function generateDefaultLnets(
  count: number,
  prefix: string,
  ipPoolBase = '192.168.0.0',
  vlanStart = 200,
  poolSize = 128,
): LnetRow[] {
  return Array.from({ length: count }, (_, i) => {
    const s = buildSubnet(ipPoolBase, i, poolSize, vlanStart);
    return {
      name: `${prefix}-lnet-${pad4(i + 1)}`,
      addressPrefix: s.prefix,
      ipAllocationMethod: 'Static',
      ipPools: [{ start: s.poolStart, end: s.poolEnd }],
      gateway: s.gateway,
      dns: s.dns,
      vlan: s.vlan,
      vmSwitchName: 'ConvergedSwitch',
    };
  });
}

/** Convert an LnetRow to the resource object used in runRequest */
function lnetRowToResource(row: LnetRow): Record<string, unknown> {
  return {
    name: row.name,
    addressPrefix: row.addressPrefix,
    ipAllocationMethod: row.ipAllocationMethod,
    ipPools: row.ipPools.map(p => ({ start: p.start, end: p.end })),
    // Keep first pool as top-level for backward compat with CLI builder
    ipPoolStart: row.ipPools[0]?.start ?? '',
    ipPoolEnd: row.ipPools[0]?.end ?? '',
    gateway: row.gateway,
    dnsServers: [row.dns],
    vlan: row.vlan,
    vmSwitchName: row.vmSwitchName,
  };
}

/* ─── Scale config ─────────────────────────────────────── */

export interface ScaleConfig {
  resourceType: ScaleResourceType;
  totalCount: number;
  batchSize: number;
  prefix: string;
  /** User-edited LNET definitions */
  lnetRows: LnetRow[];
}

/* ─── Main generator ───────────────────────────────────── */

export function generateScaleTestCases(config: ScaleConfig): TestCase[] {
  const { resourceType, totalCount, batchSize, prefix, lnetRows } = config;
  const batches = Math.ceil(totalCount / batchSize);
  const cases: TestCase[] = [];

  if (resourceType === 'lnet') {
    // LNET mode: the user defined the exact LNETs — batch them
    for (let b = 0; b < batches; b++) {
      const start = b * batchSize;
      const count = Math.min(batchSize, totalCount - start);
      const batchLabel = batches === 1 ? '' : ` batch ${b + 1}/${batches}`;
      const batchLnets = lnetRows.slice(start, start + count).map(lnetRowToResource);

      cases.push({
        caseId: `scale-lnet-${b + 1}`,
        objective: `Scale test: provision ${count} Logical Network${batchLabel} (${start + 1}–${start + count} of ${totalCount})`,
        mutation: `Bulk create ${count} resources with prefix "${prefix}"`,
        expectedOutcome: `All ${count} resources provisioned successfully without errors`,
        runRequest: { resources: { logicalNetworks: batchLnets } as unknown as Record<string, Record<string, unknown>> },
      });
    }
  } else {
    // NIC mode: first batch includes prerequisite LNETs, all batches get NICs
    const lnetCount = lnetRows.length;

    for (let b = 0; b < batches; b++) {
      const start = b * batchSize;
      const count = Math.min(batchSize, totalCount - start);
      const batchLabel = batches === 1 ? '' : ` batch ${b + 1}/${batches}`;

      const resources: Record<string, unknown[]> = {};

      // First batch: include the user-edited LNETs
      if (b === 0) {
        resources.logicalNetworks = lnetRows.map(lnetRowToResource);
      }

      // NICs distributed round-robin across LNETs
      const ipCounters = new Array(lnetCount).fill(0);
      if (start > 0) {
        const perLnet = Math.ceil(start / lnetCount);
        for (let li = 0; li < lnetCount; li++) ipCounters[li] = perLnet;
      }

      resources.networkInterfaces = Array.from({ length: count }, (_, i) => {
        const nicIdx = start + i;
        const lnetIdx = nicIdx % lnetCount;
        const row = lnetRows[lnetIdx];
        const ipOffset = ipCounters[lnetIdx]++;
        // Parse pool start to compute IP
        const poolStartNum = ipToNum(row.ipPools[0]?.start ?? '0.0.0.0');

        return {
          name: `${prefix}-nic-${pad4(nicIdx + 1)}`,
          networkRef: row.name,
          ipAddress: numToIp(poolStartNum + ipOffset),
        };
      });

      cases.push({
        caseId: `scale-nic-${b + 1}`,
        objective: `Scale test: provision ${count} Network Interface${batchLabel} (${start + 1}–${start + count} of ${totalCount})`,
        mutation: `Bulk create ${count} resources with prefix "${prefix}"`,
        expectedOutcome: `All ${count} resources provisioned successfully without errors`,
        runRequest: { resources: resources as unknown as Record<string, Record<string, unknown>> },
      });
    }
  }

  return cases;
}
