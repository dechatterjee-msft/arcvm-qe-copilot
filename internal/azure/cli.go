package azure

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"sort"
	"strings"

	"arcvm-qe-copilot/internal/spec"
)

type CommandRunner interface {
	Run(ctx context.Context, env []string, name string, args ...string) ([]byte, error)
}

type CLI struct {
	runner      CommandRunner
	logger      *log.Logger
	azConfigDir string
}

type execRunner struct{}

func NewCLI(azConfigDir string, logger *log.Logger) *CLI {
	return &CLI{
		runner:      execRunner{},
		logger:      logger,
		azConfigDir: azConfigDir,
	}
}

func (r execRunner) Run(ctx context.Context, env []string, name string, args ...string) ([]byte, error) {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Env = append(os.Environ(), env...)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return output, fmt.Errorf("%s %s failed: %w: %s", name, strings.Join(args, " "), err, strings.TrimSpace(string(output)))
	}
	return output, nil
}

func (c *CLI) EnsurePrereqs(ctx context.Context, req *spec.RunRequest) error {
	if err := os.MkdirAll(c.azConfigDir, 0o755); err != nil {
		return fmt.Errorf("create azure config dir: %w", err)
	}

	if _, err := c.run(ctx, "version"); err != nil {
		return err
	}

	if _, err := c.run(ctx, "account", "set", "--subscription", req.SubscriptionID); err != nil {
		return err
	}

	if _, err := c.run(ctx, "account", "show", "--query", "id", "-o", "tsv"); err != nil {
		return err
	}

	if _, err := c.run(ctx, "extension", "add", "--name", "stack-hci-vm", "--upgrade"); err != nil {
		return err
	}

	for _, namespace := range []string{
		"Microsoft.AzureStackHCI",
		"Microsoft.ExtendedLocation",
	} {
		if err := c.ensureProviderRegistered(ctx, namespace); err != nil {
			return err
		}
	}

	return nil
}

func (c *CLI) EnsureLogicalNetwork(ctx context.Context, req *spec.RunRequest, logicalNetwork spec.LogicalNetworkSpec) (string, error) {
	if id, found, err := c.showResourceID(ctx, "stack-hci-vm", "network", "lnet", "show", "-g", req.ResourceGroup, "-n", logicalNetwork.Name); err != nil {
		return "", err
	} else if found {
		return id, nil
	}

	args := []string{
		"stack-hci-vm", "network", "lnet", "create",
		"-g", req.ResourceGroup,
		"--custom-location", req.CustomLocationID,
		"--name", logicalNetwork.Name,
		"--location", req.Location,
		"--address-prefixes", logicalNetwork.AddressPrefix,
		"--ip-allocation-method", effectiveIPAllocationMethod(logicalNetwork),
		"--ip-pool-type", effectiveIPPoolType(logicalNetwork),
		"--ip-pool-start", logicalNetwork.IPPoolStart,
		"--ip-pool-end", logicalNetwork.IPPoolEnd,
		"--vm-switch-name", logicalNetwork.VMSwitchName,
	}
	args = append(args, c.tagArgs(req.Tags)...)
	if len(logicalNetwork.DNSServers) > 0 {
		args = append(args, "--dns-servers")
		args = append(args, logicalNetwork.DNSServers...)
	}
	if logicalNetwork.Gateway != "" {
		args = append(args, "--gateway", logicalNetwork.Gateway)
	}
	if logicalNetwork.VLAN > 0 {
		args = append(args, "--vlan", fmt.Sprintf("%d", logicalNetwork.VLAN))
	}
	if logicalNetwork.FabricNetworkConfigurationID != "" {
		args = append(args, "--fabric-network-configuration-id", logicalNetwork.FabricNetworkConfigurationID)
	}
	if logicalNetwork.NetworkSecurityGroup != "" {
		args = append(args, "--network-security-group", logicalNetwork.NetworkSecurityGroup)
	}

	raw, err := c.run(ctx, args...)
	if err != nil {
		return "", err
	}

	return extractID(raw)
}

func (c *CLI) EnsureNetworkInterface(ctx context.Context, req *spec.RunRequest, networkInterface spec.NetworkInterfaceSpec, networkRef string) (string, error) {
	if id, found, err := c.showResourceID(ctx, "stack-hci-vm", "network", "nic", "show", "-g", req.ResourceGroup, "-n", networkInterface.Name); err != nil {
		return "", err
	} else if found {
		return id, nil
	}

	args := []string{
		"stack-hci-vm", "network", "nic", "create",
		"-g", req.ResourceGroup,
		"--custom-location", req.CustomLocationID,
		"--name", networkInterface.Name,
		"--location", req.Location,
		"--subnet-id",
	}
	args = append(args, c.tagArgs(req.Tags)...)
	if networkRef == "" {
		networkRef = networkInterface.NetworkRef
	}
	args = append(args, networkRef)
	if networkInterface.IPAddress != "" {
		args = append(args, "--ip-address", networkInterface.IPAddress)
	}
	if len(networkInterface.DNSServers) > 0 {
		args = append(args, "--dns-servers")
		args = append(args, networkInterface.DNSServers...)
	}
	if networkInterface.MACAddress != "" {
		args = append(args, "--mac-address", networkInterface.MACAddress)
	}
	if networkInterface.NetworkSecurityGroup != "" {
		args = append(args, "--network-security-group", networkInterface.NetworkSecurityGroup)
	}

	raw, err := c.run(ctx, args...)
	if err != nil {
		return "", err
	}

	return extractID(raw)
}

func (c *CLI) ShowResources(ctx context.Context, req *spec.RunRequest) (spec.ResourceIDs, error) {
	ids := spec.ResourceIDs{
		LogicalNetworks:   map[string]string{},
		NetworkInterfaces: map[string]string{},
	}

	for _, logicalNetwork := range req.Resources.AllLogicalNetworks() {
		id, found, err := c.showResourceID(ctx, "stack-hci-vm", "network", "lnet", "show", "-g", req.ResourceGroup, "-n", logicalNetwork.Name)
		if err != nil {
			return spec.ResourceIDs{}, err
		}
		if !found {
			return spec.ResourceIDs{}, fmt.Errorf("logical network %q was not found", logicalNetwork.Name)
		}
		ids.LogicalNetworks[logicalNetwork.Name] = id
	}
	for _, networkInterface := range req.Resources.AllNetworkInterfaces() {
		id, found, err := c.showResourceID(ctx, "stack-hci-vm", "network", "nic", "show", "-g", req.ResourceGroup, "-n", networkInterface.Name)
		if err != nil {
			return spec.ResourceIDs{}, err
		}
		if !found {
			return spec.ResourceIDs{}, fmt.Errorf("network interface %q was not found", networkInterface.Name)
		}
		ids.NetworkInterfaces[networkInterface.Name] = id
	}

	return ids, nil
}

func (c *CLI) CleanupResources(ctx context.Context, req *spec.RunRequest) error {
	for _, networkInterface := range req.Resources.AllNetworkInterfaces() {
		if err := c.deleteIfPresent(ctx,
			[]string{"stack-hci-vm", "network", "nic", "show", "-g", req.ResourceGroup, "-n", networkInterface.Name},
			[]string{"stack-hci-vm", "network", "nic", "delete", "-g", req.ResourceGroup, "-n", networkInterface.Name, "--yes"},
		); err != nil {
			return err
		}
	}
	for _, logicalNetwork := range req.Resources.AllLogicalNetworks() {
		if err := c.deleteIfPresent(ctx,
			[]string{"stack-hci-vm", "network", "lnet", "show", "-g", req.ResourceGroup, "-n", logicalNetwork.Name},
			[]string{"stack-hci-vm", "network", "lnet", "delete", "-g", req.ResourceGroup, "-n", logicalNetwork.Name, "--yes"},
		); err != nil {
			return err
		}
	}
	return nil
}

func effectiveIPAllocationMethod(logicalNetwork spec.LogicalNetworkSpec) string {
	if logicalNetwork.IPAllocationMethod == "" {
		return "Static"
	}
	return logicalNetwork.IPAllocationMethod
}

func effectiveIPPoolType(logicalNetwork spec.LogicalNetworkSpec) string {
	if logicalNetwork.IPPoolType == "" {
		return "vm"
	}
	return logicalNetwork.IPPoolType
}

func (c *CLI) deleteIfPresent(ctx context.Context, showArgs, deleteArgs []string) error {
	if _, found, err := c.showResourceID(ctx, showArgs...); err != nil {
		return err
	} else if !found {
		return nil
	}

	_, err := c.run(ctx, deleteArgs...)
	return err
}

func (c *CLI) showResourceID(ctx context.Context, args ...string) (string, bool, error) {
	raw, err := c.run(ctx, args...)
	if err != nil {
		if isNotFound(err) {
			return "", false, nil
		}
		return "", false, err
	}

	id, err := extractID(raw)
	if err != nil {
		return "", false, err
	}

	return id, true, nil
}

func (c *CLI) ensureProviderRegistered(ctx context.Context, namespace string) error {
	raw, err := c.run(ctx, "provider", "show", "-n", namespace, "--query", "registrationState", "-o", "tsv")
	if err != nil {
		return err
	}

	if strings.EqualFold(strings.TrimSpace(string(raw)), "Registered") {
		return nil
	}

	_, err = c.run(ctx, "provider", "register", "-n", namespace, "--wait")
	return err
}

func (c *CLI) run(ctx context.Context, args ...string) ([]byte, error) {
	if c.logger != nil {
		c.logger.Printf("Running: az %s", strings.Join(args, " "))
	}

	return c.runner.Run(ctx, c.env(), "az", append(args, "--only-show-errors")...)
}

func (c *CLI) env() []string {
	if c.azConfigDir == "" {
		return nil
	}
	return []string{"AZURE_CONFIG_DIR=" + c.azConfigDir}
}

func (c *CLI) tagArgs(tags map[string]string) []string {
	if len(tags) == 0 {
		return nil
	}

	keys := make([]string, 0, len(tags))
	for key := range tags {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	values := make([]string, 0, len(tags)+1)
	values = append(values, "--tags")
	for _, key := range keys {
		value := tags[key]
		values = append(values, fmt.Sprintf("%s=%s", key, value))
	}
	return values
}

func extractID(raw []byte) (string, error) {
	var payload map[string]any
	if err := json.Unmarshal(raw, &payload); err != nil {
		return "", fmt.Errorf("parse azure cli response: %w", err)
	}

	id, ok := payload["id"].(string)
	if !ok || id == "" {
		return "", fmt.Errorf("azure cli response did not include an id")
	}

	return id, nil
}

func isNotFound(err error) bool {
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "could not be found") ||
		strings.Contains(msg, "was not found") ||
		strings.Contains(msg, "resourcenotfound") ||
		strings.Contains(msg, "not found")
}
