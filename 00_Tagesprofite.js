/**
 * ============================================================
 * BUYBACK – TAGESPROFITE MVP
 * ============================================================
 *
 * Erstellt/aktualisiert das Blatt "Tagesprofite" aus:
 * - JTL_Rohdaten
 * - Verkaufs_Mapping
 * - Produktstamm
 * - EK_Normalisiert
 * - EK_Regeln
 *
 * EK-Logik MVP:
 * 1. Controller/Sonderregeln: Fest-EK aus EK_Regeln.
 * 2. Normale Produkte: Durchschnitt der bis zu drei jüngsten gültigen
 *    Einkäufe innerhalb der letzten zwei Monate vor dem Verkaufsdatum.
 * 3. Sind nur zwei Einkäufe vorhanden, wird deren Durchschnitt verwendet.
 * 4. Ist nur ein Einkauf vorhanden, wird dessen EK verwendet.
 * 5. Gibt es im Zweimonatsfenster keinen Einkauf, entsteht ein Prüffall.
 * 6. Offene Fälle werden nicht geschätzt, sondern mit Prüfstatus ausgegeben.
 *
 * Die Funktion ist idempotent: Bereits vorhandene Verkaufszeilen werden
 * anhand eines stabilen Schlüssels aktualisiert statt doppelt angelegt.
 */

const BBP2_CONFIG = Object.freeze({
  // Bei einem nicht an Google Sheets gebundenen Apps-Script-Projekt hier
  // die Tabellen-ID aus der URL eintragen. Beispiel URL:
  // https://docs.google.com/spreadsheets/d/TABELLEN_ID/edit
  SPREADSHEET_ID: '',

  SALES_SHEET: 'JTL_Rohdaten',
  SALES_MAPPING_SHEET: 'Verkaufs_Mapping',
  PRODUCT_SHEET: 'Produktstamm',
  EK_SHEET: 'EK_Normalisiert',
  RULES_SHEET: 'EK_Regeln',
  OUTPUT_SHEET: 'Tagesprofite',
  REVIEW_SHEET: 'Tagesprofite_Prüfung',
  LOG_SHEET: 'Tagesprofite_Log',

  OUTPUT_HEADERS: [
    'Auftragsdatum',
    'Auftragsnummer',
    'Shop',
    'JTL-Artikelnummer',
    'JTL-Bezeichnung',
    'Menge',
    'Gesamt-VK',
    'Gesamt-EK',
    'Rohgewinn',
    'Marge %',
    'EK-Quelle',
    'Einzel-VK',
    'EK je Stück',
    'Produkt-ID / Regelschlüssel',
    'Kategorie',
    'Modellschlüssel',
    'Status',
    'Prüfgrund',
    'Externe Belegnummer',
    'Verkaufsschlüssel',
    'EK-Kaufdatum',
    'Aktualisiert am'
  ],

  REVIEW_HEADERS: [
    'Erstellt am',
    'Verkaufsschlüssel',
    'Auftragsdatum',
    'Auftragsnummer',
    'JTL-Artikelnummer',
    'JTL-Bezeichnung',
    'Produkt-ID / Regelschlüssel',
    'Modellschlüssel',
    'Prüfgrund',
    'Status'
  ],

  LOG_HEADERS: [
    'Ausgeführt am',
    'Verarbeitete Verkaufszeilen',
    'Erfolgreich',
    'Mit Fallback-EK',
    'Prüffälle',
    'Übersprungen',
    'Hinweis'
  ]
});

/**
 * Hauptfunktion: verarbeitet alle Zeilen aus JTL_Rohdaten.
 */
function BBP2_aktualisiereTagesprofite() {
  return bbp2AktualisiereTagesprofiteFuerZeitraum_(null, null);
}

/**
 * Praktische Testfunktion für den 16.07.2026.
 * Kann nach erfolgreichem Test wieder entfernt werden.
 */
function BBP2_testeTagesprofiteAm16072026() {
  const start = new Date(2026, 6, 16, 0, 0, 0);
  const end = new Date(2026, 6, 16, 23, 59, 59);
  return bbp2AktualisiereTagesprofiteFuerZeitraum_(start, end);
}

/**
 * Optional: verarbeitet nur ein bestimmtes Datum.
 * Beispiel im Editor:
 * BBP2_aktualisiereTagesprofiteFuerDatum('16.07.2026')
 */
function BBP2_aktualisiereTagesprofiteFuerDatum(dateText) {
  const date = bbp2ParseDate_(dateText);
  if (!date) {
    throw new Error('Datum nicht erkannt: ' + dateText);
  }

  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
  const end = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
  return bbp2AktualisiereTagesprofiteFuerZeitraum_(start, end);
}

function bbp2AktualisiereTagesprofiteFuerZeitraum_(startDate, endDate) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Eine andere Tagesprofit-Auswertung läuft bereits.');
  }

  try {
    const ss = bbp2GetSpreadsheet_();

    const salesSheet = bbp2RequireSheet_(ss, BBP2_CONFIG.SALES_SHEET);
    const mappingSheet = bbp2RequireSheet_(ss, BBP2_CONFIG.SALES_MAPPING_SHEET);
    const productSheet = bbp2RequireSheet_(ss, BBP2_CONFIG.PRODUCT_SHEET);
    const ekSheet = bbp2RequireSheet_(ss, BBP2_CONFIG.EK_SHEET);
    const rulesSheet = bbp2RequireSheet_(ss, BBP2_CONFIG.RULES_SHEET);

    const outputSheet = bbp2GetOrCreateSheet_(ss, BBP2_CONFIG.OUTPUT_SHEET);
    const reviewSheet = bbp2GetOrCreateSheet_(ss, BBP2_CONFIG.REVIEW_SHEET);
    const logSheet = bbp2GetOrCreateSheet_(ss, BBP2_CONFIG.LOG_SHEET);

    bbp2ResetOutputHeadersIfChanged_(outputSheet, BBP2_CONFIG.OUTPUT_HEADERS);
    bbp2EnsureHeaders_(reviewSheet, BBP2_CONFIG.REVIEW_HEADERS);
    bbp2EnsureHeaders_(logSheet, BBP2_CONFIG.LOG_HEADERS);

    const sales = bbp2ReadTable_(salesSheet);
    const mappings = bbp2ReadTable_(mappingSheet);
    const products = bbp2ReadTable_(productSheet);
    const ekRows = bbp2ReadTable_(ekSheet);
    const ruleRows = bbp2ReadTable_(rulesSheet);

    const mappingByArticle = bbp2BuildSalesMapping_(mappings);
    const productById = bbp2BuildProductIndex_(products);
    const ekByModelKey = bbp2BuildEkIndex_(ekRows);
    const fixedEkByKey = bbp2BuildFixedEkIndex_(ruleRows);
    const existingOutput = bbp2BuildExistingOutputIndex_(outputSheet);

    const outputRows = [];
    const outputUpdates = [];
    const reviewRows = [];

    let processed = 0;
    let success = 0;
    let fallback = 0;
    let review = 0;
    let skipped = 0;
    const chargedEkByOrderAndModel = new Set();

    sales.rows.forEach((row, rowIndex) => {
      const saleDate = bbp2GetDateByAliases_(row, sales.headerMap, [
        'Auftragsdatum', 'Verkaufsdatum', 'Datum'
      ]);

      if (!saleDate) {
        skipped++;
        return;
      }

      if (startDate && saleDate < startDate) return;
      if (endDate && saleDate > endDate) return;

      const articleNo = bbp2GetTextByAliases_(row, sales.headerMap, [
        'Artikelnummer', 'JTL-Artikelnummer', 'Artikel-Nr.', 'Artikel Nr.'
      ]);

      const description = bbp2GetTextByAliases_(row, sales.headerMap, [
        'Bezeichnung (Position)', 'JTL-Bezeichnung', 'Bezeichnung', 'Artikelbezeichnung'
      ]);

      const positionType = bbp2GetTextByAliases_(row, sales.headerMap, [
        'Positionsart', 'Positionstyp', 'Typ'
      ]).toUpperCase();

      // Offensichtliche Nicht-Warenpositionen überspringen.
      if (bbp2IsNonProductPosition_(positionType, description)) {
        skipped++;
        return;
      }

      const orderNo = bbp2GetTextByAliases_(row, sales.headerMap, [
        'Auftragsnummer', 'Auftrag', 'Bestellnummer'
      ]);
      const shop = bbp2GetTextByAliases_(row, sales.headerMap, ['Shop', 'Plattform']);
      const externalNo = bbp2GetTextByAliases_(row, sales.headerMap, [
        'Externe Belegnummer', 'Externe Bestellnummer', 'Marktplatz-Bestellnummer'
      ]);
      const sourceRow = bbp2GetTextByAliases_(row, sales.headerMap, [
        'CSV-Quellzeile', 'Quellzeile', 'Importzeile'
      ]) || String(rowIndex + 2);

      const quantity = bbp2GetNumberByAliases_(row, sales.headerMap, ['Menge', 'Anzahl']);
      const safeQuantity = quantity === null || quantity === 0 ? 1 : quantity;

      const unitVk = bbp2GetNumberByAliases_(row, sales.headerMap, [
        'Einzel-VK', 'Brutto-VK', 'Einzelpreis', 'VK je Stück'
      ]);
      let totalVk = bbp2GetNumberByAliases_(row, sales.headerMap, [
        'Gesamtumsatz', 'Gesamt-VK', 'Gesamtpreis'
      ]);

      if (totalVk === null && unitVk !== null) {
        totalVk = safeQuantity * unitVk;
      }

      const saleKey = bbp2BuildSaleKey_(
        orderNo,
        externalNo,
        articleNo,
        sourceRow,
        saleDate
      );

      processed++;

      let mapping = mappingByArticle[bbp2NormalizeKey_(articleNo)] || null;

      // Sicherheitsnetz: Feste Artikelnummern-Aliasse greifen auch dann,
      // wenn Verkaufs_Mapping noch nicht synchronisiert oder eine alte
      // Mappingzeile deaktiviert ist.
      if (!mapping) {
        mapping = bbp2ResolveArticleOverride_(articleNo, productById);
      }

      let referenceKey = '';
      let productId = '';
      let category = '';
      let modelKey = '';
      let unitEk = null;
      let ekSource = '';
      let ekDate = null;
      let status = '';
      let reason = '';

      if (!mapping) {
        status = 'PRÜFEN';
        reason = 'KEIN_VERKAUFS_MAPPING';
      } else {
        productId = mapping.productId;
        category = mapping.category;
        modelKey = mapping.modelKey;

        // Spiele sind eine feste MVP-Sonderregel mit EK 0 EUR und
        // benötigen keinen Eintrag im Produktstamm.
        const normalizedProductId = bbp2NormalizeKey_(productId);
        const normalizedModel = bbp2NormalizeKey_(modelKey);
        if (normalizedProductId === 'SPIELE' || normalizedModel === 'SPIEL') {
          referenceKey = 'SPIELE';
          productId = 'SPIELE';
          category = category || 'Spiel';
          modelKey = 'SPIEL';
          unitEk = 0;
          ekSource = 'Sonderregel Spiele / EK 0 EUR';
          status = 'OK';
        } else {
        // Sonderregel, z. B. PS4_CONTROLLER.
        const specialKey = bbp2DetectSpecialRuleKey_(mapping);
        if (specialKey) {
          referenceKey = specialKey;
          modelKey = modelKey || specialKey;

          if (Object.prototype.hasOwnProperty.call(fixedEkByKey, specialKey)) {
            unitEk = fixedEkByKey[specialKey];
            ekSource = 'EK_Regeln / Fest-EK';
            status = 'OK';
          } else {
            status = 'PRÜFEN';
            reason = 'FEST_EK_REGEL_FEHLT';
          }
        } else if (productId) {
          referenceKey = productId;
          const product = productById[bbp2NormalizeKey_(productId)] || null;

          if (!product) {
            status = 'PRÜFEN';
            reason = 'PRODUKT_ID_NICHT_IM_PRODUKTSTAMM';
          } else if (product.active === 'NEIN') {
            status = 'PRÜFEN';
            reason = 'PRODUKT_IM_PRODUKTSTAMM_INAKTIV';
          } else {
            category = category || product.category;
            modelKey = product.modelKey || modelKey;

            const ekResult = bbp2SelectEk_(
              ekByModelKey[bbp2NormalizeKey_(modelKey)] || [],
              saleDate
            );

            if (ekResult) {
              unitEk = ekResult.unitEk;
              ekDate = ekResult.date;
              ekSource = ekResult.source;
              status = ekResult.usedFallback ? 'OK_MIT_FALLBACK' : 'OK';
              if (ekResult.usedFallback) fallback++;
            } else {
              status = 'PRÜFEN';
              reason = 'KEIN_GÜLTIGER_EK_GEFUNDEN';
            }
          }
        } else {
          // Mapping kann bei Zubehör statt BB-ID direkt einen Regelschlüssel enthalten.
          const candidateKey = bbp2NormalizeKey_(mapping.modelKey || mapping.ruleKey);
          if (candidateKey && Object.prototype.hasOwnProperty.call(fixedEkByKey, candidateKey)) {
            referenceKey = candidateKey;
            modelKey = candidateKey;
            unitEk = fixedEkByKey[candidateKey];
            ekSource = 'EK_Regeln / Fest-EK';
            status = 'OK';
          } else {
            status = 'PRÜFEN';
            reason = 'MAPPING_OHNE_PRODUKT_ID_ODER_EK_REGEL';
          }
        }
        }
      }

      // Bei Paketaufträgen kann dasselbe Hauptprodukt einmal als bezahlte
      // Paketposition und zusätzlich als 0-EUR-Komponente erscheinen.
      // Der Konsolen-EK wird pro Auftrag und Modell nur einmal belastet.
      if (unitEk !== null && orderNo && modelKey && category !== 'Controller') {
        const orderModelKey = bbp2NormalizeKey_(orderNo + '|' + modelKey);
        if (totalVk === 0 && chargedEkByOrderAndModel.has(orderModelKey)) {
          unitEk = 0;
          ekSource = 'Paketkomponente / EK bereits im Auftrag berücksichtigt';
        } else if (totalVk !== 0) {
          chargedEkByOrderAndModel.add(orderModelKey);
        }
      }

      let totalEk = null;
      let grossProfit = null;
      let margin = null;

      if (unitEk !== null) {
        totalEk = unitEk * safeQuantity;
      }
      if (totalVk !== null && totalEk !== null) {
        grossProfit = totalVk - totalEk;
        margin = totalVk !== 0 ? grossProfit / totalVk : null;
      }

      if (status === 'OK' || status === 'OK_MIT_FALLBACK') {
        success++;
      } else {
        review++;
        reviewRows.push([
          new Date(),
          saleKey,
          saleDate,
          orderNo,
          articleNo,
          description,
          referenceKey || productId || mapping?.ruleKey || '',
          modelKey,
          reason,
          'OFFEN'
        ]);
      }

      const resultRow = [
        saleDate,
        orderNo,
        shop,
        articleNo,
        description,
        safeQuantity,
        totalVk,
        totalEk,
        grossProfit,
        margin,
        ekSource,
        unitVk,
        unitEk,
        referenceKey || productId,
        category,
        modelKey,
        status,
        reason,
        externalNo,
        saleKey,
        ekDate,
        new Date()
      ];

      const existingRowNumber = existingOutput[saleKey];
      if (existingRowNumber) {
        outputUpdates.push({
          rowNumber: existingRowNumber,
          values: resultRow
        });
      } else {
        outputRows.push(resultRow);
      }
    });

    /*
     * Bestehende Zeilen gebündelt in einem einzigen Lese-/Schreibzugriff
     * aktualisieren statt pro Verkaufszeile einzeln. Bei fast 10.000
     * Verkäufen, von denen die meisten bereits im Sheet stehen, führte
     * ein einzelner setValues()-Aufruf pro Zeile sonst zu einem Timeout
     * ("Service Spreadsheets timed out").
     */
    if (outputUpdates.length > 0) {
      const minRow = outputUpdates.reduce(
        (min, update) => Math.min(min, update.rowNumber),
        outputUpdates[0].rowNumber
      );
      const maxRow = outputUpdates.reduce(
        (max, update) => Math.max(max, update.rowNumber),
        outputUpdates[0].rowNumber
      );
      const blockHeight = maxRow - minRow + 1;
      const columnCount = BBP2_CONFIG.OUTPUT_HEADERS.length;

      const updateRange = outputSheet.getRange(
        minRow,
        1,
        blockHeight,
        columnCount
      );

      const block = updateRange.getValues();

      outputUpdates.forEach(update => {
        block[update.rowNumber - minRow] = update.values;
      });

      updateRange.setValues(block);
    }

    if (outputRows.length > 0) {
      outputSheet
        .getRange(
          outputSheet.getLastRow() + 1,
          1,
          outputRows.length,
          BBP2_CONFIG.OUTPUT_HEADERS.length
        )
        .setValues(outputRows);
    }

    // Prüfliste wird pro Lauf neu geschrieben, damit erledigte Fälle verschwinden.
    reviewSheet.clearContents();
    bbp2EnsureHeaders_(reviewSheet, BBP2_CONFIG.REVIEW_HEADERS);
    if (reviewRows.length > 0) {
      reviewSheet
        .getRange(2, 1, reviewRows.length, BBP2_CONFIG.REVIEW_HEADERS.length)
        .setValues(reviewRows);
    }

    logSheet.appendRow([
      new Date(),
      processed,
      success,
      fallback,
      review,
      skipped,
      startDate
        ? 'Zeitraum: ' + bbp2FormatDate_(startDate) + ' bis ' + bbp2FormatDate_(endDate)
        : 'Alle vorhandenen Verkaufszeilen verarbeitet'
    ]);

    bbp2FormatOutput_(outputSheet, reviewSheet, logSheet);

    const message =
      'Tagesprofite abgeschlossen. ' +
      'Verarbeitet: ' + processed +
      ', erfolgreich: ' + success +
      ', davon Fallback: ' + fallback +
      ', Prüffälle: ' + review +
      ', übersprungen: ' + skipped + '.';

    console.log(message);
    try {
      ss.toast(message, 'BuyBack Tagesprofite', 10);
    } catch (toastError) {
      console.log('Toast nicht verfügbar: ' + toastError.message);
    }

    return {
      processed: processed,
      success: success,
      fallback: fallback,
      review: review,
      skipped: skipped
    };
  } finally {
    lock.releaseLock();
  }
}

/**
 * Optional in taeglicherBuyBackDatenlauf() am Ende ergänzen:
 * BBP2_aktualisiereTagesprofite();
 */


function bbp2ResolveArticleOverride_(articleNo, productById) {
  if (typeof SALES_ARTICLE_OVERRIDES === 'undefined') return null;

  const override = SALES_ARTICLE_OVERRIDES[bbp2NormalizeKey_(articleNo)];
  if (!override) return null;

  const wantedModel = bbp2NormalizeKey_(override.modelKey);
  const wantedCategory = bbp2NormalizeKey_(override.category);
  const candidates = [];

  Object.keys(productById).forEach(key => {
    const product = productById[key];
    if (!product || product.active === 'NEIN') return;
    if (bbp2NormalizeKey_(product.modelKey) !== wantedModel) return;

    const productCategory = bbp2NormalizeKey_(product.category);
    if (wantedCategory && productCategory && productCategory !== wantedCategory) return;
    candidates.push(product);
  });

  if (candidates.length !== 1) return null;

  return {
    productId: candidates[0].productId,
    category: override.category || candidates[0].category,
    modelKey: override.modelKey || candidates[0].modelKey,
    ruleKey: '',
    status: 'ARTIKEL_OVERRIDE'
  };
}

function bbp2BuildSalesMapping_(table) {
  const result = {};

  table.rows.forEach(row => {
    const articleNo = bbp2GetTextByAliases_(row, table.headerMap, [
      'JTL-Artikelnummer', 'Artikelnummer'
    ]);
    if (!articleNo) return;

    const active = bbp2GetTextByAliases_(row, table.headerMap, ['Aktiv']).toUpperCase();
    if (active === 'NEIN') return;

    result[bbp2NormalizeKey_(articleNo)] = {
      productId: bbp2GetTextByAliases_(row, table.headerMap, [
        'Produkt-ID', 'Produkt-ID / Regelschlüssel', 'BuyBack-Produkt-ID'
      ]),
      category: bbp2GetTextByAliases_(row, table.headerMap, ['Erkannte Kategorie', 'Kategorie']),
      modelKey: bbp2GetTextByAliases_(row, table.headerMap, [
        'Erkannter Modellschlüssel', 'Modellschlüssel', 'Regelschlüssel'
      ]),
      ruleKey: bbp2GetTextByAliases_(row, table.headerMap, ['Regelschlüssel', 'EK-Regel']),
      status: bbp2GetTextByAliases_(row, table.headerMap, ['Mappingstatus', 'Status'])
    };
  });

  return result;
}

function bbp2BuildProductIndex_(table) {
  const result = {};

  table.rows.forEach(row => {
    const id = bbp2GetTextByAliases_(row, table.headerMap, ['Produkt-ID']);
    if (!id) return;

    result[bbp2NormalizeKey_(id)] = {
      productId: id,
      category: bbp2GetTextByAliases_(row, table.headerMap, ['Kategorie']),
      modelKey: bbp2GetTextByAliases_(row, table.headerMap, ['Modellschlüssel']),
      ekRule: bbp2GetTextByAliases_(row, table.headerMap, ['EK-Regel']),
      active: bbp2GetTextByAliases_(row, table.headerMap, ['Aktiv']).toUpperCase() || 'JA'
    };
  });

  return result;
}

function bbp2BuildEkIndex_(table) {
  const result = {};

  table.rows.forEach((row, index) => {
    const modelKey = bbp2GetTextByAliases_(row, table.headerMap, ['Modellschlüssel']);
    if (!modelKey) return;

    const reviewStatus = bbp2GetTextByAliases_(row, table.headerMap, [
      'Prüfstatus', 'Pruefstatus', 'Status'
    ]).toUpperCase();

    // Nur eindeutig verwendbare EK-Zeilen verwenden.
    if (
      reviewStatus.includes('TO_CHECK') ||
      reviewStatus.includes('PRÜF') ||
      reviewStatus.includes('PRUEF') ||
      reviewStatus.includes('FEHLER')
    ) {
      return;
    }

    const unitEk = bbp2GetNumberByAliases_(row, table.headerMap, [
      'Bereinigter Hauptprodukt-EK',
      'Bereinigter Hauptprodukt EK',
      'Einkaufspreis',
      'EK'
    ]);

    if (unitEk === null || unitEk < 0) return;

    const date = bbp2GetDateByAliases_(row, table.headerMap, [
      'Kaufdatum', 'Einkaufsdatum', 'Datum'
    ]);
    if (!date) return;

    const sourceSheet = bbp2GetTextByAliases_(row, table.headerMap, [
      'Quellblatt', 'Quelle', 'Source Sheet'
    ]);
    const sourceRow = bbp2GetTextByAliases_(row, table.headerMap, [
      'Quellzeile', 'Source Row'
    ]) || String(index + 2);

    const key = bbp2NormalizeKey_(modelKey);
    if (!result[key]) result[key] = [];

    result[key].push({
      unitEk: unitEk,
      date: date,
      source: 'EK_Normalisiert' +
        (sourceSheet ? ' / ' + sourceSheet : '') +
        ' / Zeile ' + sourceRow
    });
  });

  Object.keys(result).forEach(key => {
    result[key].sort((a, b) => a.date - b.date);
  });

  return result;
}

function bbp2BuildFixedEkIndex_(table) {
  // Kein Code-Fallback: Fest-EK-Werte kommen ausschließlich aus aktiven
  // CONTROLLER_EK/ZUBEHOER_EK-Zeilen in EK_Regeln. Fehlt eine Zeile,
  // bleibt der Schlüssel unbesetzt und der Aufrufer markiert den
  // Verkauf als Prüffall (FEST_EK_REGEL_FEHLT), statt einen
  // möglicherweise veralteten Wert stillschweigend zu verwenden.
  const result = {};

  table.rows.forEach(row => {
    const ruleType = bbp2GetTextByAliases_(row, table.headerMap, [
      'Regeltyp', 'Typ'
    ]).toUpperCase();
    const key = bbp2GetTextByAliases_(row, table.headerMap, [
      'Schlüssel', 'Regelschlüssel', 'Key'
    ]).toUpperCase();
    const active = bbp2GetTextByAliases_(row, table.headerMap, ['Aktiv']).toUpperCase();

    if (active === 'NEIN' || !key) return;
    if (ruleType && ruleType !== 'CONTROLLER_EK' && ruleType !== 'ZUBEHOER_EK') return;

    const value = bbp2GetNumberByAliases_(row, table.headerMap, ['Wert', 'Betrag', 'EK']);
    if (value !== null) result[key] = value;
  });

  return result;
}

function bbp2SelectEk_(candidates, saleDate) {
  if (!candidates || candidates.length === 0 || !saleDate) return null;

  // Kalendergenaues Zweimonatsfenster bis einschließlich Verkaufsdatum.
  const windowStart = new Date(saleDate);
  windowStart.setMonth(windowStart.getMonth() - 2);

  const eligible = candidates
    .filter(item => item.date >= windowStart && item.date <= saleDate)
    .sort((a, b) => b.date - a.date)
    .slice(0, 3);

  if (eligible.length === 0) return null;

  const averageEk = eligible.reduce((sum, item) => sum + item.unitEk, 0) / eligible.length;
  const roundedAverageEk = Math.round((averageEk + Number.EPSILON) * 100) / 100;

  const sourceDetails = eligible
    .map(item => item.source + ' (' + bbp2FormatDate_(item.date) + ': ' +
      item.unitEk.toFixed(2).replace('.', ',') + ' EUR)')
    .join(' | ');

  return {
    unitEk: roundedAverageEk,
    // Für die Nachvollziehbarkeit wird das Datum des jüngsten berücksichtigten Einkaufs ausgegeben.
    date: eligible[0].date,
    source: 'Ø aus ' + eligible.length +
      ' Einkauf' + (eligible.length === 1 ? '' : 'en') +
      ' der letzten 2 Monate: ' + sourceDetails,
    usedFallback: false,
    purchaseCount: eligible.length
  };
}

function bbp2DetectSpecialRuleKey_(mapping) {
  const candidates = [mapping.ruleKey, mapping.productId, mapping.modelKey]
    .map(bbp2NormalizeKey_)
    .filter(Boolean);

  return candidates.find(value =>
    value.endsWith('_CONTROLLER') ||
    value === 'PS4_CONTROLLER' ||
    value === 'PS5_CONTROLLER' ||
    value === 'XBOX_ONE_CONTROLLER' ||
    value === 'XBOX_SERIES_CONTROLLER' ||
    value === 'NINTENDO_CONTROLLER'
  ) || '';
}

function bbp2BuildExistingOutputIndex_(sheet) {
  const result = {};
  if (sheet.getLastRow() < 2) return result;

  // Verkaufsschlüssel steht in der neuen Übersicht in Spalte 20.
  const values = sheet
    .getRange(2, 20, sheet.getLastRow() - 1, 1)
    .getDisplayValues();

  values.forEach((row, index) => {
    const key = bbp2CleanText_(row[0]);
    if (key) result[key] = index + 2;
  });

  return result;
}

function bbp2BuildSaleKey_(orderNo, externalNo, articleNo, sourceRow, saleDate) {
  return [
    orderNo || externalNo || 'OHNE_AUFTRAG',
    articleNo || 'OHNE_ARTIKEL',
    sourceRow || 'OHNE_ZEILE',
    Utilities.formatDate(saleDate, Session.getScriptTimeZone(), 'yyyyMMdd')
  ].join('|');
}

function bbp2IsNonProductPosition_(positionType, description) {
  const text = (positionType + ' ' + description).toUpperCase();
  return (
    text.includes('VERSAND') ||
    text.includes('PORTO') ||
    text.includes('ZAHLUNGSART') ||
    text.includes('GUTSCHEIN') ||
    text.includes('RABATT') ||
    text.includes('GEBÜHR') ||
    text.includes('GEBUEHR')
  );
}

function bbp2ReadTable_(sheet) {
  if (sheet.getLastRow() < 1 || sheet.getLastColumn() < 1) {
    return { headers: [], headerMap: {}, rows: [] };
  }

  const values = sheet
    .getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn())
    .getValues();

  const headers = values[0].map(bbp2CleanText_);
  const headerMap = {};
  headers.forEach((header, index) => {
    if (header) headerMap[bbp2NormalizeHeader_(header)] = index;
  });

  return {
    headers: headers,
    headerMap: headerMap,
    rows: values.slice(1)
  };
}

function bbp2GetValueByAliases_(row, headerMap, aliases) {
  for (const alias of aliases) {
    const index = headerMap[bbp2NormalizeHeader_(alias)];
    if (index !== undefined) return row[index];
  }
  return '';
}

function bbp2GetTextByAliases_(row, headerMap, aliases) {
  return bbp2CleanText_(bbp2GetValueByAliases_(row, headerMap, aliases));
}

function bbp2GetNumberByAliases_(row, headerMap, aliases) {
  return bbp2ParseMoney_(bbp2GetValueByAliases_(row, headerMap, aliases));
}

function bbp2GetDateByAliases_(row, headerMap, aliases) {
  return bbp2ParseDate_(bbp2GetValueByAliases_(row, headerMap, aliases));
}

function bbp2ParseMoney_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  let text = String(value)
    .replace(/\s/g, '')
    .replace(/€/g, '')
    .replace(/[^0-9,.-]/g, '');

  if (!text) return null;

  const hasComma = text.includes(',');
  const hasDot = text.includes('.');

  if (hasComma && hasDot) {
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      text = text.replace(/,/g, '');
    }
  } else if (hasComma) {
    text = text.replace(',', '.');
  }

  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function bbp2ParseDate_(value) {
  if (!value) return null;
  if (value instanceof Date && !isNaN(value.getTime())) return value;

  const text = bbp2CleanText_(value);
  if (!text) return null;

  let match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (match) {
    return new Date(
      Number(match[3]),
      Number(match[2]) - 1,
      Number(match[1]),
      Number(match[4] || 0),
      Number(match[5] || 0),
      Number(match[6] || 0)
    );
  }

  const parsed = new Date(text);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function bbp2CleanText_(value) {
  return String(value === null || value === undefined ? '' : value)
    .trim()
    .replace(/\s+/g, ' ');
}

function bbp2NormalizeKey_(value) {
  return bbp2CleanText_(value).toUpperCase();
}

function bbp2NormalizeHeader_(value) {
  return bbp2CleanText_(value)
    .toUpperCase()
    .replace(/Ä/g, 'AE')
    .replace(/Ö/g, 'OE')
    .replace(/Ü/g, 'UE')
    .replace(/ß/g, 'SS')
    .replace(/[^A-Z0-9]/g, '');
}


/**
 * Setzt nur die intern gespeicherte Tabellen-ID zurück.
 */
function BBP2_TagesprofiteTabellenverknuepfungZuruecksetzen() {
  PropertiesService.getScriptProperties().deleteProperty('BUYBACK_SPREADSHEET_ID');
  return 'Gespeicherte Tabellenverknüpfung wurde zurückgesetzt.';
}

/**
 * Liefert zuverlässig die BuyBack-Tabelle.
 * Funktioniert sowohl in einem gebundenen als auch in einem eigenständigen
 * Apps-Script-Projekt.
 */
function bbp2GetSpreadsheet_() {
  const properties = PropertiesService.getScriptProperties();
  const propertyKey = 'BUYBACK_SPREADSHEET_ID';
  const savedId = bbp2CleanText_(properties.getProperty(propertyKey));

  // 1. Bereits erkannte Tabelle verwenden.
  if (savedId) {
    try {
      const savedSpreadsheet = SpreadsheetApp.openById(savedId);
      if (bbp2IsBuyBackSpreadsheet_(savedSpreadsheet)) {
        return savedSpreadsheet;
      }
    } catch (error) {
      // Gespeicherte ID ist nicht mehr erreichbar; automatische Suche folgt.
    }
    properties.deleteProperty(propertyKey);
  }

  // 2. Bei einem gebundenen Projekt die aktive Tabelle verwenden.
  const active = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.getActive();
  if (active && bbp2IsBuyBackSpreadsheet_(active)) {
    properties.setProperty(propertyKey, active.getId());
    return active;
  }

  // 3. Optional fest konfigurierte ID verwenden.
  const configuredId = bbp2CleanText_(BBP2_CONFIG.SPREADSHEET_ID);
  if (configuredId) {
    const configuredSpreadsheet = SpreadsheetApp.openById(configuredId);
    if (!bbp2IsBuyBackSpreadsheet_(configuredSpreadsheet)) {
      throw new Error(
        'Die in BBP2_CONFIG.SPREADSHEET_ID eingetragene Tabelle enthält nicht alle benötigten BuyBack-Blätter.'
      );
    }
    properties.setProperty(propertyKey, configuredSpreadsheet.getId());
    return configuredSpreadsheet;
  }

  // 4. Eigenständiges Apps-Script-Projekt: passende Tabelle automatisch
  //    in Google Drive suchen. Die gefundene ID wird dauerhaft gespeichert.
  const matches = [];
  const files = DriveApp.getFilesByType(MimeType.GOOGLE_SHEETS);

  while (files.hasNext()) {
    const file = files.next();

    try {
      const spreadsheet = SpreadsheetApp.openById(file.getId());
      if (bbp2IsBuyBackSpreadsheet_(spreadsheet)) {
        matches.push({
          id: spreadsheet.getId(),
          name: spreadsheet.getName(),
          spreadsheet: spreadsheet
        });

        // Zwei Treffer reichen, um eine Mehrdeutigkeit festzustellen.
        if (matches.length > 1) break;
      }
    } catch (error) {
      // Nicht lesbare oder fremde Dateien werden übersprungen.
    }
  }

  if (matches.length === 1) {
    properties.setProperty(propertyKey, matches[0].id);
    return matches[0].spreadsheet;
  }

  if (matches.length > 1) {
    throw new Error(
      'Es wurden mehrere Google-Tabellen mit der BuyBack-Struktur gefunden: ' +
      matches.map(function(match) { return match.name; }).join(', ') +
      '. Hinterlege in diesem Fall einmal die richtige ID in BBP2_CONFIG.SPREADSHEET_ID.'
    );
  }

  throw new Error(
    'Es wurde keine Google-Tabelle gefunden, die alle benötigten Blätter enthält: ' +
    BBP2_CONFIG.SALES_SHEET + ', ' +
    BBP2_CONFIG.SALES_MAPPING_SHEET + ', ' +
    BBP2_CONFIG.PRODUCT_SHEET + ', ' +
    BBP2_CONFIG.EK_SHEET + ' und ' +
    BBP2_CONFIG.RULES_SHEET + '.'
  );
}

/**
 * Prüft, ob eine Tabelle die erforderliche BuyBack-Struktur besitzt.
 */
function bbp2IsBuyBackSpreadsheet_(spreadsheet) {
  if (!spreadsheet) return false;

  const requiredSheets = [
    BBP2_CONFIG.SALES_SHEET,
    BBP2_CONFIG.SALES_MAPPING_SHEET,
    BBP2_CONFIG.PRODUCT_SHEET,
    BBP2_CONFIG.EK_SHEET,
    BBP2_CONFIG.RULES_SHEET
  ];

  return requiredSheets.every(function(sheetName) {
    return Boolean(spreadsheet.getSheetByName(sheetName));
  });
}

function bbp2RequireSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Tabellenblatt fehlt: ' + name);
  return sheet;
}

function bbp2GetOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function bbp2ResetOutputHeadersIfChanged_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const current = sheet
      .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length))
      .getDisplayValues()[0]
      .slice(0, headers.length)
      .map(bbp2CleanText_);

    const differs = headers.some((header, index) => current[index] !== header);
    if (differs) {
      // Tagesprofite sind vollständig reproduzierbar. Bei einem geänderten
      // Layout wird das Ergebnisblatt deshalb einmal sauber neu aufgebaut.
      sheet.clearContents();
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }

  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function bbp2EnsureHeaders_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    const current = sheet
      .getRange(1, 1, 1, Math.max(sheet.getLastColumn(), headers.length))
      .getDisplayValues()[0]
      .slice(0, headers.length)
      .map(bbp2CleanText_);

    const differs = headers.some((header, index) => current[index] !== header);
    if (differs) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    }
  }

  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  sheet.setFrozenRows(1);
}

function bbp2FormatOutput_(outputSheet, reviewSheet, logSheet) {
  [outputSheet, reviewSheet, logSheet].forEach(sheet => {
    sheet.setFrozenRows(1);
    if (sheet.getLastColumn() > 0) {
      sheet.autoResizeColumns(1, sheet.getLastColumn());
    }
  });

  if (outputSheet.getLastRow() >= 2) {
    const rowCount = outputSheet.getLastRow() - 1;
    outputSheet.getRange(2, 1, rowCount, 1).setNumberFormat('dd.MM.yyyy HH:mm');
    [7, 8, 9, 12, 13].forEach(column => {
      outputSheet.getRange(2, column, rowCount, 1).setNumberFormat('#,##0.00 [$€-407]');
    });
    outputSheet.getRange(2, 10, rowCount, 1).setNumberFormat('0.00%');
    outputSheet.getRange(2, 21, rowCount, 1).setNumberFormat('dd.MM.yyyy');
    outputSheet.getRange(2, 22, rowCount, 1).setNumberFormat('dd.MM.yyyy HH:mm:ss');
  }
}

function bbp2FormatDate_(date) {
  return Utilities.formatDate(date, Session.getScriptTimeZone(), 'dd.MM.yyyy');
}
