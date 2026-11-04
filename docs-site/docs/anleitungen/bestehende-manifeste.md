---
title: Bestehende Manifeste übernehmen
sidebar_position: 4
---

# Bestehende Manifeste übernehmen

So holst du einen laufenden OpenShift-/Kubernetes-Stand oder ein bestehendes Repo in BYOBYaml.

## Aus dem Cluster

```bash
oc project shop-prod
oc get deploy,svc,route,cm,pvc,hpa,bc,is -o yaml > shop-prod.yaml
```

Dann `shop-prod.yaml` ins BYOBYaml-Fenster ziehen. Der Import:

- zerlegt die `List` in einzelne Ressourcen, jede als eigener Startblock in der Datei `shop-prod.yaml`
- entfernt `status`, `uid`, `managedFields`, `resourceVersion` usw.
- zeigt im Bericht, wie viele Felder als Extras-Blöcke übernommen wurden

![Import-Bericht](/img/screens/import-bericht.png)

![Importierte Ressourcen als Blöcke](/img/screens/import-ergebnis.png)

Im Bild: Das Deployment ist mit eigenen Blöcken nachgebaut. `revisionHistoryLimit` und die Env-Variable mit `fieldRef` haben keinen eigenen Block und stehen deshalb als *Feld* bzw. *zu Liste* darin. Der Service hängt als zweiter Startblock darunter.

:::caution Secrets
Kein `oc get secret -o yaml` in Dateien schreiben, die in Git landen. Die Werte sind nur base64-kodiert. Secrets besser als Platzhalter mit dem Block *Secret* neu anlegen.
:::

## Aufräumen nach dem Import

1. **Anordnen** (oben in der Fläche) sortiert die Stapel.
2. Tab **Probleme** prüfen. Nach einem Import ist er normalerweise leer.
3. Extras-Blöcke durchsehen. Viele sind Cluster-Standardwerte, die du löschen kannst:
   - `spec.progressDeadlineSeconds = 600`
   - `spec.revisionHistoryLimit = 10`
   - `terminationMessagePath`, `terminationMessagePolicy`
   - `dnsPolicy: ClusterFirst`, `schedulerName: default-scheduler`
   - `spec.template.metadata.creationTimestamp = null`
4. Namespace-Blöcke durch `${NAMESPACE}` ersetzen und [Umgebungen](dev-prod.md) anlegen.
5. Optional: Ressourcen auf mehrere Dateien verteilen. Startblock mit <kbd>Strg</kbd>+<kbd>X</kbd> ausschneiden, neue Datei anlegen, mit <kbd>Strg</kbd>+<kbd>V</kbd> einfügen.

## Aus einem Git-Repo

Mehrere Dateien gleichzeitig wählen: *Importieren → YAML-Dateien…*, dann mit <kbd>Strg</kbd>/<kbd>Shift</kbd> markieren. Jede Datei wird eine eigene Datei im Projekt, mit demselben Namen.

Helm-Templates (`{{ .Values.x }}`) und Kustomize-Overlays sind **kein** reines YAML. Rendere sie vorher:

```bash
helm template myapp ./chart -f values-prod.yaml > rendered.yaml
kubectl kustomize overlays/prod > rendered.yaml
```
