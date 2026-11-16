.PHONY: web build test test-go test-e2e typecheck docker

PNPM := corepack pnpm

web:
	cd web && $(PNPM) install --frozen-lockfile && $(PNPM) build

build: web
	go build -o bin/webedit ./cmd/webedit

typecheck:
	go vet ./...
	cd web && $(PNPM) typecheck

# Seam 1: Go HTTP tests against the in-process server.
test-go:
	go test ./...

# Seam 2: Playwright against the real binary in test mode (builds the frontend).
test-e2e:
	cd web && $(PNPM) test:e2e

test: test-go test-e2e

docker:
	docker build -t webedit .
