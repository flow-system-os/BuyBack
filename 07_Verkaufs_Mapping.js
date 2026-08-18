/**
 * ============================================================
 * JTL-ARTIKELNUMMER ZU PRODUKT-ID
 * ============================================================
 *
 * Diese Datei gehört zum modularen BuyBack-Apps-Script-Projekt.
 * Alle .gs-Dateien im selben Apps-Script-Projekt teilen sich
 * Funktionen und Konstanten automatisch. Es sind keine Imports nötig.
 */


/**
 * Liefert eine feste Artikelnummer-Zuordnung. Groß-/Kleinschreibung und
 * Leerzeichen werden vereinheitlicht, damit auch Paketartikel stabil sind.
 */
function salesGetArticleOverride_(articleNumber) {
  const key = salesCleanText_(articleNumber).toUpperCase();
  return SALES_ARTICLE_OVERRIDES[key] || null;
}

/**
 * Erzeugt einen konkreten nächsten Arbeitsschritt für das Prüfblatt.
 */
function salesBuildActionStep_(reason, articleNumber, detectedModelKey, candidateResult) {
  if (reason === 'MODELLSCHLUESSEL_NICHT_ERKANNT') {
    return 'Parserregel für die Bezeichnung ergänzen oder Artikelnummer manuell einem Modell zuordnen.';
  }
  if (reason === 'MEHRERE_PASSENDE_PRODUKTE') {
    return 'Eindeutige Produkt-ID in Spalte „Manuelle Produkt-ID“ eintragen und freigeben.';
  }
  if (reason === 'PASSENDES_PRODUKT_NUR_INAKTIV') {
    return 'Produktstamm prüfen: passendes Produkt aktivieren oder auf aktive Ziel-Produkt-ID zusammenführen.';
  }
  if (reason === 'KEIN_PASSENDES_PRODUKT_GEFUNDEN') {
    return 'Produktstamm auf Modell „' + (detectedModelKey || '') + '“ prüfen; fehlendes Produkt anlegen oder Modell-Alias ergänzen.';
  }
  return 'Artikelnummer ' + articleNumber + ' und Produktstamm prüfen.';
}

function synchronisiereVerkaufsMapping() {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Eine andere Verkaufs-Mapping-Synchronisierung läuft bereits.'
    );
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(
      EK_CONFIG.TARGET_SPREADSHEET_ID
    );

    const rawSheet = spreadsheet.getSheetByName(
      SALES_MAPPING_CONFIG.RAW_SHEET_NAME
    );

    const productSheet = spreadsheet.getSheetByName(
      PRODUCT_CONFIG.PRODUCT_SHEET_NAME
    );

const aliasSheet =
    spreadsheet.getSheetByName(
        PRODUCT_CONFIG.ALIAS_SHEET_NAME
    );

if (!aliasSheet) {
    throw new Error(
        'Das Tabellenblatt "Produkt_Alias" wurde nicht gefunden.'
    );
}

    if (!rawSheet) {
      throw new Error(
        'Das Tabellenblatt "JTL_Rohdaten" wurde nicht gefunden.'
      );
    }

    if (!productSheet) {
      throw new Error(
        'Das Tabellenblatt "Produktstamm" wurde nicht gefunden.'
      );
    }

    const rulesSheet = spreadsheet.getSheetByName(
      EK_CONFIG.TARGET_SHEET_RULES
    );

    if (!rulesSheet) {
      throw new Error(
        'Das Tabellenblatt "EK_Regeln" wurde nicht gefunden.'
      );
    }

    const mappingSheet = salesGetOrCreateSheet_(
      spreadsheet,
      SALES_MAPPING_CONFIG.MAPPING_SHEET_NAME
    );

    const reviewSheet = salesGetOrCreateSheet_(
      spreadsheet,
      SALES_MAPPING_CONFIG.REVIEW_SHEET_NAME
    );

    const reviewHistorySheet = salesGetOrCreateSheet_(
      spreadsheet,
      SALES_MAPPING_CONFIG.REVIEW_HISTORY_SHEET_NAME
    );

    const logSheet = salesGetOrCreateSheet_(
      spreadsheet,
      SALES_MAPPING_CONFIG.LOG_SHEET_NAME
    );

    const gameListSheet = salesGetOrCreateSheet_(
      spreadsheet,
      GAME_LIST_CONFIG.SHEET_NAME
    );

    const gameListIsNew =
      gameListSheet.getLastRow() === 0;

    salesEnsureHeaders_(
      gameListSheet,
      GAME_LIST_CONFIG.HEADERS
    );

    if (gameListIsNew) {
      gameListSheet
        .getRange(
          2,
          1,
          GAME_LIST_CONFIG.SEED_ROWS.length,
          GAME_LIST_CONFIG.HEADERS.length
        )
        .setValues(GAME_LIST_CONFIG.SEED_ROWS);
    }

    salesEnsureHeaders_(
      mappingSheet,
      SALES_MAPPING_CONFIG.MAPPING_HEADERS
    );

    salesEnsureHeaders_(
      reviewSheet,
      SALES_MAPPING_CONFIG.REVIEW_HEADERS
    );

    salesEnsureHeaders_(
      reviewHistorySheet,
      SALES_MAPPING_CONFIG.REVIEW_HISTORY_HEADERS
    );

    salesEnsureHeaders_(
      logSheet,
      SALES_MAPPING_CONFIG.LOG_HEADERS
    );

    const now = new Date();

    const salesProducts = salesReadUniqueJtlProducts_(
      rawSheet
    );

    const productIndex = salesReadActiveProductIndex_(
      productSheet
    );
const aliasLookup =
    salesReadAliasLookup_(
        aliasSheet
    );

    const grosshaendlerEkKeys =
      salesReadGrosshaendlerEkKeys_(
        rulesSheet
      );

    const gameTitles =
      salesReadGameTitles_(
        gameListSheet
      );

    const existingMappings = salesReadExistingMappings_(
      mappingSheet
    );

    const existingReviewItems = salesReadExistingReviewItems_(
      reviewSheet
    );

    const newMappingRows = [];
    const mappingRowUpdates = new Map();
    const newReviewRows = [];

    const mappingLastSeenUpdates = new Map();

    let alreadyMapped = 0;
    let automaticallyMapped = 0;
    let reviewCount = 0;
    let errorCount = 0;

    salesProducts.forEach(salesProduct => {
      try {
        const articleNumber =
          salesProduct.articleNumber;

        const existingMapping =
          existingMappings.get(articleNumber);

        /*
         * Nur ausdrücklich manuelle Zuordnungen sind vor einer
         * automatischen Neubewertung geschützt. Automatische und
         * regelbasierte Mappings werden bei jedem Lauf erneut geprüft,
         * damit verbesserte Erkennungsregeln alte Fehlzuordnungen
         * selbstständig korrigieren können.
         */
        if (salesIsProtectedManualMapping_(existingMapping)) {
          alreadyMapped++;
          mappingLastSeenUpdates.set(existingMapping.rowNumber, now);
          return;
        }

        const normalizedSalesName =
          ekNormalizeProductName_(
            salesProduct.description
          );
const normalizedAlias =
    productNormalizeAlias_(normalizedSalesName);

const aliasProductId =
    aliasLookup.get(normalizedAlias);

if (aliasProductId) {

    const product =
        salesFindProductById_(
            productIndex,
            aliasProductId
        );

    if (product) {

        salesQueueMappingRow_(
            existingMapping,
            [
                articleNumber,
                salesProduct.description,
                normalizedSalesName,
                product.category,
                product.modelKey,
                product.productId,
                'AUTOMATISCH_GEMAPPT',
                'ALIAS',
                now,
                now,
                'JA',
                'Alias-Matching'
            ],
            newMappingRows,
            mappingRowUpdates
        );

        existingMappings.set(articleNumber, {
            rowNumber: existingMapping?.rowNumber || null,
            productId: product.productId,
            active: 'JA'
        });

        automaticallyMapped++;
        return;
    }
}
        /*
         * Spiele und Controller werden direkt über feste Geschäftsregeln
         * zugeordnet. Dafür ist kein Produktstamm-Treffer erforderlich.
         */
        if (salesIsVideoGame_(normalizedSalesName, gameTitles)) {
          salesQueueMappingRow_(
            existingMapping,
            [
              articleNumber,
              salesProduct.description,
              normalizedSalesName,
              'Spiel',
            'SPIEL',
            'SPIELE',
            'SONDERREGEL_EK_0',
            'REGEL_SPIEL',
            now,
            now,
            'JA',
              'Videospiel; EK wird mit 0 EUR angesetzt'
            ],
            newMappingRows,
            mappingRowUpdates
          );

          existingMappings.set(articleNumber, {
            rowNumber: existingMapping?.rowNumber || null,
            productId: 'SPIELE',
            active: 'JA'
          });

          automaticallyMapped++;
          return;
        }

        const articleOverride = salesGetArticleOverride_(articleNumber);

        const detectedCategory = articleOverride
          ? articleOverride.category
          : salesDetermineCategory_(normalizedSalesName);

        const controllerModelKey =
          detectedCategory === 'Controller'
            ? salesDetectControllerModelKey_(normalizedSalesName)
            : '';

        if (controllerModelKey) {
          salesQueueMappingRow_(
            existingMapping,
            [
            articleNumber,
            salesProduct.description,
            normalizedSalesName,
            'Controller',
            controllerModelKey,
            controllerModelKey,
            'SONDERREGEL_CONTROLLER',
            'REGEL_CONTROLLER_EK',
            now,
            now,
            'JA',
            'Controller-EK wird aus EK_Regeln gelesen'
            ],
            newMappingRows,
            mappingRowUpdates
          );

          existingMappings.set(articleNumber, {
            rowNumber: existingMapping?.rowNumber || null,
            productId: controllerModelKey,
            active: 'JA',
            status: 'SONDERREGEL_CONTROLLER',
            source: 'REGEL_CONTROLLER_EK'
          });

          automaticallyMapped++;
          return;
        }

        const detectedModelKey = articleOverride
          ? salesCanonicalizeModelKey_(
              articleOverride.modelKey,
              detectedCategory
            )
          : salesExtractModelKey_(
              normalizedSalesName,
              detectedCategory
            );

        if (!detectedModelKey) {
          const reviewKey =
            salesCreateReviewKey_(
              articleNumber,
              'MODELLSCHLUESSEL_NICHT_ERKANNT'
            );

          const existingReview =
            existingReviewItems.get(reviewKey);

          salesQueueReviewDeactivation_(
            existingMapping,
            now,
            mappingRowUpdates
          );

          newReviewRows.push([
            now,
            articleNumber,
            salesProduct.description,
            normalizedSalesName,
            detectedCategory,
            '',
            '',
            'MODELLSCHLUESSEL_NICHT_ERKANNT',
            'OFFEN',
            '',
            '',
            '',
            salesBuildActionStep_('MODELLSCHLUESSEL_NICHT_ERKANNT', articleNumber, '', null)
          ]);

          reviewCount++;
          return;
        }

        /*
         * Großhändler-Einkäufe tauchen nie in den normalen Einkaufsdaten
         * auf und haben daher nie ein passendes Produktstamm-Produkt.
         * Annika trägt für solche Fälle den vom Parser bereits erkannten
         * Modellschlüssel manuell als GROSSHAENDLER_EK-Regel in EK_Regeln
         * ein; ab dann wird jeder Verkauf mit genau diesem Schlüssel
         * direkt über den festen Preis abgerechnet statt in die
         * Prüfliste zu laufen (analog zur Controller-Sonderregel oben).
         */
        if (
          grosshaendlerEkKeys.has(
            salesCleanText_(detectedModelKey).toUpperCase()
          )
        ) {
          salesQueueMappingRow_(
            existingMapping,
            [
            articleNumber,
            salesProduct.description,
            normalizedSalesName,
            detectedCategory,
            detectedModelKey,
            detectedModelKey,
            'SONDERREGEL_GROSSHAENDLER',
            'REGEL_GROSSHAENDLER_EK',
            now,
            now,
            'JA',
            'Grosshaendler-EK wird aus EK_Regeln gelesen'
            ],
            newMappingRows,
            mappingRowUpdates
          );

          existingMappings.set(articleNumber, {
            rowNumber: existingMapping?.rowNumber || null,
            productId: detectedModelKey,
            active: 'JA',
            status: 'SONDERREGEL_GROSSHAENDLER',
            source: 'REGEL_GROSSHAENDLER_EK'
          });

          automaticallyMapped++;
          return;
        }

        const candidateResult =
          salesFindProductCandidates_(
            productIndex,
            detectedCategory,
            detectedModelKey
          );

        if (candidateResult.candidates.length === 1) {
          const product =
            candidateResult.candidates[0];

          salesQueueMappingRow_(
            existingMapping,
            [
              articleNumber,
              salesProduct.description,
              normalizedSalesName,
              detectedCategory,
            detectedModelKey,
            product.productId,
            'AUTOMATISCH_GEMAPPT',
            articleOverride ? 'ARTIKELNUMMER_OVERRIDE_' + candidateResult.source : candidateResult.source,
            now,
            now,
            'JA',
              articleOverride ? articleOverride.note : ''
            ],
            newMappingRows,
            mappingRowUpdates
          );

          existingMappings.set(articleNumber, {
            rowNumber: existingMapping?.rowNumber || null,
            productId: product.productId,
            active: 'JA'
          });

          automaticallyMapped++;
          return;
        }

        const reviewReason =
          candidateResult.candidates.length > 1
            ? 'MEHRERE_PASSENDE_PRODUKTE'
            : (candidateResult.inactiveCandidates || []).length > 0
              ? 'PASSENDES_PRODUKT_NUR_INAKTIV'
              : 'KEIN_PASSENDES_PRODUKT_GEFUNDEN';

        const reviewKey =
          salesCreateReviewKey_(
            articleNumber,
            reviewReason
          );

        const existingReview =
          existingReviewItems.get(reviewKey);

        salesQueueReviewDeactivation_(
          existingMapping,
          now,
          mappingRowUpdates
        );

        const displayedCandidates =
          candidateResult.candidates.length > 0
            ? candidateResult.candidates
            : (candidateResult.inactiveCandidates || []);

        const candidateText =
          displayedCandidates
            .map(product =>
              [
                product.productId,
                product.category,
                product.modelKey,
                candidateResult.candidates.length > 0 ? 'AKTIV' : 'INAKTIV'
              ].join(' | ')
            )
            .join(' || ');

        newReviewRows.push([
          now,
          articleNumber,
          salesProduct.description,
          normalizedSalesName,
          detectedCategory,
          detectedModelKey,
          candidateText,
          reviewReason,
          'OFFEN',
          '',
          '',
          '',
          salesBuildActionStep_(reviewReason, articleNumber, detectedModelKey, candidateResult)
        ]);

        reviewCount++;

      } catch (error) {
        console.error(
          `Mappingfehler bei Artikel ${salesProduct.articleNumber}: ` +
          error.message
        );

        errorCount++;
      }
    });

    /*
     * Bestehende automatische Mappings direkt aktualisieren.
     */
    mappingRowUpdates.forEach((rowValues, rowNumber) => {
      mappingSheet
        .getRange(
          rowNumber,
          1,
          1,
          SALES_MAPPING_CONFIG.MAPPING_HEADERS.length
        )
        .setValues([rowValues]);
    });

    /*
     * Neue automatische Mappings gesammelt schreiben.
     */
    if (newMappingRows.length > 0) {
      const firstRow =
        mappingSheet.getLastRow() + 1;

      mappingSheet
        .getRange(
          firstRow,
          1,
          newMappingRows.length,
          SALES_MAPPING_CONFIG.MAPPING_HEADERS.length
        )
        .setValues(newMappingRows);

      salesFormatMappingRows_(
        mappingSheet,
        firstRow,
        newMappingRows.length
      );
    }

    /*
     * Das operative Prüfblatt bildet immer nur den aktuellen Lauf ab.
     * Vorherige Inhalte werden zunächst vollständig im Historienblatt
     * archiviert und anschließend durch die aktuellen Prüffälle ersetzt.
     */
    salesArchiveAndReplaceReviewRows_(
      reviewSheet,
      reviewHistorySheet,
      newReviewRows,
      now
    );

    /*
     * Zuletzt-erkannt-Zeitpunkte aktualisieren.
     */
    mappingLastSeenUpdates.forEach(
      (date, rowNumber) => {
        mappingSheet
          .getRange(rowNumber, 10)
          .setValue(date);
      }
    );

    logSheet.appendRow([
      now,
      salesProducts.length,
      alreadyMapped,
      automaticallyMapped,
      reviewCount,
      errorCount,
      errorCount === 0
        ? 'ERFOLGREICH'
        : 'TEILWEISE_ERFOLGREICH'
    ]);

    console.log(
      [
        'Verkaufs-Mapping abgeschlossen.',
        `Eindeutige JTL-Artikel: ${salesProducts.length}.`,
        `Bereits gemappt: ${alreadyMapped}.`,
        `Neu automatisch gemappt: ${automaticallyMapped}.`,
        `Prüffälle: ${reviewCount}.`,
        `Fehler: ${errorCount}.`
      ].join(' ')
    );

  } finally {
    lock.releaseLock();
  }
}


/**
 * Liest eindeutige Kombinationen aus JTL-Artikelnummer
 * und Verkaufsbezeichnung.
 *
 * Wenn dieselbe Artikelnummer mehrere Bezeichnungen besitzt,
 * wird die zuletzt importierte nichtleere Bezeichnung verwendet.
 */

function salesReadUniqueJtlProducts_(rawSheet) {
  if (rawSheet.getLastRow() < 2) {
    return [];
  }

  const headers = rawSheet
    .getRange(
      1,
      1,
      1,
      rawSheet.getLastColumn()
    )
    .getDisplayValues()[0]
    .map(salesCleanText_);

  const articleNumberIndex =
    headers.indexOf('Artikelnummer');

  const descriptionIndex =
    headers.indexOf('Bezeichnung (Position)');

  const importTimestampIndex =
    headers.indexOf('Importzeitpunkt');

  if (
    articleNumberIndex === -1 ||
    descriptionIndex === -1
  ) {
    throw new Error(
      'Artikelnummer oder Bezeichnung (Position) fehlt in JTL_Rohdaten.'
    );
  }

  const values = rawSheet
    .getRange(
      2,
      1,
      rawSheet.getLastRow() - 1,
      rawSheet.getLastColumn()
    )
    .getDisplayValues();

  const uniqueProducts = new Map();

  values.forEach((row, index) => {
    const articleNumber =
      salesCleanText_(row[articleNumberIndex]);

    const description =
      salesCleanText_(row[descriptionIndex]);

    if (!articleNumber || !description) {
      return;
    }

    const importTimestamp =
      importTimestampIndex !== -1
        ? salesCleanText_(
            row[importTimestampIndex]
          )
        : '';

    /*
     * Spätere Tabellenzeilen überschreiben frühere Bezeichnungen
     * derselben Artikelnummer.
     */
    uniqueProducts.set(articleNumber, {
      articleNumber: articleNumber,
      description: description,
      importTimestamp: importTimestamp,
      sourceRow: index + 2
    });
  });

  return Array.from(uniqueProducts.values());
}


/**
 * Liest nur aktive Produkte aus dem Produktstamm.
 */

function salesReadActiveProductIndex_(productSheet) {
const result = {
  byCategoryAndModel: new Map(),
  byModel: new Map(),
  byProductId: new Map(),
  inactiveByCategoryAndModel: new Map(),
  inactiveByModel: new Map()
};

  if (productSheet.getLastRow() < 2) {
    return result;
  }

  const values = productSheet
    .getRange(
      2,
      1,
      productSheet.getLastRow() - 1,
      PRODUCT_CONFIG.PRODUCT_HEADERS.length
    )
    .getDisplayValues();

  values.forEach((row, index) => {
    const productId =
      salesCleanText_(row[0]);

    const category =
      salesCleanText_(row[1]);

    const originalModelKey = salesCleanText_(row[2]);

    const modelKey =
      salesCanonicalizeModelKey_(originalModelKey, category);

    const active =
      salesCleanText_(row[5])
        .toUpperCase();

    if (!productId || !category || !modelKey) {
      return;
    }

    const product = {
      rowNumber: index + 2,
      productId: productId,
      category: category,
      modelKey: originalModelKey,
      canonicalModelKey: modelKey
    };

result.byProductId.set(
    product.productId,
    product
);

    const compositeKey =
      salesCreateCompositeKey_(
        category,
        modelKey
      );

    if (active === 'NEIN') {
      if (!result.inactiveByCategoryAndModel.has(compositeKey)) {
        result.inactiveByCategoryAndModel.set(compositeKey, []);
      }
      result.inactiveByCategoryAndModel.get(compositeKey).push(product);

      if (!result.inactiveByModel.has(modelKey)) {
        result.inactiveByModel.set(modelKey, []);
      }
      result.inactiveByModel.get(modelKey).push(product);
      return;
    }

    if (!result.byCategoryAndModel.has(compositeKey)) {
      result.byCategoryAndModel.set(
        compositeKey,
        []
      );
    }

    result.byCategoryAndModel
      .get(compositeKey)
      .push(product);

    if (!result.byModel.has(modelKey)) {
      result.byModel.set(modelKey, []);
    }

    result.byModel
      .get(modelKey)
      .push(product);
  });

  return result;
}


/**
 * Sucht zuerst Kategorie + Modellschlüssel.
 *
 * Falls dabei kein Treffer entsteht, wird nur nach dem
 * Modellschlüssel gesucht. Das ist zulässig, wenn dieser
 * im aktiven Produktstamm eindeutig ist.
 */

function salesFindProductCandidates_(
  productIndex,
  detectedCategory,
  detectedModelKey
) {
  const normalizedModelKey =
    salesCanonicalizeModelKey_(detectedModelKey, detectedCategory);

  const compositeKey =
    salesCreateCompositeKey_(
      detectedCategory,
      normalizedModelKey
    );

  const exactCandidates =
    productIndex.byCategoryAndModel.get(
      compositeKey
    ) || [];

  if (exactCandidates.length > 0) {
    return {
      candidates: exactCandidates,
      inactiveCandidates: [],
      source: 'KATEGORIE_UND_MODELLSCHLUESSEL'
    };
  }

  const modelCandidates =
    productIndex.byModel.get(
      normalizedModelKey
    ) || [];

  if (modelCandidates.length > 0) {
    return {
      candidates: modelCandidates,
      inactiveCandidates: [],
      source: 'EINDEUTIGER_MODELLSCHLUESSEL'
    };
  }

  const inactiveExact =
    productIndex.inactiveByCategoryAndModel.get(compositeKey) || [];

  const inactiveByModel =
    productIndex.inactiveByModel.get(normalizedModelKey) || [];

  return {
    candidates: [],
    inactiveCandidates:
      inactiveExact.length > 0 ? inactiveExact : inactiveByModel,
    source:
      (inactiveExact.length > 0 || inactiveByModel.length > 0)
        ? 'NUR_INAKTIVES_PRODUKT_GEFUNDEN'
        : 'KEIN_TREFFER'
  };
}





/**
 * Erkennt manuell gepflegte Mappings. Nur diese werden bei einer
 * automatischen Synchronisierung nicht überschrieben.
 */
function salesIsProtectedManualMapping_(mapping) {
  if (!mapping || !mapping.productId || mapping.active === 'NEIN') {
    return false;
  }

  const status = salesCleanText_(mapping.status).toUpperCase();
  const source = salesCleanText_(mapping.source).toUpperCase();

  return (
    status.includes('MANUELL') ||
    status.includes('FREIGEGEBEN') ||
    source.includes('MANUELL') ||
    source.includes('FREIGEGEBEN')
  );
}


/**
 * Schreibt ein neues Mapping oder ersetzt die vorhandene automatische
 * Zeile. Der ursprüngliche Zeitpunkt "Erstmals erkannt" bleibt erhalten.
 */
function salesQueueMappingRow_(
  existingMapping,
  rowValues,
  newMappingRows,
  mappingRowUpdates
) {
  const finalRow = rowValues.slice();

  if (existingMapping && existingMapping.rowNumber) {
    if (existingMapping.firstSeen) {
      finalRow[8] = existingMapping.firstSeen;
    }

    mappingRowUpdates.set(
      existingMapping.rowNumber,
      finalRow
    );
    return;
  }

  newMappingRows.push(finalRow);
}


/**
 * Deaktiviert eine bisherige automatische Zuordnung, wenn der Artikel
 * nun einen Prüffall bildet. Die bisherige Produkt-ID bleibt zu
 * Dokumentationszwecken sichtbar, wird aber nicht mehr produktiv genutzt.
 */
function salesQueueReviewDeactivation_(
  existingMapping,
  now,
  mappingRowUpdates
) {
  if (
    !existingMapping ||
    !existingMapping.rowNumber ||
    salesIsProtectedManualMapping_(existingMapping)
  ) {
    return;
  }

  mappingRowUpdates.set(
    existingMapping.rowNumber,
    [
      existingMapping.articleNumber || '',
      existingMapping.description || '',
      existingMapping.normalizedDescription || '',
      existingMapping.category || '',
      existingMapping.modelKey || '',
      existingMapping.productId || '',
      'PRUEFUNG_ERFORDERLICH',
      'NEUBEWERTUNG_OHNE_EINDEUTIGEN_TREFFER',
      existingMapping.firstSeen || now,
      now,
      'NEIN',
      'Automatisch deaktiviert; aktueller Fall steht in Mapping_Prüfung_Verkauf'
    ]
  );
}


/**
 * Erkennt eigenständige Videospiele auf der Verkaufsseite.
 * Diese werden mit der Sonderregel SPIELE und EK 0 EUR verarbeitet.
 */

function salesReadExistingMappings_(mappingSheet) {
  const result = new Map();

  if (mappingSheet.getLastRow() < 2) {
    return result;
  }

  const values = mappingSheet
    .getRange(
      2,
      1,
      mappingSheet.getLastRow() - 1,
      SALES_MAPPING_CONFIG.MAPPING_HEADERS.length
    )
    .getDisplayValues();

  values.forEach((row, index) => {
    const articleNumber =
      salesCleanText_(row[0]);

    if (!articleNumber) {
      return;
    }

    result.set(articleNumber, {
      rowNumber: index + 2,
      articleNumber: articleNumber,
      description: salesCleanText_(row[1]),
      normalizedDescription: salesCleanText_(row[2]),
      category: salesCleanText_(row[3]),
      modelKey: salesCleanText_(row[4]),
      productId: salesCleanText_(row[5]),
      status: salesCleanText_(row[6]),
      source: salesCleanText_(row[7]),
      firstSeen: row[8] || '',
      note: salesCleanText_(row[11]),
      active: salesCleanText_(row[10]).toUpperCase()
    });
  });

  return result;
}


/**
 * Liest bestehende offene Verkaufs-Prüffälle.
 */

function salesReadExistingReviewItems_(reviewSheet) {
  const result = new Map();

  if (reviewSheet.getLastRow() < 2) {
    return result;
  }

  const values = reviewSheet
    .getRange(
      2,
      1,
      reviewSheet.getLastRow() - 1,
      SALES_MAPPING_CONFIG.REVIEW_HEADERS.length
    )
    .getDisplayValues();

  values.forEach((row, index) => {
    const articleNumber =
      salesCleanText_(row[1]);

    const reason =
      salesCleanText_(row[7]);

    const status =
      salesCleanText_(row[8])
        .toUpperCase();

    if (
      !articleNumber ||
      !reason ||
      status === 'ERLEDIGT'
    ) {
      return;
    }

    result.set(
      salesCreateReviewKey_(
        articleNumber,
        reason
      ),
      {
        rowNumber: index + 2,
        status: salesCleanText_(row[8]) || 'OFFEN',
        manualProductId: salesCleanText_(row[9]),
        editedBy: salesCleanText_(row[10]),
        editedAt: row[11] || '',
      actionStep: salesCleanText_(row[12])
      }
    );
  });

  return result;
}


/**
 * Erstellt einen eindeutigen Schlüssel für Prüffälle.
 */

function salesCreateReviewKey_(
  articleNumber,
  reason
) {
  return [
    salesCleanText_(articleNumber),
    salesCleanText_(reason).toUpperCase()
  ].join('|');
}


/**
 * Erstellt den Kategorie-/Modellschlüssel.
 */

function salesCreateCompositeKey_(
  category,
  modelKey
) {
  return [
    salesCleanText_(category).toUpperCase(),
    salesCleanText_(modelKey).toUpperCase()
  ].join('|');
}


/**
 * Legt ein fehlendes Tabellenblatt an.
 */

function salesGetOrCreateSheet_(
  spreadsheet,
  sheetName
) {
  return (
    spreadsheet.getSheetByName(sheetName) ||
    spreadsheet.insertSheet(sheetName)
  );
}


/**
 * Erstellt beziehungsweise validiert Kopfzeilen.
 */

function salesEnsureHeaders_(
  sheet,
  expectedHeaders
) {
  if (sheet.getLastRow() === 0) {
    sheet
      .getRange(
        1,
        1,
        1,
        expectedHeaders.length
      )
      .setValues([expectedHeaders])
      .setFontWeight('bold');

    sheet.setFrozenRows(1);

    return;
  }

  const currentHeaders = sheet
    .getRange(
      1,
      1,
      1,
      expectedHeaders.length
    )
    .getDisplayValues()[0]
    .map(salesCleanText_);

  expectedHeaders.forEach(
    (expectedHeader, index) => {
      if (currentHeaders[index] === expectedHeader) {
        return;
      }

      // Neue Spalten am rechten Rand dürfen automatisch ergänzt werden.
      if (!currentHeaders[index]) {
        sheet.getRange(1, index + 1).setValue(expectedHeader).setFontWeight('bold');
        return;
      }

      throw new Error(
        `Unerwartete Kopfzeile in "${sheet.getName()}", ` +
        `Spalte ${index + 1}. Erwartet "${expectedHeader}".`
      );
    }
  );
}


/**
 * Formatiert neue Mappingzeilen.
 */

function salesFormatMappingRows_(
  sheet,
  firstRow,
  rowCount
) {
  if (rowCount <= 0) {
    return;
  }

  sheet
    .getRange(
      firstRow,
      9,
      rowCount,
      2
    )
    .setNumberFormat(
      'dd.MM.yyyy HH:mm:ss'
    );

  sheet
    .getRange(
      firstRow,
      1,
      rowCount,
      1
    )
    .setNumberFormat('@');

  sheet
    .getRange(
      firstRow,
      1,
      rowCount,
      SALES_MAPPING_CONFIG.MAPPING_HEADERS.length
    )
    .setWrap(true);

  sheet.autoResizeColumns(
    1,
    SALES_MAPPING_CONFIG.MAPPING_HEADERS.length
  );
}


/**
 * Archiviert den bisherigen Stand des operativen Prüfblatts und
 * ersetzt ihn vollständig durch die Prüffälle des aktuellen Laufs.
 *
 * Dadurch gilt nach jedem Lauf:
 * Anzahl der Datenzeilen im Prüfblatt = protokollierte Prüffälle.
 */
function salesArchiveAndReplaceReviewRows_(
  reviewSheet,
  reviewHistorySheet,
  currentReviewRows,
  archivedAt
) {
  const columnCount =
    SALES_MAPPING_CONFIG.REVIEW_HEADERS.length;

  const existingRowCount =
    Math.max(reviewSheet.getLastRow() - 1, 0);

  if (existingRowCount > 0) {
    const existingRows = reviewSheet
      .getRange(2, 1, existingRowCount, columnCount)
      .getValues();

    const historyRows = existingRows.map(row => [
      archivedAt,
      ...row
    ]);

    const historyFirstRow =
      reviewHistorySheet.getLastRow() + 1;

    reviewHistorySheet
      .getRange(
        historyFirstRow,
        1,
        historyRows.length,
        SALES_MAPPING_CONFIG.REVIEW_HISTORY_HEADERS.length
      )
      .setValues(historyRows);

    reviewHistorySheet
      .getRange(historyFirstRow, 1, historyRows.length, 2)
      .setNumberFormat('dd.MM.yyyy HH:mm:ss');
  }

  if (reviewSheet.getLastRow() > 1) {
    reviewSheet
      .getRange(
        2,
        1,
        reviewSheet.getLastRow() - 1,
        columnCount
      )
      .clearContent();
  }

  if (currentReviewRows.length === 0) {
    return;
  }

  reviewSheet
    .getRange(
      2,
      1,
      currentReviewRows.length,
      columnCount
    )
    .setValues(currentReviewRows);

  salesFormatReviewRows_(
    reviewSheet,
    2,
    currentReviewRows.length
  );
}


/**
 * Formatiert neue Prüffälle.
 */

function salesFormatReviewRows_(
  sheet,
  firstRow,
  rowCount
) {
  if (rowCount <= 0) {
    return;
  }

  sheet
    .getRange(
      firstRow,
      1,
      rowCount,
      1
    )
    .setNumberFormat(
      'dd.MM.yyyy HH:mm:ss'
    );

  sheet
    .getRange(
      firstRow,
      2,
      rowCount,
      1
    )
    .setNumberFormat('@');

  sheet
    .getRange(
      firstRow,
      1,
      rowCount,
      SALES_MAPPING_CONFIG.REVIEW_HEADERS.length
    )
    .setWrap(true);

  sheet.autoResizeColumns(
    1,
    SALES_MAPPING_CONFIG.REVIEW_HEADERS.length
  );
}


/**
 * Bereinigt technische Leerzeichen.
 */

function salesCleanText_(value) {
  return String(
    value === null || value === undefined
      ? ''
      : value
  )
    .replace(/\u00A0/g, ' ')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}


/**
 * Liest alle aktiven Alias-Zuordnungen.
 *
 * KEY:
 * normalisierter Alias
 *
 * VALUE:
 * Produkt-ID
 */
function salesReadAliasLookup_(aliasSheet) {
  const result = new Map();

  if (aliasSheet.getLastRow() < 2) {
    return result;
  }

  const values = aliasSheet
    .getRange(
      2,
      1,
      aliasSheet.getLastRow() - 1,
      PRODUCT_CONFIG.ALIAS_HEADERS.length
    )
    .getDisplayValues();

  values.forEach(row => {
    const normalizedAlias =
      productNormalizeAlias_(row[1]);

    const productId =
      salesCleanText_(row[2]);

    const active =
      salesCleanText_(row[4]).toUpperCase();

    if (
      !normalizedAlias ||
      !productId ||
      active !== 'JA'
    ) {
      return;
    }

    result.set(normalizedAlias, productId);
  });

  return result;
}


/**
 * Liest alle aktiven GROSSHAENDLER_EK-Schlüssel aus EK_Regeln.
 *
 * KEY:
 * normalisierter (großgeschriebener) Modellschlüssel, wie ihn Annika
 * 1:1 aus der Spalte "Erkannter Modellschlüssel" übernimmt.
 */
function salesReadGrosshaendlerEkKeys_(rulesSheet) {
  const result = new Set();

  if (rulesSheet.getLastRow() < 2) {
    return result;
  }

  const values = rulesSheet
    .getRange(
      2,
      1,
      rulesSheet.getLastRow() - 1,
      8
    )
    .getDisplayValues();

  values.forEach(row => {
    const ruleType =
      salesCleanText_(row[1]).toUpperCase();

    const key =
      salesCleanText_(row[2]).toUpperCase();

    const active =
      salesCleanText_(row[6]).toUpperCase();

    if (
      ruleType !== 'GROSSHAENDLER_EK' ||
      !key ||
      active !== 'JA'
    ) {
      return;
    }

    result.add(key);
  });

  return result;
}


/**
 * Liest alle aktiven Such-Begriffe aus dem Tabellenblatt "Spiele_Titel".
 *
 * Gibt eine Liste bereits kleingeschriebener, getrimmter Begriffe
 * zurück, die salesIsVideoGame_ per einfachem Substring-Abgleich gegen
 * die normalisierte Verkaufsbezeichnung prüft.
 */
function salesReadGameTitles_(gameListSheet) {
  const result = [];

  if (gameListSheet.getLastRow() < 2) {
    return result;
  }

  const values = gameListSheet
    .getRange(
      2,
      1,
      gameListSheet.getLastRow() - 1,
      GAME_LIST_CONFIG.HEADERS.length
    )
    .getDisplayValues();

  values.forEach(row => {
    const term =
      salesCleanText_(row[0]).toLowerCase();

    const active =
      salesCleanText_(row[2]).toUpperCase();

    if (!term || active !== 'JA') {
      return;
    }

    result.push(term);
  });

  return result;
}


/**
 * Liefert ein Produkt anhand der Produkt-ID.
 */
function salesFindProductById_(
  productIndex,
  productId
) {
  return productIndex.byProductId.get(productId) || null;
}