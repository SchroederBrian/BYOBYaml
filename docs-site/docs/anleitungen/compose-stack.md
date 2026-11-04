---
title: 'Compose: Web + Datenbank + Cache'
sidebar_label: Compose-Stack
sidebar_position: 2
---

# Compose: Web + Datenbank + Cache

Ein typischer Stack für die lokale Entwicklung: App aus eigenem Dockerfile, PostgreSQL und Redis.

## Bauen

1. Neues Projekt, Datei `docker-compose.yml` (Typ Compose)
2. Startblock *Docker Compose · Projekt* mit Namen `shop`
3. Aus **Vorlagen** darunter ziehen:
   - *Datenbanken → PostgreSQL* (bringt das Volume `pgdata` mit)
   - *Datenbanken → Redis (persistent)*
   - *Web → App aus Dockerfile*
4. Im App-Service die Werte anpassen: Port `8080 → 3000`, *wartet auf db bis gesund*

Die Vorlagen in der Palette einer Compose-Datei:

![Compose-Vorlagen in der Palette](/img/screens/palette-vorlagen-compose.png)

So sieht ein fertiger Stack aus. Das mitgelieferte Beispielprojekt *Compose: Web + Postgres + Redis* nutzt zusätzlich die Variablen `DB_PASSWORD` und `WEB_PORT`:

![Compose-Stack mit Web, Datenbank und Cache](/img/screens/compose.png)

Ergebnis des Stacks aus den Vorlagen (gekürzt):

```yaml
name: shop
services:
  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: change-me
      POSTGRES_DB: app
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: [CMD-SHELL, pg_isready -U app]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
  app:
    build: .
    ports:
      - "8080:3000"
    env_file:
      - .env
    depends_on:
      db:
        condition: service_healthy
    restart: unless-stopped
volumes:
  pgdata:
```

## Passwort als Variable

Statt `change-me` direkt einzutragen:

1. Variable `DB_PASSWORD` anlegen: dev = `dev`, prod = `ein-langes-passwort`
2. Im Block *Variable POSTGRES_PASSWORD = …* den Wert `${DB_PASSWORD}` eintragen

## Nur in dev: Mailpit & Adminer

Die Vorlagen *Tools → Mailpit* und *Tools → Adminer* hinzufügen. Mailpit steckt im Compose-Profil `dev` und startet nur mit:

```bash
docker compose --profile dev up -d
```

## Härten für den Betrieb

Im App-Service die Vorlagen *Betrieb → Gehärteter Service*, *Log-Rotation* und *Ressourcen-Limits* einhängen.
