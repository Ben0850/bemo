# ===== Bemo-Verwaltung — Makefile =====
# Shortcuts für häufige Befehle

.PHONY: dev dev-up dev-down prod prod-up prod-down logs status backup help

# ===== Lokale Entwicklung =====
dev:  ## Lokale Entwicklung starten (ohne Docker, direkt Node)
	node server.js

dev-up:  ## Lokale Entwicklung mit Docker starten
	docker compose -f docker-compose.dev.yml up --build

dev-down:  ## Lokale Entwicklung stoppen
	docker compose -f docker-compose.dev.yml down

# ===== Produktion =====
prod-up:  ## Produktion starten
	docker compose up -d --build

prod-down:  ## Produktion stoppen
	docker compose down

prod-restart:  ## Produktion neustarten
	docker compose down && docker compose up -d --build

# ===== Utility =====
logs:  ## Container-Logs anzeigen
	docker compose logs -f

logs-app:  ## Nur App-Logs
	docker compose logs -f app

logs-nginx:  ## Nur Nginx-Logs
	docker compose logs -f nginx

status:  ## Status aller Container
	docker compose ps

backup:  ## Datenbank-Backup
	./deploy.sh backup

waf-logs:  ## WAF-Logs anzeigen
	./deploy.sh waf-logs

# ===== Git Workflow =====
git-dev:  ## Auf dev-Branch wechseln
	git checkout dev

git-prod:  ## Auf main-Branch wechseln
	git checkout main

git-merge-to-prod:  ## Dev nach Main mergen (für Deployment)
	git checkout main && git merge dev && git push origin main && git checkout dev

# ===== Help =====
help:  ## Diese Hilfe anzeigen
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-20s\033[0m %s\n", $$1, $$2}'

.DEFAULT_GOAL := help
