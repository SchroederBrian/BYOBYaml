---
title: Das .byob-Format
sidebar_label: .byob-Format
sidebar_position: 4
---

# Das .byob-Format

Eine `.byob`-Datei ist das **Austausch- und Backup-Format** von BYOBYaml. Sie enthält Projekte (mit Blöcken, Variablen und Umgebungen) und optional eigene Vorlagen. Technisch ist es UTF-8-JSON.

## Anwendungsfälle

- Projekt an Kollegen weitergeben
- Projekt in Git versionieren, neben den erzeugten YAML-Dateien
- Komplett-Backup vor einem Rechnerwechsel
- Vorlagen-Sammlung im Team verteilen

## Importieren

*Importieren → BYOBYaml-Datei (.byob)…* oder die Datei ins Fenster ziehen.

| Exportieren | Importieren |
| --- | --- |
| ![Menü Exportieren](/img/screens/menue-export.png) | ![Menü Importieren](/img/screens/menue-import.png) |

- Jedes enthaltene Projekt wird in die Datenbank übernommen.
- Existiert ein Projekt mit derselben ID schon, wird es **nicht überschrieben**. Es kommt als Kopie mit neuer ID und dem Zusatz „(Import)“ dazu.
- Vorlagen werden übernommen. Ist die ID schon vorhanden, wird die Vorlage aktualisiert.
- Danach öffnet sich das erste importierte Projekt.

## Aufbau

```json
{
  "format": "byobyaml",
  "kind": "project",
  "version": 2,
  "exportedAt": "2026-11-04T21:30:00.000Z",
  "projects": [
    {
      "format": "byobyaml",
      "version": 2,
      "id": "k3j2h1g0abcd",
      "title": "Shop",
      "createdAt": 1793820000000,
      "envs": ["dev", "prod"],
      "activeEnv": "dev",
      "variables": [
        { "name": "REPLICAS", "values": { "dev": "1", "prod": "3" } }
      ],
      "files": [
        {
          "id": "a1b2c3d4",
          "name": "deployment.yaml",
          "kind": "k8s",
          "state": { "blocks": { "languageVersion": 0, "blocks": [ /* Blockly-Serialisierung */ ] } }
        }
      ]
    }
  ],
  "snippets": [
    { "id": "…", "name": "Mein Standard-Container", "category": "user", "block": { "type": "pod_container", "fields": { } } }
  ]
}
```

| Feld | Bedeutung |
| --- | --- |
| `kind` | `project` (einzelnes Projekt) oder `bundle` (Backup mit Vorlagen) |
| `version` | Formatversion, aktuell `2` |
| `projects[].files[].kind` | `compose` oder `k8s` |
| `projects[].files[].state` | Blockly-JSON-Serialisierung der Fläche (Block-`type`, `fields`, `inputs.BODY`, `next`) |
| `snippets[].block` | Blockly-Serialisierung des obersten Blocks samt Folgeblöcken |

Die Block-Typen und Feldnamen findest du in der [Block-Referenz](/docs/referenz), z. B. `c_port` mit den Feldern `PORT`, `NAME` und `PROTO`.

:::tip Kompatibilität
Ältere Projektdateien (Version 1, `.byob.json` aus der ersten Version) werden beim Import automatisch umgewandelt.
:::

:::caution Inhalt
Variablenwerte und Felder wie Secret-Einträge stehen im Klartext in der Datei. Behandle `.byob`-Dateien wie die YAML-Dateien selbst.
:::
