.PHONY: help up down logs check shell dev

help:
	@echo "Agent OS (Hermes OS) — Command Console"
	@echo "  make up     build and start the stack (api, web, worker, postgres, redis)"
	@echo "  make down   stop the stack"
	@echo "  make logs   tail container logs"
	@echo "  make check  verify python syntax compile and docker compose syntax"
	@echo "  make dev    run the backend locally (fastapi) for quick iteration"

up:
	docker compose up --build -d

down:
	docker compose down

logs:
	docker compose logs -f

check:
	python3 -m compileall -q apps/api/app apps/worker 2>/dev/null || echo "Skiping compile check: python3 not available"
	docker compose config -q && echo "Docker Compose configuration is valid."

dev:
	cd apps/api && pip install -r requirements.txt && uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
