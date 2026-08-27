# Kontext für eine neue Claude-Sitzung

Dieses Dokument ist der Einstiegspunkt, falls eine neue Claude-Code-Sitzung (anderer Account, andere Maschine, kein Zugriff auf den bisherigen Chatverlauf) an diesem Projekt weiterarbeiten soll. Es fasst zusammen, was für die Zusammenarbeit wichtig ist, und verweist für Architekturdetails auf [README.md](README.md).

## Was ist das hier

Google-Apps-Script-Projekt für den BuyBack-Gebrauchtwaren-Prozess. Ein Parser gleicht Einkaufsdaten (manuell/über Großhändler erfasst) mit JTL-Verkaufsdaten automatisch ab, berechnet daraus täglich den Rohgewinn. Ziel: möglichst viele Verkäufe automatisch korrekt zuordnen, der Rest landet als manueller Prüffall in eigenen Tabellenblättern. Architektur, Datenfluss und Kernkomponenten stehen ausführlich in [README.md](README.md) Abschnitt 1–3.

**Schwesterprojekt:** `C:\Project_minijob\Dashboard_fuer_BuyBack_Projekt` (GitHub: `flow-system-os/Dashboard_BuyBack`, live: `https://dashboard-buyback.vercel.app`) — eine kleine statische Anleitungsseite vor diesem Prozess, komplett getrenntes Repo, kein gemeinsamer Code.

## Auftraggeberin / Ansprechpartner

- **Annika** — hat das System ursprünglich gebaut, trifft fachliche Entscheidungen, einzige Quelle für Produktions-Datenzugriff. Kommuniziert meist per Slack/Chat-Nachrichten, die der Nutzer (Zidane) hier einfügt.
- **Syed** — Kollege, prüft den Parser unabhängig (zusätzliche Validierungsebene), arbeitet auch an einer separaten "Purchase Engine". Laut Annikas Vorgabe (2026-08-24): **ein zentraler Parser**, Syed soll nicht parallel eine eigene Version bauen. Zidane meldet sich bei Syed, wenn eine neue Parser-Version fertig ist; Syed reviewt erst nach dieser Meldung.
- **Julian** — testet das System aus Business-/User-Sicht, bekommt Zahlen zum Abgleich mit seiner eigenen manuellen Berechnung.
- **Nutzer dieser Sitzungen** — Zidane, arbeitet den Parser/das Dashboard im Auftrag von Annika ab.

## Wichtige IDs/Links

- Google-Sheet ("BuyBack 2026"): `1jXYNh18Q9ib77zoqNqBm-1TOK1trDqESJKsSGB6KxIA`
- Apps-Script-Projekt (scriptId, aus `.clasp.json`): `1eT9DN6jsoxqS3S3k6hpg5l0qlNVAARl3aXe7vSAL2Xxq3OXZdI8YIL7Y` — Editor: `https://script.google.com/d/<scriptId>/edit`
- Google-Cloud-Projekt (für clasp-Logs/Drive-API): `buyback-appsscript`, Projekt-Nr. `947872849982`
- Drive-Import-Ordner (JTL-CSV-Exporte): `https://drive.google.com/drive/folders/1VpyJlsVkVoOGCAI8ueCrVM3O_1l56stN`
- GitHub: `flow-system-os/BuyBack`

## Etablierter Arbeitsablauf (wichtig, bevor Code geändert wird)

1. **Fix vorschlagen, nicht sofort umsetzen** — bei größeren/riskanteren Änderungen erst Root Cause + Vorschlag beschreiben, auf Zustimmung warten. Kleinere, klar abgegrenzte Fixes (Regex-Erweiterungen etc.) dürfen nach grober Freigabe ("mach das", "fangt an") direkt implementiert werden.
2. **Offline testen vor jedem Push** — Node `vm`, die echten `.js`-Dateien laden, gegen reale Beispieldaten testen (Auszüge aus echten Produkttexten liegen typischerweise im Scratchpad-Verzeichnis der jeweiligen Sitzung, nicht im Repo). Vorher/Nachher-Diff über den gesamten Testdatensatz, nicht nur Einzelfälle — Regressionen fallen sonst nicht auf.
3. **Commit + Push zu GitHub UND `clasp push -f`** — beides bei jedem Fix, nicht nur eins von beiden.
4. **Sync-Reihenfolge nach Regeländerungen** (Funktionen manuell im Apps-Script-Editor ausführen, `clasp run-function` funktioniert nicht zuverlässig — siehe unten):
   1. `importiereNeueJtlDateien()` — [01_JTL_Import.js](01_JTL_Import.js) (nur falls eine neue CSV-Datei im Drive-Ordner liegt)
   2. `synchronisiereVerkaufsMapping()` — [07_Verkaufs_Mapping.js](07_Verkaufs_Mapping.js)
   3. `synchronisiereProduktstamm()` — [05_Produktstamm.js](05_Produktstamm.js)
   4. `aktualisiereNeueUndGeaenderteEinkaeufe()` — [02_EK_Normalisierung.js](02_EK_Normalisierung.js)
   5. `BBP2_aktualisiereTagesprofite()` — [00_Tagesprofite.js](00_Tagesprofite.js)
5. **Ergebnis über `clasp logs` prüfen**, nicht raten — funktioniert seit 2026-08-04 (siehe Setup-Hinweise unten).
6. **"Silent wrong match" ist schlimmer als ein Prüffall** — ein Fix darf die Zahl der Prüffälle erhöhen, wenn er vorher unbemerkte Fehlzuordnungen aufdeckt. Das ist ein Erfolg, keine Regression.

## Bekannte Zugriffs-/Setup-Eigenheiten

- `clasp run-function` funktioniert nicht zuverlässig für dieses Projekt — nicht erneut versuchen, stattdessen Funktionen manuell im Editor ausführen lassen und Ergebnis über `clasp logs` prüfen.
- `clasp logs` funktioniert (seit 2026-08-04 eingerichtet: eigenes GCP-Projekt statt Standard-Apps-Script-Projekt, IAM-Rechte vergeben).
- Verschiedene Google-Accounts haben unterschiedliche Zugriffsrechte auf verschiedene Drive-Ordner/Sheets (bewusste Datenzugriffs-Trennung von Annika). Wenn ein Import/eine Funktion mit einem Berechtigungsfehler abbricht, zuerst prüfen, mit welchem Account sie ausgeführt wurde — oft liegt es genau daran, nicht an einem Code-Fehler.
- Lokale xlsx-Exports der Live-Tabelle landen gelegentlich direkt im Projektordner (z. B. `BuyBack_Profit_27_08_2026.xlsx`) — lassen sich per `unzip` (xlsx ist ein ZIP-Container) und einem kleinen Node-Skript ohne externe Bibliotheken auswerten, da kein `xlsx`-npm-Paket lokal verfügbar ist.

## Aktueller Stand

Siehe [README.md](README.md) Abschnitt 4 für die zuletzt gemessene Trefferquote und offene Punkte. Kurzfassung zum Zeitpunkt dieses Dokuments (2026-08-27): Parser-MVP ist aus Annikas Sicht funktional nutzbar, Fokus verschiebt sich Richtung Datenqualität (fehlende Produktstamm-Einträge, Produktduplikate) statt weiterer Parser-Regex-Arbeit. Währungsumrechnung (SEK/GBP → EUR) ist implementiert und live verifiziert. Nächstes größeres Thema laut Annika: das Dashboard-Projekt fertigstellen, danach neues Projekt für Zidane.
