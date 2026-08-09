# BuyBack — Produkt-Matching & Parser

Google-Apps-Script-Projekt für den BuyBack-Prozess: Einkaufsdaten und JTL-Verkaufsdaten werden unabhängig voneinander auf einen gemeinsamen **Modellschlüssel** normalisiert, darüber automatisch zusammengeführt (Matching) und daraus die Tagesprofite berechnet.

Dieses Dokument beschreibt den aktuellen Stand des Matching-Parsers: Architektur, Trefferquote, bekannte Ursachen für offene Prüffälle, und was zuletzt geändert wurde. Zielgruppe: neue Entwickler im Projekt sowie andere Projekte (z. B. den Purchasing Assistant), die dieselbe Parser-Logik wiederverwenden wollen.

## 1. Datenfluss

```
Einkauf (Sheet)          Verkauf (JTL-Export)
      |                          |
02_EK_Normalisierung.js   07_Verkaufs_Mapping.js / 08_Verkaufs_Parser.js
      |                          |
      v                          v
EK_Normalisiert            Verkaufs_Mapping (Produkt-ID)
      \                        /
       \                      /
        v                    v
         Produktstamm (05_Produktstamm.js)
                  |
                  v
   00_Tagesprofite.js (EK je Modellschlüssel × Verkauf = Gewinn)
```

- **Einkaufsseite**: `Einkaufsbezeichnung → EK_Normalisiert → Modellschlüssel` (direkt, kein Zwischenschritt über eine Produkt-ID)
- **Verkaufsseite**: `JTL-Bezeichnung → Verkaufs_Mapping → Produkt-ID → Modellschlüssel via Produktstamm`
- Beide Seiten laufen unabhängig durch eigene Parser-Regeln, treffen sich aber **ausschließlich über den Modellschlüssel**. Das ist die zentrale Kopplungsstelle im ganzen System — jeder Fehler dort pflanzt sich in jeden nachgelagerten Abgleich fort.

## 2. Kernkomponenten des Parsers

| Datei | Zuständig für |
|---|---|
| [03_EK_Parser.js](03_EK_Parser.js) | Rohe Modellschlüssel-Extraktion (`ekExtractModelKey_`), Kategorie-Erkennung Einkaufsseite (`ekDetermineCategory_`), Textnormalisierung, Farbwort-Filter |
| [08_Verkaufs_Parser.js](08_Verkaufs_Parser.js) | Kategorie-Erkennung Verkaufsseite (`salesDetermineCategory_`, `salesDetectConsoleCategory_`), Spiele-/Controller-Sonderregeln, **die zentrale Kanonisierung** (`salesCanonicalizeModelKey_`, `salesCanonicalizeCameraModelKey_`) |
| [02_EK_Normalisierung.js](02_EK_Normalisierung.js) | Ablauf Einkaufsseite: ruft Extraktion + Kanonisierung auf, EK-spezifische Nachbearbeitung (Speicherstandards, Controller-Paketabzug) |
| [07_Verkaufs_Mapping.js](07_Verkaufs_Mapping.js) | Ablauf Verkaufsseite: JTL-Artikel → Produkt-ID, Kandidatensuche im Produktstamm |
| [05_Produktstamm.js](05_Produktstamm.js) | Legt neue Produkte aus `EK_Normalisiert` an, pflegt Aliase |
| [00_Tagesprofite.js](00_Tagesprofite.js) | EK-Auswahl je Modellschlüssel (letzte 3 Einkäufe/2 Monate), Gewinnberechnung, Fest-EK-Regeln |
| [04_EK_Regeln_und_Hilfen.js](04_EK_Regeln_und_Hilfen.js) | Liest `EK_Regeln`-Tabellenblatt (Controller-Festpreise, Standard-Speichergrößen) — **einzige Quelle**, kein Code-Fallback |

## 3. Design-Prinzip: eine gemeinsame Kanonisierung für beide Seiten

Die wichtigste Architekturentscheidung: `ekExtractModelKey_()` liefert einen **rohen** Modellschlüssel (z. B. "ALPHA 6000" oder "HX20V"). Sowohl die Einkaufs- als auch die Verkaufsseite rufen danach **dieselbe** Funktion `salesCanonicalizeModelKey_()` (bzw. für Kameras `salesCanonicalizeCameraModelKey_()`) auf, um Schreibweisen zu vereinheitlichen — römische Ziffern, V-Suffixe, Marken-Präfixe, Speicherformat etc.

Das ist bewusst **eine** Funktion, kein Duplikat pro Seite: jede neue Normalisierungsregel (z. B. "HX-5" mit Bindestrich erkennen) wirkt automatisch auf Einkauf und Verkauf gleichzeitig. Bis 2026-08-04 lief diese Kanonisierung nur auf der Verkaufsseite — das war der größte einzelne Fehlerherd (siehe Abschnitt 5).

**Für Wiederverwendung in anderen Projekten (z. B. Purchasing Assistant):** Die relevanten, wiederverwendbaren Bausteine sind:
- `ekNormalizeProductName_(text)` — Rohtext-Normalisierung (Kleinschreibung, Sonderzeichen, bekannte Zubehör-/Farbwörter entfernen)
- `ekDetermineCategory_(sourceSheetName, normalizedName)` bzw. `salesDetermineCategory_(normalizedName)` — Kategorie-Erkennung, je nachdem ob eine Tabellenblatt-Herkunft bekannt ist oder nur der Text vorliegt
- `ekExtractModelKey_(normalizedName, category)` — die eigentliche Modell-Erkennung (viele kategoriespezifische Regex-Regeln)
- `salesCanonicalizeModelKey_(modelKey, category)` / `salesCanonicalizeCameraModelKey_(modelKey)` — die gemeinsame Kanonisierung

Alle vier sind reine Funktionen ohne Spreadsheet-Zugriff — sie lassen sich 1:1 in ein anderes Apps-Script-Projekt kopieren oder (wie bei der Fehlersuche in diesem Projekt praktiziert) in einer lokalen Node-Umgebung offline testen, ohne gegen die echten Sheets laufen zu müssen.

## 4. Aktueller Stand (Stand: 2026-08-10)

Letzter vollständiger Lauf nach allen unten dokumentierten Fixes **und** der Zusammenführung der bekannten Produktstamm-Duplikate: **8.692 von 9.824 Verkaufszeilen automatisch erfolgreich zugeordnet (88,5 %)**, 1.132 Prüffälle, 9.131 Versand-/Nicht-Produktzeilen automatisch übersprungen. Zum Vergleich: der Ausgangswert vor dieser Fix-Runde lag bei 78,7 % (7.729/9.824) — die Verbesserung von knapp 10 Prozentpunkten geht überwiegend auf die Zusammenführung von 9 doppelten Produktstamm-Einträgen zurück (siehe Abschnitt 6), nicht auf einzelne Parser-Regex-Fixes.

Verlauf zur Einordnung:

| Zeitpunkt | Erfolgreich | Prüffälle | Quote |
|---|---|---|---|
| Ausgangswert vor dieser Fix-Runde | 7.729 | 2.095 | 78,7 % |
| Nach Kanonisierungs-Fix, vor Duplikate-Fix (kurzzeitige Verschlechterung, siehe Abschnitt 6) | 7.637 | 2.187 | 77,7 % |
| Nach Produktstamm-Duplikate-Fix (verhindert neue Duplikate, alte noch nicht bereinigt) | 7.666 | 2.158 | 78,0 % |
| **Nach Zusammenführung der 9 bekannten Duplikate** | **8.692** | **1.132** | **88,5 %** |

### Verteilung der offenen Prüffälle (Verkaufs-Mapping, `Mapping_Prüfung_Verkauf`, Stand vor der letzten Zusammenführung)

| Prüfgrund | Anteil | Hauptursache |
|---|---|---|
| `KEIN_PASSENDES_PRODUKT_GEFUNDEN` | größter Anteil (~60 %) | Modellschlüssel korrekt erkannt, aber Produkt fehlt im Produktstamm — meist eine Datenlücke, kein Parser-Bug |
| `MEHRERE_PASSENDE_PRODUKTE` | zweitgrößter Anteil (~25–30 %) | Mehrdeutigkeit, überwiegend durch **doppelte Produktstamm-Einträge** für dasselbe Modell (z. B. "PS4 PRO 500GB" und "PS4 PRO" als zwei getrennte, aktive Produkte) — siehe Abschnitt 6 |
| `MODELLSCHLUESSEL_NICHT_ERKANNT` | kleinster Anteil (~10 %) | Parser erkennt gar kein Modell — Spiele außerhalb der festen Titel-Liste, ungewöhnliche Marken/Formulierungen, echte Einzelfälle |

**Wichtig für die Einordnung:** die ersten beiden Kategorien sind mehrheitlich **keine Parser-Bugs**, sondern Datenpflege-Themen (fehlende Produkte, doppelte Produkte). Weitere Regex-Verbesserungen am Parser wirken vor allem auf die dritte, kleinste Kategorie. Diese Tabelle stammt aus der Prüfliste vor der letzten Zusammenführung (Abschnitt 6) — eine aktualisierte Verteilung nach der Zusammenführung steht noch aus.

## 5. Änderungshistorie (2026-08-04 bis 2026-08-08)

Alle Änderungen wurden vor dem Livegang offline gegen echte Beispieldaten getestet (siehe Commit-Historie für Details je Änderung).

1. **Kanonisierung auch auf der Einkaufsseite aktiviert** (höchster Einzelhebel) — vorher liefen Einkauf und Verkauf mit unterschiedlichen Schreibweisen desselben Modells auseinander (z. B. `RX100M3` vs. `RX100 III`, `HX20V` vs. `HX20`).
2. **Controller-Festpreise vereinheitlicht** — drei unterschiedliche, teils veraltete Code-Fallbacks für Controller-EK entfernt; einzige Quelle ist jetzt das Tabellenblatt `EK_Regeln`. Fehlende Regel → Prüffall statt falscher/geratener Wert.
3. **Controller-Kauf ohne Hauptgerät** (z. B. ein einzeln gekaufter Controller) wurde bisher fälschlich als "Konsole minus Controller-Wert" verrechnet — jetzt als eigener Prüffall erkannt.
4. **Kamera-Modellschlüssel**: "Sony Alpha 5000" und Modelle mit Bindestrich ("HX-5") wurden nicht erkannt und teils durch ein mitverkauftes Objektiv überschrieben.
5. **"Xbox One Series S/X"** (Tippfehler für "Xbox Series S/X") sowie **"Xbox OneS/OneX"** (ohne Leerzeichen) wurden falscher Konsolen-Generation zugeordnet.
6. **Fremdsprachige Farbwörter** (ES/FR/NL/FI) wurden nicht herausgefiltert.
7. **"SX240" vs. "SX240HS"**: unterschiedliche Schreibweisen zwischen Einkauf (mit Leerzeichen) und Verkauf (ohne) führten zu getrennten Schlüsseln.
8. **Zusammengeschriebene Objektiv-Wörter** ("Teleobjektiv") und **Huawei-Handys** wurden nicht als jeweilige Kategorie erkannt.
9. **Zwei Bugs im täglichen Hauptlauf** behoben: ein Schritt rief eine nicht existierende Funktion auf (brach den ganzen Lauf vor der Gewinnberechnung ab), und es gab zwei widersprüchliche Definitionen der Start-Funktion.
10. **Timeout bei `BBP2_aktualisiereTagesprofite`**: bestehende Verkaufszeilen wurden einzeln, eine nach der anderen, ins Sheet zurückgeschrieben (ein `setValues()`-Aufruf pro Zeile). Bei fast 10.000 Zeilen führte das zu "Service Spreadsheets timed out". Jetzt werden bestehende Zeilen gebündelt in einem Lese-/Schreibzugriff aktualisiert, genau wie neue Zeilen es schon vorher waren.

## 6. Produktstamm-Duplikate — Root Cause gefunden, 9 bekannte Fälle bereits zusammengeführt

Root Cause: Die Kandidatensuche beim Verkaufs-Mapping kanonisiert Produktstamm-Einträge beim Indizieren (erkennt z. B. "A6000" und "ALPHA 6000" korrekt als dasselbe Modell). Das Anlegen neuer Produkte (`synchronisiereProduktstamm`) tat das bis 2026-08-08 nicht — bei einer Änderung der Schreibweise (z. B. durch einen Parser-Fix) wurde dadurch ein doppelter Produktstamm-Eintrag angelegt statt der bestehende erkannt. Ursache jetzt behoben (beide Stellen kanonisieren jetzt gleich), sodass **keine neuen Duplikate dieser Art mehr entstehen**.

Die zum Zeitpunkt der Analyse bekannten 9 Duplikat-Paare (u. a. PS4 Pro 500GB/1TB, PS5 Disc/Digital/Slim 500GB-Varianten, Xbox Series S/X ohne Speicherangabe, Xbox One X 500GB, HX400/HX400V, A6000/Alpha 6000 — jeweils Paare, bei denen laut Hardware-Fakten nur eine Speichervariante real existiert) wurden über den bestehenden, kontrollierten Mechanismus zusammengeführt:

- Tabellenblatt `Produkt_Zusammenführung` (Spalten: Alte Produkt-ID, Ziel-Produkt-ID, Grund, Freigegeben, Ausgeführt am, Status) — Zeile eintragen, "Freigegeben" auf "JA" setzen
- Funktion `fuehreFreigegebeneProdukteZusammen()` (in [06_Produkt_Zusammenfuehrung.js](06_Produkt_Zusammenfuehrung.js)) ausführen — deaktiviert das alte Produkt, verschiebt alle Aliase auf die Ziel-ID

Diese 9 Zusammenführungen betrafen zusammen 272 Alias-Zeilen und erklären den Großteil des Sprungs von 78,0 % auf 88,5 % in Abschnitt 4.

**Bemerkenswert:** Es existiert bereits ein automatischer Vorschlagsmechanismus ("globaler Produktstammvergleich"), der weitere Kandidaten mit Status `VORSCHLAG` (nicht freigegeben) in dasselbe Tabellenblatt einträgt — Fundort/Auslöser dieses Mechanismus wurde in dieser Runde noch nicht untersucht. Vorsicht bei diesen automatischen Vorschlägen: mindestens einer der beobachteten Vorschläge ("Galaxy Tab A9+" → "Galaxy Tab A9") sieht nach einer **falschen** Zusammenführung aus — A9 und A9+ sind unterschiedliche, real existierende Samsung-Modelle, keine Schreibweisen desselben Geräts. Automatische Vorschläge dieses Mechanismus sollten vor der Freigabe geprüft werden, nicht blind übernommen.

## 7. Bekannte, bewusst nicht behobene Punkte

- **Modellschlüssel-Namensraum ohne Marken-Präfix**: Schlüssel wie "5000" statt "SONY_ALPHA_5000" sind grundsätzlich kollisionsanfällig. Eine durchgängige Umstellung wurde als sinnvoll bewertet, aber als größerer, risikoreicherer Umbau zurückgestellt (betrifft den gesamten Produktstamm-Namensraum).
- **Nintendo Joy-Con/Pro-Controller "ohne Hauptgerät"**: dieselbe Fehlerklasse wie Punkt 3 in Abschnitt 5, aber für Nintendo strukturell anders (Kategorie kommt vom Quell-Tabellenblatt, nicht aus dem Text) — noch nicht untersucht.
- **Großhändler-Einkäufe ohne EK-Daten** (z. B. Zubehör, das nicht im Einkaufs-Sheet steht): Mechanismus noch nicht entworfen, wartet auf Entscheidung zur Zuordnungsart (exakter Produkttext vs. manuell vergebener Schlüssel).
- **Spiele-Erkennung**: aktuell eine feste Liste von 7 Titeln im Code (`salesIsVideoGame_`). Kein zuverlässigeres Signal in den JTL-Daten gefunden (weder Positionsart noch Artikelnummern-Muster).
