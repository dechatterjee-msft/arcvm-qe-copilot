import type { RunRequest } from './types';

function shellQuote(value: string): string {
  return `'${String(value ?? '').replace(/'/g, `'\\''`)}'`;
}

function joinCmd(parts: string[]): string {
  if (!parts.length) return '';
  const blocks: string[][] = [];
  let current: string[] = [];
  for (const line of parts) {
    if (line === '') {
      if (current.length > 0) { blocks.push(current); current = []; }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) blocks.push(current);
  return blocks
    .map((block) =>
      block.length === 1
        ? block[0]
        : block.slice(0, -1).map((l) => l + ' \\').join('\n') + '\n' + block[block.length - 1],
    )
    .join('\n\n');
}

function splitCmd(cmd: string): string {
  if (!cmd) return '';
  const tokens = cmd.match(/(?:--\S+\s+'[^']*'|--\S+\s+\S+|-\S+\s+'[^']*'|-\S+\s+\S+|\S+)/g);
  if (!tokens || tokens.length <= 1) return cmd;
  const parts: string[] = [];
  const base: string[] = [];
  for (const t of tokens) {
    if (t.startsWith('-')) parts.push(t);
    else if (parts.length === 0) base.push(t);
    else parts[parts.length - 1] += ' ' + t;
  }
  if (parts.length === 0) return cmd;
  const lines = [base.join(' '), ...parts.map((p) => '  ' + p)];
  return lines.slice(0, -1).map((l) => l + ' \\').join('\n') + '\n' + lines[lines.length - 1];
}

interface CmdGroup {
  label: string;
  create: string[];
  show: string;
  del: string;
}

export function buildRelevantAzCliCommands(runRequest: RunRequest): string[] {
  const rawResources = runRequest?.resources || {};
  const rg = runRequest?.resourceGroup || '<resource-group>';
  const location = runRequest?.location || '<location>';
  const customLocation = runRequest?.customLocationId || '<custom-location-id>';

  // Normalize: plural array keys → multiple singular entries
  // e.g. { logicalNetworks: [{...}, {...}] } → calls builder for each item
  const pluralToSingular: Record<string, string> = {
    logicalNetworks: 'logicalNetwork',
    networkInterfaces: 'networkInterface',
    networkSecurityGroups: 'networkSecurityGroup',
    networkSecurityRules: 'networkSecurityRule',
    storagePaths: 'storagePath',
    storageContainers: 'storageContainer',
    galleryImages: 'galleryImage',
    virtualMachines: 'virtualMachine',
    virtualHardDisks: 'virtualHardDisk',
  };

  const allItems: Record<string, unknown>[] = [];
  const baseResources: Record<string, Record<string, unknown>> = {};

  for (const [key, value] of Object.entries(rawResources)) {
    const singularKey = pluralToSingular[key];
    if (singularKey && Array.isArray(value)) {
      for (const item of value) {
        if (item && typeof item === 'object') allItems.push({ ...item, _resourceType: singularKey });
      }
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      baseResources[key] = value as Record<string, unknown>;
    }
  }

  // If plural arrays were found, build CLI commands for each item individually and combine
  if (allItems.length > 0) {
    const allLines: string[] = [];
    // First process any singular resources normally
    if (Object.keys(baseResources).length > 0) {
      const baseCmds = buildRelevantAzCliCommands({ ...runRequest, resources: baseResources });
      if (baseCmds.length > 0 && !baseCmds[0].startsWith('# Resource definition')) {
        allLines.push(...baseCmds, '');
      }
    }
    // Then process each array item
    for (const item of allItems) {
      const type = item._resourceType as string;
      const { _resourceType, ...spec } = item;
      const itemCmds = buildRelevantAzCliCommands({ ...runRequest, resources: { [type]: spec } });
      if (itemCmds.length > 0 && !itemCmds[0].startsWith('# Resource definition')) {
        allLines.push(...itemCmds, '');
      }
    }
    while (allLines.length > 0 && allLines[allLines.length - 1] === '') allLines.pop();
    return allLines.length > 0 ? allLines : ['# Resource definition (JSON)', JSON.stringify(rawResources, null, 2)];
  }

  const resources = rawResources;
  const cmdGroups: CmdGroup[] = [];

  // Storage Path
  const sp = resources.storagePath as Record<string, unknown> | undefined;
  if (sp) {
    const name = String(sp.name || '<storage-path-name>');
    const create = [
      'az stack-hci storagepath create',
      `  --resource-group ${shellQuote(rg)}`,
      `  --custom-location ${shellQuote(customLocation)}`,
      `  --name ${shellQuote(name)}`,
      `  --location ${shellQuote(location)}`,
    ];
    if (sp.path) create.push(`  --path ${shellQuote(String(sp.path))}`);
    cmdGroups.push({ label: 'Storage Path', create, show: `az stack-hci storagepath show --resource-group ${shellQuote(rg)} --name ${shellQuote(name)}`, del: `az stack-hci storagepath delete --resource-group ${shellQuote(rg)} --name ${shellQuote(name)} --yes` });
  }

  // Storage Container
  const sc = resources.storageContainer as Record<string, unknown> | undefined;
  if (sc) {
    const name = String(sc.name || '<storage-container-name>');
    const create = [
      'az stack-hci storagepath create',
      `  --resource-group ${shellQuote(rg)}`,
      `  --custom-location ${shellQuote(customLocation)}`,
      `  --name ${shellQuote(name)}`,
      `  --location ${shellQuote(location)}`,
    ];
    if (sc.path) create.push(`  --path ${shellQuote(String(sc.path))}`);
    cmdGroups.push({ label: 'Storage Container', create, show: `az stack-hci storagepath show --resource-group ${shellQuote(rg)} --name ${shellQuote(name)}`, del: `az stack-hci storagepath delete --resource-group ${shellQuote(rg)} --name ${shellQuote(name)} --yes` });
  }

  // Gallery Image
  const gi = resources.galleryImage as Record<string, unknown> | undefined;
  if (gi) {
    const name = String(gi.name || '<gallery-image-name>');
    const create = [
      'az stack-hci-vm image create',
      `  --resource-group ${shellQuote(rg)}`,
      `  --custom-location ${shellQuote(customLocation)}`,
      `  --name ${shellQuote(name)}`,
      `  --location ${shellQuote(location)}`,
    ];
    if (gi.imagePath) create.push(`  --image-path ${shellQuote(String(gi.imagePath))}`);
    if (gi.osType) create.push(`  --os-type ${shellQuote(String(gi.osType))}`);
    if (gi.hyperVGeneration) create.push(`  --hyper-v-generation ${shellQuote(String(gi.hyperVGeneration))}`);
    cmdGroups.push({ label: 'Gallery Image', create, show: `az stack-hci-vm image show --resource-group ${shellQuote(rg)} --name ${shellQuote(name)}`, del: `az stack-hci-vm image delete --resource-group ${shellQuote(rg)} --name ${shellQuote(name)} --yes` });
  }

  // Logical Network
  const lnet = resources.logicalNetwork as Record<string, unknown> | undefined;
  if (lnet) {
    const name = String(lnet.name || '<logical-network-name>');
    const pools = Array.isArray(lnet.ipPools) ? (lnet.ipPools as { start: string; end: string }[]) : [];
    const firstPool = pools.length > 0 ? pools[0] : null;
    const create = [
      'az stack-hci-vm network lnet create',
      `  --resource-group ${shellQuote(rg)}`,
      `  --custom-location ${shellQuote(customLocation)}`,
      `  --name ${shellQuote(name)}`,
      `  --location ${shellQuote(location)}`,
    ];
    if (lnet.addressPrefix) create.push(`  --address-prefixes ${shellQuote(String(lnet.addressPrefix))}`);
    if (lnet.ipAllocationMethod) create.push(`  --ip-allocation-method ${shellQuote(String(lnet.ipAllocationMethod))}`);
    if (lnet.ipPoolType) create.push(`  --ip-pool-type ${shellQuote(String(lnet.ipPoolType))}`);
    // Use first pool for create (fall back to legacy top-level fields)
    const poolStart = firstPool?.start || String(lnet.ipPoolStart || '');
    const poolEnd = firstPool?.end || String(lnet.ipPoolEnd || '');
    if (poolStart) create.push(`  --ip-pool-start ${shellQuote(poolStart)}`);
    if (poolEnd) create.push(`  --ip-pool-end ${shellQuote(poolEnd)}`);
    if (lnet.vmSwitchName) create.push(`  --vm-switch-name ${shellQuote(String(lnet.vmSwitchName))}`);
    if (Array.isArray(lnet.dnsServers) && lnet.dnsServers.length > 0) create.push(`  --dns-servers ${(lnet.dnsServers as string[]).map(shellQuote).join(' ')}`);
    if (lnet.gateway) create.push(`  --gateway ${shellQuote(String(lnet.gateway))}`);
    if (typeof lnet.vlan === 'number' && lnet.vlan > 0) create.push(`  --vlan ${shellQuote(String(lnet.vlan))}`);
    cmdGroups.push({ label: 'Logical Network', create, show: `az stack-hci-vm network lnet show --resource-group ${shellQuote(rg)} --name ${shellQuote(name)}`, del: `az stack-hci-vm network lnet delete --resource-group ${shellQuote(rg)} --name ${shellQuote(name)} --yes` });

    // Additional pools via update commands
    for (let pi = 1; pi < pools.length; pi++) {
      const pool = pools[pi];
      const update = [
        `# IP Pool ${pi + 1}`,
        'az stack-hci-vm network lnet update',
        `  --resource-group ${shellQuote(rg)}`,
        `  --name ${shellQuote(name)}`,
        `  --ip-pool-start ${shellQuote(pool.start)}`,
        `  --ip-pool-end ${shellQuote(pool.end)}`,
      ];
      cmdGroups.push({ label: `Logical Network – Pool ${pi + 1}`, create: update, show: '', del: '' });
    }
  }

  // NSG
  const nsg = resources.networkSecurityGroup as Record<string, unknown> | undefined;
  if (nsg) {
    const name = String(nsg.name || '<nsg-name>');
    const create = [
      'az stack-hci-vm network nsg create',
      `  --resource-group ${shellQuote(rg)}`,
      `  --custom-location ${shellQuote(customLocation)}`,
      `  --name ${shellQuote(name)}`,
      `  --location ${shellQuote(location)}`,
    ];
    const ruleLines: string[] = [];
    if (Array.isArray(nsg.rules)) {
      for (const rule of nsg.rules as Record<string, unknown>[]) {
        const rn = String(rule.name || '<rule-name>');
        const rc = [
          'az stack-hci-vm network nsg rule create',
          `  --resource-group ${shellQuote(rg)}`,
          `  --nsg-name ${shellQuote(name)}`,
          `  --name ${shellQuote(rn)}`,
        ];
        if (rule.priority) rc.push(`  --priority ${shellQuote(String(rule.priority))}`);
        if (rule.direction) rc.push(`  --direction ${shellQuote(String(rule.direction))}`);
        if (rule.access) rc.push(`  --access ${shellQuote(String(rule.access))}`);
        if (rule.protocol) rc.push(`  --protocol ${shellQuote(String(rule.protocol))}`);
        if (rule.destinationPortRange) rc.push(`  --destination-port-ranges ${shellQuote(String(rule.destinationPortRange))}`);
        ruleLines.push('', ...rc);
      }
    }
    cmdGroups.push({ label: 'Network Security Group', create: [...create, ...ruleLines], show: `az stack-hci-vm network nsg show --resource-group ${shellQuote(rg)} --name ${shellQuote(name)}`, del: `az stack-hci-vm network nsg delete --resource-group ${shellQuote(rg)} --name ${shellQuote(name)} --yes` });
  }

  // Network Security Rule (standalone)
  const nsr = resources.networkSecurityRule as Record<string, unknown> | undefined;
  if (nsr) {
    const ruleName = String(nsr.name || '<rule-name>');
    const nsgName = String(nsr.nsgRef || '<nsg-name>');
    const create = [
      'az stack-hci-vm network nsg rule create',
      `  --resource-group ${shellQuote(rg)}`,
      `  --nsg-name ${shellQuote(nsgName)}`,
      `  --name ${shellQuote(ruleName)}`,
    ];
    if (nsr.priority) create.push(`  --priority ${shellQuote(String(nsr.priority))}`);
    if (nsr.direction) create.push(`  --direction ${shellQuote(String(nsr.direction))}`);
    if (nsr.access) create.push(`  --access ${shellQuote(String(nsr.access))}`);
    if (nsr.protocol) create.push(`  --protocol ${shellQuote(String(nsr.protocol))}`);
    if (nsr.sourceAddressPrefix) create.push(`  --source-address-prefixes ${shellQuote(String(nsr.sourceAddressPrefix))}`);
    if (nsr.destinationAddressPrefix) create.push(`  --destination-address-prefixes ${shellQuote(String(nsr.destinationAddressPrefix))}`);
    if (nsr.sourcePortRange) create.push(`  --source-port-ranges ${shellQuote(String(nsr.sourcePortRange))}`);
    if (nsr.destinationPortRange) create.push(`  --destination-port-ranges ${shellQuote(String(nsr.destinationPortRange))}`);
    cmdGroups.push({
      label: 'Network Security Rule',
      create,
      show: `az stack-hci-vm network nsg rule show --resource-group ${shellQuote(rg)} --nsg-name ${shellQuote(nsgName)} --name ${shellQuote(ruleName)}`,
      del: `az stack-hci-vm network nsg rule delete --resource-group ${shellQuote(rg)} --nsg-name ${shellQuote(nsgName)} --name ${shellQuote(ruleName)} --yes`,
    });
  }

  // NIC
  const nic = resources.networkInterface as Record<string, unknown> | undefined;
  if (nic) {
    const name = String(nic.name || '<nic-name>');
    const create = [
      'az stack-hci-vm network nic create',
      `  --resource-group ${shellQuote(rg)}`,
      `  --custom-location ${shellQuote(customLocation)}`,
      `  --name ${shellQuote(name)}`,
      `  --location ${shellQuote(location)}`,
    ];
    if (nic.networkRef) create.push(`  --subnet-id ${shellQuote(String(nic.networkRef))}`);
    if (nic.ipAddress) create.push(`  --ip-address ${shellQuote(String(nic.ipAddress))}`);
    cmdGroups.push({ label: 'Network Interface', create, show: `az stack-hci-vm network nic show --resource-group ${shellQuote(rg)} --name ${shellQuote(name)}`, del: `az stack-hci-vm network nic delete --resource-group ${shellQuote(rg)} --name ${shellQuote(name)} --yes` });
  }

  // VHD
  const vhd = resources.virtualHardDisk as Record<string, unknown> | undefined;
  if (vhd) {
    const name = String(vhd.name || '<vhd-name>');
    const create = [
      'az stack-hci-vm disk create',
      `  --resource-group ${shellQuote(rg)}`,
      `  --custom-location ${shellQuote(customLocation)}`,
      `  --name ${shellQuote(name)}`,
      `  --location ${shellQuote(location)}`,
    ];
    if (vhd.sizeGB) create.push(`  --size-gb ${shellQuote(String(vhd.sizeGB))}`);
    if (vhd.diskFileFormat) create.push(`  --disk-file-format ${shellQuote(String(vhd.diskFileFormat))}`);
    if (vhd.storagePathRef) create.push(`  --storage-path-id ${shellQuote(String(vhd.storagePathRef))}`);
    cmdGroups.push({ label: 'Virtual Hard Disk', create, show: `az stack-hci-vm disk show --resource-group ${shellQuote(rg)} --name ${shellQuote(name)}`, del: `az stack-hci-vm disk delete --resource-group ${shellQuote(rg)} --name ${shellQuote(name)} --yes` });
  }

  // VM
  const vm = resources.virtualMachine as Record<string, unknown> | undefined;
  if (vm) {
    const name = String(vm.name || '<vm-name>');
    const create = [
      'az stack-hci-vm create',
      `  --resource-group ${shellQuote(rg)}`,
      `  --custom-location ${shellQuote(customLocation)}`,
      `  --name ${shellQuote(name)}`,
      `  --location ${shellQuote(location)}`,
    ];
    if (vm.imageRef) create.push(`  --image ${shellQuote(String(vm.imageRef))}`);
    if (vm.vCPUs) create.push(`  --processors ${shellQuote(String(vm.vCPUs))}`);
    if (vm.memoryMB) create.push(`  --memory-mb ${shellQuote(String(vm.memoryMB))}`);
    if (vm.osType) create.push(`  --os-type ${shellQuote(String(vm.osType))}`);
    if (vm.adminUsername) create.push(`  --admin-username ${shellQuote(String(vm.adminUsername))}`);
    if (vm.sshPublicKeyPath) create.push(`  --ssh-key-values ${shellQuote(String(vm.sshPublicKeyPath))}`);
    if (Array.isArray(vm.networkRefs) && vm.networkRefs.length > 0) {
      for (const ref of vm.networkRefs as string[]) create.push(`  --nic-id ${shellQuote(ref)}`);
    }
    if (vm.storagePathRef) create.push(`  --storage-path-id ${shellQuote(String(vm.storagePathRef))}`);
    cmdGroups.push({ label: 'Virtual Machine', create, show: `az stack-hci-vm show --resource-group ${shellQuote(rg)} --name ${shellQuote(name)}`, del: `az stack-hci-vm delete --resource-group ${shellQuote(rg)} --name ${shellQuote(name)} --yes` });
  }

  const lines: string[] = [];

  if (cmdGroups.length > 1) {
    lines.push('# --- Provision (dependency order) ---'); for (const g of cmdGroups) { lines.push(`# ${g.label}`, joinCmd(g.create), ''); }
    lines.push('# --- Verify ---'); for (const g of cmdGroups) { lines.push(splitCmd(g.show), ''); }
    lines.push('# --- Cleanup (reverse dependency order) ---'); for (const g of [...cmdGroups].reverse()) { lines.push(splitCmd(g.del), ''); }
  } else if (cmdGroups.length === 1) {
    const g = cmdGroups[0];
    lines.push(joinCmd(g.create), '');
    lines.push(splitCmd(g.show), '');
    lines.push(splitCmd(g.del), '');
  }

  if (lines.length === 0) {
    lines.push('# Resource definition (JSON)', JSON.stringify(resources, null, 2));
  }

  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

export function extractResourcePills(runRequest: RunRequest): string[] {
  const pills: string[] = [];
  const resources = runRequest?.resources || {};
  for (const [type, spec] of Object.entries(resources)) {
    if (!spec || typeof spec !== 'object') continue;
    if (Array.isArray(spec)) {
      pills.push(`${spec.length} ${type}`);
    } else {
      const s = spec as Record<string, unknown>;
      if (s.name) pills.push(String(s.name));
      else if (s.addressPrefix) pills.push(String(s.addressPrefix));
      else pills.push(type);
    }
    if (pills.length >= 3) break;
  }
  return pills;
}

/* ─── Scale CLI summary (one template per resource type) ── */

const RESOURCE_TYPE_CLI: Record<string, { group: string[]; label: string }> = {
  logicalNetworks:      { group: ['stack-hci-vm', 'network', 'lnet'], label: 'Logical Network' },
  networkInterfaces:    { group: ['stack-hci-vm', 'network', 'nic'],  label: 'Network Interface' },
  networkSecurityGroups:{ group: ['stack-hci-vm', 'network', 'nsg'],  label: 'Network Security Group' },
  networkSecurityRules: { group: ['stack-hci-vm', 'network', 'nsg', 'rule'], label: 'Network Security Rule' },
  storagePaths:         { group: ['stack-hci', 'storagepath'],       label: 'Storage Path' },
  virtualHardDisks:     { group: ['stack-hci-vm', 'vhd'],           label: 'Virtual Hard Disk' },
  storageContainers:    { group: ['stack-hci', 'storagepath'],       label: 'Storage Container' },
  galleryImages:        { group: ['stack-hci-vm', 'image'],          label: 'Gallery Image' },
  virtualMachines:      { group: ['stack-hci-vm', 'create'],         label: 'Virtual Machine' },
};

export function buildScaleCliSummary(runRequest: RunRequest): string {
  const rg = runRequest?.resourceGroup || '<resource-group>';
  const cl = runRequest?.customLocationId || '<custom-location-id>';
  const location = runRequest?.location || '<location>';
  const resources = runRequest?.resources || {};
  const sections: string[] = [];

  for (const [key, value] of Object.entries(resources)) {
    if (!value || typeof value !== 'object') continue;

    const items = Array.isArray(value) ? value : [value];
    if (items.length === 0) continue;

    const meta = RESOURCE_TYPE_CLI[key];
    const label = meta?.label || key;
    const count = items.length;
    const first = items[0] as Record<string, unknown>;
    const last = items[items.length - 1] as Record<string, unknown>;
    const firstName = String(first.name || '???');
    const lastName = String(last.name || '???');

    sections.push(`# ${label} — ${count} resource${count !== 1 ? 's' : ''} (${firstName} .. ${lastName})`);

    if (meta) {
      const cmdBase = `az ${meta.group.join(' ')} create`;
      const cmdParts = [
        cmdBase,
        `  --resource-group ${shellQuote(rg)}`,
        `  --custom-location ${shellQuote(cl)}`,
        `  --location ${shellQuote(location)}`,
        `  --name ${shellQuote('<' + firstName.replace(/\d{3,}$/, '{0001..' + String(count).padStart(4, '0') + '}') + '>')}`,
      ];

      // Show key fields from the first item as example
      for (const [fk, fv] of Object.entries(first)) {
        if (fk === 'name' || fk === '_resourceType') continue;
        if (fv === undefined || fv === null || fv === '') continue;
        const flag = `--${fk.replace(/([A-Z])/g, '-$1').toLowerCase()}`;
        if (Array.isArray(fv)) {
          cmdParts.push(`  ${flag} ${fv.map(v => shellQuote(String(v))).join(' ')}`);
        } else {
          cmdParts.push(`  ${flag} ${shellQuote(String(fv))}`);
        }
      }

      sections.push(cmdParts.map((l, i) => i < cmdParts.length - 1 ? l + ' \\' : l).join('\n'));
    }

    sections.push(`# Backend will execute the above for all ${count} resources in this batch`);
    sections.push('');
  }

  while (sections.length > 0 && sections[sections.length - 1] === '') sections.pop();
  return sections.length > 0 ? sections.join('\n') : '# Scale test — resources defined in JSON payload';
}
