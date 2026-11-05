---
title: Eigene Blocktypen
description: Eigene Compose- und Kubernetes-Blöcke visuell erstellen.
---

Der Designer ist nach der Anmeldung über **Eigene Blocktypen** unter der Blocksuche erreichbar. Im Gastmodus steht er nicht zur Verfügung. Die Bibliothek wird im eigenen Konto gespeichert.

1. **Docker Compose** oder **Kubernetes** wählen und mit einem passenden Grundbaustein beginnen.
2. Vorhandene Bausteine auf der Fläche verbinden. Ein Blocktyp besteht aus einer zusammenhängenden Struktur mit höchstens 40 Bausteinen.
3. Einen Baustein anklicken. Rechts auswählen, welche Felder später im eigenen Block sichtbar sind, und ihnen verständliche Namen und gültige Standardwerte geben.
4. Bei Bedarf unter **Weitere Feldeinstellungen** Auswahlwerte, Pflichtfelder, Zahlenbereiche und Reihenfolge anpassen. Mehrere Bausteinfelder können denselben Eingabewert verwenden.
5. Vorschau und Prüfhinweise beachten, dann **Blocktyp speichern**. Der Typ erscheint in **Eigene Blöcke** und in der kategorienübergreifenden Blocksuche.

Es gibt keine frei erfundenen YAML-Feldpfade oder eigenen Programme. Der Designer verwendet freigegebene native Bausteine und prüft das Ergebnis im passenden Beispielkontext gegen das offizielle Compose-Schema beziehungsweise die gebündelten Kubernetes-API-Schemas. Dazu kommen Prüfungen etwa für Ports, Image-Referenzen, Namen, Selektoren, Volumes und Ressourcenmengen. Fehler verhindern das Speichern der Definition. Beim Einsetzen werden die tatsächlichen Werte und die betroffene YAML-Ressource erneut geprüft; ungültige Ausgaben können nicht als YAML exportiert werden.

**Die Prüfung ist kein Cluster-Dry-Run:** Vorhandensein von Images, Dateien und externen Ressourcen, Berechtigungen, Admission-Regeln, installierte API-Versionen sowie Laufzeitverhalten hängen von der Zielumgebung ab. Diese müssen dort geprüft werden. Eigene CRDs und OpenShift-spezifische APIs sind im Designer nicht freigegeben.

Im normalen Editor lassen sich sichtbare Textfelder mit `${VARIABLEN}` befüllen. Passwörter und Tokens über Variablen beziehungsweise den Secret-Tresor einsetzen: Standardwerte eines Blocktyps werden in seiner Definition gespeichert und exportiert.

Die Bibliothek unterstützt Duplizieren, JSON-Import und -Export sowie Archivieren und Wiederherstellen. Ein bereits eingesetzter Block behält seine gespeicherte Version, auch wenn der Bibliothekseintrag später bearbeitet oder archiviert wird. Über sein Rechtsklickmenü lässt sich der Typ erneut im Designer öffnen. `.byob`-Dateien enthalten die benötigten Definitionen; Marktplatz-Inhalte werden in native Bausteine aufgelöst. Der Helm-Export verwendet ebenfalls die native Struktur.

Bei gleichzeitigen Änderungen in mehreren Fenstern verhindert eine Versionsprüfung das Überschreiben. **Bibliothek neu laden** übernimmt den aktuellen Bibliotheksstand und erhält den offenen Entwurf.
