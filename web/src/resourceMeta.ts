export interface ResourceMeta {
  label: string;
  key?: string;
  docsUrl: string;
  placeholder: string;
  quickPrompts: { label: string; desc: string; prompt: string }[];
  baseline?: Record<string, unknown>;
  resources?: Record<string, Record<string, unknown>>;
}

export const resourceMeta: Record<string, ResourceMeta> = {
  lnet: {
    label: 'Logical Network',
    key: 'logicalNetwork',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/azure-local/manage/create-logical-networks?view=azloc-2602&tabs=azurecli',
    placeholder: 'Test invalid gateway and DNS combinations, subnet overlap across VLAN boundaries, immutable field updates after create, and cleanup safety across repeated runs',
    quickPrompts: [
      { label: 'Admission', desc: 'Invalid required fields and malformed network inputs.', prompt: 'I want to test admission failures, missing required fields, and rejection messaging quality' },
      { label: 'Overlap', desc: 'Subnet collisions, adjacency, and VLAN separation.', prompt: 'I want to test overlap behavior across subnets, VLAN boundaries, and isolation guarantees' },
      { label: 'Immutability', desc: 'Fields that must remain locked after creation.', prompt: 'I want to test immutability constraints and update rejection after the logical network is provisioned' },
      { label: 'Lifecycle', desc: 'Provision, inspect, repeat, and clean up safely.', prompt: 'I want to test end-to-end lifecycle, repeated runs, show operations, and cleanup safety under partial failure' },
    ],
    baseline: { name: 'qe-lnet-test', addressPrefix: '192.168.201.0/24', ipAllocationMethod: 'Static', ipPoolStart: '192.168.201.50', ipPoolEnd: '192.168.201.100', gateway: '192.168.201.1', dnsServers: ['192.168.201.10'], vlan: 201, vmSwitchName: 'ConvergedSwitch' },
  },
  nic: {
    label: 'Network Interface',
    key: 'networkInterface',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/azure-local/manage/create-network-interfaces?view=azloc-2602&tabs=azurecli',
    placeholder: 'Test NIC creation with invalid subnet refs, duplicate MAC addresses, IP conflicts, NSG attachment, and cleanup when the parent network is missing',
    quickPrompts: [
      { label: 'Admission', desc: 'Missing subnet refs and invalid NIC parameters.', prompt: 'I want to test NIC admission failures with missing subnet references, invalid IP configurations, and malformed parameters' },
      { label: 'MAC Conflicts', desc: 'Duplicate MAC addresses and collision detection.', prompt: 'I want to test duplicate MAC address assignment, conflict detection across NICs, and error messaging' },
      { label: 'IP Conflicts', desc: 'Duplicate static IPs and pool exhaustion.', prompt: 'I want to test static IP conflicts, pool exhaustion scenarios, and overlapping IP assignments across NICs' },
      { label: 'Lifecycle', desc: 'Create, attach, detach, and cleanup NIC flows.', prompt: 'I want to test NIC lifecycle including creation, VM attachment, detachment, re-attachment, and cleanup safety' },
    ],
    baseline: { name: 'qe-nic-test', networkRef: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-arcvm-qe/providers/Microsoft.AzureStackHCI/logicalNetworks/qe-lnet-test', ipAddress: '192.168.201.60' },
  },
  nsg: {
    label: 'Network Security Group',
    key: 'networkSecurityGroup',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/azure-local/manage/manage-network-security-groups?view=azloc-2602&tabs=azurecli',
    placeholder: 'Test NSG rule priority conflicts, invalid protocol/direction combinations, overlapping port ranges, and cleanup when attached to an active network',
    quickPrompts: [
      { label: 'Rule Conflicts', desc: 'Priority clashes and overlapping port ranges.', prompt: 'I want to test NSG rule priority conflicts, overlapping port ranges, and duplicate rule detection' },
      { label: 'Protocol Mix', desc: 'Invalid protocol and direction combinations.', prompt: 'I want to test invalid protocol/direction combinations, wildcard rules, and mixed TCP/UDP/ICMP scenarios' },
      { label: 'Attachment', desc: 'NSG binding to subnets and NICs.', prompt: 'I want to test NSG attachment to subnets, NICs, detachment behavior, and cascading effects on traffic' },
      { label: 'Lifecycle', desc: 'Create, update rules, and clean up safely.', prompt: 'I want to test NSG lifecycle including creation, rule additions, rule deletions, and cleanup when attached to active resources' },
    ],
    baseline: { name: 'qe-nsg-test', rules: [{ name: 'allow-ssh', priority: 100, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', destinationPortRange: '22' }] },
  },
  nsr: {
    label: 'Network Security Rule',
    key: 'networkSecurityRule',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/azure-local/manage/manage-network-security-groups?view=azloc-2602&tabs=azurecli',
    placeholder: 'Test standalone NSG rule operations: add rules to existing NSGs, priority conflicts, direction/protocol validation, port range edge cases, and rule CRUD lifecycle',
    quickPrompts: [
      { label: 'Priority Conflicts', desc: 'Duplicate priorities and ordering edge cases.', prompt: 'I want to test NSG rule priority conflicts, duplicate priority values, and ordering behavior when multiple rules target the same traffic' },
      { label: 'Port Ranges', desc: 'Invalid, overlapping, and wildcard port ranges.', prompt: 'I want to test invalid port ranges, overlapping destination ports, wildcard port rules, and multi-port range handling' },
      { label: 'Direction & Access', desc: 'Inbound/Outbound with Allow/Deny combinations.', prompt: 'I want to test all combinations of direction (Inbound/Outbound) and access (Allow/Deny) with different protocols and verify rule enforcement' },
      { label: 'Lifecycle', desc: 'Create, update, and delete rules on an existing NSG.', prompt: 'I want to test standalone rule lifecycle: adding rules to an existing NSG, updating rule properties, deleting rules, and verifying NSG state after each operation' },
    ],
    baseline: { name: 'qe-nsr-allow-http', nsgRef: 'qe-nsg-test', priority: 200, direction: 'Inbound', access: 'Allow', protocol: 'Tcp', destinationPortRange: '80' },
  },
  storagepath: {
    label: 'Storage Path',
    key: 'storagePath',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/azure-local/manage/create-storage-path?view=azloc-2602&tabs=azurecli',
    placeholder: 'Test storage path creation with invalid paths, duplicate names, path length limits, and cleanup safety when VMs reference the path',
    quickPrompts: [
      { label: 'Invalid Paths', desc: 'Non-existent volumes and malformed path strings.', prompt: 'I want to test storage path creation with non-existent volumes, invalid characters, and malformed path strings' },
      { label: 'Duplicates', desc: 'Conflicting names and path collisions.', prompt: 'I want to test duplicate storage path names, path collisions on the same volume, and conflict resolution' },
      { label: 'In-Use Deletion', desc: 'Delete paths referenced by VMs or VHDs.', prompt: 'I want to test deletion of storage paths that are referenced by VMs or VHDs, and verify proper error handling' },
      { label: 'Lifecycle', desc: 'Create, verify, and clean up storage paths.', prompt: 'I want to test storage path lifecycle including creation, show operations, updates, and cleanup safety' },
    ],
    baseline: { name: 'qe-storagepath-test', path: 'C:\\ClusterStorage\\Volume1\\qe-tests' },
  },
  vm: {
    label: 'Virtual Machine',
    key: 'virtualMachine',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/azure-local/manage/create-arc-virtual-machines?view=azloc-2602&tabs=azurecli',
    placeholder: 'Test VM creation with invalid image refs, resource exhaustion, missing network/storage refs, startup and stop lifecycle, and forced cleanup',
    quickPrompts: [
      { label: 'Admission', desc: 'Missing image refs and invalid VM parameters.', prompt: 'I want to test VM admission failures with missing image references, invalid vCPU/memory values, and malformed parameters' },
      { label: 'Resource Limits', desc: 'vCPU and memory exhaustion scenarios.', prompt: 'I want to test VM creation under resource exhaustion, exceeding vCPU and memory limits, and capacity error handling' },
      { label: 'Start/Stop', desc: 'Power state transitions and forced stops.', prompt: 'I want to test VM start, stop, restart, force-stop, and power state transition edge cases' },
      { label: 'Lifecycle', desc: 'Provision, run, and clean up VMs.', prompt: 'I want to test full VM lifecycle including creation, running workloads, stopping, and cleanup with dependency verification' },
    ],
    baseline: { name: 'qe-vm-test', imageRef: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-arcvm-qe/providers/Microsoft.AzureStackHCI/galleryImages/ubuntu-2204', vCPUs: 2, memoryMB: 4096, osType: 'Linux', adminUsername: 'azureuser', sshPublicKeyPath: '~/.ssh/id_rsa.pub', networkRefs: ['/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-arcvm-qe/providers/Microsoft.AzureStackHCI/networkInterfaces/qe-nic-test'] },
  },
  vhd: {
    label: 'Virtual Hard Disk',
    key: 'virtualHardDisk',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/azure-local/manage/virtual-hard-disks?view=azloc-2602&tabs=azurecli',
    placeholder: 'Test VHD creation with invalid sizes, unsupported formats, duplicate names, storage path conflicts, and cleanup when attached to a VM',
    quickPrompts: [
      { label: 'Invalid Sizes', desc: 'Zero, negative, and oversized disk values.', prompt: 'I want to test VHD creation with invalid sizes including zero, negative, and exceeding maximum allowed values' },
      { label: 'Format Issues', desc: 'Unsupported formats and type mismatches.', prompt: 'I want to test VHD creation with unsupported disk formats, invalid format strings, and type mismatches' },
      { label: 'Attached Delete', desc: 'Delete VHDs still attached to VMs.', prompt: 'I want to test deletion of VHDs that are currently attached to VMs and verify proper error handling and protection' },
      { label: 'Lifecycle', desc: 'Create, attach, detach, and clean up VHDs.', prompt: 'I want to test VHD lifecycle including creation, VM attachment, detachment, resize operations, and cleanup' },
    ],
    baseline: { name: 'qe-vhd-test', sizeGB: 32, diskFileFormat: 'vhdx' },
  },
  storagecontainer: {
    label: 'Storage Container',
    key: 'storageContainer',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/azure-local/manage/create-storage-path?view=azloc-2602&tabs=azurecli',
    placeholder: 'Test storage container creation with invalid paths, naming conflicts, path accessibility, and cleanup when VHDs reference it',
    quickPrompts: [
      { label: 'Path Validation', desc: 'Invalid volume paths and access issues.', prompt: 'I want to test storage container creation with invalid volume paths, inaccessible locations, and path format validation' },
      { label: 'Naming Conflicts', desc: 'Duplicate names and character restrictions.', prompt: 'I want to test storage container naming conflicts, duplicate names, special characters, and length limits' },
      { label: 'In-Use Deletion', desc: 'Delete containers referenced by VHDs.', prompt: 'I want to test deletion of storage containers that are referenced by VHDs and verify dependency protection' },
      { label: 'Lifecycle', desc: 'Create, verify, and clean up containers.', prompt: 'I want to test storage container lifecycle including creation, listing, show operations, and cleanup safety' },
    ],
    baseline: { name: 'qe-sc-test', path: 'C:\\ClusterStorage\\Volume1\\qe-containers' },
  },
  galleryimage: {
    label: 'Gallery Image',
    key: 'galleryImage',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/azure-local/manage/virtual-machine-image-azure-marketplace?view=azloc-2602&tabs=azurecli',
    placeholder: 'Test gallery image creation with invalid OS types, unsupported Hyper-V generations, missing image paths, and cleanup when VMs reference the image',
    quickPrompts: [
      { label: 'OS Types', desc: 'Invalid OS types and generation mismatches.', prompt: 'I want to test gallery image creation with invalid OS types, wrong Hyper-V generations, and type/generation mismatches' },
      { label: 'Image Paths', desc: 'Missing and invalid image file locations.', prompt: 'I want to test gallery image creation with missing image paths, invalid file locations, and unsupported file formats' },
      { label: 'Referenced Delete', desc: 'Delete images referenced by VMs.', prompt: 'I want to test deletion of gallery images that are referenced by running VMs and verify dependency protection' },
      { label: 'Lifecycle', desc: 'Create, list, and clean up gallery images.', prompt: 'I want to test gallery image lifecycle including creation, listing, show operations, updates, and cleanup safety' },
    ],
    baseline: { name: 'qe-image-test', imagePath: 'C:\\ClusterStorage\\Volume1\\images\\ubuntu-2204.vhdx', osType: 'Linux', hyperVGeneration: 'V2' },
  },
  e2e: {
    label: 'E2E (Full VM Stack)',
    docsUrl: 'https://learn.microsoft.com/en-us/azure/azure-local/manage/create-arc-virtual-machines?view=azloc-2602&tabs=azurecli',
    placeholder: 'Test full VM stack: LNET → NIC → VHD → VM creation order, cross-resource dependency failures, partial provisioning recovery, cascading cleanup, and end-to-end lifecycle under repeated runs',
    quickPrompts: [
      { label: 'Dependency Order', desc: 'Create resources in correct dependency order.', prompt: 'I want to test E2E resource creation order: LNET before NIC, VHD before VM, and verify failures when order is violated' },
      { label: 'Partial Failure', desc: 'Recovery when mid-stack provisioning fails.', prompt: 'I want to test partial provisioning failure recovery when a mid-stack resource fails and earlier resources need cleanup' },
      { label: 'Cascading Cleanup', desc: 'Delete stack in reverse dependency order.', prompt: 'I want to test cascading cleanup in reverse dependency order: VM, then NIC, then VHD, then LNET, with failure handling' },
      { label: 'Full Lifecycle', desc: 'End-to-end provision, verify, and teardown.', prompt: 'I want to test the full E2E lifecycle: provision all resources, verify connectivity and functionality, then clean up everything' },
    ],
    resources: {
      logicalNetwork: { name: 'qe-e2e-lnet', addressPrefix: '192.168.210.0/24', ipAllocationMethod: 'Static', ipPoolStart: '192.168.210.50', ipPoolEnd: '192.168.210.100', gateway: '192.168.210.1', dnsServers: ['192.168.210.10'], vlan: 210, vmSwitchName: 'ConvergedSwitch' },
      networkInterface: { name: 'qe-e2e-nic', networkRef: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-arcvm-qe/providers/Microsoft.AzureStackHCI/logicalNetworks/qe-e2e-lnet', ipAddress: '192.168.210.60' },
      virtualHardDisk: { name: 'qe-e2e-vhd', sizeGB: 64, diskFileFormat: 'vhdx' },
      virtualMachine: { name: 'qe-e2e-vm', imageRef: '/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-arcvm-qe/providers/Microsoft.AzureStackHCI/galleryImages/ubuntu-2204', vCPUs: 4, memoryMB: 8192, osType: 'Linux', adminUsername: 'azureuser', sshPublicKeyPath: '~/.ssh/id_rsa.pub', networkRefs: ['/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-arcvm-qe/providers/Microsoft.AzureStackHCI/networkInterfaces/qe-e2e-nic'] },
    },
  },
};

export const RESOURCE_TABS = Object.keys(resourceMeta) as (keyof typeof resourceMeta)[];
