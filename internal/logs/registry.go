package logs

// Operator describes a Kubernetes operator running on Azure Local.
type Operator struct {
	Name          string   `json:"name"`
	Namespace     string   `json:"namespace"`
	LabelSelector string   `json:"labelSelector"`
	ContainerName string   `json:"containerName,omitempty"`
	Controllers   []string `json:"controllers,omitempty"`
}

var operatorCatalog = map[string]Operator{
	"network-operator": {
		Name:          "network-operator",
		Namespace:     "azure-arc-platform",
		LabelSelector: "app=network-operator",
		Controllers:   []string{"lnet-controller", "nic-controller", "nsg-controller"},
	},
	"ipam-operator": {
		Name:          "ipam-operator",
		Namespace:     "azure-arc-platform",
		LabelSelector: "app=ipam-operator",
		Controllers:   []string{"ippool-controller", "ipallocation-controller"},
	},
	"macpool-operator": {
		Name:          "macpool-operator",
		Namespace:     "azure-arc-platform",
		LabelSelector: "app=macpool-operator",
		Controllers:   []string{"macpool-controller"},
	},
	"storage-operator": {
		Name:          "storage-operator",
		Namespace:     "azure-arc-platform",
		LabelSelector: "app=storage-operator",
		Controllers:   []string{"storagepath-controller", "storagecontainer-controller"},
	},
	"vm-operator": {
		Name:          "vm-operator",
		Namespace:     "azure-arc-platform",
		LabelSelector: "app=vm-operator",
		Controllers:   []string{"vm-controller", "vhd-controller", "galleryimage-controller"},
	},
	"infra-operator": {
		Name:          "infra-operator",
		Namespace:     "azure-arc-platform",
		LabelSelector: "app=infra-operator",
		Controllers:   []string{"cluster-controller"},
	},
}

var resourceToOperators = map[string][]string{
	"lnet":             {"network-operator", "ipam-operator"},
	"nic":              {"network-operator", "ipam-operator", "macpool-operator"},
	"nsg":              {"network-operator"},
	"storagepath":      {"storage-operator"},
	"storagecontainer": {"storage-operator"},
	"galleryimage":     {"vm-operator"},
	"vhd":              {"vm-operator", "storage-operator"},
	"vm":               {"vm-operator", "network-operator", "ipam-operator", "macpool-operator", "storage-operator"},
	"e2e":              {"network-operator", "ipam-operator", "macpool-operator", "storage-operator", "vm-operator", "infra-operator"},
}

// GetOperator returns the Operator definition by name, or ok=false.
func GetOperator(name string) (Operator, bool) {
	op, ok := operatorCatalog[name]
	return op, ok
}

// AllOperators returns a copy of every known operator.
func AllOperators() []Operator {
	out := make([]Operator, 0, len(operatorCatalog))
	for _, op := range operatorCatalog {
		out = append(out, op)
	}
	return out
}

// OperatorsForResource returns the operator names relevant for the given resource type.
func OperatorsForResource(resourceType string) []string {
	if ops, ok := resourceToOperators[resourceType]; ok {
		return ops
	}
	return nil
}

// OperatorsForResources returns deduplicated operator names for a set of resource types.
func OperatorsForResources(resourceTypes []string) []string {
	seen := map[string]bool{}
	var out []string
	for _, rt := range resourceTypes {
		for _, op := range OperatorsForResource(rt) {
			if !seen[op] {
				seen[op] = true
				out = append(out, op)
			}
		}
	}
	return out
}
