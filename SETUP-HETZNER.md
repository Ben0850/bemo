# Hetzner Cloud Server — Setup-Anleitung

## Bemo-Verwaltung: app.bemo-autovermietung.de

---

## 1. Hetzner Cloud Server erstellen

1. Einloggen auf https://console.hetzner.cloud
2. Neues Projekt erstellen (z.B. "Bemo-Verwaltung")
3. Server erstellen:
   - **Standort**: Falkenstein oder Nuernberg (DE, DSGVO)
   - **Image**: Ubuntu 24.04
   - **Typ**: CX22 (2 vCPU, 4 GB RAM, 40 GB SSD) — ca. 4 EUR/Monat
   - **SSH-Key**: Eigenen Public Key hinterlegen (empfohlen!)
   - **Name**: bemo-prod

4. Server-IP notieren (z.B. `168.119.xxx.xxx`)

---

## 2. DNS konfigurieren

Beim Domain-Anbieter einen A-Record setzen:

```
app.bemo-autovermietung.de  →  A  →  168.119.xxx.xxx  (Server-IP)
```

TTL: 300 (5 Minuten) fuer schnelle Aenderungen.

Pruefen ob DNS aktiv ist:
```bash
nslookup app.bemo-autovermietung.de
```

---

## 3. SSH auf den Server

```bash
ssh root@168.119.xxx.xxx
```

---

## 4. Server-Ersteinrichtung

```bash
# System updaten
apt update && apt upgrade -y

# Git installieren
apt install -y git

# Projekt klonen
git clone https://github.com/ben0850/bemo.git /opt/bemo-verwaltung
cd /opt/bemo-verwaltung

# Environment-Datei erstellen
cp .env.example .env
nano .env
```

In der `.env` Datei sicherstellen:
```
DOMAIN=app.bemo-autovermietung.de
CERT_EMAIL=info@bemo-autovermietung.de
```

Dann das Setup-Script ausfuehren:
```bash
chmod +x deploy.sh
./deploy.sh setup
```

Das Script installiert automatisch:
- Docker + Docker Compose
- UFW Firewall (Ports 22, 80, 443)
- Fail2Ban (Brute-Force-Schutz)
- Selbstsigniertes SSL-Zertifikat (temporaer)

---

## 5. SSL-Zertifikat (Let's Encrypt)

**Wichtig**: DNS muss vorher auf die Server-IP zeigen!

```bash
cd /opt/bemo-verwaltung
./deploy.sh ssl
```

---

## 6. App starten

```bash
./deploy.sh start
```

Pruefen ob alles laeuft:
```bash
./deploy.sh status
```

Die App ist jetzt erreichbar unter:
```
https://app.bemo-autovermietung.de
```

---

## 7. Updates deployen (Git-Workflow)

### Auf dem lokalen Rechner (Windows):

```bash
# Aenderungen committen
git add .
git commit -m "Feature XYZ"

# Auf dev-Branch pushen
git push origin dev

# Wenn bereit fuer Produktion: nach main mergen
git checkout main
git merge dev
git push origin main
git checkout dev
```

### Auf dem Server:

```bash
ssh root@168.119.xxx.xxx
cd /opt/bemo-verwaltung
./deploy.sh update
```

Das `update`-Kommando macht automatisch:
1. Datenbank-Backup
2. `git pull origin main`
3. Docker-Container neu bauen
4. Neustart

---

## Nuetzliche Befehle auf dem Server

| Befehl | Beschreibung |
|---|---|
| `./deploy.sh status` | Container-Status + Health Check |
| `./deploy.sh logs` | Alle Logs live anzeigen |
| `./deploy.sh logs app` | Nur App-Logs |
| `./deploy.sh logs nginx` | Nur Nginx-Logs |
| `./deploy.sh backup` | Datenbank-Backup erstellen |
| `./deploy.sh waf-logs` | WAF/ModSecurity Logs |
| `./deploy.sh restart` | App neustarten |
| `./deploy.sh stop` | App stoppen |

---

## Sicherheits-Checkliste

- [x] UFW Firewall (nur 22/80/443)
- [x] Fail2Ban (SSH Brute-Force-Schutz)
- [x] SSL/TLS (Let's Encrypt, auto-renewal)
- [x] ModSecurity WAF (OWASP Core Rule Set)
- [x] Security Headers (HSTS, CSP, X-Frame-Options, etc.)
- [x] Rate Limiting (API: 30r/s, Login: 5r/min)
- [x] Non-root Docker Container
- [x] Keine .env/.git Dateien oeffentlich erreichbar
- [ ] SSH-Key statt Passwort (manuell konfigurieren)
- [ ] Automatische Backups (Hetzner Snapshot oder Cron)

---

## Hetzner Firewall (optional, zusaetzlich zu UFW)

In der Hetzner Console unter Firewalls:
- Eingehend erlauben: TCP 22 (SSH), TCP 80 (HTTP), TCP 443 (HTTPS)
- Alles andere blockieren

---

## Kosten-Uebersicht

| Posten | Kosten |
|---|---|
| Hetzner CX22 Server | ~4,51 EUR/Monat |
| Domain (falls noetig) | ~1 EUR/Monat |
| SSL (Let's Encrypt) | Kostenlos |
| **Gesamt** | **~5,50 EUR/Monat** |
