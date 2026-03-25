package logging

import (
	"fmt"
	"log"
	"os"
	"strings"
)

// New creates a root *log.Logger that writes to stdout with timestamp prefix.
func New() *log.Logger {
	return log.New(os.Stdout, "", log.LstdFlags)
}

// Tagged returns a new *log.Logger that prefixes every message with [tag].
// Example: Tagged(root, "Azure OpenAI") → "2026/03/25 20:45:07 [Azure OpenAI] ..."
func Tagged(parent *log.Logger, tag string) *log.Logger {
	prefix := fmt.Sprintf("[%s] ", tag)
	return log.New(parent.Writer(), prefix, parent.Flags())
}

// MaskKey replaces all but the first 4 characters of a key with "***hidden***".
// Returns "***hidden***" when the key is shorter than 8 characters.
func MaskKey(key string) string {
	if len(key) < 8 {
		return "***hidden***"
	}
	return key[:4] + "***hidden***"
}

// Preview returns the first n characters of s, appending "..." if truncated.
func Preview(s string, n int) string {
	s = strings.TrimSpace(s)
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}