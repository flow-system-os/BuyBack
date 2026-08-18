/**
 * ============================================================
 * ZENTRALE KONFIGURATIONEN
 * ============================================================
 *
 * Diese Datei gehört zum modularen BuyBack-Apps-Script-Projekt.
 * Alle .gs-Dateien im selben Apps-Script-Projekt teilen sich
 * Funktionen und Konstanten automatisch. Es sind keine Imports nötig.
 */

const CONFIG = Object.freeze({
  DRIVE_FOLDER_ID: '1VpyJlsVkVoOGCAI8ueCrVM3O_1l56stN',
  SPREADSHEET_ID: '1jXYNh18Q9ib77zoqNqBm-1TOK1trDqESJKsSGB6KxIA',

  RAW_SHEET_NAME: 'JTL_Rohdaten',
  LOG_SHEET_NAME: 'Import_Log',
  ERROR_SHEET_NAME: 'Import_Fehler',

  TIMEZONE: 'Europe/Berlin',

  EXPECTED_HEADERS: [
    'Auftragsnummer',
    'Auftragsdatum',
    'Shop',
    'Externe Belegnummer',
    'Artikelnummer',
    'Bezeichnung (Position)',
    'Positionsart',
    'Menge',
    'Brutto-VK'
  ],

  TECHNICAL_HEADERS: [
    'Importzeitpunkt',
    'Quelldatei',
    'Drive-Datei-ID',
    'CSV-Quellzeile'
  ],

DERIVED_HEADERS: [
  'Einzel-VK',
  'Gesamtumsatz'
],

ARCHIVE_FOLDER_NAME: 'Archiv',



  REVIEW_HISTORY_HEADERS: [
    'Archiviert am',
    'Erstellt am',
    'JTL-Artikelnummer',
    'JTL-Bezeichnung',
    'Normalisierte Verkaufsbezeichnung',
    'Erkannte Kategorie',
    'Erkannter Modellschlüssel',
    'Gefundene Kandidaten',
    'Prüfgrund',
    'Status',
    'Manuelle Produkt-ID',
    'Bearbeitet von',
    'Bearbeitet am'
  ],

  LOG_HEADERS: [
    'Importzeitpunkt',
    'Dateiname',
    'Drive-Datei-ID',
    'Erkanntes Verkaufsdatum',
    'Importierte Datenzeilen',
    'Trennzeichen',
    'Status'
  ],

  ERROR_HEADERS: [
    'Zeitpunkt',
    'Dateiname',
    'Drive-Datei-ID',
    'Fehlertyp',
    'Fehlermeldung'
  ]
});


/**
 * Hauptfunktion.
 *
 * Diese Funktion:
 * 1. sucht alle noch nicht verarbeiteten CSV-Dateien,
 * 2. sortiert sie chronologisch,
 * 3. importiert sie nacheinander.
 *
 * Diese Funktion wird später mit dem täglichen Trigger verbunden.
 */

const EK_CONFIG = Object.freeze({
  SOURCE_SPREADSHEET_ID:
    '1-cox_2tXdeiuxxfzcCN6OgEcpK_Z91r2eCFGHs8QAfw',

  TARGET_SPREADSHEET_ID:
    '1jXYNh18Q9ib77zoqNqBm-1TOK1trDqESJKsSGB6KxIA',

  SOURCE_SHEETS: [
    'PS4',
    'Nintendo',
    'Kameras etc.',
    'XBOX',
    'Handys + Tablets',
    'PS5',
    'Objektive'
  ],

  EXCLUDED_SHEETS: [
    'Vnukov'
  ],

  TARGET_SHEET_NORMALIZED:
    'EK_Normalisiert',

  TARGET_SHEET_RULES:
    'EK_Regeln',

  TARGET_SHEET_REVIEW:
    'Mapping_Prüfung',

  TARGET_SHEET_LOG:
    'EK_Import_Log',

  TIMEZONE:
    'Europe/Berlin',

  /**
   * Positionen in der unstrukturierten Einkaufstabelle.
   * Arrays beginnen bei 0:
   *
   * A = 0
   * B = 1
   * C = 2
   * D = 3
   * E = 4
   * F = 5
   */
  COLUMNS: Object.freeze({
    DATE: 0,
    PRODUCT: 1,
    TOTAL_PRICE: 2,
    LOCATION: 3,
    ADDITIONAL_INFO: 4,
    SELLER: 5
  }),

  NORMALIZED_HEADERS: [
    'Importzeitpunkt',
    'Quelltab',
    'Quellzeile',
    'Kaufdatum',
    'Originalbezeichnung',
    'Normalisierte Bezeichnung',
    'Kategorie',
    'Modellschlüssel',
    'Gesamtpreis inkl. Versand/Gebühren',
    'Erkannte Controller-Anzahl',
    'Controller-Typ',
    'Controller-Abzugswert',
    'Sonstiges Zubehör mit 0 EUR',
    'Bereinigter Hauptprodukt-EK',
    'PLZ / Ort / Land',
    'Zusatzinformation',
    'Verkäufername',
    'Prüfstatus',
    'Prüfgrund',
    'Quelldatensatz-ID', 
    'Quelldaten-Hash',
'Sync-Schlüssel'
  ],

  REVIEW_HEADERS: [
    'Erstellt am',
    'Quelltab',
    'Quellzeile',
    'Kaufdatum',
    'Originalbezeichnung',
    'Gesamtpreis',
    'Erkannter Modellschlüssel',
    'Prüfgrund',
    'Status',
    'Manuelle Entscheidung',
    'Bearbeitet von',
    'Bearbeitet am'
  ],

  REVIEW_HISTORY_HEADERS: [
    'Archiviert am',
    'Erstellt am',
    'JTL-Artikelnummer',
    'JTL-Bezeichnung',
    'Normalisierte Verkaufsbezeichnung',
    'Erkannte Kategorie',
    'Erkannter Modellschlüssel',
    'Gefundene Kandidaten',
    'Prüfgrund',
    'Status',
    'Manuelle Produkt-ID',
    'Bearbeitet von',
    'Bearbeitet am'
  ],

  LOG_HEADERS: [
    'Ausführungszeitpunkt',
    'Verarbeitete Tabs',
    'Gelesene Quellzeilen',
    'Übernommene Einkaufszeilen',
    'Prüffälle',
    'Status'
  ]
});


/**
 * Zentrale Startfunktion.
 *
 * Diese Funktion zunächst manuell ausführen:
 *
 * normalisiereEinkaufstabelle
 */

const PRODUCT_CONFIG = Object.freeze({
  PRODUCT_SHEET_NAME: 'Produktstamm',
  ALIAS_SHEET_NAME: 'Produkt_Alias',

  ID_PREFIX: 'BB',
  ID_DIGITS: 6,

  PRODUCT_HEADERS: [
    'Produkt-ID',
    'Kategorie',
    'Modellschlüssel',
    'Standardname',
    'EK-Regel',
    'Aktiv',
    'Erstmals erkannt',
    'Zuletzt erkannt',
    'Quelle',
    'Bemerkung'
  ],

  ALIAS_HEADERS: [
    'Alias',
    'Normalisierter Alias',
    'Produkt-ID',
    'Quelle',
    'Aktiv',
    'Erstmals erkannt',
    'Zuletzt erkannt'
  ]
});


/**
 * Zentrale Funktion zum fortlaufenden Aufbau des Produktstamms.
 *
 * Sie kann manuell ausgeführt oder nach dem täglichen EK-Sync
 * automatisch aufgerufen werden.
 */

const PRODUCT_MERGE_CONFIG = Object.freeze({
  SHEET_NAME: 'Produkt_Zusammenführung',

  HEADERS: [
    'Alte Produkt-ID',
    'Ziel-Produkt-ID',
    'Grund',
    'Freigegeben',
    'Ausgeführt am',
    'Status'
  ]
});


/**
 * Führt alle mit JA freigegebenen Produkt-IDs zusammen.
 */

const SALES_MAPPING_CONFIG = Object.freeze({
  RAW_SHEET_NAME: 'JTL_Rohdaten',
  MAPPING_SHEET_NAME: 'Verkaufs_Mapping',
  REVIEW_SHEET_NAME: 'Mapping_Prüfung_Verkauf',
  REVIEW_HISTORY_SHEET_NAME: 'Mapping_Prüfung_Verkauf_Log',
  LOG_SHEET_NAME: 'Verkaufs_Mapping_Log',

  MAPPING_HEADERS: [
    'JTL-Artikelnummer',
    'JTL-Bezeichnung',
    'Normalisierte Verkaufsbezeichnung',
    'Erkannte Kategorie',
    'Erkannter Modellschlüssel',
    'Produkt-ID',
    'Mappingstatus',
    'Zuordnungsquelle',
    'Erstmals erkannt',
    'Zuletzt erkannt',
    'Aktiv',
    'Bemerkung'
  ],

  REVIEW_HEADERS: [
    'Erstellt am',
    'JTL-Artikelnummer',
    'JTL-Bezeichnung',
    'Normalisierte Verkaufsbezeichnung',
    'Erkannte Kategorie',
    'Erkannter Modellschlüssel',
    'Gefundene Kandidaten',
    'Prüfgrund',
    'Status',
    'Manuelle Produkt-ID',
    'Bearbeitet von',
    'Bearbeitet am',
    'Empfohlener Actionstep'
  ],

  REVIEW_HISTORY_HEADERS: [
    'Archiviert am',
    'Erstellt am',
    'JTL-Artikelnummer',
    'JTL-Bezeichnung',
    'Normalisierte Verkaufsbezeichnung',
    'Erkannte Kategorie',
    'Erkannter Modellschlüssel',
    'Gefundene Kandidaten',
    'Prüfgrund',
    'Status',
    'Manuelle Produkt-ID',
    'Bearbeitet von',
    'Bearbeitet am',
    'Empfohlener Actionstep'
  ],

  LOG_HEADERS: [
    'Ausführungszeitpunkt',
    'Eindeutige JTL-Artikel',
    'Bereits gemappt',
    'Neu automatisch gemappt',
    'Prüffälle',
    'Fehler',
    'Status'
  ]
});

/**
 * Selbstständig von Annika/dem Team pflegbare Liste von Spieltiteln,
 * die als Videospiel gelten sollen (EK 0 EUR, siehe salesIsVideoGame_).
 * Bewusst als Tabellenblatt statt als Code-Liste, damit neue Titel
 * ohne Code-Änderung ergänzt werden können.
 */

const GAME_LIST_CONFIG = Object.freeze({
  SHEET_NAME: 'Spiele_Titel',

  HEADERS: [
    'Such-Begriff',
    'Plattform',
    'Aktiv',
    'Hinzugefügt am',
    'Kommentar'
  ],

  /*
   * Einmalige Startbefüllung beim ersten Anlegen des Blatts - die
   * bisher fest im Code stehenden Titel, damit beim Umstieg keine
   * bereits funktionierende Erkennung verlorengeht. Danach ist das
   * Tabellenblatt die alleinige Quelle, kein Code-Fallback.
   */
  SEED_ROWS: [
    ['the last of us', '', 'JA', '', 'Ursprünglich fest im Code'],
    ['landwirtschaftssimulator', '', 'JA', '', 'Ursprünglich fest im Code'],
    ['landwirtschafts simulator', '', 'JA', '', 'Ursprünglich fest im Code'],
    ['call of duty', '', 'JA', '', 'Ursprünglich fest im Code'],
    ['minecraft', '', 'JA', '', 'Ursprünglich fest im Code'],
    ['rocket league', '', 'JA', '', 'Ursprünglich fest im Code'],
    ['dragon age', '', 'JA', '', 'Ursprünglich fest im Code'],
    ['the hunter call of the wild', '', 'JA', '', 'Ursprünglich fest im Code']
  ]
});


/**
 * Stabile Zuordnungen für JTL-Artikelnummern, deren Marktplatzbezeichnung
 * je nach Sprache oder Paketlisting wechseln kann.
 *
 * Es wird bewusst nur Kategorie + Modell vorgegeben. Die konkrete
 * Produkt-ID wird weiterhin im aktiven Produktstamm gesucht. Dadurch
 * bleibt die Zuordnung korrekt, auch wenn Produkt-IDs später bereinigt
 * oder zusammengeführt werden.
 */
const SALES_ARTICLE_OVERRIDES = Object.freeze({
  '23': Object.freeze({ category: 'PS4', modelKey: 'PS4 PRO 1TB', note: 'Bestehendes PS4-Pro-Listing' }),
  '64': Object.freeze({ category: 'PS4', modelKey: 'PS4 PRO 1TB', note: 'Backmarket PS4 Pro 1TB; Sprachvarianten erlaubt' }),
  '34': Object.freeze({ category: 'XBOX', modelKey: 'XBOX SERIES X 1TB', note: 'Xbox Series X 1TB; Sprachvarianten erlaubt' }),
  '10254-1X CONTROLLER-PS4 PRO-007': Object.freeze({ category: 'PS4', modelKey: 'PS4 PRO 1TB', note: 'PS4-Pro-Paketlisting; Hauptprodukt' }),
  '10010': Object.freeze({ category: 'PS4', modelKey: 'PS4 PRO 1TB', note: 'PS4-Pro-Komponente im Paketverkauf' })
});



/**
 * Zentrale Funktion.
 *
 * Diese Funktion zunächst manuell ausführen:
 *
 * synchronisiereVerkaufsMapping
 */
