.PHONY: bootstrap run build test clean help

# Detect OS for cross-platform support
UNAME := $(shell uname -s 2>/dev/null || echo Windows)
BINARY := arcvm-qe-copilot
ifeq ($(UNAME),Linux)
	BINARY_EXT :=
	OPEN_CMD := xdg-open 2>/dev/null || wslview 2>/dev/null || echo "Open manually:"
else ifeq ($(UNAME),Darwin)
	BINARY_EXT :=
	OPEN_CMD := open
else
	BINARY_EXT := .exe
	OPEN_CMD := echo "Open manually:"
endif

## help: Show this help
help:
	@echo ""
	@echo "arcvm-qe-copilot — Azure Local QE Test Planner"
	@echo ""
	@echo "Quick start:"
	@echo "  make bootstrap   — First-time setup: .env, DB schemas, seed embeddings"
	@echo "  make run          — Start the server on :8080"
	@echo ""
	@echo "Development:"
	@echo "  make build        — Compile the server binary"
	@echo "  make test         — Run all unit tests"
	@echo "  make clean        — Remove build artifacts and data"
	@echo "  make seed         — Re-seed embeddings only (skips existing)"
	@echo "  make lint         — Format code with gofmt"
	@echo ""

## bootstrap: First-time project setup
bootstrap:
	@echo "==> Checking Go installation..."
	@go version || (echo "ERROR: Go is not installed. Install from https://go.dev/dl/" && exit 1)
	@echo "==> Installing dependencies..."
	@go mod download
	@echo "==> Running bootstrap..."
	@go run ./cmd/bootstrap
	@echo ""
	@echo "==> Done! Next steps:"
	@echo "    1. Edit .env with your Azure OpenAI credentials"
	@echo "    2. Run 'make bootstrap' again to seed embeddings"
	@echo "    3. Run 'make run' to start the server"

## seed: Re-run embedding seed only (skips already-cached)
seed:
	@go run ./cmd/bootstrap

## run: Start the server
run:
	@go run ./cmd/server

## build: Compile the server binary
build:
	@go build -o bin/$(BINARY)$(BINARY_EXT) ./cmd/server
	@echo "Binary built: bin/$(BINARY)$(BINARY_EXT)"

## test: Run all tests
test:
	@go test ./...

## lint: Format Go source files
lint:
	@gofmt -w .
	@echo "Formatted."

## clean: Remove build artifacts and database
clean:
	@rm -rf bin/
	@echo "Cleaned build artifacts."
	@echo "To also remove the database: rm -rf data/"
