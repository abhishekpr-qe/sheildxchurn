.PHONY: test lint check install generate-constants coverage

# Python tests
test:
	.venv/bin/pytest tests/ -v

# Python linting (if ruff is available)
lint:
	.venv/bin/ruff check src/ scripts/ tests/

# Syntax check all Node.js modules
check-node:
	@for f in server/config.js server/index.js server/lib/*.js server/services/*.js server/routes/*.js; do \
		node -c "$$f" 2>&1 && echo "✓ $$f" || echo "✗ $$f"; \
	done

# Node.js tests
check-node-tests:
	npx jest --passWithNoTests

# Run all checks
check: test check-node check-node-tests

# Install dependencies
install:
	pip install -e ".[dev]"
	npm install

# Generate constants.json from Python domain constants
generate-constants:
	.venv/bin/python3 -c "import json,sys;sys.path.insert(0,'.');from src.churn.domain.constants import *;json.dump({k:v for k,v in locals().items() if k.isupper() and not k.startswith('_')},open('server/constants.json','w'),indent=2)"
	@echo "Generated server/constants.json"

# Coverage report
coverage:
	.venv/bin/pytest tests/ --cov=src/churn --cov-report=term-missing
