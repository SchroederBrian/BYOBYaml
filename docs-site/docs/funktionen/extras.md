---
title: Extras – jedes Feld setzen
sidebar_label: Extras
sidebar_position: 6
---

# Extras – jedes Feld setzen

Kubernetes und Compose haben hunderte Felder. Für die häufigen gibt es eigene Blöcke. Für **alles andere** gibt es die Extras-Blöcke, die überall funktionieren.

## Das „aktuelle Objekt“

Extras wirken immer auf das Objekt, in dem sie stecken:

| Extras-Block steckt … | Pfade beziehen sich auf … |
| --- | --- |
| direkt unter einem Ressourcen-Startblock | die ganze Ressource (`metadata.…`, `spec.…`) |
| direkt unter *Docker Compose* | die ganze Compose-Datei (`configs`, `x-…`) |
| in einem Compose-*Service* | diesen Service (`cap_add`, `ulimits`, …) |
| in einem *Container* | diesen Container (`lifecycle`, `stdin`, …) |

## Die Blöcke

### Feld … = …

Setzt einen Wert an einem Pfad mit Punkten. Fehlende Zwischenobjekte werden angelegt, vorhandene Werte **überschrieben**.

![Feld-Blöcke unter dem Deployment und im Container](/img/screens/extras-feld.png)

Die beiden *Feld*-Blöcke unter dem Deployment beziehen sich auf die Ressource, der im Container auf den Container. Ergebnis (Auszug):

```yaml
spec:
  template:
    spec:
      containers:
        - name: web
          image: nginx:1.27
          securityContext:          # Feld im Container
            seccompProfile:
              type: RuntimeDefault
      hostNetwork: true             # Feld spec.template.spec.hostNetwork
  revisionHistoryLimit: 3           # Feld spec.revisionHistoryLimit
```

Werte werden als YAML gelesen:

| Eingabe | Ergebnis |
| --- | --- |
| `3` | Zahl `3` |
| `true` | Boolean |
| `"3"` | String `"3"` |
| `[a, b]` | Liste |
| `{key: v}` | Objekt |
| `Europe/Berlin` | String |

Listen-Indizes gehen auch: `spec.template.spec.containers[0].stdin`.

### zu Liste … hinzufügen …

Hängt einen Eintrag an eine Liste an und legt die Liste an, wenn sie fehlt:

![Listen-Einträge für Tolerations und Env](/img/screens/extras-liste.png)

```yaml
    spec:
      containers:
        - name: worker
          image: busybox:1.36
          env:                       # zu Liste env (im Container)
            - name: POD_IP
              valueFrom:
                fieldRef:
                  fieldPath: status.podIP
      tolerations:                   # zu Liste spec.template.spec.tolerations
        - key: dedicated
          operator: Exists
```

Mehrere *zu Liste*-Blöcke mit demselben Pfad ergeben mehrere Einträge in genau dieser Reihenfolge.

### YAML einmischen …

Mischt ein YAML-Objekt in das aktuelle Objekt. Objekte werden zusammengeführt, Listen angehängt. Diesen Block brauchst du, wenn Schlüssel Punkte enthalten:

![YAML einmischen für eine Annotation mit Punkten im Schlüssel](/img/screens/extras-yaml.png)

Der Schlüssel `app.openshift.io/connects-to` enthält Punkte. Mit *Feld* würde er als Pfad zerlegt; *YAML einmischen* übernimmt ihn unverändert:

```yaml
metadata:
  name: web
  annotations:
    app.openshift.io/connects-to: db
```

### Notiz …

Reiner Kommentar für dich. Er erzeugt kein YAML.

### Eigene Ressource … kind … apiVersion …

Ein Startblock für jeden Ressourcentyp ohne eigenen Startblock, etwa `NetworkPolicy`, `Certificate`, `PodDisruptionBudget` oder `ServiceMonitor`. Den Inhalt baust du mit Extras und Metadaten-Blöcken:

![Eigene Ressource PodDisruptionBudget](/img/screens/extras-ressource.png)

## Reihenfolge

Extras werden in Stapel-Reihenfolge ausgeführt. Ein *Feld*-Block **unter** einem normalen Block überschreibt dessen Ergebnis. Ein Beispiel ist ein abweichender Selector:

![Feld überschreibt den automatisch erzeugten Selector](/img/screens/extras-override.png)

Der Deployment-Startblock erzeugt `selector.matchLabels.app: web`. Der *Feld*-Block darunter ersetzt den ganzen Selector durch `{app: web, tier: fe}`. Damit der Selector die Pods weiterhin findet, setzt ein *Pod-Label* `tier = fe` das passende Label im Pod-Template.

:::caution Selector und Pod-Labels müssen zusammenpassen
Kubernetes lehnt ein Deployment ab, dessen Selector nicht zu den Labels im Pod-Template passt. Wer den Selector überschreibt, muss die Labels mitziehen.
:::

Genau so bildet der [Import](import.md) Abweichungen von den Standardwerten ab.
