package spec

import "testing"

func TestProvisionRequestValidates(t *testing.T) {
	req := validRequest()
	if err := req.Validate("provision"); err != nil {
		t.Fatalf("expected request to validate: %v", err)
	}
}

func TestBulkProvisionRequestValidates(t *testing.T) {
	req := validRequest()
	req.Resources.LogicalNetwork = nil
	req.Resources.NetworkInterface = nil
	req.Resources.LogicalNetworks = []LogicalNetworkSpec{
		{
			Name:          "test-lnet-a",
			AddressPrefix: "10.0.0.0/24",
			IPPoolStart:   "10.0.0.10",
			IPPoolEnd:     "10.0.0.20",
			VMSwitchName:  "ConvergedSwitch",
		},
		{
			Name:          "test-lnet-b",
			AddressPrefix: "10.1.0.0/24",
			IPPoolStart:   "10.1.0.10",
			IPPoolEnd:     "10.1.0.20",
			VMSwitchName:  "ConvergedSwitch",
		},
	}
	req.Resources.NetworkInterfaces = []NetworkInterfaceSpec{
		{Name: "nic-a", NetworkRef: "test-lnet-a"},
		{Name: "nic-b", NetworkRef: "test-lnet-b"},
	}
	if err := req.Validate("provision"); err != nil {
		t.Fatalf("expected bulk request to validate: %v", err)
	}
}

func TestLongevityRequiresIterationsOrDuration(t *testing.T) {
	req := validRequest()
	req.Longevity = LongevitySpec{}
	if err := req.Validate("longevity"); err == nil {
		t.Fatal("expected longevity validation to fail")
	}
}

func TestNICRequiresNetworkRefWhenNoLogicalNetworkIsProvided(t *testing.T) {
	req := validRequest()
	req.Resources.LogicalNetwork = nil
	req.Resources.NetworkInterface.NetworkRef = ""
	if err := req.Validate("provision"); err == nil {
		t.Fatal("expected validation to fail when nic has no network reference")
	}
}

func TestNICRequiresNetworkRefWhenMultipleLogicalNetworksExist(t *testing.T) {
	req := validRequest()
	req.Resources.LogicalNetworks = []LogicalNetworkSpec{
		{
			Name:          "test-lnet-b",
			AddressPrefix: "10.1.0.0/24",
			IPPoolStart:   "10.1.0.10",
			IPPoolEnd:     "10.1.0.20",
			VMSwitchName:  "ConvergedSwitch",
		},
	}
	req.Resources.NetworkInterface.NetworkRef = ""
	if err := req.Validate("provision"); err == nil {
		t.Fatal("expected validation to fail when nic has no networkRef and multiple lnets exist")
	}
}

func validRequest() *RunRequest {
	return &RunRequest{
		SubscriptionID:   "00000000-0000-0000-0000-000000000000",
		ResourceGroup:    "rg-test",
		Location:         "eastus2",
		CustomLocationID: "/subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/rg-test/providers/Microsoft.ExtendedLocation/customLocations/test-cl",
		Resources: Resources{
			LogicalNetwork: &LogicalNetworkSpec{
				Name:          "test-lnet",
				AddressPrefix: "10.0.0.0/24",
				IPPoolStart:   "10.0.0.10",
				IPPoolEnd:     "10.0.0.20",
				VMSwitchName:  "ConvergedSwitch",
			},
			NetworkInterface: &NetworkInterfaceSpec{
				Name: "test-nic",
			},
		},
		Longevity: LongevitySpec{
			Iterations: 1,
			Interval:   "1m",
			Actions:    []string{"provision", "show", "cleanup"},
		},
	}
}
