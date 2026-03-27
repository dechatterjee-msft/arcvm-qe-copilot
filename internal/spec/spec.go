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

	NetworkSecurityGroup  *NetworkSecurityGroupSpec  `json:"networkSecurityGroup,omitempty"`
	NetworkSecurityRule   *NetworkSecurityRuleSpec   `json:"networkSecurityRule,omitempty"`
	NetworkSecurityRules  []NetworkSecurityRuleSpec  `json:"networkSecurityRules,omitempty"`
	StoragePath           *StoragePathSpec           `json:"storagePath,omitempty"`
	VirtualMachine        *VirtualMachineSpec        `json:"virtualMachine,omitempty"`
	VirtualHardDisk       *VirtualHardDiskSpec       `json:"virtualHardDisk,omitempty"`
	StorageContainer      *StorageContainerSpec      `json:"storageContainer,omitempty"`
	GalleryImage          *GalleryImageSpec          `json:"galleryImage,omitempty"`
}

// UnmarshalJSON handles LLM responses that return singular fields (logicalNetwork,
// networkInterface) as arrays instead of objects.
func (r *Resources) UnmarshalJSON(data []byte) error {
	// Use a raw-message wrapper so we can inspect logicalNetwork / networkInterface
	// before committing to a concrete type.
	type rawResources struct {
		LogicalNetwork    json.RawMessage        `json:"logicalNetwork,omitempty"`
		LogicalNetworks   []LogicalNetworkSpec   `json:"logicalNetworks,omitempty"`
		NetworkInterface  json.RawMessage        `json:"networkInterface,omitempty"`
		NetworkInterfaces []NetworkInterfaceSpec `json:"networkInterfaces,omitempty"`

		NetworkSecurityGroup  *NetworkSecurityGroupSpec  `json:"networkSecurityGroup,omitempty"`
		NetworkSecurityRule   json.RawMessage            `json:"networkSecurityRule,omitempty"`
		NetworkSecurityRules  []NetworkSecurityRuleSpec  `json:"networkSecurityRules,omitempty"`
		StoragePath           *StoragePathSpec           `json:"storagePath,omitempty"`
		VirtualMachine        *VirtualMachineSpec        `json:"virtualMachine,omitempty"`
		VirtualHardDisk       *VirtualHardDiskSpec       `json:"virtualHardDisk,omitempty"`
		StorageContainer      *StorageContainerSpec      `json:"storageContainer,omitempty"`
		GalleryImage          *GalleryImageSpec          `json:"galleryImage,omitempty"`
	}

	var raw rawResources
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}

	// logicalNetwork: accept object or array
	if len(raw.LogicalNetwork) > 0 {
		trimmed := strings.TrimSpace(string(raw.LogicalNetwork))
		if strings.HasPrefix(trimmed, "[") {
			var arr []LogicalNetworkSpec
			if err := json.Unmarshal(raw.LogicalNetwork, &arr); err != nil {
				return fmt.Errorf("logicalNetwork: %w", err)
			}
			r.LogicalNetworks = append(r.LogicalNetworks, arr...)
		} else {
			var single LogicalNetworkSpec
			if err := json.Unmarshal(raw.LogicalNetwork, &single); err != nil {
				return fmt.Errorf("logicalNetwork: %w", err)
			}
			r.LogicalNetwork = &single
		}
	}

	// networkInterface: accept object or array
	if len(raw.NetworkInterface) > 0 {
		trimmed := strings.TrimSpace(string(raw.NetworkInterface))
		if strings.HasPrefix(trimmed, "[") {
			var arr []NetworkInterfaceSpec
			if err := json.Unmarshal(raw.NetworkInterface, &arr); err != nil {
				return fmt.Errorf("networkInterface: %w", err)
			}
			r.NetworkInterfaces = append(r.NetworkInterfaces, arr...)
		} else {
			var single NetworkInterfaceSpec
			if err := json.Unmarshal(raw.NetworkInterface, &single); err != nil {
				return fmt.Errorf("networkInterface: %w", err)
			}
			r.NetworkInterface = &single
		}
	}

	// networkSecurityRule: accept object or array
	if len(raw.NetworkSecurityRule) > 0 {
		trimmed := strings.TrimSpace(string(raw.NetworkSecurityRule))
		if strings.HasPrefix(trimmed, "[") {
			var arr []NetworkSecurityRuleSpec
			if err := json.Unmarshal(raw.NetworkSecurityRule, &arr); err != nil {
				return fmt.Errorf("networkSecurityRule: %w", err)
			}
			r.NetworkSecurityRules = append(r.NetworkSecurityRules, arr...)
		} else {
			var single NetworkSecurityRuleSpec
			if err := json.Unmarshal(raw.NetworkSecurityRule, &single); err != nil {
				return fmt.Errorf("networkSecurityRule: %w", err)
			}
			r.NetworkSecurityRule = &single
		}
	}

	// Copy the remaining fields directly.
	r.LogicalNetworks = append(r.LogicalNetworks, raw.LogicalNetworks...)
	r.NetworkInterfaces = append(r.NetworkInterfaces, raw.NetworkInterfaces...)
	r.NetworkSecurityRules = append(r.NetworkSecurityRules, raw.NetworkSecurityRules...)
	r.NetworkSecurityGroup = raw.NetworkSecurityGroup
	r.StoragePath = raw.StoragePath
	r.VirtualMachine = raw.VirtualMachine
	r.VirtualHardDisk = raw.VirtualHardDisk
	r.StorageContainer = raw.StorageContainer
	r.GalleryImage = raw.GalleryImage

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
		r.NetworkSecurityRule == nil &&
		len(r.NetworkSecurityRules) == 0 &&
		r.StoragePath == nil &&
		r.VirtualMachine == nil &&
		r.VirtualHardDisk == nil &&
		r.StorageContainer == nil &&
		r.GalleryImage == nil
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

func (r Resources) AllNetworkSecurityRules() []NetworkSecurityRuleSpec {
	out := make([]NetworkSecurityRuleSpec, 0, len(r.NetworkSecurityRules)+1)
	if r.NetworkSecurityRule != nil {
		out = append(out, *r.NetworkSecurityRule)
	}
	out = append(out, r.NetworkSecurityRules...)
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
	if err != nil {
		return fmt.Errorf("vlan: cannot parse %q as int: %w", s, err)
	}
	*f = FlexInt(n)
	return nil
}
