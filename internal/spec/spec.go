package spec

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type RunRequest struct {
	SubscriptionID   string            `json:"subscriptionId"`
	ResourceGroup    string            `json:"resourceGroup"`
	Location         string            `json:"location"`
	CustomLocationID string            `json:"customLocationId"`
	AzureConfigDir   string            `json:"azureConfigDir,omitempty"`
	Tags             map[string]string `json:"tags,omitempty"`
	Resources        Resources         `json:"resources"`
	Longevity        LongevitySpec     `json:"longevity,omitempty"`
	CaseID           string            `json:"caseId,omitempty"`
	Description      string            `json:"description,omitempty"`
}

type Resources struct {
	LogicalNetwork    *LogicalNetworkSpec    `json:"logicalNetwork,omitempty"`
	LogicalNetworks   []LogicalNetworkSpec   `json:"logicalNetworks,omitempty"`
	NetworkInterface  *NetworkInterfaceSpec  `json:"networkInterface,omitempty"`
	NetworkInterfaces []NetworkInterfaceSpec `json:"networkInterfaces,omitempty"`

	NetworkSecurityGroup   *NetworkSecurityGroupSpec   `json:"networkSecurityGroup,omitempty"`
	NetworkSecurityGroups  []NetworkSecurityGroupSpec  `json:"networkSecurityGroups,omitempty"`
	NetworkSecurityRule    *NetworkSecurityRuleSpec    `json:"networkSecurityRule,omitempty"`
	NetworkSecurityRules   []NetworkSecurityRuleSpec   `json:"networkSecurityRules,omitempty"`
	StoragePath            *StoragePathSpec            `json:"storagePath,omitempty"`
	StoragePaths           []StoragePathSpec           `json:"storagePaths,omitempty"`
	VirtualMachine         *VirtualMachineSpec         `json:"virtualMachine,omitempty"`
	VirtualMachines        []VirtualMachineSpec        `json:"virtualMachines,omitempty"`
	VirtualHardDisk        *VirtualHardDiskSpec        `json:"virtualHardDisk,omitempty"`
	VirtualHardDisks       []VirtualHardDiskSpec       `json:"virtualHardDisks,omitempty"`
	StorageContainer       *StorageContainerSpec       `json:"storageContainer,omitempty"`
	StorageContainers      []StorageContainerSpec      `json:"storageContainers,omitempty"`
	GalleryImage           *GalleryImageSpec           `json:"galleryImage,omitempty"`
	GalleryImages          []GalleryImageSpec          `json:"galleryImages,omitempty"`
}

// UnmarshalJSON handles LLM responses that return singular fields (logicalNetwork,
// networkInterface) as arrays instead of objects.
func (r *Resources) UnmarshalJSON(data []byte) error {
	// Use a raw-message wrapper so we can inspect singular fields that the LLM
	// may return as arrays instead of objects.
	type rawResources struct {
		LogicalNetwork    json.RawMessage        `json:"logicalNetwork,omitempty"`
		LogicalNetworks   []LogicalNetworkSpec   `json:"logicalNetworks,omitempty"`
		NetworkInterface  json.RawMessage        `json:"networkInterface,omitempty"`
		NetworkInterfaces []NetworkInterfaceSpec `json:"networkInterfaces,omitempty"`

		NetworkSecurityGroup   json.RawMessage           `json:"networkSecurityGroup,omitempty"`
		NetworkSecurityGroups  []NetworkSecurityGroupSpec `json:"networkSecurityGroups,omitempty"`
		NetworkSecurityRule    json.RawMessage            `json:"networkSecurityRule,omitempty"`
		NetworkSecurityRules   []NetworkSecurityRuleSpec  `json:"networkSecurityRules,omitempty"`
		StoragePath            json.RawMessage            `json:"storagePath,omitempty"`
		StoragePaths           []StoragePathSpec          `json:"storagePaths,omitempty"`
		VirtualMachine         json.RawMessage            `json:"virtualMachine,omitempty"`
		VirtualMachines        []VirtualMachineSpec       `json:"virtualMachines,omitempty"`
		VirtualHardDisk        json.RawMessage            `json:"virtualHardDisk,omitempty"`
		VirtualHardDisks       []VirtualHardDiskSpec      `json:"virtualHardDisks,omitempty"`
		StorageContainer       json.RawMessage            `json:"storageContainer,omitempty"`
		StorageContainers      []StorageContainerSpec     `json:"storageContainers,omitempty"`
		GalleryImage           json.RawMessage            `json:"galleryImage,omitempty"`
		GalleryImages          []GalleryImageSpec         `json:"galleryImages,omitempty"`
	}

	var raw rawResources
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	// Helper: unmarshal a RawMessage that can be a single object or an array.
	unmarshalSingularOrArray := func(data json.RawMessage, fieldName string, single any, arr any) error {
		if len(data) == 0 {
			return nil
		}
		trimmed := strings.TrimSpace(string(data))
		if strings.HasPrefix(trimmed, "[") {
			if err := json.Unmarshal(data, arr); err != nil {
				return fmt.Errorf("%s: %w", fieldName, err)
			}
		} else {
			if err := json.Unmarshal(data, single); err != nil {
				return fmt.Errorf("%s: %w", fieldName, err)
			}
		}
		return nil
	}

	// logicalNetwork
	var singleLnet LogicalNetworkSpec
	var arrLnets []LogicalNetworkSpec
	if err := unmarshalSingularOrArray(raw.LogicalNetwork, "logicalNetwork", &singleLnet, &arrLnets); err != nil {
		return err
	}
	if len(arrLnets) > 0 {
		r.LogicalNetworks = append(r.LogicalNetworks, arrLnets...)
	} else if singleLnet.Name != "" {
		r.LogicalNetwork = &singleLnet
	}

	// networkInterface
	var singleNic NetworkInterfaceSpec
	var arrNics []NetworkInterfaceSpec
	if err := unmarshalSingularOrArray(raw.NetworkInterface, "networkInterface", &singleNic, &arrNics); err != nil {
		return err
	}
	if len(arrNics) > 0 {
		r.NetworkInterfaces = append(r.NetworkInterfaces, arrNics...)
	} else if singleNic.Name != "" {
		r.NetworkInterface = &singleNic
	}

	// networkSecurityGroup
	var singleNsg NetworkSecurityGroupSpec
	var arrNsgs []NetworkSecurityGroupSpec
	if err := unmarshalSingularOrArray(raw.NetworkSecurityGroup, "networkSecurityGroup", &singleNsg, &arrNsgs); err != nil {
		return err
	}
	if len(arrNsgs) > 0 {
		r.NetworkSecurityGroups = append(r.NetworkSecurityGroups, arrNsgs...)
	} else if singleNsg.Name != "" {
		r.NetworkSecurityGroup = &singleNsg
	}

	// networkSecurityRule
	var singleNsr NetworkSecurityRuleSpec
	var arrNsrs []NetworkSecurityRuleSpec
	if err := unmarshalSingularOrArray(raw.NetworkSecurityRule, "networkSecurityRule", &singleNsr, &arrNsrs); err != nil {
		return err
	}
	if len(arrNsrs) > 0 {
		r.NetworkSecurityRules = append(r.NetworkSecurityRules, arrNsrs...)
	} else if singleNsr.Name != "" {
		r.NetworkSecurityRule = &singleNsr
	}

	// storagePath
	var singleSP StoragePathSpec
	var arrSPs []StoragePathSpec
	if err := unmarshalSingularOrArray(raw.StoragePath, "storagePath", &singleSP, &arrSPs); err != nil {
		return err
	}
	if len(arrSPs) > 0 {
		r.StoragePaths = append(r.StoragePaths, arrSPs...)
	} else if singleSP.Name != "" {
		r.StoragePath = &singleSP
	}

	// virtualMachine
	var singleVM VirtualMachineSpec
	var arrVMs []VirtualMachineSpec
	if err := unmarshalSingularOrArray(raw.VirtualMachine, "virtualMachine", &singleVM, &arrVMs); err != nil {
		return err
	}
	if len(arrVMs) > 0 {
		r.VirtualMachines = append(r.VirtualMachines, arrVMs...)
	} else if singleVM.Name != "" {
		r.VirtualMachine = &singleVM
	}

	// virtualHardDisk
	var singleVHD VirtualHardDiskSpec
	var arrVHDs []VirtualHardDiskSpec
	if err := unmarshalSingularOrArray(raw.VirtualHardDisk, "virtualHardDisk", &singleVHD, &arrVHDs); err != nil {
		return err
	}
	if len(arrVHDs) > 0 {
		r.VirtualHardDisks = append(r.VirtualHardDisks, arrVHDs...)
	} else if singleVHD.Name != "" {
		r.VirtualHardDisk = &singleVHD
	}

	// storageContainer
	var singleSC StorageContainerSpec
	var arrSCs []StorageContainerSpec
	if err := unmarshalSingularOrArray(raw.StorageContainer, "storageContainer", &singleSC, &arrSCs); err != nil {
		return err
	}
	if len(arrSCs) > 0 {
		r.StorageContainers = append(r.StorageContainers, arrSCs...)
	} else if singleSC.Name != "" {
		r.StorageContainer = &singleSC
	}

	// galleryImage
	var singleGI GalleryImageSpec
	var arrGIs []GalleryImageSpec
	if err := unmarshalSingularOrArray(raw.GalleryImage, "galleryImage", &singleGI, &arrGIs); err != nil {
		return err
	}
	if len(arrGIs) > 0 {
		r.GalleryImages = append(r.GalleryImages, arrGIs...)
	} else if singleGI.Name != "" {
		r.GalleryImage = &singleGI
	}

	// Copy the plural array fields directly.
	r.LogicalNetworks = append(r.LogicalNetworks, raw.LogicalNetworks...)
	r.NetworkInterfaces = append(r.NetworkInterfaces, raw.NetworkInterfaces...)
	r.NetworkSecurityGroups = append(r.NetworkSecurityGroups, raw.NetworkSecurityGroups...)
	r.NetworkSecurityRules = append(r.NetworkSecurityRules, raw.NetworkSecurityRules...)
	r.StoragePaths = append(r.StoragePaths, raw.StoragePaths...)
	r.VirtualMachines = append(r.VirtualMachines, raw.VirtualMachines...)
	r.VirtualHardDisks = append(r.VirtualHardDisks, raw.VirtualHardDisks...)
	r.StorageContainers = append(r.StorageContainers, raw.StorageContainers...)
	r.GalleryImages = append(r.GalleryImages, raw.GalleryImages...)

	return nil
}

type LogicalNetworkSpec struct {
	Name                         string   `json:"name"`
	AddressPrefix                string   `json:"addressPrefix"`
	IPAllocationMethod           string   `json:"ipAllocationMethod,omitempty"`
	IPPoolStart                  string   `json:"ipPoolStart"`
	IPPoolEnd                    string   `json:"ipPoolEnd"`
	IPPoolType                   string   `json:"ipPoolType,omitempty"`
	Gateway                      string   `json:"gateway,omitempty"`
	DNSServers                   []string `json:"dnsServers,omitempty"`
	VLAN                         FlexInt  `json:"vlan,omitempty"`
	VMSwitchName                 string   `json:"vmSwitchName"`
	FabricNetworkConfigurationID string   `json:"fabricNetworkConfigurationId,omitempty"`
	NetworkSecurityGroup         string   `json:"networkSecurityGroup,omitempty"`
}

type NetworkInterfaceSpec struct {
	Name                 string   `json:"name"`
	NetworkRef           string   `json:"networkRef,omitempty"`
	IPAddress            string   `json:"ipAddress,omitempty"`
	DNSServers           []string `json:"dnsServers,omitempty"`
	MACAddress           string   `json:"macAddress,omitempty"`
	NetworkSecurityGroup string   `json:"networkSecurityGroup,omitempty"`
}

type NetworkSecurityGroupSpec struct {
	Name  string             `json:"name"`
	Rules []SecurityRuleSpec `json:"rules,omitempty"`
}

type SecurityRuleSpec struct {
	Name                     string `json:"name"`
	Priority                 int    `json:"priority"`
	Direction                string `json:"direction"`
	Access                   string `json:"access"`
	Protocol                 string `json:"protocol"`
	SourceAddressPrefix      string `json:"sourceAddressPrefix,omitempty"`
	DestinationAddressPrefix string `json:"destinationAddressPrefix,omitempty"`
	SourcePortRange          string `json:"sourcePortRange,omitempty"`
	DestinationPortRange     string `json:"destinationPortRange,omitempty"`
}

type NetworkSecurityRuleSpec struct {
	Name                     string `json:"name"`
	NSGRef                   string `json:"nsgRef"`
	Priority                 int    `json:"priority"`
	Direction                string `json:"direction"`
	Access                   string `json:"access"`
	Protocol                 string `json:"protocol"`
	SourceAddressPrefix      string `json:"sourceAddressPrefix,omitempty"`
	DestinationAddressPrefix string `json:"destinationAddressPrefix,omitempty"`
	SourcePortRange          string `json:"sourcePortRange,omitempty"`
	DestinationPortRange     string `json:"destinationPortRange,omitempty"`
}

type StoragePathSpec struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

type VirtualMachineSpec struct {
	Name             string   `json:"name"`
	ImageRef         string   `json:"imageRef,omitempty"`
	VCPUs            int      `json:"vCPUs,omitempty"`
	MemoryMB         int      `json:"memoryMB,omitempty"`
	StoragePathRef   string   `json:"storagePathRef,omitempty"`
	NetworkRefs      []string `json:"networkRefs,omitempty"`
	OSType           string   `json:"osType,omitempty"`
	AdminUsername    string   `json:"adminUsername,omitempty"`
	SSHPublicKeyPath string   `json:"sshPublicKeyPath,omitempty"`
}

type VirtualHardDiskSpec struct {
	Name           string `json:"name"`
	SizeGB         int    `json:"sizeGB,omitempty"`
	DiskFileFormat string `json:"diskFileFormat,omitempty"`
	StoragePathRef string `json:"storagePathRef,omitempty"`
}

type StorageContainerSpec struct {
	Name string `json:"name"`
	Path string `json:"path,omitempty"`
}

type GalleryImageSpec struct {
	Name             string `json:"name"`
	ImagePath        string `json:"imagePath,omitempty"`
	OSType           string `json:"osType,omitempty"`
	HyperVGeneration string `json:"hyperVGeneration,omitempty"`
}

type LongevitySpec struct {
	Iterations  int      `json:"iterations,omitempty"`
	Duration    string   `json:"duration,omitempty"`
	Interval    string   `json:"interval,omitempty"`
	Jitter      string   `json:"jitter,omitempty"`
	MaxFailures int      `json:"maxFailures,omitempty"`
	Actions     []string `json:"actions,omitempty"`
	ReportPath  string   `json:"reportPath,omitempty"`
}

type ResourceIDs struct {
	LogicalNetworks   map[string]string `json:"logicalNetworks,omitempty"`
	NetworkInterfaces map[string]string `json:"networkInterfaces,omitempty"`
}

func (r *RunRequest) Validate(jobType string) error {
	switch {
	case r.SubscriptionID == "":
		return fmt.Errorf("subscriptionId is required")
	case r.ResourceGroup == "":
		return fmt.Errorf("resourceGroup is required")
	case r.Location == "":
		return fmt.Errorf("location is required")
	case r.CustomLocationID == "":
		return fmt.Errorf("customLocationId is required")
	case r.Resources.IsEmpty():
		return fmt.Errorf("at least one resource definition is required")
	}

	if r.Longevity.Interval != "" {
		if _, err := time.ParseDuration(r.Longevity.Interval); err != nil {
			return fmt.Errorf("invalid longevity.interval: %w", err)
		}
	}
	if r.Longevity.Jitter != "" {
		if _, err := time.ParseDuration(r.Longevity.Jitter); err != nil {
			return fmt.Errorf("invalid longevity.jitter: %w", err)
		}
	}
	if r.Longevity.Duration != "" {
		if _, err := time.ParseDuration(r.Longevity.Duration); err != nil {
			return fmt.Errorf("invalid longevity.duration: %w", err)
		}
	}
	if r.Longevity.MaxFailures < 0 {
		return fmt.Errorf("longevity.maxFailures cannot be negative")
	}

	for _, action := range r.ActionsOrDefault() {
		switch action {
		case "provision", "show", "cleanup":
		default:
			return fmt.Errorf("unsupported longevity action %q", action)
		}
	}

	if jobType == "longevity" && r.Longevity.Iterations == 0 && r.Longevity.Duration == "" {
		return fmt.Errorf("longevity requires either iterations or duration")
	}

	return nil
}

func (r Resources) IsEmpty() bool {
	return r.LogicalNetwork == nil &&
		len(r.LogicalNetworks) == 0 &&
		r.NetworkInterface == nil &&
		len(r.NetworkInterfaces) == 0 &&
		r.NetworkSecurityGroup == nil &&
		len(r.NetworkSecurityGroups) == 0 &&
		r.NetworkSecurityRule == nil &&
		len(r.NetworkSecurityRules) == 0 &&
		r.StoragePath == nil &&
		len(r.StoragePaths) == 0 &&
		r.VirtualMachine == nil &&
		len(r.VirtualMachines) == 0 &&
		r.VirtualHardDisk == nil &&
		len(r.VirtualHardDisks) == 0 &&
		r.StorageContainer == nil &&
		len(r.StorageContainers) == 0 &&
		r.GalleryImage == nil &&
		len(r.GalleryImages) == 0
}

func (r Resources) AllLogicalNetworks() []LogicalNetworkSpec {
	out := make([]LogicalNetworkSpec, 0, len(r.LogicalNetworks)+1)
	if r.LogicalNetwork != nil {
		out = append(out, *r.LogicalNetwork)
	}
	out = append(out, r.LogicalNetworks...)
	return out
}

func (r Resources) AllNetworkInterfaces() []NetworkInterfaceSpec {
	out := make([]NetworkInterfaceSpec, 0, len(r.NetworkInterfaces)+1)
	if r.NetworkInterface != nil {
		out = append(out, *r.NetworkInterface)
	}
	out = append(out, r.NetworkInterfaces...)
	return out
}

func (r Resources) AllNetworkSecurityGroups() []NetworkSecurityGroupSpec {
	out := make([]NetworkSecurityGroupSpec, 0, len(r.NetworkSecurityGroups)+1)
	if r.NetworkSecurityGroup != nil {
		out = append(out, *r.NetworkSecurityGroup)
	}
	out = append(out, r.NetworkSecurityGroups...)
	return out
}

func (r Resources) AllNetworkSecurityRules() []NetworkSecurityRuleSpec {
	out := make([]NetworkSecurityRuleSpec, 0, len(r.NetworkSecurityRules)+1)
	if r.NetworkSecurityRule != nil {
		out = append(out, *r.NetworkSecurityRule)
	}
	out = append(out, r.NetworkSecurityRules...)
	return out
}

func (r Resources) AllStoragePaths() []StoragePathSpec {
	out := make([]StoragePathSpec, 0, len(r.StoragePaths)+1)
	if r.StoragePath != nil {
		out = append(out, *r.StoragePath)
	}
	out = append(out, r.StoragePaths...)
	return out
}

func (r Resources) AllVirtualHardDisks() []VirtualHardDiskSpec {
	out := make([]VirtualHardDiskSpec, 0, len(r.VirtualHardDisks)+1)
	if r.VirtualHardDisk != nil {
		out = append(out, *r.VirtualHardDisk)
	}
	out = append(out, r.VirtualHardDisks...)
	return out
}

func (r Resources) AllStorageContainers() []StorageContainerSpec {
	out := make([]StorageContainerSpec, 0, len(r.StorageContainers)+1)
	if r.StorageContainer != nil {
		out = append(out, *r.StorageContainer)
	}
	out = append(out, r.StorageContainers...)
	return out
}

func (r Resources) AllGalleryImages() []GalleryImageSpec {
	out := make([]GalleryImageSpec, 0, len(r.GalleryImages)+1)
	if r.GalleryImage != nil {
		out = append(out, *r.GalleryImage)
	}
	out = append(out, r.GalleryImages...)
	return out
}

func (r Resources) AllVirtualMachines() []VirtualMachineSpec {
	out := make([]VirtualMachineSpec, 0, len(r.VirtualMachines)+1)
	if r.VirtualMachine != nil {
		out = append(out, *r.VirtualMachine)
	}
	out = append(out, r.VirtualMachines...)
	return out
}

func (r *RunRequest) EffectiveIPAllocationMethod() string {
	if r.Resources.LogicalNetwork == nil || r.Resources.LogicalNetwork.IPAllocationMethod == "" {
		return "Static"
	}
	return r.Resources.LogicalNetwork.IPAllocationMethod
}

func (r *RunRequest) EffectiveIPPoolType() string {
	if r.Resources.LogicalNetwork == nil || r.Resources.LogicalNetwork.IPPoolType == "" {
		return "vm"
	}
	return r.Resources.LogicalNetwork.IPPoolType
}

func (r *RunRequest) EffectiveLongevityInterval() time.Duration {
	if r.Longevity.Interval == "" {
		return 30 * time.Minute
	}
	d, _ := time.ParseDuration(r.Longevity.Interval)
	return d
}

func (r *RunRequest) EffectiveLongevityJitter() time.Duration {
	if r.Longevity.Jitter == "" {
		return 0
	}
	d, _ := time.ParseDuration(r.Longevity.Jitter)
	return d
}

func (r *RunRequest) EffectiveLongevityDuration() time.Duration {
	if r.Longevity.Duration == "" {
		return 0
	}
	d, _ := time.ParseDuration(r.Longevity.Duration)
	return d
}

func (r *RunRequest) EffectiveLongevityMaxFailures() int {
	if r.Longevity.MaxFailures == 0 {
		return 3
	}
	return r.Longevity.MaxFailures
}

func (r *RunRequest) EffectiveLongevityIterations() int {
	return r.Longevity.Iterations
}

func (r *RunRequest) ActionsOrDefault() []string {
	if len(r.Longevity.Actions) == 0 {
		return []string{"provision", "show"}
	}
	actions := make([]string, 0, len(r.Longevity.Actions))
	for _, action := range r.Longevity.Actions {
		actions = append(actions, strings.ToLower(strings.TrimSpace(action)))
	}
	return actions
}

func (r *RunRequest) ResolveReportPath(defaultBaseDir, jobID string) string {
	if r.Longevity.ReportPath == "" {
		return filepath.Join(defaultBaseDir, jobID+".json")
	}
	if filepath.IsAbs(r.Longevity.ReportPath) {
		return r.Longevity.ReportPath
	}
	return filepath.Join(defaultBaseDir, r.Longevity.ReportPath)
}

func (r *RunRequest) ResolveAzureConfigDir(defaultPath string) string {
	if r.AzureConfigDir == "" {
		return defaultPath
	}
	return r.AzureConfigDir
}

// FlexInt is an int that also accepts JSON strings like "201".
type FlexInt int

func (f FlexInt) Int() int { return int(f) }

func (f FlexInt) MarshalJSON() ([]byte, error) {
	return json.Marshal(int(f))
}

func (f *FlexInt) UnmarshalJSON(b []byte) error {
	// Try number first.
	var n int
	if err := json.Unmarshal(b, &n); err == nil {
		*f = FlexInt(n)
		return nil
	}
	// Fall back to quoted string.
	var s string
	if err := json.Unmarshal(b, &s); err != nil {
		return fmt.Errorf("vlan: expected number or string, got %s", string(b))
	}
	s = strings.TrimSpace(s)
	if s == "" {
		*f = 0
		return nil
	}
	n, err := strconv.Atoi(s)
	if err == nil {
		*f = FlexInt(n)
		return nil
	}
	// LLM may return word-form numbers ("TwoHundred"); treat as 0.
	*f = 0
	return nil
}
