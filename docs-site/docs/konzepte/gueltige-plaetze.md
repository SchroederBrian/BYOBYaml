---
title: Gültige Plätze & Probleme
sidebar_position: 2
---

# Gültige Plätze & Probleme

Wie in Scratch rastet jeder Block überall ein. Ob er dort **sinnvoll** ist, prüft BYOBYaml bei jeder Änderung.

## Wirkungsbereiche

Jeder Startblock und jeder Klammerblock öffnet einen *Wirkungsbereich*. Ein Block funktioniert nur, wenn einer seiner erlaubten Bereiche aktiv ist.

| Bereich | Geöffnet durch | Typische Blöcke |
| --- | --- | --- |
| `compose` | Docker Compose | Service, Volume, Netzwerk, Secret |
| `service` | Service (Compose) | Image, Port, Variable, Healthcheck … |
| `k8s` | jeder Ressourcen-Startblock | Namespace, Label, Annotation |
| `pod` | Deployment, StatefulSet, DaemonSet, Job, CronJob | Container, Volume aus PVC, Pull Secret … |
| `container` | Container, Init-Container | Port, Env, Ressourcen, Probes, Mounts … |
| *Ressourcen-Typ* | z. B. `Service`, `Route`, `Ingress`, `BuildConfig` | Service-Port, Route-TLS, Ingress-Regel, Git-Quelle … |

Extras-Blöcke funktionieren überall.

## Was bei einem Fehler passiert

Beispiel: Der *Port*-Block hängt direkt unter dem Deployment statt **im** Container.

![Warnung am Block, Klick auf das ⚠ zeigt die Meldung](/img/screens/warnung-blase.png)

1. Der Block erzeugt **kein** YAML.
2. Er bekommt ein ⚠-Symbol. Ein Klick darauf zeigt die Meldung als Sprechblase (siehe oben).
3. Die Meldung erscheint im Tab **Probleme** und in der Statusleiste. Ein Klick auf die Meldung springt zum Block.

![Tab Probleme](/img/screens/probleme.png)

**Lösung:** den Block in den Mund des Container-Blocks ziehen. Das ⚠ verschwindet sofort.

## Mögliche Meldungen

| Meldung | Bedeutung |
| --- | --- |
| *Dieser Block gehört in einen "Container"-Block.* | Falscher Platz, siehe Tabelle oben |
| *Variable `${X}` ist nicht definiert.* | Es fehlt eine [Variable](../funktionen/variablen.md) mit diesem Namen |
| *"abc" ist keine Zahl.* | In einem Zahlenfeld steht Text, auch nach dem Einsetzen der Variablen |
| *"web" hat noch keinen Container-Block.* | Workload ohne Container |
| *Service "x" braucht ein Image oder einen Build.* | Compose-Service ohne `image` und `build` |
| *Service "x" hat noch keinen Port-Block.* | Kubernetes-Service ohne Ports |
| *BuildConfig braucht eine Quelle / Strategie.* | Git-Quelle oder Docker-/S2I-Strategie fehlt |
| *min ist größer als max.* | HPA-Grenzen vertauscht |
| *YAML-Fehler: …* | Text im Block *YAML einmischen* ist kein gültiges YAML |

Probleme blockieren nichts. Exportieren geht trotzdem, nur der fehlerhafte Block wird ausgelassen.
