---
title: 7 · Marktplatz – teilen und laden
sidebar_label: 7 · Marktplatz
sidebar_position: 7
---

# Marktplatz: Blöcke, Dateien und Projekte teilen

Im **Marktplatz** teilen alle kostenlos, was sie gebaut haben. Es gibt drei Arten von Einträgen:

| Art | Was ist drin? | Was passiert beim Übernehmen? |
| --- | --- | --- |
| **Block-Kombination** | eine Kette von Blöcken, z. B. *Healthcheck + Restart* | landet auf deiner Arbeitsfläche oder in **Meine Vorlagen** |
| **Datei** | eine komplette YAML-Datei als Blöcke | wird als neue Datei in dein Projekt gelegt |
| **Projekt** | mehrere Dateien plus Variablen und Umgebungen | wird als neues Projekt geöffnet |

Öffnen: Titelleiste → **Marktplatz**, Menü **Datei → Marktplatz öffnen** oder auf dem Handy unten **Markt**.

![Marktplatz: Entdecken](/img/screens/marktplatz-entdecken.png)

## Finden

- **Suche** durchsucht Titel, Beschreibung, Tags und Namen der Autor:innen. Mehrere Wörter müssen alle vorkommen.
- **Art** (links): nur Block-Kombinationen, Dateien oder Projekte.
- **Für**: nur Einträge für *Docker Compose* oder für *Kubernetes / OpenShift*.
- **Tags**: Ein Klick auf `#postgres` filtert danach, ein zweiter Klick hebt den Filter auf.
- **Sortieren**: *Beliebt* (Downloads und Sterne), *Neu*, *Meiste Sterne*, *Zuletzt aktualisiert*.
- Ein Klick auf den Namen einer Person zeigt alle ihre Einträge.

## Ansehen und übernehmen

Ein Klick auf eine Karte öffnet die Detailansicht mit Beschreibung, Tags und einer **Vorschau**. Unter **Blöcke** siehst du die Blöcke, unter **YAML** das fertige YAML. Bei Projekten wählst du oben die Datei für die Vorschau. In der Blockvorschau kannst du die Fläche verschieben und zoomen, aber nichts ändern.

![Marktplatz: Detailansicht mit Vorschau](/img/screens/marktplatz-detail.png)

Die Buttons hängen von der Art ab:

- **In Arbeitsfläche einfügen** (Block-Kombination): Die Blöcke erscheinen oben links auf der Fläche und sind ausgewählt. Gehören sie unter einen anderen Block, steht das in der Meldung, z. B. *gehört in einen "Service"-Block*. Dann ziehst du sie dorthin. Der Button ist gesperrt, wenn die Kombination nicht zur geöffneten Datei passt, also Compose-Blöcke in einer Kubernetes-Datei.
- **Zu Meine Vorlagen**: Die Kombination steht danach in der Palette unter **Meine Vorlagen**.
- **Als Datei ins Projekt** / **Als neues Projekt öffnen**: Datei bzw. Projekt werden angelegt und geöffnet.
- **Herunterladen**: Dateien als `.yaml`, Projekte und Block-Kombinationen als `.byob`.
- **Merken** (Stern): Gemerkte Einträge findest du links unter **Gemerkt**.
- **Link kopieren**: Der Link öffnet den Eintrag direkt in der Web-Version.

Einträge enthalten nur Blöcke. Beim Übernehmen wird nichts ausgeführt und nichts an Cluster oder Docker geschickt.

## Veröffentlichen

Es gibt drei Wege:

1. Im Marktplatz oben rechts **Veröffentlichen** oder im Menü **Datei → Im Marktplatz veröffentlichen…**
2. **Rechtsklick auf einen Block → „Ab hier im Marktplatz teilen…“**: teilt diesen Block und alle Blöcke darunter in der Kette.
3. Tab **Vorlagen** → beim Eintrag einer eigenen Vorlage auf das Teilen-Symbol klicken.

![Veröffentlichen: Inhalt wählen, beschreiben, prüfen](/img/screens/marktplatz-veroeffentlichen.png)

Der Dialog hat drei Schritte:

1. **Was möchtest du teilen?** Wähle die aktuelle Datei, das ganze Projekt, eine eigene Vorlage oder die Block-Kombination vom Rechtsklick. Darunter zeigt die App gleich die Anzahl der Blöcke, den Editor (Compose oder Kubernetes) und die Größe. Bei Projekten ist **Variablenwerte nicht mitschicken** voreingestellt. Dann werden nur die Namen der Variablen geteilt, keine Werte.
2. **Beschreiben**: Titel (3–80 Zeichen), Beschreibung und bis zu 6 Tags. Vorhandene Tags werden zum Anklicken vorgeschlagen.
3. **Prüfen**: Sieht ein Wert wie ein Passwort, Token oder privater Schlüssel aus, listet die App die Stellen auf. Du musst dann bestätigen, dass das keine echten Zugangsdaten sind. Am besten ersetzt du solche Werte vorher durch Variablen wie `${DB_PASSWORD}`. Zum Schluss bestätigst du, dass du den Inhalt teilen darfst. Er wird **öffentlich** und ist für alle frei nutzbar (**CC0**).

Danach ist der Eintrag sofort online. Mit **Link kopieren** gibst du ihn weiter.

:::warning Öffentlich heißt öffentlich
Alles, was du veröffentlichst, kann jede Person sehen und herunterladen. Teile keine echten Passwörter, Tokens, internen Hostnamen oder Zertifikate.
:::

## Eigene Einträge verwalten

Links unter **Meine Uploads** stehen alle deine Einträge mit Downloads und Sternen. In der Detailansicht:

- **Bearbeiten**: Titel, Beschreibung und Tags ändern. Oder den Inhalt durch die aktuelle Datei, das aktuelle Projekt oder eine Vorlage ersetzen. Dann steigt die Version (v2, v3 …).
- **Löschen**: Der Eintrag ist sofort weg.

## Melden

Enthält ein Eintrag echte Zugangsdaten, Spam oder unpassende Inhalte, nutzt du **Melden**. Nach mehreren Meldungen verschiedener Personen wird der Eintrag automatisch ausgeblendet, bis die Moderation ihn geprüft hat. Die Person, die ihn veröffentlicht hat, sieht ihn weiter mit dem Hinweis *ausgeblendet*.

## Desktop-App und Web-Version

- **Web-Version** (byobyaml.keksgames.de/app): Du bist mit deinem Konto angemeldet und kannst alles direkt nutzen.
- **Desktop-App**: Stöbern, ansehen und übernehmen klappt **ohne Konto**. Zum Veröffentlichen, Merken und Melden klickst du im Marktplatz auf **Anmelden** und gibst E-Mail und Passwort deines Web-Kontos ein. Die App speichert **nicht das Passwort**, sondern nur einen persönlichen Zugriffsschlüssel. **Abmelden** (×-Symbol neben deinem Namen) widerruft ihn. Wenn du das Passwort deines Kontos änderst, werden alle Desktop-Anmeldungen ungültig.
- Ein Konto legst du in der Web-Version an (Link *Noch kein Konto?* im Anmelde-Dialog).

![Marktplatz auf dem Handy](/img/screens/marktplatz-handy.png)
