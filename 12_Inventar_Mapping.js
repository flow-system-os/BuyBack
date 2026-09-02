/**
 * ============================================================
 * INVENTAR (JTL-ARTIKELSTAMMDATEN) ZU PRODUKT-ID
 * ============================================================
 *
 * Diese Datei gehört zum modularen BuyBack-Apps-Script-Projekt.
 * Alle .gs-Dateien im selben Apps-Script-Projekt teilen sich
 * Funktionen und Konstanten automatisch. Es sind keine Imports nötig.
 *
 * Zweck
 * -----
 * Der Verkaufs-Parser verbindet JEDE JTL-Artikelnummer, die schon einmal
 * verkauft wurde, mit einer Produkt-ID (Verkaufs_Mapping). Der Einkaufs-
 * Parser verbindet jede Einkaufszeile über denselben Modellschlüssel.
 * Es fehlte bisher die dritte Seite: der aktuelle LAGERBESTAND je
 * Produkt-ID. Diese Datei schließt genau diese Lücke - mit den bereits
 * vorhandenen Funktionen, ohne eine neue Erkennungslogik.
 *
 * Warum eine eigene Datei und nicht ein Zusatz in 07_Verkaufs_Mapping.js:
 * Verkaufs_Mapping ist auf JTL-Verkaufsartikel gekeyt, die tatsächlich
 * verkauft wurden. Der Artikelstammdaten-Export enthält dagegen den
 * gesamten Katalog (ca. 6.500 SKUs, die meisten nie verkauft), und der
 * Zustand hängt als Suffix an der Artikelnummer ("11728 - Sehr Gut").
 * Ein nie verkaufter Katalog-Artikel darf die Verkaufs-Velocity nicht
 * verfälschen - deshalb bekommt das Inventar zwei EIGENE Blätter.
 *
 * Wiederverwendete Funktionen (Aufrufreihenfolge wie synchronisiereVerkaufsMapping):
 *   salesCleanText_                 07_Verkaufs_Mapping.js
 *   salesReadExistingMappings_      07_Verkaufs_Mapping.js
 *   salesReadActiveProductIndex_    07_Verkaufs_Mapping.js
 *   salesReadAliasLookup_           07_Verkaufs_Mapping.js
 *   salesReadGrosshaendlerEkKeys_   07_Verkaufs_Mapping.js
 *   salesReadGameTitles_            07_Verkaufs_Mapping.js
 *   salesFindProductById_           07_Verkaufs_Mapping.js
 *   salesFindProductCandidates_     07_Verkaufs_Mapping.js
 *   salesGetOrCreateSheet_          07_Verkaufs_Mapping.js
 *   salesEnsureHeaders_             07_Verkaufs_Mapping.js
 *   salesGetArticleOverride_        07_Verkaufs_Mapping.js / 00_Konfiguration.js
 *   ekNormalizeProductName_         03_EK_Parser.js
 *   productNormalizeAlias_          05_Produktstamm.js
 *   salesIsVideoGame_               08_Verkaufs_Parser.js
 *   salesDetermineCategory_         08_Verkaufs_Parser.js
 *   salesDetectControllerModelKey_  08_Verkaufs_Parser.js
 *   salesExtractModelKey_           08_Verkaufs_Parser.js
 *   salesCanonicalizeModelKey_      08_Verkaufs_Parser.js
 *   parseGermanNumber_              10_Allgemeine_Hilfsfunktionen.js
 *   readAndParseCsv_ / isCsvFile_ / getOrCreateSubfolder_   01_JTL_Import.js
 *
 * Ablauf im Hauptlauf (99_Hauptlauf.js):
 *   ... -> synchronisiereVerkaufsMapping -> synchronisiereInventarMapping -> ...
 *
 * Zwei Startpunkte:
 *   importiereInventarStammdaten()   optional: neueste Artikelstammdaten-CSV
 *                                    aus dem Drive-Ordner in Inventar_Rohdaten
 *                                    laden (analog zu importiereNeueJtlDateien).
 *   synchronisiereInventarMapping()  die eigentliche Zuordnung + Bestandsrollup.
 */


const INVENTAR_MAPPING_CONFIG = Object.freeze({
  /*
   * Optionaler Drive-Ordner mit den JTL-Artikelstammdaten-Exporten.
   * Leer lassen, wenn die CSV manuell in "Inventar_Rohdaten" eingefügt
   * wird. Ist eine ID gesetzt, funktioniert der Import 1:1 wie beim
   * Verkaufsimport (neueste Datei zuerst, danach ins Unterarchiv).
   */
  DRIVE_FOLDER_ID: '1PhQPPbHxKmQNwtj4YLc1HqnzSobjfdoG',
  ARCHIVE_FOLDER_NAME: 'Archiv',

  SOURCE_SHEET_NAME: 'Inventar_Rohdaten',
  MAPPING_SHEET_NAME: 'Inventar_Mapping',
  STOCK_SHEET_NAME: 'Inventar_Bestand',
  LOG_SHEET_NAME: 'Inventar_Mapping_Log',

  /*
   * Kopfzeile des JTL-Artikelstammdaten-Exports. "Zustand" ist KEINE
   * eigene Spalte - JTL hängt ihn als Suffix an die Artikelnummer.
   */
  SOURCE_HEADERS: [
    'Artikelnummer',
    'Artikelname',
    'Auf Lager',
    'In Aufträgen',
    'Verfügbar'
  ],

  /*
   * JTL hängt den Zustand als Suffix " - <Zustand>" an die Artikelnummer.
   * Liste bewusst großzügig: fehlt ein Zustandswort hier, bleibt es Teil
   * der Basis-Artikelnummer und spaltet den Bestand künstlich auf.
   */
  CONDITION_SUFFIXES: [
    'SEHR GUT',
    'GUT',
    'AKZEPTABEL',
    'NEU',
    'NEUWERTIG',
    'WIE NEU',
    'PRÜFEN',
    'PRUEFEN',
    'PRUFEN',
    'DEFEKT',
    'BASTLER',
    'B-WARE',
    'BWARE',
    'RETOURE',
    'GEBRAUCHT',
    'OFFEN',
    'OFFENE VERPACKUNG'
  ],

  /*
   * Marken-Token für die Namens-Konsistenzprüfung (siehe
   * inventarMarken_). Ein Widerspruch (Name sagt "sony", Zielprodukt
   * sagt "bose") ist das stärkste Signal für eine Fehlzuordnung -
   * typischerweise eine in JTL neu vergebene Artikelnummer.
   */
  MARKEN: [
    'sony', 'canon', 'nikon', 'panasonic', 'olympus', 'fujifilm', 'pentax',
    'leica', 'samsung', 'apple', 'huawei', 'xiaomi', 'google', 'oneplus',
    'oppo', 'nokia', 'motorola', 'bose', 'sonos', 'jbl', 'teufel',
    'sennheiser', 'beats', 'marshall', 'microsoft', 'nintendo', 'asus',
    'lenovo', 'gopro', 'dji', 'garmin', 'sandisk', 'avm', 'dymo'
  ],

  MAPPING_HEADERS: [
    'Artikelnummer',
    'Basis-Artikelnummer',
    'Zustand',
    'Artikelname',
    'Auf Lager',
    'In Aufträgen',
    'Verfügbar',
    'Produkt-ID',
    'Join-Quelle',
    'Zuordnungsquelle',
    'Erkannte Kategorie',
    'Erkannter Modellschlüssel',
    'Aktiv',
    'Aktualisiert am',
    'Bemerkung'
  ],

  STOCK_HEADERS: [
    'Produkt-ID',
    'Kategorie',
    'Modellschlüssel',
    'Standardname',
    'Verfügbar',
    'Auf Lager',
    'In Aufträgen',
    'SKU-Anzahl',
    'Zeilen',
    'Join-Quelle',
    'Verfügbarkeit',
    'Aktualisiert am'
  ],

  LOG_HEADERS: [
    'Ausführungszeitpunkt',
    'Inventarzeilen',
    'Automatisch gemappt',
    'Über Verkaufs_Mapping',
    'Über Alias',
    'Über Parser-Pipeline',
    'Spiele / Controller',
    'Unmapped',
    'Produkt-IDs mit Bestand',
    'Status'
  ]
});


/**
 * OPTIONAL: neueste Artikelstammdaten-CSV aus dem Drive-Ordner in das
 * Tabellenblatt "Inventar_Rohdaten" laden. Reihenfolge und Archivierung
 * verhalten sich wie beim Verkaufsimport.
 *
 * Ohne gesetzten DRIVE_FOLDER_ID bricht die Funktion mit einer klaren
 * Anweisung ab (CSV manuell einfügen) - der Hauptlauf ruft nur
 * synchronisiereInventarMapping auf, nicht diesen Import.
 */
function importiereInventarStammdaten() {
  const folderId = INVENTAR_MAPPING_CONFIG.DRIVE_FOLDER_ID;

  if (!folderId) {
    throw new Error(
      'Kein Drive-Ordner für Artikelstammdaten konfiguriert. Entweder ' +
      'INVENTAR_MAPPING_CONFIG.DRIVE_FOLDER_ID setzen oder die CSV manuell ' +
      'in das Tabellenblatt "Inventar_Rohdaten" einfügen (Spalten: ' +
      INVENTAR_MAPPING_CONFIG.SOURCE_HEADERS.join(', ') + ').'
    );
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    console.log('Ein anderer Inventar-Import läuft bereits.');
    return;
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(
      EK_CONFIG.TARGET_SPREADSHEET_ID
    );

    const rawSheet = salesGetOrCreateSheet_(
      spreadsheet,
      INVENTAR_MAPPING_CONFIG.SOURCE_SHEET_NAME
    );
    salesEnsureHeaders_(rawSheet, INVENTAR_MAPPING_CONFIG.SOURCE_HEADERS);

    const folder = DriveApp.getFolderById(folderId);
    const files = folder.getFiles();
    const csvFiles = [];
    while (files.hasNext()) {
      const file = files.next();
      if (isCsvFile_(file)) {
        csvFiles.push(file);
      }
    }

    if (csvFiles.length === 0) {
      console.log('Kein Artikelstammdaten-CSV im Drive-Ordner gefunden.');
      return;
    }

    // Neueste Datei zuerst.
    csvFiles.sort(
      (a, b) => b.getDateCreated().getTime() - a.getDateCreated().getTime()
    );
    const file = csvFiles[0];

    const parsed = readAndParseCsv_(file);
    const rows = parsed.rows || [];
    if (rows.length < 2) {
      throw new Error('Die Artikelstammdaten-CSV enthält keine Datenzeilen.');
    }

    const headerIndex = inventarFindeKopfzeile_(rows);
    if (headerIndex === -1) {
      throw new Error(
        'Kopfzeile nicht gefunden. Erwartete Spalten: ' +
        INVENTAR_MAPPING_CONFIG.SOURCE_HEADERS.join(', ')
      );
    }

    const colMap = inventarSpaltenIndex_(rows[headerIndex]);
    const output = [];
    for (let i = headerIndex + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.every(cell => String(cell || '').trim() === '')) {
        continue;
      }
      const values = INVENTAR_MAPPING_CONFIG.SOURCE_HEADERS.map(header => {
        const idx = colMap[header];
        return idx === undefined ? '' : String(row[idx] === undefined ? '' : row[idx]).trim();
      });
      if (!values[0]) {
        continue;
      }
      output.push(values);
    }

    if (output.length === 0) {
      throw new Error('Unterhalb der Kopfzeile wurden keine Zeilen gefunden.');
    }

    // Rohdaten vollständig ersetzen - der Export ist immer ein Vollstand.
    if (rawSheet.getLastRow() > 1) {
      rawSheet
        .getRange(2, 1, rawSheet.getLastRow() - 1, rawSheet.getLastColumn())
        .clearContent();
    }
    rawSheet
      .getRange(2, 1, output.length, INVENTAR_MAPPING_CONFIG.SOURCE_HEADERS.length)
      .setValues(output);

    try {
      const archive = getOrCreateSubfolder_(
        folder,
        INVENTAR_MAPPING_CONFIG.ARCHIVE_FOLDER_NAME
      );
      file.moveTo(archive);
    } catch (archiveError) {
      console.error(
        'Import ok, Archivierung fehlgeschlagen: ' + archiveError.message
      );
    }

    console.log(
      'Artikelstammdaten importiert: ' + output.length + ' Zeilen aus "' +
      file.getName() + '".'
    );
  } finally {
    lock.releaseLock();
  }
}


/**
 * Hauptfunktion. Nach synchronisiereVerkaufsMapping ausführen, damit die
 * Verkaufs-Mappings aktuell sind. Mehrfach ausführbar - beide
 * Ausgabeblätter werden bei jedem Lauf neu aufgebaut.
 */
function synchronisiereInventarMapping() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Eine andere Inventar-Synchronisierung läuft bereits.');
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(
      EK_CONFIG.TARGET_SPREADSHEET_ID
    );

    const inventorySheet = spreadsheet.getSheetByName(
      INVENTAR_MAPPING_CONFIG.SOURCE_SHEET_NAME
    );
    if (!inventorySheet || inventorySheet.getLastRow() < 2) {
      throw new Error(
        'Das Tabellenblatt "' + INVENTAR_MAPPING_CONFIG.SOURCE_SHEET_NAME +
        '" fehlt oder ist leer. Zuerst importiereInventarStammdaten() ' +
        'ausführen oder die JTL-Artikelstammdaten-CSV dort einfügen ' +
        '(Spalten: ' + INVENTAR_MAPPING_CONFIG.SOURCE_HEADERS.join(', ') + ').'
      );
    }

    const productSheet = spreadsheet.getSheetByName(
      PRODUCT_CONFIG.PRODUCT_SHEET_NAME
    );
    const aliasSheet = spreadsheet.getSheetByName(
      PRODUCT_CONFIG.ALIAS_SHEET_NAME
    );
    const mappingSheet = spreadsheet.getSheetByName(
      SALES_MAPPING_CONFIG.MAPPING_SHEET_NAME
    );
    if (!productSheet || !aliasSheet || !mappingSheet) {
      throw new Error(
        'Produktstamm, Produkt_Alias oder Verkaufs_Mapping fehlt - ' +
        'zuerst synchronisiereVerkaufsMapping ausführen.'
      );
    }

    const rulesSheet = spreadsheet.getSheetByName(
      EK_CONFIG.TARGET_SHEET_RULES
    );
    const gameListSheet = spreadsheet.getSheetByName(
      GAME_LIST_CONFIG.SHEET_NAME
    );
    const mergeSheet = spreadsheet.getSheetByName(
      PRODUCT_MERGE_CONFIG.SHEET_NAME
    );

    const outMapping = salesGetOrCreateSheet_(
      spreadsheet,
      INVENTAR_MAPPING_CONFIG.MAPPING_SHEET_NAME
    );
    const outStock = salesGetOrCreateSheet_(
      spreadsheet,
      INVENTAR_MAPPING_CONFIG.STOCK_SHEET_NAME
    );
    const logSheet = salesGetOrCreateSheet_(
      spreadsheet,
      INVENTAR_MAPPING_CONFIG.LOG_SHEET_NAME
    );

    salesEnsureHeaders_(outMapping, INVENTAR_MAPPING_CONFIG.MAPPING_HEADERS);
    salesEnsureHeaders_(outStock, INVENTAR_MAPPING_CONFIG.STOCK_HEADERS);
    salesEnsureHeaders_(logSheet, INVENTAR_MAPPING_CONFIG.LOG_HEADERS);

    const now = new Date();
    const inventoryRows = inventarLeseRohdaten_(inventorySheet);
    const productIndex = salesReadActiveProductIndex_(productSheet);
    const aliasLookup = salesReadAliasLookup_(aliasSheet);
    const existingSalesMappings = inventarLeseVerkaufsMappingIndex_(mappingSheet);
    const grosshaendlerEkKeys = rulesSheet
      ? salesReadGrosshaendlerEkKeys_(rulesSheet)
      : new Set();
    const gameTitles = gameListSheet
      ? salesReadGameTitles_(gameListSheet)
      : [];

    /*
     * Zusammenführungen (Produkt_Zusammenführung) und die Liste der
     * AKTIVEN Produkt-IDs. Beides schützt vor Zuordnungen auf tote
     * Produkt-IDs: Alias- und Verkaufs-Mapping-Zeilen zeigen noch auf
     * das alte Produkt, nachdem es zusammengeführt/deaktiviert wurde.
     */
    const mergeMap = inventarLeseProduktZusammenfuehrung_(mergeSheet);
    const activeProductIds = inventarLeseAktiveProduktIds_(productSheet);

    /*
     * Sammel-/Vaterzeilen erkennen. JTL exportiert bei Variations-
     * artikeln sowohl die Vaterzeile ("10183") als auch jede
     * Kombination ("10183-Aqua Blau-005", "10259-Xbox One S 1TB-1x
     * Controller-007"). Der Bestand liegt auf den Kombinationen; die
     * Vaterzeile ist nur eine Anzeige-Summe und darf im Rollup NICHT
     * mitgezählt werden. Bisher wurde nur der " - <Zustand>"-Fall
     * abgedeckt, nicht die "-<Variante>"-Kombinationen (Bindestrich
     * ohne umgebende Leerzeichen).
     */
    const alleArtikelnummern = new Set(
      inventoryRows.map(it => it.articleNumber.toUpperCase())
    );
    const skusMitKindern = new Set();
    inventoryRows.forEach(item => {
      if (item.condition) {
        skusMitKindern.add(item.baseSku);
        return;
      }
      const kombiTreffer = item.articleNumber.match(/^(.+?)-\S/);
      if (kombiTreffer) {
        const vaterSku = salesCleanText_(kombiTreffer[1]);
        if (alleArtikelnummern.has(vaterSku.toUpperCase())) {
          skusMitKindern.add(vaterSku);
        }
      }
    });

    const mappingRows = [];
    const stockAccumulator = new Map();
    let viaSalesMapping = 0;
    let viaAlias = 0;
    let viaParser = 0;
    let viaSpecialRule = 0;
    let unmapped = 0;

    inventoryRows.forEach(item => {
      const result = inventarFolgeMergeUndAktiv_(
        inventarZuordneProdukt_(
          item,
          existingSalesMappings,
          aliasLookup,
          productIndex,
          grosshaendlerEkKeys,
          gameTitles
        ),
        mergeMap,
        activeProductIds,
        productIndex
      );

      mappingRows.push([
        item.articleNumber,
        item.baseSku,
        item.condition,
        item.articleName,
        item.onHand,
        item.inOrders,
        item.available,
        result.productId,
        result.joinSource,
        result.assignmentSource,
        result.category,
        result.modelKey,
        result.productId ? 'JA' : 'NEIN',
        now,
        result.note
      ]);

      if (result.joinSource === 'VERKAUFS_MAPPING') viaSalesMapping++;
      else if (result.joinSource === 'ALIAS') viaAlias++;
      else if (result.joinSource === 'PARSER_PIPELINE') viaParser++;
      else if (result.joinSource === 'SONDERREGEL') viaSpecialRule++;
      else unmapped++;

      // Nur echte Produktstamm-IDs (BB......) fließen in den Bestand.
      // Sonderregel-Schlüssel (SPIELE, *_CONTROLLER, Großhändler-Modelle)
      // sind keine Lagerprodukte der Purchase Engine.
      if (!result.productId || result.productId.indexOf(PRODUCT_CONFIG.ID_PREFIX) !== 0) {
        return;
      }

      const skipParent = !item.condition && skusMitKindern.has(item.baseSku);
      if (skipParent) {
        return;
      }

      if (!stockAccumulator.has(result.productId)) {
        const product = salesFindProductById_(productIndex, result.productId);
        stockAccumulator.set(result.productId, {
          productId: result.productId,
          category: product ? product.category : result.category,
          modelKey: product ? product.modelKey : result.modelKey,
          name: product ? (product.standardName || product.modelKey || '') : '',
          available: 0,
          onHand: 0,
          inOrders: 0,
          skus: new Set(),
          rows: 0,
          joinSources: {}
        });
      }

      const acc = stockAccumulator.get(result.productId);
      acc.available += item.available;
      acc.onHand += item.onHand;
      acc.inOrders += item.inOrders;
      acc.skus.add(item.baseSku);
      acc.rows += 1;
      acc.joinSources[result.joinSource] =
        (acc.joinSources[result.joinSource] || 0) + 1;
    });

    inventarErsetzeBlatt_(
      outMapping,
      INVENTAR_MAPPING_CONFIG.MAPPING_HEADERS,
      mappingRows
    );

    const stockRows = [];
    stockAccumulator.forEach(acc => {
      const available = Math.max(0, acc.available);
      const onHand = Math.max(0, acc.onHand);
      const availability = onHand <= 0
        ? 'OUT_OF_STOCK'
        : (available <= 0
            ? 'RESERVIERT'
            : (available <= 1 ? 'LOW_STOCK' : 'VERFUEGBAR'));

      let dominantSource = 'PARSER_PIPELINE';
      let best = -1;
      Object.keys(acc.joinSources).forEach(key => {
        if (acc.joinSources[key] > best) {
          best = acc.joinSources[key];
          dominantSource = key;
        }
      });

      stockRows.push([
        acc.productId,
        acc.category,
        acc.modelKey,
        acc.name,
        available,
        onHand,
        Math.max(0, acc.inOrders),
        acc.skus.size,
        acc.rows,
        dominantSource,
        availability,
        now
      ]);
    });
    inventarErsetzeBlatt_(
      outStock,
      INVENTAR_MAPPING_CONFIG.STOCK_HEADERS,
      stockRows
    );

    logSheet.appendRow([
      now,
      inventoryRows.length,
      viaSalesMapping + viaAlias + viaParser + viaSpecialRule,
      viaSalesMapping,
      viaAlias,
      viaParser,
      viaSpecialRule,
      unmapped,
      stockRows.length,
      'ERFOLGREICH'
    ]);

    console.log(
      [
        'Inventar-Mapping abgeschlossen.',
        'Inventarzeilen: ' + inventoryRows.length + '.',
        'Über Verkaufs_Mapping: ' + viaSalesMapping + '.',
        'Über Alias: ' + viaAlias + '.',
        'Über Parser-Pipeline: ' + viaParser + '.',
        'Spiele/Controller/Großhändler: ' + viaSpecialRule + '.',
        'Unmapped: ' + unmapped + '.',
        'Produkt-IDs mit Bestand: ' + stockRows.length + '.'
      ].join(' ')
    );
  } finally {
    lock.releaseLock();
  }
}


/**
 * Zerlegt die JTL-Artikelnummer in Basis-SKU und Zustand.
 * "11728 - Sehr Gut" -> { baseSku: "11728", condition: "Sehr Gut" }
 * "11728"            -> { baseSku: "11728", condition: "" }
 *
 * JTL legt je Zustand einen eigenen Artikel an; für die Purchase Engine
 * muss der Bestand wieder auf EINE Produkt-ID zusammenfallen (Annika:
 * der Zustand darf die Produktidentität nicht aufspalten).
 */
function inventarZerlegeArtikelnummer_(articleNumber) {
  const cleaned = salesCleanText_(articleNumber);

  // Der Zustand hängt IMMER als " - <Zustand>" (Leerzeichen-Bindestrich-
  // Leerzeichen) am Ende. Ein Bindestrich OHNE umgebende Leerzeichen
  // ("10183-Aqua Blau-005") ist eine JTL-Variationskombination und bleibt
  // Teil der Basis-Artikelnummer.
  const parts = cleaned.split(' - ');
  if (parts.length < 2) {
    return { baseSku: cleaned, condition: '' };
  }
  const rawSuffix = parts[parts.length - 1];
  if (!inventarIstZustandssuffix_(rawSuffix)) {
    return { baseSku: cleaned, condition: '' };
  }
  return {
    baseSku: salesCleanText_(parts.slice(0, -1).join(' - ')),
    condition: salesCleanText_(rawSuffix)
  };
}


/**
 * Prüft, ob ein Suffix eine JTL-Zustandsangabe ist. Tolerant gegen
 * Groß-/Kleinschreibung, angehängte Klammerzusätze ("Neu (OVP)") und
 * Zeichensalat aus Mehrfach-Encoding ("PrÃƒÂ¼fen" statt "Prüfen") -
 * ohne diese Toleranz landet die komplette Zeichenkette als
 * Basis-Artikelnummer und spaltet den Bestand künstlich auf.
 */
function inventarIstZustandssuffix_(suffix) {
  let s = salesCleanText_(suffix).toUpperCase();
  s = s.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return false;

  const asciiOnly = s.replace(/Ü/g, 'UE').replace(/[^A-Z \-]/g, '');
  // "PrÃƒÂ¼fen" -> nach dem Strippen "PRFEN"; "Prüfen"/"Pruefen" ebenfalls abdecken.
  if (/^PR[A-Z]{0,4}FEN$/.test(asciiOnly)) return true;

  const candidates = new Set([s, asciiOnly, asciiOnly.replace(/UE/g, 'U')]);
  for (const c of candidates) {
    if (c && INVENTAR_MAPPING_CONFIG.CONDITION_SUFFIXES.indexOf(c) !== -1) {
      return true;
    }
  }
  return false;
}


/**
 * Ordnet EINE Inventarzeile einer Produkt-ID zu - ausschließlich mit
 * bestehenden Funktionen. Reihenfolge identisch zu
 * synchronisiereVerkaufsMapping, mit einem zusätzlichen ersten Schritt:
 * ein bereits berechnetes Verkaufs-Mapping für die Basis-SKU wird
 * direkt wiederverwendet (ein verkaufter Artikel ist schon gemappt).
 */
function inventarZuordneProdukt_(
  item,
  existingSalesMappings,
  aliasLookup,
  productIndex,
  grosshaendlerEkKeys,
  gameTitles
) {
  const empty = {
    productId: '',
    joinSource: 'UNMAPPED',
    assignmentSource: '',
    category: '',
    modelKey: '',
    note: ''
  };

  // Bei JTL-Variationskombinationen trägt der Name einen generierten
  // Präfix ("Xbox One X/S Variation Gut <echter Name>"); das "X/S"
  // erzwingt sonst fälschlich das X-Modell. Für die ERKENNUNG entfernen,
  // der Rohname bleibt in der Mappingzeile erhalten.
  const nameForParsing = inventarBereinigeVariationsname_(item.articleName);
  const normalizedName = ekNormalizeProductName_(nameForParsing);

  let reuseBlockedNote = '';

  // 0) Bestehendes Verkaufs-Mapping wiederverwenden - ABER nur, wenn der
  //    AKTUELLE Artikelname noch zum damals verkauften Produkt passt.
  //    JTL vergibt Artikelnummern neu; ohne diese Prüfung erbt das
  //    Inventar jede Alt-Fehlzuordnung (real: SKU 10025 "Nintendo Switch
  //    Lite" zeigt im Verkaufs_Mapping auf "Samsung Galaxy S20 FE").
  const existing =
    existingSalesMappings.get(item.baseSku.toUpperCase()) ||
    existingSalesMappings.get(item.articleNumber.toUpperCase());

  if (existing && existing.productId && existing.active !== 'NEIN') {
    const product = salesFindProductById_(productIndex, existing.productId);

    // Ein Videospiel darf NIE ein Hardware-Mapping erben. Kommt vor, wenn
    // die JTL-Artikelnummer früher eine Kamera/Konsole war und jetzt ein
    // Spiel ist (real: SKU 670 "Asterix ... (Nintendo Switch)" zeigt im
    // Verkaufs_Mapping auf ein Kamera-Produkt).
    const istSpiel =
      salesIsVideoGame_(normalizedName, gameTitles) ||
      inventarIstGenerischesSpiel_(normalizedName, item.articleName);

    const konsistenz = istSpiel
      ? { ok: false, hint: 'Spielkontext, kein Hardware-Mapping' }
      : inventarPruefeNamensKonsistenz_(normalizedName, product);

    if (konsistenz.ok) {
      return {
        productId: existing.productId,
        joinSource: 'VERKAUFS_MAPPING',
        assignmentSource: existing.source || existing.status || '',
        category: product ? product.category : existing.category,
        modelKey: product ? product.modelKey : existing.modelKey,
        note: 'Bestehendes Verkaufs-Mapping wiederverwendet' +
          (konsistenz.hint ? ' (' + konsistenz.hint + ')' : '')
      };
    }
    reuseBlockedNote = 'VERKAUFS_MAPPING_NICHT_UEBERNOMMEN: ' + konsistenz.hint;
  }

  // 1) Alias auf den Artikelnamen.
  const normalizedAlias = productNormalizeAlias_(normalizedName);
  const aliasProductId = aliasLookup.get(normalizedAlias);
  if (aliasProductId) {
    const product = salesFindProductById_(productIndex, aliasProductId);
    if (product) {
      return {
        productId: product.productId,
        joinSource: 'ALIAS',
        assignmentSource: 'ALIAS',
        category: product.category,
        modelKey: product.modelKey,
        note: 'Alias-Matching (productNormalizeAlias_)'
      };
    }
  }

  // 2) Videospiel-Sonderregel (gepflegte Titelliste).
  if (salesIsVideoGame_(normalizedName, gameTitles)) {
    return {
      productId: 'SPIELE',
      joinSource: 'SONDERREGEL',
      assignmentSource: 'REGEL_SPIEL',
      category: 'Spiel',
      modelKey: 'SPIEL',
      note: 'Videospiel; nicht kaufrelevant für die Purchase Engine'
    };
  }

  const override = salesGetArticleOverride_(item.baseSku);
  const detectedCategory = override
    ? override.category
    : salesDetermineCategory_(normalizedName);

  // 2b) Generischer Spielkontext ohne Listentreffer: "(Sony PlayStation 4,
  //     2016)", "[PS4]", "pegi". Nur wenn die Konsolenerkennung selbst
  //     bereits UNBEKANNT liefert (dann ist die Plattform nur erwähnt).
  //     Ohne diesen Schutz landen solche Zeilen über den Modell-Fallback
  //     unten auf dem EK einer ganzen Konsole (real: hunderte Zeilen).
  if (
    !override &&
    detectedCategory === 'UNBEKANNT' &&
    inventarIstGenerischesSpiel_(normalizedName, item.articleName)
  ) {
    return {
      productId: 'SPIELE',
      joinSource: 'SONDERREGEL',
      assignmentSource: 'REGEL_SPIEL_GENERISCH',
      category: 'Spiel',
      modelKey: 'SPIEL',
      note: 'Generischer Spielkontext (Plattform nur erwähnt); ' +
        'nicht kaufrelevant für die Purchase Engine'
    };
  }

  // 3) Controller-Sonderregel.
  const controllerModelKey = detectedCategory === 'Controller'
    ? salesDetectControllerModelKey_(normalizedName)
    : '';

  if (controllerModelKey) {
    return {
      productId: controllerModelKey,
      joinSource: 'SONDERREGEL',
      assignmentSource: 'REGEL_CONTROLLER_EK',
      category: 'Controller',
      modelKey: controllerModelKey,
      note: 'Controller-Sonderregel'
    };
  }

  // 4) Modellschlüssel erkennen.
  const detectedModelKey = override
    ? salesCanonicalizeModelKey_(override.modelKey, detectedCategory)
    : salesExtractModelKey_(normalizedName, detectedCategory);

  if (!detectedModelKey) {
    return Object.assign({}, empty, {
      category: detectedCategory,
      note: reuseBlockedNote || 'MODELLSCHLUESSEL_NICHT_ERKANNT'
    });
  }

  // 5) Großhändler-EK-Sonderregel.
  if (grosshaendlerEkKeys.has(salesCleanText_(detectedModelKey).toUpperCase())) {
    return {
      productId: detectedModelKey,
      joinSource: 'SONDERREGEL',
      assignmentSource: 'REGEL_GROSSHAENDLER_EK',
      category: detectedCategory,
      modelKey: detectedModelKey,
      note: 'Großhändler-EK-Regel'
    };
  }

  // 6) Kandidatensuche im aktiven Produktstamm.
  const candidateResult = salesFindProductCandidates_(
    productIndex,
    detectedCategory,
    detectedModelKey
  );

  if (candidateResult.candidates.length === 1) {
    const product = candidateResult.candidates[0];

    // Konsolen-Produkt getroffen, aber der Name ist ein Spielkontext
    // ("Super Mario 3D Land (Nintendo 3DS, 2011)"): salesDetermineCategory_
    // erkennt "Nintendo 3DS" als Konsole und trifft dann per Kategorie+
    // Modell die Konsole selbst. Konsequent aussortieren.
    const konsoleGetroffen = /^(?:PS4|PS5|XBOX|NINTENDO)$/.test(
      String(product.category || '').toUpperCase()
    );
    if (
      !override && konsoleGetroffen &&
      inventarIstGenerischesSpiel_(normalizedName, item.articleName)
    ) {
      return {
        productId: 'SPIELE',
        joinSource: 'SONDERREGEL',
        assignmentSource: 'REGEL_SPIEL_GENERISCH',
        category: 'Spiel',
        modelKey: 'SPIEL',
        note: 'Konsolen-Treffer, aber Spielkontext im Namen'
      };
    }

    // Der Modell-NUR-Fallback (Kategorie+Modell verfehlt, nur der
    // Modellschlüssel traf) ist die Hauptquelle stiller Fehlzuordnungen:
    // ein aus einer Nebenbei-Erwähnung extrahierter Sammelschlüssel
    // ("PS4 500GB") trifft dann irgendein Produkt derselben Modellzeile.
    if (
      !override &&
      candidateResult.source === 'EINDEUTIGER_MODELLSCHLUESSEL'
    ) {
      const guard = inventarPruefeModellFallback_(
        normalizedName, detectedCategory, detectedModelKey, product
      );
      if (!guard.ok) {
        return Object.assign({}, empty, {
          category: detectedCategory,
          modelKey: detectedModelKey,
          note: guard.reason
        });
      }
    }

    return {
      productId: product.productId,
      joinSource: 'PARSER_PIPELINE',
      assignmentSource: override
        ? 'ARTIKELNUMMER_OVERRIDE_' + candidateResult.source
        : candidateResult.source,
      category: product.category,
      modelKey: product.modelKey,
      note: override ? override.note : ''
    };
  }

  const reason = candidateResult.candidates.length > 1
    ? 'MEHRERE_PASSENDE_PRODUKTE'
    : ((candidateResult.inactiveCandidates || []).length > 0
        ? 'PASSENDES_PRODUKT_NUR_INAKTIV'
        : 'KEIN_PASSENDES_PRODUKT_GEFUNDEN');

  return Object.assign({}, empty, {
    category: detectedCategory,
    modelKey: detectedModelKey,
    note: reuseBlockedNote ? reuseBlockedNote + ' | ' + reason : reason
  });
}


/**
 * Räumt den generierten JTL-Variationskombinations-Text auf.
 * JTL setzt "<Vaterbezeichnung> Variation <Zustand> <Kindbezeichnung>"
 * zusammen. Je nach Artikel trägt der verlässliche Produktname mal den
 * TEIL VOR, mal den TEIL NACH "Variation <Zustand>":
 *   "Nintendo 3DS Variation Gut Aqua Blau"            -> "Nintendo 3DS" (Farbe nach)
 *   "Xbox One X/S Variation Gut Xbox One S 1TB-1x..." -> "Xbox One S 1TB-1x..." (Gerät nach)
 * Das "X/S" im Vaterteil würde sonst fälschlich das X-Modell erzwingen.
 */
function inventarBereinigeVariationsname_(name) {
  const m = String(name || '').match(
    /^(.*?)\bVariation\b\s+(?:sehr\s+gut|gut|akzeptabel|neu(?:wertig)?|wie\s+neu|pr[üu]e?fen|defekt|bastler|b-?ware|retoure)\s+(.*)$/i
  );
  if (!m) return name;

  const pre = salesCleanText_(m[1]);
  const post = salesCleanText_(m[2]);

  // Trägt der Teil NACH "Variation <Zustand>" eine echte Geräteangabe
  // (Speichergröße oder Plattform-Modell)? Dann ist er der verlässliche Name.
  const postHatGeraet =
    /\b\d{2,4}\s?gb\b|\b\d\s?tb\b/i.test(post) ||
    /\b(?:xbox\s?one|playstation\s?[45]|ps[45]|nintendo\s+(?:switch|3ds|2ds)|switch\s+(?:lite|oled))\b/i.test(post);
  if (postHatGeraet && post.length >= 3) return post;

  // Sonst ist der Teil VOR "Variation" der Produktname (Farbe/Zubehör danach).
  if (pre.length >= 3) return pre;

  return name;
}


/**
 * Marken-Token aus einem Produkttext - direkt und über eindeutige
 * Produktfamilien (iPhone -> apple, Galaxy -> samsung, ...).
 */
function inventarMarken_(text) {
  const t = ' ' +
    ekNormalizeProductName_(text).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim() +
    ' ';
  const found = new Set();
  INVENTAR_MAPPING_CONFIG.MARKEN.forEach(b => {
    if (t.indexOf(' ' + b + ' ') !== -1) found.add(b);
  });
  if (/ i(?:phone|pad) | apple watch | airpods | macbook | imac /.test(t)) found.add('apple');
  if (/ galaxy /.test(t)) found.add('samsung');
  if (/ pixel /.test(t)) found.add('google');
  if (/ playstation | ps[45] | dualshock | dualsense | psvita | psp | cyber shot | walkman | bravia /.test(t)) found.add('sony');
  if (/ xbox /.test(t)) found.add('microsoft');
  if (/ switch | [23]ds | wii | gameboy | game boy /.test(t)) found.add('nintendo');
  if (/ coolpix | nikkor /.test(t)) found.add('nikon');
  if (/ powershot | ixus | speedlite /.test(t)) found.add('canon');
  if (/ lumix /.test(t)) found.add('panasonic');
  if (/ fritzfon | fritzbox | fritz fon /.test(t)) found.add('avm');
  return found;
}

function inventarMarkenKonflikt_(a, b) {
  if (!a || !b || !a.size || !b.size) return false;
  for (const x of a) if (b.has(x)) return false;
  return true;
}


/**
 * Modellschlüssel auf die "Familie" ohne Speichergröße reduzieren,
 * damit "IPHONE 12 128GB" und "IPHONE 12" gleich zählen.
 */
function inventarModellFamilie_(modelKey) {
  return salesCleanText_(modelKey)
    .toUpperCase()
    .replace(/\b\d+\s?(?:GB|TB|GO)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


/**
 * Konsolen-/Geräte-Sammelschlüssel ohne unterscheidendes Modell
 * ("PS4 500GB", "XBOX 360", "3DS"). Diese dürfen NUR greifen, wenn die
 * Kategorie sie bestätigt - nie über den Modell-nur-Fallback.
 */
function inventarIstKonsolenSammelSchluessel_(modelKey) {
  return /^(?:PS4|PS5|XBOX|NINTENDO|SWITCH|WII|GAMEBOY|GAME BOY|[23]DS|DSI|DS LITE)\b/
    .test(salesCleanText_(modelKey).toUpperCase());
}


/**
 * Erkennt Zeilen, die eine Plattform nur ERWÄHNEN (Videospiel,
 * Zubehör-Listing), unabhängig von der gepflegten Spiele_Titel-Liste.
 * normalizedName ist bereits klein, ohne Klammern/Kommata; deshalb wird
 * zusätzlich der (leicht normalisierte) Rohname geprüft.
 */
function inventarIstGenerischesSpiel_(normalizedName, rawName) {
  const v = ' ' + String(normalizedName || '') + ' ';
  const r = ' ' + String(rawName || '')
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim() + ' ';

  if (
    /\b(?:500|512|825|1000)\s?gb\b|\b1\s?tb\b/.test(r) ||
    /\bkonsole\b|\bconsole\b/.test(r)
  ) {
    return false;
  }

  return (
    /\bpegi\b|\busk\s?\d{1,2}\b/.test(r) ||
    /\[(?:ps[45]|xbox(?: one)?|switch|nintendo|wii)\]/.test(r) ||
    /\((?:fuer |für |for )?(?:sony |microsoft )?(?:playstation|ps[45]|xbox(?: one| series [sx])?|nintendo(?: switch)?|wii(?: u)?)[^)]*\)/.test(r) ||
    /\b(?:sony )?playstation ?[45] ?, ?(?:19|20)\d{2}\b/.test(r) ||
    /\bnintendo switch ?, ?(?:19|20)\d{2}\b/.test(r) ||
    /\b(?:microsoft )?xbox one ?, ?(?:19|20)\d{2}\b/.test(r) ||
    /\bplaystation [45] (?:19|20)\d{2}\b/.test(v) ||
    /\bnintendo switch (?:19|20)\d{2}\b/.test(v)
  );
}


/**
 * Konsistenzprüfung für Schritt 0: passt der AKTUELLE Artikelname noch
 * zum Produkt, auf das das alte Verkaufs-Mapping zeigt?
 */
function inventarPruefeNamensKonsistenz_(normalizedName, product) {
  if (!product) {
    // Ziel nicht (mehr) im Produktindex - inventarFolgeMergeUndAktiv_
    // hinter dieser Zuordnung kümmert sich darum.
    return { ok: true, hint: 'Ziel nicht im aktiven Produktstamm' };
  }

  const detectedCategory = salesDetermineCategory_(normalizedName);
  const rawKey = salesExtractModelKey_(normalizedName, detectedCategory);
  const detectedKey = salesCanonicalizeModelKey_(rawKey, detectedCategory);
  const productKey = product.canonicalModelKey ||
    salesCanonicalizeModelKey_(product.modelKey, product.category);

  if (detectedKey && detectedKey === productKey) {
    return { ok: true, hint: '' };
  }

  const markenName = inventarMarken_(normalizedName);
  const markenProdukt = inventarMarken_(
    product.modelKey + ' ' + (product.standardName || '') + ' ' + product.category
  );
  if (inventarMarkenKonflikt_(markenName, markenProdukt)) {
    return {
      ok: false,
      hint: 'Marke widerspricht (' +
        [...markenName].join('/') + ' vs ' + [...markenProdukt].join('/') + ')'
    };
  }

  if (
    detectedKey &&
    inventarModellFamilie_(detectedKey) === inventarModellFamilie_(productKey)
  ) {
    return { ok: true, hint: 'Familie stimmt' };
  }

  // Plattform im Namen erwähnt, Zielprodukt gehört aber nicht zu dieser
  // Plattform-Hardware -> Widerspruch, auch wenn kein Modellschlüssel
  // erkannt wurde (real: "GTA V Xbox One" zeigt im Verkaufs_Mapping auf
  // eine Kompaktkamera).
  const pc0 = String(product.category || '').toUpperCase();
  const plattform =
    /\bxbox\b/.test(normalizedName) ? 'XBOX' :
    (/\bplaystation\b|\bps[45]\b/.test(normalizedName) ? 'PS' :
      (/\bnintendo\b|\bswitch\b|\bwii\b|\b[23]ds\b/.test(normalizedName) ? 'NINTENDO' : ''));
  if (plattform) {
    const okCat =
      (plattform === 'XBOX' && pc0 === 'XBOX') ||
      (plattform === 'PS' && (pc0 === 'PS4' || pc0 === 'PS5')) ||
      (plattform === 'NINTENDO' && pc0 === 'NINTENDO') ||
      pc0 === 'CONTROLLER' || pc0 === 'SPIEL';
    if (!okCat) {
      return {
        ok: false,
        hint: 'Plattform erwähnt (' + plattform + '), Zielprodukt ' + product.category
      };
    }
  }

  const entscheidend = new Set([
    'PS4', 'PS5', 'XBOX', 'NINTENDO', 'HANDYS + TABLETS', 'AUDIO',
    'KAMERA / SONSTIGE ELEKTRONIK', 'OBJEKTIV', 'CONTROLLER', 'VR'
  ]);
  const dc = String(detectedCategory || '').toUpperCase();
  const pc = String(product.category || '').toUpperCase();
  if (detectedKey && entscheidend.has(dc) && dc !== pc) {
    return {
      ok: false,
      hint: 'Kategorie widerspricht (' + detectedCategory + ' vs ' + product.category + ')'
    };
  }

  if (!detectedKey) {
    return { ok: true, hint: 'Name zu unspezifisch, Mapping beibehalten' };
  }

  return {
    ok: false,
    hint: 'Modell weicht ab (' + detectedKey + ' vs ' + productKey + ')'
  };
}


/**
 * Schutz für den Modell-NUR-Fallback in Schritt 6.
 */
function inventarPruefeModellFallback_(
  normalizedName, detectedCategory, detectedModelKey, product
) {
  if (inventarIstKonsolenSammelSchluessel_(detectedModelKey)) {
    // Ausnahme: ein echtes, speicherloses Konsolen-Listing steht mit der
    // Konsole am Textanfang ("Xbox One 2014 Schwarz", "PlayStation 4 FAT")
    // und ist KEIN Spielkontext - dann darf der Sammelschlüssel greifen.
    const startetMitKonsole =
      /^(?:sony |microsoft |nintendo )?(?:playstation ?[45]|ps[45]|xbox(?: one)?|nintendo (?:switch|wii|[23]ds)|switch|wii)\b/
        .test(String(normalizedName || ''));
    // Zubehör-/Peripherie-Wörter schließen die "echte Konsole"-Ausnahme aus
    // ("Sony PS4 CHARGING", "Sony Move ... PlayStation", "PS4 VR Brille").
    const zubehoerWort =
      /\b(?:charging|ladestation|ladeger|dock|docking|controller|gamepad|move|kamera|camera|vr|brille|headset|kabel|adapter|h(?:ü|ue)lle|tasche|cover|stand|halterung|kopfh(?:ö|oe)rer|fernbedienung|remote|akku|battery|netzteil|skin|sticker|folie)\b/
        .test(String(normalizedName || ''));
    if (
      !startetMitKonsole ||
      zubehoerWort ||
      inventarIstGenerischesSpiel_(normalizedName, normalizedName)
    ) {
      return {
        ok: false,
        reason: 'MODELLFALLBACK_KONSOLEN_SAMMELSCHLUESSEL (' + detectedModelKey + ')'
      };
    }
  }

  const markenName = inventarMarken_(normalizedName);
  const markenProdukt = inventarMarken_(
    product.modelKey + ' ' + (product.standardName || '') + ' ' + product.category
  );
  if (inventarMarkenKonflikt_(markenName, markenProdukt)) {
    return {
      ok: false,
      reason: 'MODELLFALLBACK_MARKENKONFLIKT (' +
        [...markenName].join('/') + ' vs ' + [...markenProdukt].join('/') + ')'
    };
  }

  // Kategorie-Widerspruch nur für Konsolen/VR strikt ahnden - diese
  // Familien dürfen sich nie mischen ("PS4 VR Brille" -> Canon-Kamera,
  // "PS5-Spiel" -> PS4). Kamera/Objektiv-Grenzfälle sind dagegen fast
  // immer Produktstamm-Kategorisierungseigenheiten (PSP unter PS4,
  // Kamera-Kit als "Objektiv") und werden zugelassen.
  const dc = String(detectedCategory || '').toUpperCase();
  const pc = String(product.category || '').toUpperCase();
  const konsolenFamilie = new Set(['PS4', 'PS5', 'XBOX', 'NINTENDO', 'VR']);
  if (dc && pc && dc !== pc && konsolenFamilie.has(dc)) {
    return {
      ok: false,
      reason: 'MODELLFALLBACK_KATEGORIE_WIDERSPRUCH (' +
        detectedCategory + ' vs ' + product.category + ')'
    };
  }

  return { ok: true };
}


/**
 * Liest ausgeführte Zusammenführungen (Produkt_Zusammenführung) als
 * Map alteId -> Ziel-Id (beide GROSS). Ketten (A->B->C) werden aufgelöst.
 */
function inventarLeseProduktZusammenfuehrung_(sheet) {
  const map = new Map();
  if (!sheet || sheet.getLastRow() < 2) return map;

  const values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, PRODUCT_MERGE_CONFIG.HEADERS.length)
    .getDisplayValues();

  values.forEach(row => {
    const from = salesCleanText_(row[0]).toUpperCase();
    const to = salesCleanText_(row[1]).toUpperCase();
    const released = salesCleanText_(row[3]).toUpperCase();
    const status = salesCleanText_(row[5]).toUpperCase();
    if (!from || !to || from === to) return;
    if (status.indexOf('AUSGEF') !== 0 && released !== 'JA') return;
    map.set(from, to);
  });

  map.forEach((to, from) => {
    let cur = to;
    let guard = 0;
    while (map.has(cur) && guard++ < 10) cur = map.get(cur);
    map.set(from, cur);
  });

  return map;
}


/**
 * Liest die IDs aller AKTIVEN Produkte (Spalte "Aktiv" != NEIN).
 */
function inventarLeseAktiveProduktIds_(productSheet) {
  const set = new Set();
  if (!productSheet || productSheet.getLastRow() < 2) return set;

  const values = productSheet
    .getRange(2, 1, productSheet.getLastRow() - 1, PRODUCT_CONFIG.PRODUCT_HEADERS.length)
    .getDisplayValues();

  values.forEach(row => {
    const id = salesCleanText_(row[0]).toUpperCase();
    const active = salesCleanText_(row[5]).toUpperCase();
    if (id && active !== 'NEIN') set.add(id);
  });

  return set;
}


/**
 * Nachbearbeitung jeder Zuordnung: einer ausgeführten Zusammenführung
 * folgen und niemals auf einer inaktiven Produkt-ID stehenbleiben.
 */
function inventarFolgeMergeUndAktiv_(result, mergeMap, activeProductIds, productIndex) {
  if (!result) return result;

  // Fall A: nur ein INAKTIVES Produkt gefunden - wurde es zusammengeführt?
  // ("Xbox One S 1TB" hat kein aktives Produkt mehr, nur das nach
  // BB000285 zusammengeführte BB000302.)
  if (
    !result.productId &&
    /PASSENDES_PRODUKT_NUR_INAKTIV/.test(result.note || '') &&
    result.category && result.modelKey && mergeMap.size
  ) {
    const cr = salesFindProductCandidates_(
      productIndex, result.category, result.modelKey
    );
    const inaktiv = cr.inactiveCandidates || [];
    if (inaktiv.length === 1) {
      const from = String(inaktiv[0].productId).toUpperCase();
      if (mergeMap.has(from)) {
        const target = mergeMap.get(from);
        const p = salesFindProductById_(productIndex, target);
        if (p && (!activeProductIds.size || activeProductIds.has(target))) {
          return {
            productId: target,
            joinSource: 'PARSER_PIPELINE',
            assignmentSource: 'INAKTIV_ZUSAMMENGEFUEHRT',
            category: p.category,
            modelKey: p.modelKey,
            note: 'Nur inaktives Produkt ' + inaktiv[0].productId +
              ' gefunden -> zusammengeführt nach ' + target
          };
        }
      }
    }
    return result;
  }

  if (
    !result.productId ||
    result.productId.indexOf(PRODUCT_CONFIG.ID_PREFIX) !== 0
  ) {
    return result;
  }

  let id = result.productId.toUpperCase();

  if (mergeMap.has(id)) {
    const target = mergeMap.get(id);
    result.note = (result.note ? result.note + ' | ' : '') +
      'Zusammengeführt ' + result.productId + ' -> ' + target;
    result.productId = target;
    id = target;
    const p = salesFindProductById_(productIndex, target);
    if (p) {
      result.category = p.category;
      result.modelKey = p.modelKey;
    }
  }

  if (activeProductIds.size && !activeProductIds.has(id)) {
    const alt = salesFindProductCandidates_(
      productIndex, result.category, result.modelKey
    );
    if (alt.candidates.length === 1) {
      result.note = (result.note ? result.note + ' | ' : '') +
        'Inaktives Ziel (' + id + ') über Kategorie+Modell ersetzt';
      result.productId = alt.candidates[0].productId;
      result.category = alt.candidates[0].category;
      result.modelKey = alt.candidates[0].modelKey;
    } else {
      return {
        productId: '',
        joinSource: 'UNMAPPED',
        assignmentSource: '',
        category: result.category,
        modelKey: result.modelKey,
        note: 'PRODUKT_NUR_INAKTIV (' + id + ')'
      };
    }
  }

  return result;
}


/**
 * Liest "Inventar_Rohdaten" und normalisiert jede Zeile.
 */
function inventarLeseRohdaten_(sheet) {
  const headers = sheet
    .getRange(1, 1, 1, sheet.getLastColumn())
    .getDisplayValues()[0]
    .map(salesCleanText_);

  const idx = name => headers.indexOf(name);
  const articleIdx = idx('Artikelnummer');
  const nameIdx = idx('Artikelname');
  const onHandIdx = idx('Auf Lager');
  const inOrdersIdx = idx('In Aufträgen');
  const availableIdx = idx('Verfügbar');

  if (articleIdx === -1 || nameIdx === -1) {
    throw new Error(
      'Artikelnummer oder Artikelname fehlt in "' +
      INVENTAR_MAPPING_CONFIG.SOURCE_SHEET_NAME + '".'
    );
  }

  const values = sheet
    .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
    .getDisplayValues();

  const rows = [];
  values.forEach(row => {
    const articleNumber = salesCleanText_(row[articleIdx]);
    if (!articleNumber) {
      return;
    }
    const split = inventarZerlegeArtikelnummer_(articleNumber);
    rows.push({
      articleNumber: articleNumber,
      baseSku: split.baseSku,
      condition: split.condition,
      articleName: salesCleanText_(row[nameIdx]),
      onHand: onHandIdx === -1 ? 0 : (parseGermanNumber_(row[onHandIdx]) || 0),
      inOrders: inOrdersIdx === -1 ? 0 : (parseGermanNumber_(row[inOrdersIdx]) || 0),
      available: availableIdx === -1 ? 0 : (parseGermanNumber_(row[availableIdx]) || 0)
    });
  });
  return rows;
}


/**
 * Baut aus Verkaufs_Mapping einen case-insensitiven Index
 * (Artikelnummer in Großschreibung -> Mappinginfo). Nutzt
 * salesReadExistingMappings_ und schlüsselt zusätzlich großgeschrieben um,
 * damit Paket-Artikelnummern wie "10254-1X CONTROLLER-..." zuverlässig
 * treffen.
 */
function inventarLeseVerkaufsMappingIndex_(mappingSheet) {
  const base = salesReadExistingMappings_(mappingSheet);
  const result = new Map();
  base.forEach((value, key) => {
    result.set(String(key).toUpperCase(), value);
  });
  return result;
}


/**
 * Sucht die Kopfzeile in den ersten zehn CSV-Zeilen.
 */
function inventarFindeKopfzeile_(rows) {
  const max = Math.min(rows.length, 10);
  for (let r = 0; r < max; r++) {
    const normalized = rows[r].map(cell =>
      salesCleanText_(cell).toLowerCase()
    );
    const allPresent = INVENTAR_MAPPING_CONFIG.SOURCE_HEADERS.every(header =>
      normalized.indexOf(header.toLowerCase()) !== -1
    );
    if (allPresent) {
      return r;
    }
  }
  return -1;
}


/**
 * normalisierter Spaltenname -> Spaltenindex.
 */
function inventarSpaltenIndex_(headerRow) {
  const map = {};
  headerRow.forEach((cell, index) => {
    const name = salesCleanText_(cell).toLowerCase();
    INVENTAR_MAPPING_CONFIG.SOURCE_HEADERS.forEach(expected => {
      if (name === expected.toLowerCase() && map[expected] === undefined) {
        map[expected] = index;
      }
    });
  });
  return map;
}


/**
 * Schreibt ein Ausgabeblatt komplett neu (Kopf bleibt, Daten ersetzt).
 */
function inventarErsetzeBlatt_(sheet, headers, rows) {
  if (sheet.getLastRow() > 1) {
    sheet
      .getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn())
      .clearContent();
  }
  salesEnsureHeaders_(sheet, headers);
  if (rows.length > 0) {
    sheet
      .getRange(2, 1, rows.length, headers.length)
      .setValues(rows);
  }
}
