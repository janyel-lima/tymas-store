# ════════════════════════════════════════════════════════
#  Makefile — Comandos da Stack MP Telegram Bot
#  Uso: make <comando>
# ════════════════════════════════════════════════════════

.PHONY: help dev prod down logs ps build-prod setup clean

# Cores ANSI
GREEN  = \033[0;32m
YELLOW = \033[1;33m
CYAN   = \033[0;36m
RESET  = \033[0m

help: ## Mostra esta ajuda
	@echo ""
	@echo "$(CYAN)╔══════════════════════════════════════════╗$(RESET)"
	@echo "$(CYAN)║     MP Telegram Bot — Comandos Make      ║$(RESET)"
	@echo "$(CYAN)╚══════════════════════════════════════════╝$(RESET)"
	@echo ""
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN {FS = ":.*?## "}; {printf "  $(GREEN)%-20s$(RESET) %s\n", $$1, $$2}'
	@echo ""

setup: ## Configura o ambiente inicial (cria .env e diretórios de dados)
	@echo "$(YELLOW)→ Configurando ambiente...$(RESET)"
	@[ -f .env ] || (cp .env.example .env && echo "$(GREEN)✓ .env criado a partir de .env.example$(RESET)")
	@[ -f .env.dev ] || echo "$(YELLOW)⚠ Crie .env.dev para desenvolvimento$(RESET)"
	@mkdir -p backend/data bot-one/data
	@echo "$(GREEN)✓ Diretórios de dados criados$(RESET)"
	@echo "$(YELLOW)→ Edite o .env com suas credenciais antes de continuar$(RESET)"

# ── Desenvolvimento ───────────────────────────────────────
dev: ## Inicia todos os serviços em modo desenvolvimento (hot-reload)
	@echo "$(CYAN)→ Iniciando stack de desenvolvimento...$(RESET)"
	@[ -f .env.dev ] || (echo "$(YELLOW)⚠ .env.dev não encontrado. Copiando de .env.dev.example...$(RESET)" && cp .env.example .env.dev)
	docker compose -f docker-compose.dev.yml up --build

dev-d: ## Inicia em modo desenvolvimento em background (detached)
	docker compose -f docker-compose.dev.yml up --build -d

dev-logs: ## Logs do modo desenvolvimento
	docker compose -f docker-compose.dev.yml logs -f

dev-down: ## Para o modo desenvolvimento
	docker compose -f docker-compose.dev.yml down

# ── Produção ──────────────────────────────────────────────
prod: ## Inicia todos os serviços em modo produção
	@echo "$(CYAN)→ Iniciando stack de produção...$(RESET)"
	@[ -f .env ] || (echo "$(RED)✗ .env não encontrado! Execute: make setup$(RESET)" && exit 1)
	docker compose up --build -d
	@echo "$(GREEN)✓ Stack iniciada em background$(RESET)"
	@make ps

build-prod: ## Apenas faz o build das imagens de produção (sem subir)
	docker compose build --no-cache

down: ## Para todos os serviços de produção
	docker compose down

# ── Utilitários ───────────────────────────────────────────
logs: ## Logs de produção em tempo real (todos os serviços)
	docker compose logs -f

logs-backend: ## Logs apenas do backend
	docker compose logs -f backend

logs-bot: ## Logs apenas do bot
	docker compose logs -f bot

logs-frontend: ## Logs apenas do frontend (Nginx)
	docker compose logs -f frontend

ps: ## Status dos containers
	@echo ""
	docker compose ps
	@echo ""

restart: ## Reinicia todos os serviços
	docker compose restart

restart-backend: ## Reinicia apenas o backend
	docker compose restart backend

restart-bot: ## Reinicia apenas o bot
	docker compose restart bot

# ── Banco de Dados ────────────────────────────────────────
db-shell: ## Abre o shell SQLite do backend
	docker compose exec backend sh -c "sqlite3 /app/data/payments.db"

db-admin: ## Executa db-admin.js (listar pagamentos)
	docker compose exec backend node db-admin.js list

db-stats: ## Exibe estatísticas do banco
	docker compose exec backend node db-admin.js stats

# ── Manutenção ────────────────────────────────────────────
clean: ## Remove containers, imagens e volumes não utilizados
	@echo "$(YELLOW)→ Limpando recursos Docker...$(RESET)"
	docker compose down --remove-orphans
	docker image prune -f
	docker volume prune -f
	@echo "$(GREEN)✓ Limpeza concluída$(RESET)"

clean-all: ## Remove TUDO incluindo volumes persistentes (⚠ apaga dados!)
	@echo "$(YELLOW)⚠ ATENÇÃO: Isso apagará o banco de dados SQLite!$(RESET)"
	@read -p "Confirme digitando 'sim': " confirm && [ "$$confirm" = "sim" ] || exit 1
	docker compose down -v --remove-orphans
	docker image rm mp-telegram-backend mp-telegram-bot mp-telegram-frontend 2>/dev/null || true
	rm -rf backend/data bot-one/data
	@echo "$(GREEN)✓ Limpeza total concluída$(RESET)"

# ── Ngrok (Dev com webhooks) ──────────────────────────────
ngrok: ## Expõe o backend via ngrok (necessário para webhooks do MP em dev)
	@which ngrok > /dev/null 2>&1 || (echo "$(YELLOW)⚠ Instale ngrok: https://ngrok.com$(RESET)" && exit 1)
	@echo "$(CYAN)→ Expondo backend na porta 3000 via ngrok...$(RESET)"
	@echo "$(YELLOW)→ Copie a URL HTTPS e atualize BACKEND_URL no .env.dev$(RESET)"
	ngrok http 3000
