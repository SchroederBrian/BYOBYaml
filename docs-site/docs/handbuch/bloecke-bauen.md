---
title: 2 · Blöcke bauen – Schritt für Schritt
sidebar_label: 2 · Blöcke bauen
sidebar_position: 2
---

# Blöcke bauen – Schritt für Schritt

Am Beispiel eines Web-Deployments mit Service siehst du jeden Handgriff und das YAML, das er erzeugt.

## Grundgriffe

| Was | Wie |
| --- | --- |
| Block holen | Kategorie in der Palette anklicken, Block auf die Fläche ziehen |
| Einrasten | Block mit der linken oberen Ecke **unter** einen anderen oder **in** den Mund eines Klammerblocks ziehen; eine graue Vorschau zeigt, wo er landet |
| Verschieben | Am Block ziehen; alle Blöcke darunter kommen mit |
| Einzelnen Block herauslösen | Den Block darunter festhalten und wegziehen, dann den gewünschten Block |
| Wert ändern | In das helle Feld klicken und tippen. Bei ▾ öffnet sich eine Auswahl, bei ☐ ein Häkchen |
| Löschen | Auf den Papierkorb oder zurück in die Palette ziehen, oder Block anklicken und <kbd>Entf</kbd> |
| Rückgängig | <kbd>Strg</kbd>+<kbd>Z</kbd> |

## Schritt 1 – Startblock

Neue Kubernetes-Datei anlegen (Steuerrad-Symbol über der Dateiliste). Der Startblock **Deployment** ist schon da. Name `web`, Replicas `2`.

![Schritt 1: nur der Startblock](/img/screens/schritt-1.png)

Der Startblock allein erzeugt schon ein gültiges Gerüst: `apiVersion`, `kind`, `metadata.name`, `spec.replicas`, den Selector und die Pod-Labels `app: web`. Zusätzlich erscheint ein Hinweis: Es fehlt noch ein Container.

## Schritt 2 – Container einsetzen

Palette **Pod** → Block **Container** unter das Deployment ziehen. Name `web`, Image `nginx:1.27`.

![Schritt 2: Container unter dem Deployment](/img/screens/schritt-2.png)

Der Container ist ein **Klammerblock**: Er hat einen Mund, in den weitere Blöcke gehören. Im YAML landet er unter `spec.template.spec.containers`.

## Schritt 3 – Port und Ressourcen

Palette **Container** → **Port** und **mindestens (requests)** **in** den Container ziehen.

![Schritt 3: Port und Requests im Container](/img/screens/schritt-3.png)

:::tip Woran erkenne ich „in“ statt „unter“?
Die Blöcke im Container sind eingerückt. Hängst du sie versehentlich unter den Container statt hinein, bekommen sie ein ⚠. Siehe [Fehler finden](fehler-finden.md).
:::

## Schritt 4 – Probe und ein zweites Dokument

1. Palette **Container** → **Bereit? (readiness) prüfen per HTTP GET** in den Container, Pfad `/ready`, Port `http`. Der Port-Name funktioniert hier, weil der Port-Block ihn als `http` benennt.
2. Palette **Ressourcen** → **Service** **neben** das Deployment auf die freie Fläche ziehen. Er bekommt einen eigenen Stapel.
3. Palette **Netzwerk** → **Port 80 → Ziel http** unter den Service.

![Schritt 4: Deployment und Service](/img/screens/schritt-4.png)

Zwei Startblöcke ergeben **zwei YAML-Dokumente**, getrennt durch `---`. Scroll im YAML-Tab nach unten:

```yaml
---
apiVersion: v1
kind: Service
metadata:
  name: web
spec:
  selector:
    app: web
  ports:
    - name: http
      port: 80
      targetPort: http
  type: ClusterIP
```

Der Service findet die Pods über `selector: app: web`, also über das Label, das der Deployment-Startblock automatisch setzt. Deshalb steht im Service-Startblock **für App** `web`.

## Rechtsklick-Menü

![Kontextmenü eines Blocks](/img/screens/kontextmenue.png)

| Eintrag | Wirkung |
| --- | --- |
| **Ab hier als Vorlage speichern…** | Block samt Inhalt und allen Blöcken darunter als [eigene Vorlage](vorlagen.md) |
| **Kopieren** | Dupliziert den Block samt Inhalt |
| **Kommentar hinzufügen** | Notiz am Block, nur in BYOBYaml sichtbar |
| **interne Eingänge** | Ändert nur die Darstellung |
| **Baustein zusammenfalten** | Klappt den Block zu einer Zeile zusammen, praktisch bei großen Containern |
| **Baustein deaktivieren** | Block wird grau und erzeugt kein YAML, bleibt aber erhalten |
| **… Bausteine löschen** | Löscht den Block und alles in ihm |

## Ordnung halten

- **Anordnen** (oben über der Fläche) stapelt alle Startblöcke sauber untereinander.
- **Einpassen** zoomt so, dass alles sichtbar ist.
- Mit dem Mausrad zoomst du, mit Ziehen auf der leeren Fläche verschiebst du die Ansicht.

Weiter mit [Fehler finden](fehler-finden.md).
