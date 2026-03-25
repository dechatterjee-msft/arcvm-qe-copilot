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
}

type Resources struct {
	LogicalNetwork    *LogicalNetworkSpec    `json:"logicalNetwork,omitempty"`
	LogicalNetworks   []LogicalNetworkSpec   `json:"logicalNetworks,omitempty"`
	NetworkInterface  *NetworkInterfaceSpec  `json:"networkInterface,omitempty"`
	NetworkInterfaces []NetworkInterfaceSpec `json:"networkInterfaces,omitempty"`

	NetworkSecurityGroup *NetworkSecurityGroupSpec `json:"networkSecurityGroup,omitempty"`
	StoragePath          *StoragePathSpec          `json:"storagePath,omitempty"`
	VirtualMachine       *VirtualMachineSpec       `json:"virtualMachine,omitempty"`
	VirtualHardDisk      *VirtualHardDiskSpec      `json:"virtualHardDisk,omitempty"`
	StorageContainer     *StorageContainerSpec     `json:"storageContainer,omitempty"`
	GalleryImage         *GalleryImageSpec         `json:"galleryImage,omitempty"`
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
	Name              string `json:"name"`
	ImagePath         string `json:"imagePath,omitempty"`
	OSType            string `json:"osType,omitempty"`
	HyperVGeneration  string `json:"hyperVGeneration,omitempty"`
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

	logicalNetworks := r.Resources.AllLogicalNetworks()
	networkInterfaces := r.Resources.AllNetworkInterfaces()

	for _, logicalNetwork := range logicalNetworks {
		switch {
		case logicalNetwork.Name == "":
			return fmt.Errorf("resources.logicalNetwork.name is required")
		case logicalNetwork.AddressPrefix == "":
			return fmt.Errorf("resources.logicalNetwork.addressPrefix is required")
		case logicalNetwork.IPPoolStart == "":
			return fmt.Errorf("resources.logicalNetwork.ipPoolStart is required")
		case logicalNetwork.IPPoolEnd == "":
			return fmt.Errorf("resources.logicalNetwork.ipPoolEnd is required")
		case logicalNetwork.VMSwitchName == "":
			return fmt.Errorf("resources.logicalNetwork.vmSwitchName is required")
		}
	}

	lnetNames := make(map[string]struct{}, len(logicalNetworks))
	for _, logicalNetwork := range logicalNetworks {
		if _, exists := lnetNames[logicalNetwork.Name]; exists {
			return fmt.Errorf("duplicate logical network name %q", logicalNetwork.Name)
		}
		lnetNames[logicalNetwork.Name] = struct{}{}
	}

	for _, nic := range networkInterfaces {
		if nic.Name == "" {
			return fmt.Errorf("resources.networkInterface.name is required")
		}
		if nic.NetworkRef == "" && len(logicalNetworks) == 0 {
			return fmt.Errorf("resources.networkInterface.networkRef is required when no logical network is supplied")
		}
		if nic.NetworkRef == "" && len(logicalNetworks) > 1 {
			return fmt.Errorf("resources.networkInterface.networkRef is required when multiple logical networks are supplied")
		}
	}

	nicNames := make(map[string]struct{}, len(networkInterfaces))
	for _, nic := range networkInterfaces {
		if _, exists := nicNames[nic.Name]; exists {
			return fmt.Errorf("duplicate network interface name %q", nic.Name)
		}
		nicNames[nic.Name] = struct{}{}
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
