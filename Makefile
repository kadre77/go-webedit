.PHONY: web build test test-go test-web test-e2e typecheck fmt-check docs-check check-fast check hooks docker

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

# Seam 2: vitest over the frontend's modules, in process (the App state
# against an in-memory Root Folder).
test-web:
	cd web && $(PNPM) test:web

# Seam 3: Playwright against the real binary in test mode (builds the frontend).
test-e2e:
	cd web && $(PNPM) test:e2e

test: test-go test-web test-e2e

fmt-check:
	@out=$$(gofmt -l cmd internal); if [ -n "$$out" ]; then echo "gofmt needed:"; echo "$$out"; exit 1; fi

# Glossary _Avoid_ terms and the spec's closed list of error codes.
docs-check:
	scripts/check-docs.sh

# What the pre-commit hook runs: everything but the e2e suite.
check-fast: fmt-check docs-check typecheck test-go test-web

# Run before every commit of app code: the whole suite must be green.
check: check-fast test-e2e

# Points git at the repo's hooks (.githooks/pre-commit runs check-fast).
hooks:
	git config core.hooksPath .githooks

docker:
	docker build -t webedit .
