#!/bin/bash
# ===== Bemo-Verwaltung — Deployment Script =====
# Wird auf dem Ubuntu Cloud Server ausgeführt.
#
# Erstinstallation:
#   1. Server vorbereiten:    ./deploy.sh setup
#   2. SSL Zertifikat holen:  ./deploy.sh ssl
#   3. App starten:           ./deploy.sh start
#
# Updates:
#   ./deploy.sh update        (manuell, mit Backup)
#   ./deploy.sh deploy        (CI/CD, ohne interaktive Elemente)
#
# Weitere Befehle:
#   ./deploy.sh stop|restart|logs|status|backup

set -euo pipefail

# ===== Config =====
APP_DIR="$(cd "$(dirname "$0")" && pwd)"
COMPOSE_FILE="$APP_DIR/docker-compose.yml"
BACKUP_DIR="$APP_DIR/backups"

# Load env if exists
if [ -f "$APP_DIR/.env" ]; then
  source "$APP_DIR/.env"
fi

DOMAIN="${DOMAIN:-app.bemo-autovermietung.de}"
CERT_EMAIL="${CERT_EMAIL:-info@bemo-autovermietung.de}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log()  { echo -e "${GREEN}[✓]${NC} $1"; }
warn() { echo -e "${YELLOW}[!]${NC} $1"; }
err()  { echo -e "${RED}[✗]${NC} $1"; exit 1; }

# ===== Commands =====

cmd_setup() {
  echo "===== Server-Ersteinrichtung ====="

  # System update
  log "System aktualisieren..."
  sudo apt-get update -qq
  sudo apt-get upgrade -y -qq

  # Install Docker if not present
  if ! command -v docker &> /dev/null; then
    log "Docker installieren..."
    curl -fsSL https://get.docker.com | sudo sh
    sudo usermod -aG docker "$USER"
    log "Docker installiert. Bitte neu einloggen falls 'permission denied' kommt."
  else
    log "Docker bereits installiert."
  fi

  # Install Docker Compose plugin if not present
  if ! docker compose version &> /dev/null; then
    log "Docker Compose Plugin installieren..."
    sudo apt-get install -y docker-compose-plugin
  else
    log "Docker Compose bereits installiert."
  fi

  # Firewall
  log "Firewall konfigurieren (UFW)..."
  sudo ufw allow 22/tcp   # SSH
  sudo ufw allow 80/tcp   # HTTP
  sudo ufw allow 443/tcp  # HTTPS
  sudo ufw --force enable
  log "Firewall aktiv: SSH(22), HTTP(80), HTTPS(443)"

  # Fail2Ban
  if ! command -v fail2ban-client &> /dev/null; then
    log "Fail2Ban installieren..."
    sudo apt-get install -y fail2ban
    sudo systemctl enable fail2ban
    sudo systemctl start fail2ban
  fi

  # Create directories
  mkdir -p "$APP_DIR/nginx/ssl" "$BACKUP_DIR" "$APP_DIR/data"

  # Create .env from example if not exists
  if [ ! -f "$APP_DIR/.env" ]; then
    cp "$APP_DIR/.env.example" "$APP_DIR/.env"
    warn "Bitte .env anpassen: nano $APP_DIR/.env"
  fi

  # Generate self-signed cert for initial startup
  if [ ! -f "$APP_DIR/nginx/ssl/fullchain.pem" ]; then
    log "Selbstsigniertes Zertifikat erstellen (temporär)..."
    openssl req -x509 -nodes -days 30 -newkey rsa:2048 \
      -keyout "$APP_DIR/nginx/ssl/privkey.pem" \
      -out "$APP_DIR/nginx/ssl/fullchain.pem" \
      -subj "/CN=$DOMAIN"
    log "Temporäres SSL-Zertifikat erstellt."
  fi

  echo ""
  log "Setup abgeschlossen!"
  echo "  Nächste Schritte:"
  echo "  1. .env anpassen:        nano $APP_DIR/.env"
  echo "  2. DNS A-Record setzen:  $DOMAIN → Server-IP"
  echo "  3. SSL holen:            $0 ssl"
  echo "  4. App starten:          $0 start"
}

cmd_ssl() {
  echo "===== Let's Encrypt SSL-Zertifikat ====="

  if [ "$DOMAIN" = "tuev.example.com" ]; then
    err "Bitte zuerst DOMAIN in .env setzen!"
  fi

  # Stop nginx temporarily if running
  docker compose -f "$COMPOSE_FILE" stop nginx 2>/dev/null || true

  # Get certificate
  log "Zertifikat anfordern für $DOMAIN..."
  docker run --rm \
    -v "$APP_DIR/nginx/ssl:/etc/letsencrypt" \
    -v "$APP_DIR/nginx/ssl/webroot:/var/www/certbot" \
    -p 80:80 \
    certbot/certbot certonly \
      --standalone \
      --agree-tos \
      --no-eff-email \
      --email "$CERT_EMAIL" \
      -d "$DOMAIN"

  # Symlink certs
  ln -sf "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" "$APP_DIR/nginx/ssl/fullchain.pem"
  ln -sf "/etc/letsencrypt/live/$DOMAIN/privkey.pem" "$APP_DIR/nginx/ssl/privkey.pem"

  log "SSL-Zertifikat erfolgreich installiert!"
}

cmd_start() {
  # Ensure SSL certs exist (self-signed fallback)
  if [ ! -f "$APP_DIR/nginx/ssl/fullchain.pem" ]; then
    log "Kein SSL-Zertifikat gefunden, erstelle selbstsigniertes..."
    mkdir -p "$APP_DIR/nginx/ssl"
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
      -keyout "$APP_DIR/nginx/ssl/privkey.pem" \
      -out "$APP_DIR/nginx/ssl/fullchain.pem" \
      -subj "/CN=$DOMAIN" 2>/dev/null
  fi

  log "App starten..."
  docker compose -f "$COMPOSE_FILE" up -d --build
  log "App gestartet!"
  docker compose -f "$COMPOSE_FILE" ps
}

cmd_stop() {
  log "App stoppen..."
  docker compose -f "$COMPOSE_FILE" down
  log "App gestoppt."
}

cmd_restart() {
  log "App neustarten..."
  docker compose -f "$COMPOSE_FILE" down
  docker compose -f "$COMPOSE_FILE" up -d --build
  log "App neugestartet!"
  docker compose -f "$COMPOSE_FILE" ps
}

cmd_update() {
  echo "===== Update von Git ====="

  # Backup first
  cmd_backup

  # Pull latest
  log "Git Pull..."
  git pull origin main

  # Rebuild and restart
  log "Container neu bauen..."
  docker compose -f "$COMPOSE_FILE" up -d --build

  log "Update abgeschlossen!"
  docker compose -f "$COMPOSE_FILE" ps
}

cmd_deploy() {
  # CI/CD-tauglicher Deploy-Befehl (keine interaktiven Elemente, kein Backup)
  echo "===== CI/CD Deploy ====="

  log "Git Pull..."
  git pull origin main

  log "Container neu bauen..."
  docker compose -f "$COMPOSE_FILE" up -d --build

  log "Warte auf Container-Start..."
  sleep 10

  log "Health Check..."
  if curl -f -s http://localhost:3000/api/health > /dev/null 2>&1; then
    log "Health Check OK — Deployment erfolgreich!"
  else
    err "Health Check fehlgeschlagen!"
  fi
}

cmd_logs() {
  local service="${2:-}"
  if [ -n "$service" ]; then
    docker compose -f "$COMPOSE_FILE" logs -f "$service"
  else
    docker compose -f "$COMPOSE_FILE" logs -f
  fi
}

cmd_status() {
  echo "===== Container Status ====="
  docker compose -f "$COMPOSE_FILE" ps
  echo ""
  echo "===== Health Check ====="
  curl -s http://localhost:3000/api/health 2>/dev/null || echo "App nicht erreichbar"
  echo ""
  echo "===== Disk ====="
  df -h /
  echo ""
  echo "===== Docker Volumes ====="
  docker volume ls | grep tuev
}

cmd_backup() {
  local timestamp=$(date +%Y%m%d_%H%M%S)
  local backup_file="$BACKUP_DIR/tuev_backup_$timestamp.db"

  mkdir -p "$BACKUP_DIR"

  # Copy DB from Docker volume
  log "Datenbank-Backup erstellen..."
  docker compose -f "$COMPOSE_FILE" exec -T app cat /app/data/tuev.db > "$backup_file" 2>/dev/null || \
    cp "$APP_DIR/data/tuev.db" "$backup_file" 2>/dev/null || \
    warn "Kein laufender Container — lokale DB kopiert."

  if [ -f "$backup_file" ]; then
    log "Backup gespeichert: $backup_file ($(du -h "$backup_file" | cut -f1))"
  fi

  # Keep only last 10 backups
  ls -t "$BACKUP_DIR"/tuev_backup_*.db 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
}

cmd_waf_logs() {
  echo "===== WAF / ModSecurity Logs ====="
  docker compose -f "$COMPOSE_FILE" exec nginx tail -100 /var/log/modsecurity/audit.log 2>/dev/null || \
    warn "Keine WAF-Logs verfügbar."
}

# ===== Main =====
case "${1:-help}" in
  setup)    cmd_setup ;;
  ssl)      cmd_ssl ;;
  start)    cmd_start ;;
  stop)     cmd_stop ;;
  restart)  cmd_restart ;;
  update)   cmd_update ;;
  deploy)   cmd_deploy ;;
  logs)     cmd_logs "$@" ;;
  status)   cmd_status ;;
  backup)   cmd_backup ;;
  waf-logs) cmd_waf_logs ;;
  *)
    echo "Bemo-Verwaltung — Deployment"
    echo ""
    echo "Befehle:"
    echo "  setup      Server-Ersteinrichtung (Docker, Firewall, Fail2Ban)"
    echo "  ssl        Let's Encrypt SSL-Zertifikat holen"
    echo "  start      App starten (Docker Compose)"
    echo "  stop       App stoppen"
    echo "  restart    App neustarten mit Rebuild"
    echo "  update     Git Pull + Rebuild + Restart (manuell, mit Backup)"
    echo "  deploy     CI/CD Deploy (ohne Backup, mit Health Check)"
    echo "  logs       Container-Logs anzeigen (optional: logs app|nginx)"
    echo "  status     Status aller Container + Health Check"
    echo "  backup     Datenbank-Backup erstellen"
    echo "  waf-logs   WAF/ModSecurity Logs anzeigen"
    echo ""
    echo "Beispiel Erstinstallation:"
    echo "  git clone <repo-url> /opt/tuev-verwaltung"
    echo "  cd /opt/tuev-verwaltung"
    echo "  cp .env.example .env && nano .env"
    echo "  ./deploy.sh setup"
    echo "  ./deploy.sh ssl"
    echo "  ./deploy.sh start"
    ;;
esac
