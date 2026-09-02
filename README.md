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

**Dritte Eingabe (Inventar):** `12_Inventar_Mapping.js` liest zusätzlich den JTL-Artikelstammdaten-Export (Lagerbestand) und ordnet jede Bestandszeile mit **denselben** Verkaufs-Parser-Funktionen einer Produkt-ID zu → `Inventar_Bestand` (Bestand je Produkt-ID, für die Purchase Engine). Details siehe Abschnitt 8.

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
| [12_Inventar_Mapping.js](12_Inventar_Mapping.js) | Dritte Eingabe: JTL-Lagerbestand (Artikelstammdaten) → Produkt-ID über die bestehenden Verkaufs-Parser-Funktionen; Bestandsrollup je Produkt-ID (`Inventar_Bestand`); Schutzprüfungen gegen stille Fehlzuordnungen (Abschnitt 8). Tests: [test_inventar_mapping.js](test_inventar_mapping.js) |

## 3. Design-Prinzip: eine gemeinsame Kanonisierung für beide Seiten

Die wichtigste Architekturentscheidung: `ekExtractModelKey_()` liefert einen **rohen** Modellschlüssel (z. B. "ALPHA 6000" oder "HX20V"). Sowohl die Einkaufs- als auch die Verkaufsseite rufen danach **dieselbe** Funktion `salesCanonicalizeModelKey_()` (bzw. für Kameras `salesCanonicalizeCameraModelKey_()`) auf, um Schreibweisen zu vereinheitlichen — römische Ziffern, V-Suffixe, Marken-Präfixe, Speicherformat etc.

Das ist bewusst **eine** Funktion, kein Duplikat pro Seite: jede neue Normalisierungsregel (z. B. "HX-5" mit Bindestrich erkennen) wirkt automatisch auf Einkauf und Verkauf gleichzeitig. Bis 2026-08-04 lief diese Kanonisierung nur auf der Verkaufsseite — das war der größte einzelne Fehlerherd (siehe Abschnitt 5).

**Für Wiederverwendung in anderen Projekten (z. B. Purchasing Assistant):** Die relevanten, wiederverwendbaren Bausteine sind:
- `ekNormalizeProductName_(text)` — Rohtext-Normalisierung (Kleinschreibung, Sonderzeichen, bekannte Zubehör-/Farbwörter entfernen)
- `ekDetermineCategory_(sourceSheetName, normalizedName)` bzw. `salesDetermineCategory_(normalizedName)` — Kategorie-Erkennung, je nachdem ob eine Tabellenblatt-Herkunft bekannt ist oder nur der Text vorliegt
- `ekExtractModelKey_(normalizedName, category)` — die eigentliche Modell-Erkennung (viele kategoriespezifische Regex-Regeln)
- `salesCanonicalizeModelKey_(modelKey, category)` / `salesCanonicalizeCameraModelKey_(modelKey)` — die gemeinsame Kanonisierung

Alle vier sind reine Funktionen ohne Spreadsheet-Zugriff — sie lassen sich 1:1 in ein anderes Apps-Script-Projekt kopieren oder (wie bei der Fehlersuche in diesem Projekt praktiziert) in einer lokalen Node-Umgebung offline testen, ohne gegen die echten Sheets laufen zu müssen.

## 4. Aktueller Stand (Stand: 2026-08-27)

Nach Einspielen des vollständigen Jahresexports (Januar bis Mitte August 2026, inkl. Währungsspalte für SEK/GBP-Verkäufe): **18.566 von 21.252 Verkaufszeilen automatisch erfolgreich zugeordnet (87,4 %)**, 2.686 Prüffälle, 19.791 Versand-/Nicht-Produktzeilen automatisch übersprungen. Die Quote liegt auf ähnlichem Niveau wie beim letzten kleineren Datensatz (siehe Tabelle unten) — der große Sprung in den absoluten Zahlen kommt vom deutlich größeren, jetzt vollständigen Zeitraum, nicht von einer Verschlechterung.

Zwischenzeitliche Werte auf dem kleineren Datensatz (~9.800 Zeilen, vor dem Jahresexport), zur Einordnung der Fix-Wirkung:

| Zeitpunkt | Erfolgreich | Prüffälle | Quote |
|---|---|---|---|
| Ausgangswert (vor 2026-08-04) | 7.729 | 2.095 | 78,7 % |
| Nach Produktstamm-Duplikate-Zusammenführung (2026-08-10) | 8.692 | 1.132 | 88,5 % |
| Nach Konsolen-/Spiele-Sicherheitsfix + Spiele_Titel-Umstellung (2026-08-18) | 8.698 | 1.126 | 88,6 % |
| Nach Kamera-/Bose-/Normalisierungs-Fixes (2026-08-20) | 8.667 | 1.157 | 88,2 % |
| Nach PS5-Slim-Produktstamm-Bereinigung (2026-08-24) | 8.601 | 1.223 | 87,6 % (Anstieg vermutlich durch aufgedeckte, vorher stille Fehlzuordnungen — siehe Prinzip "Silent wrong match ist schlimmer als ein Prüffall" in CLAUDE.md) |
| **Jahresexport, Währung korrigiert (2026-08-27)** | **18.566** | **2.686** | **87,4 %** |

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

## 5a. Änderungshistorie (2026-08-18 bis 2026-08-27)

Fortsetzung von Abschnitt 5, gleiche Vorgehensweise (offline gegen echte Daten getestet vor jedem Push).

**Juli-Profitvalidierung deckte zwei systemische Fehler auf (2026-08-18):**
1. Einzeln verkaufte Spiele/Zubehör mit Konsolen-Wort im Titel (z. B. "Mario + Rabbids... Nintendo Switch") bekamen den EK der ganzen Konsole zugewiesen — `salesDetectConsoleCategory_` und `ekExtractModelKey_` erkannten Nintendo Switch/Xbox Series schon bei bloßer Erwähnung, ohne Speichergröße oder Position als Hauptprodukt zu prüfen. Gefixt: beide Stellen verlangen jetzt Speicherangabe oder Position am Textanfang, analog zu PS4/PS5.
2. Schwedische (SEK) und britische (GBP) Verkäufe wurden mangels Währungsspalte im Rohexport 1:1 als EUR behandelt (z. B. eine PS5 für 5.554,85 SEK erschien als 5.554,85 €). Behoben 2026-08-27, siehe eigener Punkt unten.

**Spiele-Erkennung von fester Code-Liste auf Tabellenblatt umgestellt** (`Spiele_Titel`, selbst pflegbar durch Annika/Team, keine Code-Änderung mehr nötig für neue Titel) — ersetzt die in Abschnitt 7 erwähnte 7-Titel-Liste.

**Weitere Modellschlüssel-/Kategorie-Fixes:** PS5 Pro/Slim ohne Zusatz, deutsches Tausendertrennzeichen ("1.650 €" wurde als 1,65 € geparst — steckte identisch in drei fast-duplizierten Preis-Parsern), Samsung-Handys ohne "Galaxy"-Wort, DualSense/DualShock ohne das Wort "Controller", Kategorie-Fälle ohne Marken-Präfix ("Switch 32GB"), Canon-IS-Suffix (analog zum bereits behandelten HS-Suffix), spanisches/französisches Farb-/Kategoriewort, Bose-Erkennung (SoundTouch mit Artikelnummer dazwischen, Revolve, Portable Smart Speaker), drei Kamera-Modellschlüssel-Muster (Lumix-DMC-Präfix, Sony-HX-Suffixbuchstabe, Canon-G-Leerzeichen — behebt Fälle, in denen ein mitverkauftes Objektiv den Kamera-Schlüssel überschrieb), SanDisk-Speicherkarten (lieferten vorher die UHS-Geschwindigkeitsklasse "V60" statt eines Modellnamens).

**Generalisierte Normalisierungs-Fixes** (wirken auf alle Kategorien, nicht nur Einzelfälle): typografische Apostroph-Varianten (’ vs. ') vereinheitlicht, Akzentzeichen (Pokémon → Pokemon) per NFD-Normalisierung entfernt, Bindestriche bei der Spiele-Erkennung wie Leerzeichen behandelt ("Hunter-Call of The Wild-Edition").

**PS5-Slim-Produktstamm-Duplikat** (500GB-Variante existiert real nicht, Kanonisierung fasst sie ohnehin auf 1TB zusammen) über den bestehenden `Produkt_Zusammenführung`-Mechanismus bereinigt (siehe Abschnitt 6).

**Währungsumrechnung SEK/GBP → EUR** (2026-08-27): `EXPECTED_HEADERS` um "Währung" ergänzt, `01_JTL_Import.js` rechnet `Einzel-VK`/`Gesamtumsatz` mit einem festen Näherungskurs (`CONFIG.CURRENCY_RATES_TO_EUR` in [00_Konfiguration.js](00_Konfiguration.js)) in EUR um, `Brutto-VK` bleibt zur Nachvollziehbarkeit in der Originalwährung stehen. Kein tagesaktueller Kurs — bewusste MVP-Vereinfachung. Live verifiziert an den ursprünglich gemeldeten Anomalien (z. B. 6.065,63 SEK → korrekt 533,78 € statt vorher fälschlich 6.065,63 €). Einmalige Migrationsfunktion `fuegeWaehrungsSpalteInJtlRohdatenEin()` fügt die neue Spalte sicher in ein bereits befülltes `JTL_Rohdaten`-Sheet ein.

## 6. Produktstamm-Duplikate — Root Cause gefunden, 9 bekannte Fälle bereits zusammengeführt

Root Cause: Die Kandidatensuche beim Verkaufs-Mapping kanonisiert Produktstamm-Einträge beim Indizieren (erkennt z. B. "A6000" und "ALPHA 6000" korrekt als dasselbe Modell). Das Anlegen neuer Produkte (`synchronisiereProduktstamm`) tat das bis 2026-08-08 nicht — bei einer Änderung der Schreibweise (z. B. durch einen Parser-Fix) wurde dadurch ein doppelter Produktstamm-Eintrag angelegt statt der bestehende erkannt. Ursache jetzt behoben (beide Stellen kanonisieren jetzt gleich), sodass **keine neuen Duplikate dieser Art mehr entstehen**.

Die zum Zeitpunkt der Analyse bekannten 9 Duplikat-Paare (u. a. PS4 Pro 500GB/1TB, PS5 Disc/Digital/Slim 500GB-Varianten, Xbox Series S/X ohne Speicherangabe, Xbox One X 500GB, HX400/HX400V, A6000/Alpha 6000 — jeweils Paare, bei denen laut Hardware-Fakten nur eine Speichervariante real existiert) wurden über den bestehenden, kontrollierten Mechanismus zusammengeführt:

- Tabellenblatt `Produkt_Zusammenführung` (Spalten: Alte Produkt-ID, Ziel-Produkt-ID, Grund, Freigegeben, Ausgeführt am, Status) — Zeile eintragen, "Freigegeben" auf "JA" setzen
- Funktion `fuehreFreigegebeneProdukteZusammen()` (in [06_Produkt_Zusammenfuehrung.js](06_Produkt_Zusammenfuehrung.js)) ausführen — deaktiviert das alte Produkt, verschiebt alle Aliase auf die Ziel-ID

Diese 9 Zusammenführungen betrafen zusammen 272 Alias-Zeilen und erklären den Großteil des Sprungs von 78,0 % auf 88,5 % in Abschnitt 4.

**Zweiter, einfacherer Mechanismus für einzelne, bereits eindeutig bestätigte Fälle:** `bereinigeAktuelleDoppelprodukteSicher()` (ebenfalls in [06_Produkt_Zusammenfuehrung.js](06_Produkt_Zusammenfuehrung.js)) — eine fest im Code hinterlegte Liste (`merges`-Array direkt in der Funktion) statt eines Sheet-Workflows. Gedacht für Fälle, bei denen die Zusammenführung schon im Code-Review bestätigt wurde (z. B. PS5 Slim 500GB, das laut Hardware-Fakten real nicht existiert). Idempotent, kann gefahrlos mehrfach ausgeführt werden. Neue Fälle werden als weiterer Eintrag im `merges`-Array ergänzt.

**Bemerkenswert:** Es existiert bereits ein automatischer Vorschlagsmechanismus ("globaler Produktstammvergleich"), der weitere Kandidaten mit Status `VORSCHLAG` (nicht freigegeben) in dasselbe Tabellenblatt einträgt — Fundort/Auslöser dieses Mechanismus wurde in dieser Runde noch nicht untersucht. Vorsicht bei diesen automatischen Vorschlägen: mindestens einer der beobachteten Vorschläge ("Galaxy Tab A9+" → "Galaxy Tab A9") sieht nach einer **falschen** Zusammenführung aus — A9 und A9+ sind unterschiedliche, real existierende Samsung-Modelle, keine Schreibweisen desselben Geräts. Automatische Vorschläge dieses Mechanismus sollten vor der Freigabe geprüft werden, nicht blind übernommen.

## 7. Bekannte, bewusst nicht behobene Punkte (Stand 2026-08-27)

- **Modellschlüssel-Namensraum ohne Marken-Präfix**: Schlüssel wie "5000" statt "SONY_ALPHA_5000" sind grundsätzlich kollisionsanfällig. Eine durchgängige Umstellung wurde als sinnvoll bewertet, aber als größerer, risikoreicherer Umbau zurückgestellt (betrifft den gesamten Produktstamm-Namensraum).
- **Nintendo Joy-Con/Pro-Controller "ohne Hauptgerät"**: dieselbe Fehlerklasse wie Punkt 3 in Abschnitt 5, aber für Nintendo strukturell anders (Kategorie kommt vom Quell-Tabellenblatt, nicht aus dem Text) — noch nicht untersucht.
- **Großhändler-Einkäufe ohne EK-Daten**: Mechanismus existiert seit 2026-08-14 (`GROSSHAENDLER_EK`-Regeltyp in `EK_Regeln`, Schlüssel = erkannter Modellschlüssel). Wichtige strukturelle Einschränkung: die Regel wird erst geprüft, *nachdem* ein Modellschlüssel erkannt wurde — für Produkte ohne jede Erkennung kann eine korrekt eingetragene Regel trotzdem nie greifen (betraf z. B. SanDisk-Speicherkarten, bis dafür ein eigenes Modellschlüssel-Muster ergänzt wurde, siehe Abschnitt 5a).
- **Kamera/Objektiv-Kategorie — größter Einzelposten unter den Prüffällen, aber überwiegend Datenlücke, kein Parser-Bug**: Root-Cause-Analyse (2026-08-19/20) zeigt, dass der Parser in den meisten offenen Fällen bereits einen sauberen, korrekten Modellschlüssel liefert — es gibt trotzdem keinen Treffer, weil das jeweilige Modell im Produktstamm/den Einkaufsdaten schlicht fehlt. Offene Entscheidung bei Annika: gezieltes Nachtragen der fehlenden Modelle lohnt sich oder nicht.
- **497 Produktnamen-Varianten → nur 2 aktive Produkte** (Fund von Syed, 2026-08-14): vermutlich der größte verbleibende Hebel für die Prüffälle-Reduktion, aber ohne Syeds konkrete Liste oder einen frischen Produktstamm-Export nicht sinnvoll angehbar.
- **Kleinere, noch nicht einzeln untersuchte Punkte** (aus Syeds Audit): 2 Verkäufe zeigen auf stillgelegte/zusammengeführte Produkt-IDs, 17 doppelte Auftragszeilen, 1 Fall mit Postleitzahl statt Preis, 8 Controller-Käufe mit EK=0€, PS5-Kopfhörer teils als Konsole gematcht, eine Nintendo-Switch-TV-Docking-Station wird wie eine Konsole behandelt (Zubehör-Fall, gleiche Fehlerklasse wie ein bereits gefixter Switch-Dock-Fall).
- **Mixed-Bundle-Erkennung nur markenübergreifend**: `ekContainsMixedMainProducts_` erkennt Kombinationen wie PS4+Xbox, aber nicht mehrere unterschiedliche Modelle derselben Marke in einer Zeile (z. B. drei verschiedene Sony-Kameras in einem Kauf) — der gesamte Preis würde dann fälschlich einem einzigen erkannten Modell zugeordnet.
- **Mengen-Erkennung beim Einkauf fehlt für das Hauptprodukt**: bei Sammel-Einkäufen ("11x Nintendo 3DS XL, 1.650€") wird der Gesamtpreis aktuell als Einzelpreis behandelt (es gibt nur ein Mengenfeld für Controller-Zubehör, keins fürs Hauptprodukt) — verzerrt den Durchschnitts-EK. Direkt relevant für eine mögliche künftige strukturierte Dateneingabe (separate Mengen-Spalte würde das beheben).
- **Spiele-Erkennung**: seit 2026-08-18 ein selbst pflegbares Tabellenblatt (`Spiele_Titel`) statt fester Code-Liste, siehe Abschnitt 5a. Ersetzt den früheren Stand mit 7 fest im Code hinterlegten Titeln.

## 8. Inventar-Parser: JTL-Lagerbestand → Produkt-ID 

**Zweck.** Der Verkaufs-Parser verbindet jede *verkaufte* JTL-Artikelnummer mit einer Produkt-ID, der Einkaufs-Parser jede Einkaufszeile über den Modellschlüssel. Es fehlte die dritte Seite: der **aktuelle Lagerbestand je Produkt-ID**. `12_Inventar_Mapping.js` liest den JTL-Artikelstammdaten-Export (Tabellenblatt `Inventar_Rohdaten`), ordnet jede Zeile einer Produkt-ID zu — **ausschließlich mit den bestehenden Verkaufs-Parser-Funktionen, keine neue Erkennungslogik** — und schreibt zwei eigene Blätter:

- `Inventar_Mapping` — eine Zeile je SKU (Basis-Artikelnummer, Zustand, erkannte Produkt-ID, Join-Quelle, Bemerkung)
- `Inventar_Bestand` — Bestand (`Verfügbar` / `Auf Lager` / `In Aufträgen`) je Produkt-ID, für die Purchase Engine

### Zuordnungs-Reihenfolge je Inventarzeile (`inventarZuordneProdukt_`)

0. Bestehendes `Verkaufs_Mapping` für die Basis-SKU wiederverwenden — **mit Namens-Konsistenzprüfung** (siehe unten)
1. Alias auf den Artikelnamen (`Produkt_Alias`)
2. Videospiel-Titelliste (`Spiele_Titel`) → `SPIELE` (aus dem Bestand raus)
3. Generischer Spielkontext ("(Sony PlayStation 4, 2016)", "[PS4]", "pegi") → `SPIELE`
4. Controller-Sonderregel
5. Modellschlüssel-Erkennung (`salesExtractModelKey_`)
6. Großhändler-EK-Sonderregel (`GROSSHAENDLER_EK`)
7. Kandidatensuche im aktiven Produktstamm (Kategorie + Modell, dann Modell allein) — **mit Schutzprüfungen** (siehe unten)

Nach jeder Zuordnung: `inventarFolgeMergeUndAktiv_` folgt einer ausgeführten Zusammenführung (`Produkt_Zusammenführung`) und lässt keine Zuordnung auf einer inaktiven Produkt-ID stehen.

### Live-Validierung auf dem echten Sheet

- 6.459 Zeilen geprüft (alle, keine Stichprobe)
- 3.174 stimmten mit einem tatsächlichen Produkt überein → 2 Fehler, beide mit 0 Stück auf Lager → ~99,94 % Genauigkeit
- 0 doppelt gezählte Produkte (alle 251 Gesamtzahlen von Hand geprüft)
- 1.431 korrekt als Spiele/Controller aussortiert (nicht als Lagerbestand gezählt)
- 1.765 wurden bewusst nicht zugeordnet, weil:
  - 1.307 – es wurde erkannt, um was es sich handelt, aber ein solches Produkt ist noch nicht im Katalog vorhanden (meist 0 auf Lager, aber 77 davon haben tatsächlich Lagerbestand)      
  - 218 – Artikeltyp, den der Parser überhaupt nicht erkennen kann (30 haben tatsächlich Lagerbestand)
  - 200 – es wurde zu Recht vermieden, anzunehmen, es handele sich um eine komplette Konsole (39 davon sind tatsächlich vorrätig)
  - 40 – die Sicherheitsprüfung hat einen veralteten Datensatz abgelehnt und nichts Besseres gefunden (4 davon sind tatsächlich vorrätig)
- 150 Zeilen / 841 Einheiten aus diesem nicht zugeordneten Stapel sind tatsächlich noch vorrätig – es handelt sich um eine Lücke in der Abdeckung (fehlende Katalogeinträge / nicht erkannte Artikeltypen), nicht um ein Problem mit falscher Zuordnung

## 9. So führt man es in Apps Script aus (kurz erklärt)

**1. Code hochladen:** im Projektordner `clasp push -f`.

**2. Einmaliger Aufbau** (nur nötig, wenn `Produktstamm`/`EK_Normalisiert` noch leer sind — sonst direkt zu Schritt 3). Jede Funktion einzeln im Apps-Script-Editor über das Funktions-Dropdown oben + den ▶-Button starten; `clasp run-function` funktioniert für dieses Projekt nicht zuverlässig (siehe CLAUDE.md):

1. `aktualisiereNeueUndGeaenderteEinkaeufe()` — baut `EK_Normalisiert` aus den Einkaufsdaten
2. `synchronisiereProduktstamm()` — baut daraus `Produktstamm` und `Produkt_Alias`

**3. Normaler Tageslauf** — entweder alles auf einmal:

- `taeglicherBuyBackDatenlauf()` ([99_Hauptlauf.js](99_Hauptlauf.js)) — importiert neue JTL-Verkaufs-CSVs, gleicht Verkäufe ab, gleicht Inventar ab, berechnet Tagesprofite, alles hintereinander

— oder einzeln, in genau dieser Reihenfolge (z. B. um gezielt einen Schritt zu testen):

1. `importiereNeueJtlDateien()` — nur falls eine neue Verkaufs-CSV im Drive-Ordner liegt
2. `synchronisiereVerkaufsMapping()`
3. `synchronisiereInventarMapping()` — braucht vorher Daten in `Inventar_Rohdaten` (siehe unten)
4. `BBP2_aktualisiereTagesprofite()`

**4. `Inventar_Rohdaten` befüllen** (für Schritt 3 oben) — zwei Wege:

- **Über einen Drive-Ordner:**
  1. Die JTL-Artikelstammdaten-CSV in genau diesen Drive-Ordner hochladen.
  2. Danach `importiereInventarStammdaten()` ausführen — sie holt sich automatisch die neueste CSV aus diesem Ordner und füllt `Inventar_Rohdaten`.

  **Wichtig:** dafür einen eigenen Ordner nehmen, nicht denselben wie für die Verkaufs-CSVs (`CONFIG.DRIVE_FOLDER_ID` in [00_Konfiguration.js](00_Konfiguration.js)) — sonst versucht jeder Import auch die Datei des jeweils anderen zu lesen und scheitert daran (sauber, mit Fehlermeldung, aber unnötig verwirrend).

**5. Ergebnis ansehen:**
- **Im Apps-Script-Editor:** unten erscheint das Ausführungsprotokoll (die `console.log`-Zeilen) — alternativ `clasp logs` im Terminal.
- **Im Sheet:** die eigentlichen Ergebnisse stehen nie in Apps Script selbst, sondern in den Tabellenblättern — `Verkaufs_Mapping`, `Produktstamm`, `Inventar_Mapping`, `Inventar_Bestand`, `Tagesprofite` usw. Sheet-Tab öffnen bzw. neu laden, dort nachsehen.