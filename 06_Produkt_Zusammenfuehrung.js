/**
 * ============================================================
 * KONTROLLIERTE PRODUKT-ZUSAMMENFÜHRUNGEN
 * ============================================================
 *
 * Diese Datei gehört zum modularen BuyBack-Apps-Script-Projekt.
 * Alle .gs-Dateien im selben Apps-Script-Projekt teilen sich
 * Funktionen und Konstanten automatisch. Es sind keine Imports nötig.
 */

function fuehreFreigegebeneProdukteZusammen() {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Eine andere Produkt-Zusammenführung läuft bereits.'
    );
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(
      EK_CONFIG.TARGET_SPREADSHEET_ID
    );

    const productSheet = spreadsheet.getSheetByName(
      PRODUCT_CONFIG.PRODUCT_SHEET_NAME
    );

    const aliasSheet = spreadsheet.getSheetByName(
      PRODUCT_CONFIG.ALIAS_SHEET_NAME
    );

    const mergeSheet =
      spreadsheet.getSheetByName(
        PRODUCT_MERGE_CONFIG.SHEET_NAME
      ) ||
      spreadsheet.insertSheet(
        PRODUCT_MERGE_CONFIG.SHEET_NAME
      );

    productMergeEnsureHeaders_(mergeSheet);

    if (!productSheet || !aliasSheet) {
      throw new Error(
        'Produktstamm oder Produkt_Alias wurde nicht gefunden.'
      );
    }

    if (mergeSheet.getLastRow() < 2) {
      console.log(
        'Keine Zusammenführungsregeln vorhanden.'
      );
      return;
    }

    const mergeRows = mergeSheet
      .getRange(
        2,
        1,
        mergeSheet.getLastRow() - 1,
        PRODUCT_MERGE_CONFIG.HEADERS.length
      )
      .getDisplayValues();

    const productMap =
      productMergeReadProductMap_(productSheet);

    let executed = 0;
    let skipped = 0;
    let errors = 0;

    mergeRows.forEach((row, index) => {
      const sheetRow = index + 2;

      const oldProductId =
        productCleanText_(row[0]);

      const targetProductId =
        productCleanText_(row[1]);

      const reason =
        productCleanText_(row[2]);

      const approved =
        productCleanText_(row[3])
          .toUpperCase();

      const existingStatus =
        productCleanText_(row[5])
          .toUpperCase();

      if (
        approved !== 'JA' ||
        existingStatus === 'AUSGEFUEHRT'
      ) {
        skipped++;
        return;
      }

      try {
        if (!oldProductId || !targetProductId) {
          throw new Error(
            'Alte Produkt-ID oder Ziel-Produkt-ID fehlt.'
          );
        }

        if (oldProductId === targetProductId) {
          throw new Error(
            'Alte und neue Produkt-ID sind identisch.'
          );
        }

        const oldProduct =
          productMap.get(oldProductId);

        const targetProduct =
          productMap.get(targetProductId);

        if (!oldProduct) {
          throw new Error(
            `Alte Produkt-ID ${oldProductId} wurde nicht gefunden.`
          );
        }

        if (!targetProduct) {
          throw new Error(
            `Ziel-Produkt-ID ${targetProductId} wurde nicht gefunden.`
          );
        }

        /*
         * Alle Aliase auf die Ziel-ID umstellen.
         */
        productMergeMoveAliases_(
          aliasSheet,
          oldProductId,
          targetProductId
        );

        /*
         * Alte Produkt-ID deaktivieren.
         */
        productSheet
          .getRange(
            oldProduct.rowNumber,
            6
          )
          .setValue('NEIN');

        const currentNote =
          productCleanText_(
            productSheet
              .getRange(
                oldProduct.rowNumber,
                10
              )
              .getDisplayValue()
          );

        const mergeNote = [
          `Zusammengeführt in ${targetProductId}`,
          reason
            ? `Grund: ${reason}`
            : ''
        ]
          .filter(Boolean)
          .join(' | ');

        productSheet
          .getRange(
            oldProduct.rowNumber,
            10
          )
          .setValue(
            currentNote
              ? `${currentNote} | ${mergeNote}`
              : mergeNote
          );

        /*
         * Ausführung protokollieren.
         */
        mergeSheet
          .getRange(
            sheetRow,
            5
          )
          .setValue(new Date());

        mergeSheet
          .getRange(
            sheetRow,
            6
          )
          .setValue('AUSGEFUEHRT');

        executed++;

      } catch (error) {
        mergeSheet
          .getRange(
            sheetRow,
            6
          )
          .setValue(
            `FEHLER: ${error.message}`
          );

        errors++;
      }
    });

    /*
     * Doppelte Aliaszeilen nach allen Zusammenführungen entfernen.
     */
    productMergeRemoveDuplicateAliases_(
      aliasSheet
    );

    console.log(
      [
        'Produkt-Zusammenführung abgeschlossen.',
        `Ausgeführt: ${executed}.`,
        `Übersprungen: ${skipped}.`,
        `Fehler: ${errors}.`
      ].join(' ')
    );

  } finally {
    lock.releaseLock();
  }
}


/**
 * Liest den Produktstamm als Map:
 * Produkt-ID → Zeilennummer und Stammdaten
 */

function productMergeReadProductMap_(
  productSheet
) {
  const result = new Map();

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
      productCleanText_(row[0]);

    if (!productId) {
      return;
    }

    result.set(productId, {
      rowNumber: index + 2,
      category: productCleanText_(row[1]),
      modelKey: productCleanText_(row[2]),
      active: productCleanText_(row[5])
    });
  });

  return result;
}


/**
 * Stellt alle Aliase einer alten Produkt-ID auf die Ziel-ID um.
 *
 * Diese Funktion verändert die Werte gesammelt und schreibt
 * die gesamte Produkt-ID-Spalte in einem einzigen Vorgang zurück.
 * Das ist stabiler als viele einzelne setValue()-Aufrufe.
 */

function productMergeMoveAliases_(
  aliasSheet,
  oldProductId,
  targetProductId
) {
  if (aliasSheet.getLastRow() < 2) {
    return 0;
  }

  const firstDataRow = 2;
  const productIdColumn = 3;
  const rowCount =
    aliasSheet.getLastRow() - 1;

  const range =
    aliasSheet.getRange(
      firstDataRow,
      productIdColumn,
      rowCount,
      1
    );

  const values =
    range.getDisplayValues();

  let changedRows = 0;

  values.forEach(row => {
    const currentProductId =
      productCleanText_(row[0]);

    if (currentProductId !== oldProductId) {
      return;
    }

    row[0] = targetProductId;
    changedRows++;
  });

  if (changedRows > 0) {
    range.setValues(values);
  }

  console.log(
    `${changedRows} Aliaszeilen von ${oldProductId} ` +
    `auf ${targetProductId} umgestellt.`
  );

  return changedRows;
}

/**
 * Entfernt doppelte Alias-Zuordnungen ohne zeilenweises deleteRow().
 *
 * Vorgehen:
 * 1. Alle Aliasdaten lesen.
 * 2. Eindeutige Datensätze im Arbeitsspeicher bilden.
 * 3. Alten Datenbereich einmal leeren.
 * 4. Bereinigte Daten gesammelt zurückschreiben.
 *
 * Eindeutigkeit:
 * normalisierter Alias + Produkt-ID
 */

function productMergeRemoveDuplicateAliases_(
  aliasSheet
) {
  if (aliasSheet.getLastRow() < 2) {
    return 0;
  }

  const columnCount =
    PRODUCT_CONFIG.ALIAS_HEADERS.length;

  const oldRowCount =
    aliasSheet.getLastRow() - 1;

  const values =
    aliasSheet
      .getRange(
        2,
        1,
        oldRowCount,
        columnCount
      )
      .getValues();

  const seen = new Set();
  const cleanedRows = [];

  let removedDuplicates = 0;

  values.forEach(row => {
    const normalizedAlias =
      productNormalizeAlias_(row[1]);

    const productId =
      productCleanText_(row[2]);

    /*
     * Unvollständige Zeilen bleiben zur Nachvollziehbarkeit erhalten.
     * Nur vollständige Alias-/Produkt-ID-Kombinationen werden dedupliziert.
     */
    if (!normalizedAlias || !productId) {
      cleanedRows.push(row);
      return;
    }

    const key =
      `${normalizedAlias}|${productId}`;

    if (seen.has(key)) {
      removedDuplicates++;
      return;
    }

    seen.add(key);
    cleanedRows.push(row);
  });

  /*
   * Alten Alias-Datenbereich gesammelt leeren.
   * Die Kopfzeile in Zeile 1 bleibt bestehen.
   */
  aliasSheet
    .getRange(
      2,
      1,
      oldRowCount,
      columnCount
    )
    .clearContent();

  /*
   * Bereinigte Datensätze gesammelt zurückschreiben.
   */
  if (cleanedRows.length > 0) {
    aliasSheet
      .getRange(
        2,
        1,
        cleanedRows.length,
        columnCount
      )
      .setValues(cleanedRows);

    productFormatAliasRows_(
      aliasSheet,
      2,
      cleanedRows.length
    );
  }

  console.log(
    `${removedDuplicates} doppelte Aliaszeilen entfernt.`
  );

  return removedDuplicates;
}


/**
 * Legt die Kopfzeile für Produkt_Zusammenführung an.
 */

function productMergeEnsureHeaders_(
  mergeSheet
) {
  if (mergeSheet.getLastRow() === 0) {
    mergeSheet
      .getRange(
        1,
        1,
        1,
        PRODUCT_MERGE_CONFIG.HEADERS.length
      )
      .setValues([
        PRODUCT_MERGE_CONFIG.HEADERS
      ])
      .setFontWeight('bold');

    mergeSheet.setFrozenRows(1);
    return;
  }

  const currentHeaders = mergeSheet
    .getRange(
      1,
      1,
      1,
      PRODUCT_MERGE_CONFIG.HEADERS.length
    )
    .getDisplayValues()[0]
    .map(productCleanText_);

  PRODUCT_MERGE_CONFIG.HEADERS.forEach(
    (expectedHeader, index) => {
      if (
        currentHeaders[index] !==
        expectedHeader
      ) {
        throw new Error(
          `Unerwartete Kopfzeile in Produkt_Zusammenführung, ` +
          `Spalte ${index + 1}.`
        );
      }
    }
  );
}


/**
 * ============================================================
 * VERKAUFS-MAPPING
 * ============================================================
 *
 * Ordnet JTL-Artikelnummern dauerhaft den BuyBack-Produkt-IDs zu.
 *
 * Reihenfolge:
 * 1. Bestehendes Mapping anhand der JTL-Artikelnummer verwenden.
 * 2. Neue Verkaufsbezeichnung normalisieren.
 * 3. Kategorie und Modellschlüssel erkennen.
 * 4. Im aktiven Produktstamm nach einem eindeutigen Produkt suchen.
 * 5. Eindeutige Treffer dauerhaft speichern.
 * 6. Unklare Fälle in Mapping_Prüfung_Verkauf schreiben.
 *
 * Das Mapping arbeitet vollständig regelbasiert und ohne KI.
 */

function bereinigeAktuelleDoppelprodukteSicher() {
  const spreadsheet = SpreadsheetApp.openById(
    EK_CONFIG.TARGET_SPREADSHEET_ID
  );

  const productSheet = spreadsheet.getSheetByName(
    PRODUCT_CONFIG.PRODUCT_SHEET_NAME
  );

  const aliasSheet = spreadsheet.getSheetByName(
    PRODUCT_CONFIG.ALIAS_SHEET_NAME
  );

  const mergeSheet = spreadsheet.getSheetByName(
    PRODUCT_MERGE_CONFIG.SHEET_NAME
  );

  if (!productSheet || !aliasSheet || !mergeSheet) {
    throw new Error(
      'Produktstamm, Produkt_Alias oder Produkt_Zusammenführung fehlt.'
    );
  }

  const merges = [
    {
      oldProductId: 'BB000280',
      targetProductId: 'BB000265',
      reason: 'PlayStation Portal doppelt angelegt'
    },
    {
      oldProductId: 'BB000302',
      targetProductId: 'BB000285',
      reason: 'Xbox One S 1TB doppelt angelegt'
    },
    {
      oldProductId: 'BB000345',
      targetProductId: 'BB000300',
      reason: 'PS5 Slim 500GB doppelt angelegt (reale Sony-Hardware gibt es nur als 1TB, ' +
        'die Modellschluessel-Kanonisierung fasst beide Eintraege bereits zusammen)'
    }
  ];

  /*
   * ----------------------------------------------------------
   * PRODUKTSTAMM EINLESEN
   * ----------------------------------------------------------
   */
  const productRowCount =
    Math.max(productSheet.getLastRow() - 1, 0);

  const productValues =
    productRowCount > 0
      ? productSheet
          .getRange(
            2,
            1,
            productRowCount,
            PRODUCT_CONFIG.PRODUCT_HEADERS.length
          )
          .getDisplayValues()
      : [];

  const productRowById = new Map();

  productValues.forEach((row, index) => {
    const productId =
      productCleanText_(row[0]);

    if (productId) {
      productRowById.set(
        productId,
        index + 2
      );
    }
  });

  /*
   * ----------------------------------------------------------
   * ALIASE EINLESEN
   * ----------------------------------------------------------
   */
  const aliasRowCount =
    Math.max(aliasSheet.getLastRow() - 1, 0);

  const aliasValues =
    aliasRowCount > 0
      ? aliasSheet
          .getRange(
            2,
            1,
            aliasRowCount,
            PRODUCT_CONFIG.ALIAS_HEADERS.length
          )
          .getDisplayValues()
      : [];

  /*
   * Spalte E = Aktiv
   *
   * Wir ändern die Werte zuerst nur im Arbeitsspeicher und
   * schreiben anschließend die gesamte Aktiv-Spalte einmal zurück.
   */
  const aliasActiveValues =
    aliasValues.map(row => [
      productCleanText_(row[4]) || 'JA'
    ]);

  let deactivatedProducts = 0;
  let deactivatedAliases = 0;

  merges.forEach(merge => {
    const oldProductRow =
      productRowById.get(
        merge.oldProductId
      );

    const targetProductRow =
      productRowById.get(
        merge.targetProductId
      );

    if (!oldProductRow) {
      throw new Error(
        `Alte Produkt-ID ${merge.oldProductId} wurde nicht gefunden.`
      );
    }

    if (!targetProductRow) {
      throw new Error(
        `Ziel-Produkt-ID ${merge.targetProductId} wurde nicht gefunden.`
      );
    }

    /*
     * Alte Produkt-ID deaktivieren.
     */
    productSheet
      .getRange(oldProductRow, 6)
      .setValue('NEIN');

    const oldNote =
      productCleanText_(
        productSheet
          .getRange(oldProductRow, 10)
          .getDisplayValue()
      );

    const newNote =
      `Zusammengeführt in ${merge.targetProductId}` +
      ` | Grund: ${merge.reason}`;

    productSheet
      .getRange(oldProductRow, 10)
      .setValue(
        oldNote
          ? `${oldNote} | ${newNote}`
          : newNote
      );

    deactivatedProducts++;

    /*
     * Alle Aliase der alten ID deaktivieren.
     *
     * Produkt-ID steht in Spalte C.
     * Aktiv steht in Spalte E.
     */
    aliasValues.forEach((aliasRow, aliasIndex) => {
      const aliasProductId =
        productCleanText_(aliasRow[2]);

      if (
        aliasProductId === merge.oldProductId &&
        productCleanText_(
          aliasActiveValues[aliasIndex][0]
        ).toUpperCase() !== 'NEIN'
      ) {
        aliasActiveValues[aliasIndex][0] =
          'NEIN';

        deactivatedAliases++;
      }
    });
  });

  /*
   * Aktiv-Spalte der Aliase in einem einzigen Vorgang schreiben.
   */
  if (aliasActiveValues.length > 0) {
    aliasSheet
      .getRange(
        2,
        5,
        aliasActiveValues.length,
        1
      )
      .setValues(aliasActiveValues);
  }

  /*
   * ----------------------------------------------------------
   * ZUSAMMENFÜHRUNGSTABELLE AKTUALISIEREN
   * ----------------------------------------------------------
   */
  const mergeRowCount =
    Math.max(mergeSheet.getLastRow() - 1, 0);

  if (mergeRowCount > 0) {
    const mergeValues =
      mergeSheet
        .getRange(
          2,
          1,
          mergeRowCount,
          PRODUCT_MERGE_CONFIG.HEADERS.length
        )
        .getDisplayValues();

    const executedAt = new Date();

    mergeValues.forEach((row, index) => {
      const oldProductId =
        productCleanText_(row[0]);

      const targetProductId =
        productCleanText_(row[1]);

      const matchesCurrentMerge =
        merges.some(merge =>
          merge.oldProductId === oldProductId &&
          merge.targetProductId === targetProductId
        );

      if (!matchesCurrentMerge) {
        return;
      }

      const sheetRow = index + 2;

      mergeSheet
        .getRange(sheetRow, 5)
        .setValue(executedAt);

      mergeSheet
        .getRange(sheetRow, 6)
        .setValue('AUSGEFUEHRT');
    });
  }

  SpreadsheetApp.flush();

  console.log(
    [
      'Sichere Doppelprodukt-Bereinigung abgeschlossen.',
      `Deaktivierte Produkte: ${deactivatedProducts}.`,
      `Deaktivierte Aliase: ${deactivatedAliases}.`
    ].join(' ')
  );
}

/**
 * ============================================================
 * PRÜFUNG INAKTIVER PRODUKTE VOR EINER REAKTIVIERUNG
 * ============================================================
 *
 * Hintergrund:
 * Produkte werden bei einer kontrollierten Zusammenführung bewusst
 * auf "Aktiv = NEIN" gesetzt. Deshalb dürfen inaktive Produkte nicht
 * pauschal reaktiviert werden. Diese Prüfung zeigt je Produkt:
 *
 * - ob ein aktives Produkt mit demselben kanonischen Modell existiert,
 * - ob ein Zusammenführungsvermerk vorhanden ist,
 * - wie viele aktive Aliase noch auf die Produkt-ID zeigen,
 * - wie viele Verkaufsmappings auf die Produkt-ID zeigen,
 * - ob eine Reaktivierung grundsätzlich geprüft werden kann.
 */

const INACTIVE_PRODUCT_AUDIT_CONFIG = Object.freeze({
  SHEET_NAME: 'Prüfung_Inaktive_Produkte',
  HEADERS: [
    'Produkt-ID',
    'Kategorie',
    'Modellschlüssel',
    'Standardname',
    'Bemerkung',
    'Kanonischer Vergleichsschlüssel',
    'Aktive gleichartige Produkte',
    'Aktive Aliase',
    'Verkaufsmappings',
    'Bewertung',
    'Empfehlung',
    'Freigabe Reaktivierung',
    'Bearbeitet am',
    'Status',
    'Ziel-Modellschlüssel',
    'Schlüsseländerung erforderlich'
  ]
});

function pruefeInaktiveProdukteVorReaktivierung() {
  const spreadsheet = SpreadsheetApp.openById(
    EK_CONFIG.TARGET_SPREADSHEET_ID
  );

  const productSheet = spreadsheet.getSheetByName(
    PRODUCT_CONFIG.PRODUCT_SHEET_NAME
  );

  const aliasSheet = spreadsheet.getSheetByName(
    PRODUCT_CONFIG.ALIAS_SHEET_NAME
  );

  const mappingSheet = spreadsheet.getSheetByName(
    SALES_MAPPING_CONFIG.MAPPING_SHEET_NAME
  );

  if (!productSheet) {
    throw new Error('Produktstamm wurde nicht gefunden.');
  }

  const auditSheet =
    spreadsheet.getSheetByName(
      INACTIVE_PRODUCT_AUDIT_CONFIG.SHEET_NAME
    ) || spreadsheet.insertSheet(
      INACTIVE_PRODUCT_AUDIT_CONFIG.SHEET_NAME
    );

  productInactiveEnsureAuditHeaders_(auditSheet);

  const existingApprovals =
    productInactiveReadExistingApprovals_(auditSheet);

  const products = productInactiveReadProducts_(productSheet);
  const aliasCounts = productInactiveCountAliases_(aliasSheet);
  const mappingCounts = productInactiveCountMappings_(mappingSheet);

  const activeByCanonicalKey = new Map();

  products.forEach(product => {
    if (product.active !== 'JA') {
      return;
    }

    const key = productInactiveComparisonKey_(
      product.category,
      product.modelKey
    );

    if (!activeByCanonicalKey.has(key)) {
      activeByCanonicalKey.set(key, []);
    }

    activeByCanonicalKey.get(key).push(product);
  });

  const rows = products
    .filter(product => product.active === 'NEIN')
    .map(product => {
      const comparisonKey = productInactiveComparisonKey_(
        product.category,
        product.modelKey
      );

      const activeEquivalents =
        activeByCanonicalKey.get(comparisonKey) || [];

      const mergeTarget =
        productInactiveExtractMergeTarget_(product.note);

      let evaluation = '';
      let recommendation = '';

      if (mergeTarget) {
        evaluation =
          `Produkt wurde laut Bemerkung in ${mergeTarget} zusammengeführt.`;
        recommendation = 'NICHT_REAKTIVIEREN_ZUSAMMENGEFUEHRT';
      } else if (activeEquivalents.length > 0) {
        evaluation =
          'Mindestens ein aktives Produkt mit gleichem kanonischen Modell vorhanden.';
        recommendation = 'NICHT_REAKTIVIEREN_AKTIVES_DUPLIKAT';
      } else {
        evaluation =
          'Kein aktives gleichartiges Produkt und kein Zusammenführungsvermerk gefunden.';
        recommendation = 'REAKTIVIERUNG_PRUEFEN';
      }

      const approval =
        existingApprovals.get(product.productId) || {};

      const targetModelKey = productInactiveTargetModelKey_(
        product.category,
        product.modelKey
      );

      const keyChangeRequired =
        productCleanText_(targetModelKey).toUpperCase() !==
        productCleanText_(product.modelKey).toUpperCase();

      return [
        product.productId,
        product.category,
        product.modelKey,
        product.standardName,
        product.note,
        comparisonKey,
        activeEquivalents
          .map(item => `${item.productId} | ${item.standardName}`)
          .join(' || '),
        aliasCounts.get(product.productId) || 0,
        mappingCounts.get(product.productId) || 0,
        evaluation,
        recommendation,
        approval.approved || '',
        approval.editedAt || '',
        approval.status || 'OFFEN',
        targetModelKey,
        keyChangeRequired ? 'JA' : 'NEIN'
      ];
    });

  const oldDataRows = Math.max(auditSheet.getLastRow() - 1, 0);

  if (oldDataRows > 0) {
    auditSheet
      .getRange(
        2,
        1,
        oldDataRows,
        INACTIVE_PRODUCT_AUDIT_CONFIG.HEADERS.length
      )
      .clearContent();
  }

  if (rows.length > 0) {
    auditSheet
      .getRange(
        2,
        1,
        rows.length,
        INACTIVE_PRODUCT_AUDIT_CONFIG.HEADERS.length
      )
      .setValues(rows);
  }

  auditSheet.setFrozenRows(1);
  auditSheet.autoResizeColumns(
    1,
    INACTIVE_PRODUCT_AUDIT_CONFIG.HEADERS.length
  );

  console.log(
    `Prüfung inaktiver Produkte abgeschlossen. Inaktive Produkte: ${rows.length}.`
  );
}

/**
 * Reaktiviert ausschließlich explizit freigegebene und weiterhin sichere
 * Datensätze aus dem Prüfblatt. Produkte mit Zusammenführungsvermerk oder
 * aktivem gleichartigem Produkt werden niemals automatisch reaktiviert.
 */
function reaktiviereFreigegebeneInaktiveProdukte() {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error('Eine andere Produktbearbeitung läuft bereits.');
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(
      EK_CONFIG.TARGET_SPREADSHEET_ID
    );

    const productSheet = spreadsheet.getSheetByName(
      PRODUCT_CONFIG.PRODUCT_SHEET_NAME
    );

    const aliasSheet = spreadsheet.getSheetByName(
      PRODUCT_CONFIG.ALIAS_SHEET_NAME
    );

    const auditSheet = spreadsheet.getSheetByName(
      INACTIVE_PRODUCT_AUDIT_CONFIG.SHEET_NAME
    );

    if (!productSheet || !auditSheet) {
      throw new Error(
        'Produktstamm oder Prüfung_Inaktive_Produkte wurde nicht gefunden.'
      );
    }

    if (auditSheet.getLastRow() < 2) {
      console.log('Keine Prüfzeilen vorhanden.');
      return;
    }

    const auditRows = auditSheet
      .getRange(
        2,
        1,
        auditSheet.getLastRow() - 1,
        INACTIVE_PRODUCT_AUDIT_CONFIG.HEADERS.length
      )
      .getDisplayValues();

    const productMap = productMergeReadProductMap_(productSheet);
    const now = new Date();

    let reactivated = 0;
    let skipped = 0;

    auditRows.forEach((row, index) => {
      const productId = productCleanText_(row[0]);
      const recommendation = productCleanText_(row[10]).toUpperCase();
      const approved = productCleanText_(row[11]).toUpperCase();
      const auditRowNumber = index + 2;

      if (approved !== 'JA') {
        skipped++;
        return;
      }

      if (recommendation !== 'REAKTIVIERUNG_PRUEFEN') {
        auditSheet.getRange(auditRowNumber, 14)
          .setValue('NICHT_AUSGEFUEHRT_SICHERHEITSSPERRE');
        skipped++;
        return;
      }

      const product = productMap.get(productId);

      if (!product) {
        auditSheet.getRange(auditRowNumber, 14)
          .setValue('FEHLER_PRODUKT_NICHT_GEFUNDEN');
        skipped++;
        return;
      }

      const targetModelKey = productInactiveTargetModelKey_(
        product.category,
        product.modelKey
      );

      const activeConflict = productInactiveFindActiveConflict_(
        productSheet,
        productId,
        product.category,
        targetModelKey
      );

      if (activeConflict) {
        auditSheet.getRange(auditRowNumber, 14)
          .setValue(`NICHT_AUSGEFUEHRT_AKTIVES_DUPLIKAT_${activeConflict}`);
        skipped++;
        return;
      }

      /*
       * Alte generische Konsolenschlüssel werden vor der Reaktivierung
       * auf die verbindliche BuyBack-Bezeichnung aktualisiert. Dadurch
       * entstehen keine neuen aktiven Varianten wie "PS4 SLIM" neben
       * "PS4 SLIM 500GB".
       */
      if (
        productCleanText_(targetModelKey).toUpperCase() !==
        productCleanText_(product.modelKey).toUpperCase()
      ) {
        productSheet.getRange(product.rowNumber, 3).setValue(targetModelKey);
        productSheet.getRange(product.rowNumber, 4).setValue(targetModelKey);

        const oldNote = productCleanText_(product.note);
        const changeNote =
          `Modellschlüssel bei Reaktivierung geändert: ` +
          `${product.modelKey} -> ${targetModelKey}`;

        productSheet.getRange(product.rowNumber, 10).setValue(
          oldNote ? `${oldNote} | ${changeNote}` : changeNote
        );
      }

      productSheet.getRange(product.rowNumber, 6).setValue('JA');
      productInactiveActivateAliases_(aliasSheet, productId);

      auditSheet.getRange(auditRowNumber, 13).setValue(now);
      auditSheet.getRange(auditRowNumber, 14).setValue('REAKTIVIERT');
      auditSheet.getRange(auditRowNumber, 15).setValue(targetModelKey);
      reactivated++;
    });

    console.log(
      [
        'Reaktivierung abgeschlossen.',
        `Reaktiviert: ${reactivated}.`,
        `Übersprungen: ${skipped}.`,
        'Danach synchronisiereVerkaufsMapping() ausführen.'
      ].join(' ')
    );
  } finally {
    lock.releaseLock();
  }
}

function productInactiveEnsureAuditHeaders_(sheet) {
  const headers = INACTIVE_PRODUCT_AUDIT_CONFIG.HEADERS;

  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
}

function productInactiveReadExistingApprovals_(sheet) {
  const result = new Map();

  if (sheet.getLastRow() < 2) {
    return result;
  }

  const rows = sheet
    .getRange(
      2,
      1,
      sheet.getLastRow() - 1,
      INACTIVE_PRODUCT_AUDIT_CONFIG.HEADERS.length
    )
    .getDisplayValues();

  rows.forEach(row => {
    const productId = productCleanText_(row[0]);

    if (!productId) {
      return;
    }

    result.set(productId, {
      approved: productCleanText_(row[11]),
      editedAt: row[12] || '',
      status: productCleanText_(row[13])
    });
  });

  return result;
}

function productInactiveReadProducts_(productSheet) {
  if (productSheet.getLastRow() < 2) {
    return [];
  }

  return productSheet
    .getRange(
      2,
      1,
      productSheet.getLastRow() - 1,
      PRODUCT_CONFIG.PRODUCT_HEADERS.length
    )
    .getDisplayValues()
    .map((row, index) => ({
      rowNumber: index + 2,
      productId: productCleanText_(row[0]),
      category: productCleanText_(row[1]),
      modelKey: productCleanText_(row[2]),
      standardName: productCleanText_(row[3]),
      active: productCleanText_(row[5]).toUpperCase(),
      note: productCleanText_(row[9])
    }))
    .filter(product => product.productId);
}

/**
 * Liefert den verbindlichen Modellschlüssel, der bei einer Reaktivierung
 * verwendet werden soll. Für Nicht-Konsolen bleibt der bestehende Schlüssel
 * unverändert beziehungsweise wird nur über die vorhandene Aliaslogik
 * normalisiert.
 */
function productInactiveTargetModelKey_(category, modelKey) {
  const normalizedCategory = productCleanText_(category).toUpperCase();
  const original = productCleanText_(modelKey);

  if (
    ['PS4', 'PS5', 'XBOX'].includes(normalizedCategory) &&
    typeof salesCanonicalizeModelKey_ === 'function'
  ) {
    return salesCanonicalizeModelKey_(original, category);
  }

  return original;
}

/**
 * Prüft unmittelbar vor der Reaktivierung erneut, ob bereits ein anderes
 * aktives Produkt mit demselben Zielschlüssel existiert. Diese Prüfung ist
 * absichtlich frisch und verlässt sich nicht nur auf den älteren Auditlauf.
 */
function productInactiveFindActiveConflict_(
  productSheet,
  ignoredProductId,
  category,
  targetModelKey
) {
  const products = productInactiveReadProducts_(productSheet);
  const targetComparisonKey = productInactiveComparisonKey_(
    category,
    targetModelKey
  );

  const conflict = products.find(product =>
    product.productId !== ignoredProductId &&
    product.active === 'JA' &&
    productInactiveComparisonKey_(
      product.category,
      product.modelKey
    ) === targetComparisonKey
  );

  return conflict ? conflict.productId : '';
}

function productInactiveComparisonKey_(category, modelKey) {
  let canonicalModel = productCleanText_(modelKey).toUpperCase();

  if (typeof salesCanonicalizeModelKey_ === 'function') {
    canonicalModel = salesCanonicalizeModelKey_(modelKey, category);
  }

  return [
    productCleanText_(category).toUpperCase(),
    productCleanText_(canonicalModel).toUpperCase()
  ].join('|');
}

function productInactiveExtractMergeTarget_(note) {
  const match = productCleanText_(note).match(
    /Zusammengef(?:ü|ue)hrt\s+in\s+(BB\d+)/i
  );

  return match ? match[1].toUpperCase() : '';
}

function productInactiveCountAliases_(aliasSheet) {
  const result = new Map();

  if (!aliasSheet || aliasSheet.getLastRow() < 2) {
    return result;
  }

  const rows = aliasSheet
    .getRange(
      2,
      1,
      aliasSheet.getLastRow() - 1,
      PRODUCT_CONFIG.ALIAS_HEADERS.length
    )
    .getDisplayValues();

  rows.forEach(row => {
    const productId = productCleanText_(row[2]);
    const active = productCleanText_(row[4]).toUpperCase();

    if (!productId || active === 'NEIN') {
      return;
    }

    result.set(productId, (result.get(productId) || 0) + 1);
  });

  return result;
}

function productInactiveCountMappings_(mappingSheet) {
  const result = new Map();

  if (!mappingSheet || mappingSheet.getLastRow() < 2) {
    return result;
  }

  const rows = mappingSheet
    .getRange(
      2,
      1,
      mappingSheet.getLastRow() - 1,
      SALES_MAPPING_CONFIG.MAPPING_HEADERS.length
    )
    .getDisplayValues();

  rows.forEach(row => {
    const productId = productCleanText_(row[5]);

    if (!productId) {
      return;
    }

    result.set(productId, (result.get(productId) || 0) + 1);
  });

  return result;
}

function productInactiveActivateAliases_(aliasSheet, productId) {
  if (!aliasSheet || aliasSheet.getLastRow() < 2) {
    return 0;
  }

  const rowCount = aliasSheet.getLastRow() - 1;
  const productIds = aliasSheet
    .getRange(2, 3, rowCount, 1)
    .getDisplayValues();
  const activeRange = aliasSheet.getRange(2, 5, rowCount, 1);
  const activeValues = activeRange.getDisplayValues();

  let changed = 0;

  productIds.forEach((row, index) => {
    if (productCleanText_(row[0]) !== productId) {
      return;
    }

    if (productCleanText_(activeValues[index][0]).toUpperCase() !== 'JA') {
      activeValues[index][0] = 'JA';
      changed++;
    }
  });

  if (changed > 0) {
    activeRange.setValues(activeValues);
  }

  return changed;
}

/**
 * ============================================================
 * EINMALIGE PRODUKTSTAMM-MIGRATION V2
 * ============================================================
 *
 * Ziel:
 * - alte Konsolenschlüssel auf die verbindlichen BuyBack-Schlüssel migrieren,
 * - versehentlich automatisch deaktivierte Produkte reaktivieren,
 * - echte Zusammenführungen und aktive Duplikate unangetastet lassen,
 * - vor der Ausführung eine nachvollziehbare Vorschau erzeugen,
 * - vor jeder Änderung Sicherungskopien der relevanten Tabellen anlegen.
 *
 * Empfohlene Reihenfolge:
 *   1. pruefeProduktstammMigrationV2()
 *   2. Vorschau kontrollieren
 *   3. migriereProduktstammAufV2()
 *   4. synchronisiereVerkaufsMapping()
 *
 * Die Migration ist idempotent: Nach erfolgreicher Umstellung erzeugt ein
 * erneuter Lauf keine weiteren Änderungen an bereits migrierten Produkten.
 */

const PRODUCT_MIGRATION_V2_CONFIG = Object.freeze({
  PREVIEW_SHEET_NAME: 'Produktstamm_Migration_V2',
  LOG_SHEET_NAME: 'Produktstamm_Migration_V2_Log',
  MARKER: 'PRODUKTSTAMM_MIGRATION_V2',
  HEADERS: [
    'Produkt-ID',
    'Kategorie',
    'Alter Modellschlüssel',
    'Ziel-Modellschlüssel',
    'Alter Standardname',
    'Aktiv vorher',
    'Bemerkung',
    'Aktiver Zielkonflikt',
    'Geplante Aktion',
    'Begründung',
    'Ausgeführt am',
    'Status'
  ]
});

/**
 * Erstellt eine unverbindliche Vorschau. Diese Funktion verändert weder den
 * Produktstamm noch Aliase oder Verkaufsmappings.
 */
function pruefeProduktstammMigrationV2() {
  const spreadsheet = SpreadsheetApp.openById(
    EK_CONFIG.TARGET_SPREADSHEET_ID
  );

  const productSheet = spreadsheet.getSheetByName(
    PRODUCT_CONFIG.PRODUCT_SHEET_NAME
  );

  if (!productSheet) {
    throw new Error('Produktstamm wurde nicht gefunden.');
  }

  const previewSheet =
    spreadsheet.getSheetByName(PRODUCT_MIGRATION_V2_CONFIG.PREVIEW_SHEET_NAME) ||
    spreadsheet.insertSheet(PRODUCT_MIGRATION_V2_CONFIG.PREVIEW_SHEET_NAME);

  productMigrationV2EnsureHeaders_(previewSheet);

  const products = productInactiveReadProducts_(productSheet);
  const plan = productMigrationV2BuildPlan_(products);

  const oldRows = Math.max(previewSheet.getLastRow() - 1, 0);
  if (oldRows > 0) {
    previewSheet.getRange(
      2,
      1,
      oldRows,
      PRODUCT_MIGRATION_V2_CONFIG.HEADERS.length
    ).clearContent();
  }

  const rows = plan.map(item => [
    item.product.productId,
    item.product.category,
    item.product.modelKey,
    item.targetModelKey,
    item.product.standardName,
    item.product.active,
    item.product.note,
    item.activeConflictId,
    item.action,
    item.reason,
    '',
    'VORSCHAU'
  ]);

  if (rows.length > 0) {
    previewSheet.getRange(
      2,
      1,
      rows.length,
      PRODUCT_MIGRATION_V2_CONFIG.HEADERS.length
    ).setValues(rows);
  }

  previewSheet.setFrozenRows(1);
  previewSheet.autoResizeColumns(
    1,
    PRODUCT_MIGRATION_V2_CONFIG.HEADERS.length
  );

  const counts = productMigrationV2CountActions_(plan);
  console.log(
    [
      'Produktstamm-Migration V2 geprüft.',
      `Migrieren und reaktivieren: ${counts.MIGRIEREN_UND_REAKTIVIEREN || 0}.`,
      `Nur Schlüssel migrieren: ${counts.NUR_SCHLUESSEL_MIGRIEREN || 0}.`,
      `Unverändert: ${counts.UNVERAENDERT || 0}.`,
      `Sicherheitssperren: ${counts.NICHT_AENDERN_ZUSAMMENGEFUEHRT || 0}` +
        ` / ${counts.NICHT_AENDERN_AKTIVES_DUPLIKAT || 0}.`
    ].join(' ')
  );
}

/**
 * Führt die in der Vorschau ermittelbaren sicheren Änderungen aus.
 * Es ist keine manuelle JA-Freigabe erforderlich. Die Entscheidung wird im
 * Ausführungszeitpunkt erneut auf Basis des aktuellen Produktstamms geprüft.
 */
function migriereProduktstammAufV2() {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error('Eine andere Produktbearbeitung läuft bereits.');
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(
      EK_CONFIG.TARGET_SPREADSHEET_ID
    );

    const productSheet = spreadsheet.getSheetByName(
      PRODUCT_CONFIG.PRODUCT_SHEET_NAME
    );
    const aliasSheet = spreadsheet.getSheetByName(
      PRODUCT_CONFIG.ALIAS_SHEET_NAME
    );

    if (!productSheet || !aliasSheet) {
      throw new Error('Produktstamm oder Produkt_Alias wurde nicht gefunden.');
    }

    /* Vor der ersten Änderung vollständige Sicherungskopien anlegen. */
    const backupNames = productMigrationV2CreateBackups_(
      spreadsheet,
      productSheet,
      aliasSheet
    );

    const products = productInactiveReadProducts_(productSheet);
    const plan = productMigrationV2BuildPlan_(products);
    const now = new Date();
    const logRows = [];

    let changed = 0;
    let reactivated = 0;
    let aliasesActivated = 0;
    let skipped = 0;

    plan.forEach(item => {
      const product = item.product;
      let status = '';

      if (item.action === 'ZUSAMMENFUEHREN_IN_ZIEL') {
        if (!item.targetProductId) {
          skipped++;
          status = 'NICHT_AUSGEFUEHRT_ZIEL_FEHLT';
        } else {
          const movedAliases = productMergeMoveAliases_(
            aliasSheet,
            product.productId,
            item.targetProductId
          );
          aliasesActivated += movedAliases;
          productSheet.getRange(product.rowNumber, 6).setValue('NEIN');
          const existingNote = productCleanText_(product.note);
          const mergeNote =
            `Zusammengeführt in ${item.targetProductId} | ` +
            `Grund: kanonischer Schlüssel ${item.targetModelKey}`;
          productSheet.getRange(product.rowNumber, 10).setValue(
            existingNote ? `${existingNote} | ${mergeNote}` : mergeNote
          );
          changed++;
          status = `ZUSAMMENGEFUEHRT_IN_${item.targetProductId}`;
        }
      } else if (
        item.action !== 'MIGRIEREN_UND_REAKTIVIEREN' &&
        item.action !== 'NUR_SCHLUESSEL_MIGRIEREN'
      ) {
        skipped++;
        status = item.action;
      } else {
        const currentConflict = productInactiveFindActiveConflict_(
          productSheet,
          product.productId,
          product.category,
          item.targetModelKey
        );

        if (currentConflict) {
          skipped++;
          status = `NICHT_AUSGEFUEHRT_AKTIVES_DUPLIKAT_${currentConflict}`;
        } else {
          const keyChanged =
            productCleanText_(product.modelKey).toUpperCase() !==
            productCleanText_(item.targetModelKey).toUpperCase();

          if (keyChanged) {
            productSheet.getRange(product.rowNumber, 3)
              .setValue(item.targetModelKey);
            productSheet.getRange(product.rowNumber, 4)
              .setValue(item.targetModelKey);
            changed++;
          }

          if (item.action === 'MIGRIEREN_UND_REAKTIVIEREN') {
            productSheet.getRange(product.rowNumber, 6).setValue('JA');
            aliasesActivated += productInactiveActivateAliases_(
              aliasSheet,
              product.productId
            );
            reactivated++;
          }

          const existingNote = productCleanText_(product.note);
          const migrationNote = [
            PRODUCT_MIGRATION_V2_CONFIG.MARKER,
            keyChanged
              ? `${product.modelKey} -> ${item.targetModelKey}`
              : 'Reaktivierung ohne Schlüsseländerung',
            Utilities.formatDate(
              now,
              Session.getScriptTimeZone(),
              'dd.MM.yyyy HH:mm:ss'
            )
          ].join(' | ');

          if (!existingNote.includes(PRODUCT_MIGRATION_V2_CONFIG.MARKER)) {
            productSheet.getRange(product.rowNumber, 10).setValue(
              existingNote
                ? `${existingNote} | ${migrationNote}`
                : migrationNote
            );
          }

          status = item.action === 'MIGRIEREN_UND_REAKTIVIEREN'
            ? 'MIGRIERT_UND_REAKTIVIERT'
            : 'SCHLUESSEL_MIGRIERT';
        }
      }

      logRows.push([
        now,
        product.productId,
        product.category,
        product.modelKey,
        item.targetModelKey,
        product.active,
        item.action,
        item.reason,
        status,
        backupNames.product,
        backupNames.alias
      ]);
    });

    productMergeRemoveDuplicateAliases_(aliasSheet);
    productMigrationV2WriteLog_(spreadsheet, logRows);

    /* Vorschau nach dem Lauf neu erzeugen, damit der Endzustand sichtbar ist. */
    pruefeProduktstammMigrationV2();

    console.log(
      [
        'Produktstamm-Migration V2 abgeschlossen.',
        `Geänderte Modellschlüssel: ${changed}.`,
        `Reaktivierte Produkte: ${reactivated}.`,
        `Reaktivierte Aliase: ${aliasesActivated}.`,
        `Übersprungen/geschützt: ${skipped}.`,
        `Backups: ${backupNames.product}, ${backupNames.alias}.`,
        'Als Nächstes synchronisiereVerkaufsMapping() ausführen.'
      ].join(' ')
    );
  } finally {
    lock.releaseLock();
  }
}

/**
 * Erstellt für alle Produkte einen sicheren Aktionsplan.
 */
function productMigrationV2BuildPlan_(products) {
  const activeByTargetKey = new Map();

  products.forEach(product => {
    if (product.active !== 'JA') return;

    const target = productMigrationV2TargetModelKey_(product);
    const key = productInactiveComparisonKey_(product.category, target);
    if (!activeByTargetKey.has(key)) activeByTargetKey.set(key, []);
    activeByTargetKey.get(key).push(product);
  });

  return products.map(product => {
    const targetModelKey = productMigrationV2TargetModelKey_(product);
    const targetComparisonKey = productInactiveComparisonKey_(
      product.category,
      targetModelKey
    );
    const activeGroup = activeByTargetKey.get(targetComparisonKey) || [];
    const activeConflicts = activeGroup.filter(
      item => item.productId !== product.productId
    );
    const activeConflictId = activeConflicts
      .map(item => item.productId)
      .join(', ');
    const mergeTarget = productInactiveExtractMergeTarget_(product.note);
    const keyChanged =
      productCleanText_(product.modelKey).toUpperCase() !==
      productCleanText_(targetModelKey).toUpperCase();
    const automaticallyDeactivated =
      /automatisch deaktiviert/i.test(product.note) &&
      /modellschl(?:ü|ue)ssel nach regel(?:ä|ae)nderung/i.test(product.note);
    const alreadyMigrated = product.note.includes(
      PRODUCT_MIGRATION_V2_CONFIG.MARKER
    );
    const normalizedCategory = productCleanText_(product.category).toUpperCase();
    const isMergeableCategory =
      normalizedCategory === 'HANDYS + TABLETS' ||
      normalizedCategory === 'KAMERA / SONSTIGE ELEKTRONIK' ||
      normalizedCategory === 'PS5';

    let action = 'UNVERAENDERT';
    let reason = 'Keine migrationspflichtige Änderung erkannt.';
    let targetProductId = '';

    if (mergeTarget) {
      action = 'NICHT_AENDERN_ZUSAMMENGEFUEHRT';
      reason = `Bewusst in ${mergeTarget} zusammengeführt.`;
    } else if (activeConflictId && isMergeableCategory) {
      const keeper = productMigrationV2ChooseKeeper_(
        [product].concat(activeConflicts),
        targetModelKey
      );

      if (keeper.productId !== product.productId) {
        action = 'ZUSAMMENFUEHREN_IN_ZIEL';
        targetProductId = keeper.productId;
        reason =
          `Kanonisch identisches Produkt; Aliase werden nach ${keeper.productId} verschoben. ` +
          `Der alte Schlüssel wird nicht weitergeführt.`;
      } else if (keyChanged) {
        action = 'NUR_SCHLUESSEL_MIGRIEREN';
        reason = 'Bevorzugtes Hauptprodukt erhält den kanonischen Modellschlüssel.';
      }
    } else if (activeConflictId) {
      action = 'NICHT_AENDERN_AKTIVES_DUPLIKAT';
      reason = `Aktives Zielprodukt vorhanden: ${activeConflictId}.`;
    } else if (
      product.active === 'NEIN' &&
      (automaticallyDeactivated || productMigrationV2IsKnownLostProduct_(product))
    ) {
      action = 'MIGRIEREN_UND_REAKTIVIEREN';
      reason = keyChanged
        ? 'Automatisch deaktiviertes Produkt ohne aktiven Nachfolger; Schlüssel wird migriert und Produkt reaktiviert.'
        : 'Automatisch deaktiviertes Produkt ohne aktiven Nachfolger; Produkt wird reaktiviert.';
    } else if (product.active === 'JA' && keyChanged) {
      action = 'NUR_SCHLUESSEL_MIGRIEREN';
      reason = 'Aktives Produkt verwendet noch keinen kanonischen Modellschlüssel.';
    } else if (alreadyMigrated) {
      action = 'UNVERAENDERT';
      reason = 'Migration V2 wurde für dieses Produkt bereits ausgeführt.';
    } else if (product.active === 'NEIN') {
      action = 'NICHT_AENDERN_MANUELL_INAKTIV';
      reason = 'Inaktiv, aber weder automatische Regel-Deaktivierung noch dokumentierter sicherer Migrationsfall.';
    }

    return {
      product,
      targetModelKey,
      activeConflictId,
      targetProductId,
      action,
      reason
    };
  });
}

function productMigrationV2ChooseKeeper_(products, targetModelKey) {
  return products.slice().sort((a, b) => {
    const aExact = productCleanText_(a.modelKey).toUpperCase() ===
      productCleanText_(targetModelKey).toUpperCase() ? 0 : 1;
    const bExact = productCleanText_(b.modelKey).toUpperCase() ===
      productCleanText_(targetModelKey).toUpperCase() ? 0 : 1;
    if (aExact !== bExact) return aExact - bExact;

    const aActive = a.active === 'JA' ? 0 : 1;
    const bActive = b.active === 'JA' ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;

    return String(a.productId).localeCompare(String(b.productId));
  })[0];
}

/**
 * Der Zielschlüssel stammt aus derselben zentralen Verkaufsnormalisierung,
 * die auch beim späteren Mapping verwendet wird. Nicht-Konsolen bleiben
 * unverändert, damit die Migration keine fachfremden Produktgruppen umbaut.
 */
function productMigrationV2TargetModelKey_(product) {
  const category = productCleanText_(product.category).toUpperCase();
  const supported = [
    'PS4',
    'PS5',
    'XBOX',
    'HANDYS + TABLETS',
    'KAMERA / SONSTIGE ELEKTRONIK'
  ];

  if (!supported.includes(category)) {
    return productCleanText_(product.modelKey);
  }

  if (typeof salesCanonicalizeModelKey_ !== 'function') {
    throw new Error(
      'salesCanonicalizeModelKey_ wurde nicht gefunden. ' +
      'Bitte 08_Verkaufs_Parser.gs aus Version 1.8 einsetzen.'
    );
  }

  return salesCanonicalizeModelKey_(product.modelKey, product.category);
}

/**
 * Bekannte verlorene Produkte ohne automatische Bemerkung. Derzeit betrifft
 * dies BB000302 (Xbox One S 1TB), das im Prüfblatt ohne Zusammenführungsvermerk
 * und ohne aktives Gegenstück gefunden wurde.
 */
function productMigrationV2IsKnownLostProduct_(product) {
  return product.productId === 'BB000302';
}

function productMigrationV2EnsureHeaders_(sheet) {
  sheet.getRange(
    1,
    1,
    1,
    PRODUCT_MIGRATION_V2_CONFIG.HEADERS.length
  ).setValues([PRODUCT_MIGRATION_V2_CONFIG.HEADERS]);
  sheet.getRange(
    1,
    1,
    1,
    PRODUCT_MIGRATION_V2_CONFIG.HEADERS.length
  ).setFontWeight('bold');
}

function productMigrationV2CreateBackups_(
  spreadsheet,
  productSheet,
  aliasSheet
) {
  const timestamp = Utilities.formatDate(
    new Date(),
    Session.getScriptTimeZone(),
    'yyyyMMdd_HHmmss'
  );

  const productName = productMigrationV2UniqueSheetName_(
    spreadsheet,
    `Backup_Produktstamm_${timestamp}`
  );
  const aliasName = productMigrationV2UniqueSheetName_(
    spreadsheet,
    `Backup_ProduktAlias_${timestamp}`
  );

  productSheet.copyTo(spreadsheet).setName(productName);
  aliasSheet.copyTo(spreadsheet).setName(aliasName);

  return { product: productName, alias: aliasName };
}

function productMigrationV2UniqueSheetName_(spreadsheet, baseName) {
  let candidate = baseName.substring(0, 99);
  let counter = 2;

  while (spreadsheet.getSheetByName(candidate)) {
    const suffix = `_${counter}`;
    candidate = `${baseName.substring(0, 99 - suffix.length)}${suffix}`;
    counter++;
  }

  return candidate;
}

function productMigrationV2WriteLog_(spreadsheet, rows) {
  const headers = [
    'Zeitpunkt',
    'Produkt-ID',
    'Kategorie',
    'Alter Modellschlüssel',
    'Ziel-Modellschlüssel',
    'Aktiv vorher',
    'Geplante Aktion',
    'Begründung',
    'Ergebnis',
    'Produktstamm-Backup',
    'Alias-Backup'
  ];

  const sheet =
    spreadsheet.getSheetByName(PRODUCT_MIGRATION_V2_CONFIG.LOG_SHEET_NAME) ||
    spreadsheet.insertSheet(PRODUCT_MIGRATION_V2_CONFIG.LOG_SHEET_NAME);

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }

  if (rows.length > 0) {
    sheet.getRange(
      sheet.getLastRow() + 1,
      1,
      rows.length,
      headers.length
    ).setValues(rows);
  }

  sheet.setFrozenRows(1);
}

function productMigrationV2CountActions_(plan) {
  return plan.reduce((result, item) => {
    result[item.action] = (result[item.action] || 0) + 1;
    return result;
  }, {});
}
