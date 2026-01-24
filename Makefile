# Code quality commands

.PHONY: check check-ts check-py lint lint-ts lint-py fix fix-ts fix-py

# Check all (no changes)
check: check-ts check-py

check-ts:
	npx tsc --noEmit
	npx biome check .

check-py:
	uv run ruff check .
	uv run ruff format --check .

# Lint only (no type checking)
lint: lint-ts lint-py

lint-ts:
	npx biome check .

lint-py:
	uv run ruff check .
	uv run ruff format --check .

# Fix auto-fixable issues
fix: fix-ts fix-py

fix-ts:
	npx biome check --write .

fix-py:
	uv run ruff check --fix .
	uv run ruff format .
