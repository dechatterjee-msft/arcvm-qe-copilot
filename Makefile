.PHONY: bootstrap run stop build test clean help web-build web-dev

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
	@echo "  make stop         — Stop the server running on :8080"
	@echo "  make build        — Build frontend + compile Go binary"
	@echo "  make web-build    — Build the React frontend only"
	@echo "  make web-dev      — Start Vite dev server (hot reload)"
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
run: web-build
	@go run ./cmd/server

## stop: Stop the server running on :8080
stop:
	@echo "==> Stopping server on :8080..."
	@lsof -ti :8080 | xargs kill -9 2>/dev/null || true
	@echo "==> Server stopped."

## build: Compile the server binary
build: web-build
	@go build -o bin/$(BINARY)$(BINARY_EXT) ./cmd/server
	@echo "Binary built: bin/$(BINARY)$(BINARY_EXT)"

## web-build: Build the React frontend and copy to embed directory
web-build:
	@echo "==> Building React frontend..."
	@cd web && npm install --silent && npm run build
	@rm -rf internal/api/ui
	@mkdir -p internal/api/ui
	@cp -r web/dist/* internal/api/ui/
	@echo "==> Frontend built and copied to internal/api/ui/"

## web-dev: Start Vite dev server (proxies API to :8080)
web-dev:
	@cd web && npm run dev

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
	@rm -rf web/node_modules web/dist
	@echo "Cleaned build artifacts."
	@echo "To also remove the database: rm -rf data/"
