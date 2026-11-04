---
title: 7 · Projekte, Speichern & Export
sidebar_label: 7 · Projekte & Export
sidebar_position: 7
---

# Projekte, Speichern & Export

## Projektverwaltung

Das **Ordner-Symbol** neben dem Projektnamen (oben in der Mitte) oder *Datei → Projekte öffnen…*:

![Projektverwaltung](/img/screens/projekte.png)

- **Öffnen:** Klick auf den Namen. Das aktuelle Projekt ist markiert (*geöffnet*).
- **Suchen:** Feld oben, filtert nach Namen.
- **⧉ Duplizieren** legt eine Kopie mit „(Kopie)“ an, z. B. als Ausgangspunkt für ein neues Team-Projekt.
- **🗑 Löschen** geht nicht beim gerade geöffneten Projekt.
- **Neues Projekt** / **Beispiel: Compose** / **Beispiel: OpenShift** legen jeweils ein neues Projekt an.
- Unten links steht, wo die Datenbank liegt.

Ein Klick auf das Compose-Beispiel öffnet zum Beispiel:

![Compose-Beispielprojekt](/img/screens/compose.png)

## Speichern

Es gibt **keinen Speichern-Knopf**, weil BYOBYaml jede Änderung nach einem kurzen Moment automatisch in die lokale SQLite-Datenbank schreibt. Die Statusleiste zeigt *Gespeichert HH:MM*. Mit <kbd>Strg</kbd>+<kbd>S</kbd> speicherst du sofort.

## Exportieren

![Menü Exportieren](/img/screens/menue-export.png)

| Ziel | Menüeintrag | Ergebnis |
| --- | --- | --- |
| Eine Datei an `oc`/`kubectl`/`docker compose` geben | **‹datei› als YAML…** | Einzelne `.yaml` |
| Ganzes Projekt ausrollen | **Alle Dateien in Ordner…** | Pro Datei eine `.yaml`, mit Werten der aktiven Umgebung |
| Projekt weitergeben / versionieren | **Projekt als .byob…** | Eine `.byob` mit Blöcken, Variablen, Umgebungen |
| Rechnerwechsel / Sicherung | **Backup: alles als .byob…** | Alle Projekte + eigene Vorlagen |

### Typischer Ablauf zum Ausrollen

```bash
# 1. In BYOBYaml: Umgebung "prod" wählen → Exportieren → Alle Dateien in Ordner… → deploy/prod
# 2. Prüfen
oc apply --dry-run=server -f deploy/prod/
# 3. Anwenden
oc apply -f deploy/prod/
```

Für Compose:

```bash
docker compose -f docker-compose.yml config   # prüft und zeigt das aufgelöste Ergebnis
docker compose up -d
```

Weiter mit den [Beispielen zum Nachbauen](beispiele.mdx).
