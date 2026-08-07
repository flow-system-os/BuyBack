/**
 * ============================================================
 * PRODUKTSTAMM UND ALIASE
 * ============================================================
 *
 * Diese Datei gehört zum modularen BuyBack-Apps-Script-Projekt.
 * Alle .gs-Dateien im selben Apps-Script-Projekt teilen sich
 * Funktionen und Konstanten automatisch. Es sind keine Imports nötig.
 */

function synchronisiereProduktstamm() {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Eine andere Produktstamm-Synchronisierung läuft bereits.'
    );
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(
      EK_CONFIG.TARGET_SPREADSHEET_ID
    );

    const normalizedSheet = spreadsheet.getSheetByName(
      EK_CONFIG.TARGET_SHEET_NORMALIZED
    );

    if (!normalizedSheet) {
      throw new Error(
        'Das Tabellenblatt "EK_Normalisiert" wurde nicht gefunden.'
      );
    }

    const productSheet = productGetOrCreateSheet_(
      spreadsheet,
      PRODUCT_CONFIG.PRODUCT_SHEET_NAME
    );

    const aliasSheet = productGetOrCreateSheet_(
      spreadsheet,
      PRODUCT_CONFIG.ALIAS_SHEET_NAME
    );

    productEnsureHeaders_(
      productSheet,
      PRODUCT_CONFIG.PRODUCT_HEADERS
    );

    productEnsureHeaders_(
      aliasSheet,
      PRODUCT_CONFIG.ALIAS_HEADERS
    );

    const now = new Date();

    const normalizedData = productReadNormalizedEkData_(
      normalizedSheet
    );

    const existingProducts = productReadExistingProducts_(
      productSheet
    );

    const existingAliases = productReadExistingAliases_(
      aliasSheet
    );

    let nextProductNumber = productDetermineNextIdNumber_(
      existingProducts
    );

    const newProductRows = [];
    const newAliasRows = [];
    const productLastSeenUpdates = new Map();
    const aliasLastSeenUpdates = new Map();

    let newProducts = 0;
    let newAliases = 0;
    let existingProductMatches = 0;

    normalizedData.forEach(item => {
      const compositeKey = productCreateCompositeKey_(
        item.category,
        salesCanonicalizeModelKey_(item.modelKey, item.category)
      );

      let product = existingProducts.byCompositeKey.get(
        compositeKey
      );

      if (!product) {
        const productId = productFormatId_(
          nextProductNumber
        );

        nextProductNumber++;

        const standardName =
          productCreateStandardName_(item);

        const newProductRow = [
          productId,
          item.category,
          item.modelKey,
          standardName,
          'STANDARD',
          'JA',
          now,
          now,
          'EK_Normalisiert',
          ''
        ];

        newProductRows.push(newProductRow);

        product = {
          productId: productId,
          category: item.category,
          modelKey: item.modelKey,
          rowNumber: null
        };

        existingProducts.byCompositeKey.set(
          compositeKey,
          product
        );

        existingProducts.byProductId.set(
          productId,
          product
        );

        newProducts++;
      } else {
        existingProductMatches++;

        if (product.rowNumber) {
          productLastSeenUpdates.set(
            product.rowNumber,
            now
          );
        }
      }

      /*
       * Alias 1:
       * Der Modellschlüssel selbst.
       */
      const aliasesToAdd = [
        {
          originalAlias: item.modelKey,
          normalizedAlias: productNormalizeAlias_(
            item.modelKey
          )
        },

        /*
         * Alias 2:
         * Die normalisierte Einkaufsbezeichnung.
         */
        {
          originalAlias: item.normalizedName,
          normalizedAlias: productNormalizeAlias_(
            item.normalizedName
          )
        }
      ];

      aliasesToAdd.forEach(aliasItem => {
        if (!aliasItem.normalizedAlias) {
          return;
        }

        const aliasKey = productCreateAliasKey_(
          aliasItem.normalizedAlias,
          product.productId
        );

        const existingAlias = existingAliases.get(
          aliasKey
        );

        if (existingAlias) {
          if (existingAlias.rowNumber) {
            aliasLastSeenUpdates.set(
              existingAlias.rowNumber,
              now
            );
          }

          return;
        }

        newAliasRows.push([
          aliasItem.originalAlias,
          aliasItem.normalizedAlias,
          product.productId,
          'EK_Normalisiert',
          'JA',
          now,
          now
        ]);

        existingAliases.set(aliasKey, {
          rowNumber: null
        });

        newAliases++;
      });
    });

    /*
     * Neue Produkte gesammelt anhängen.
     */
    if (newProductRows.length > 0) {
      const firstProductRow =
        productSheet.getLastRow() + 1;

      productSheet
        .getRange(
          firstProductRow,
          1,
          newProductRows.length,
          PRODUCT_CONFIG.PRODUCT_HEADERS.length
        )
        .setValues(newProductRows);

      productFormatProductRows_(
        productSheet,
        firstProductRow,
        newProductRows.length
      );
    }

    /*
     * Neue Aliase gesammelt anhängen.
     */
    if (newAliasRows.length > 0) {
      const firstAliasRow =
        aliasSheet.getLastRow() + 1;

      aliasSheet
        .getRange(
          firstAliasRow,
          1,
          newAliasRows.length,
          PRODUCT_CONFIG.ALIAS_HEADERS.length
        )
        .setValues(newAliasRows);

      productFormatAliasRows_(
        aliasSheet,
        firstAliasRow,
        newAliasRows.length
      );
    }

    /*
     * "Zuletzt erkannt" bei vorhandenen Produkten aktualisieren.
     */
    productLastSeenUpdates.forEach(
      (date, rowNumber) => {
        productSheet
          .getRange(rowNumber, 8)
          .setValue(date);
      }
    );

    /*
     * "Zuletzt erkannt" bei vorhandenen Aliasen aktualisieren.
     */
    aliasLastSeenUpdates.forEach(
      (date, rowNumber) => {
        aliasSheet
          .getRange(rowNumber, 7)
          .setValue(date);
      }
    );

    console.log(
      [
        'Produktstamm-Synchronisierung erfolgreich.',
        `Neue Produkte: ${newProducts}.`,
        `Neue Aliase: ${newAliases}.`,
        `Bestehende Produktzuordnungen: ${existingProductMatches}.`
      ].join(' ')
    );

  } finally {
    lock.releaseLock();
  }
}


/**
 * Liest automatisch verwertbare Produkte aus EK_Normalisiert.
 *
 * Prüffälle und leere Modellschlüssel werden nicht automatisch
 * in den Produktstamm aufgenommen.
 */

function productReadNormalizedEkData_(normalizedSheet) {
  if (normalizedSheet.getLastRow() < 2) {
    return [];
  }

  const headers = normalizedSheet
    .getRange(
      1,
      1,
      1,
      normalizedSheet.getLastColumn()
    )
    .getDisplayValues()[0]
    .map(productCleanText_);

  const categoryIndex =
    headers.indexOf('Kategorie');

  const normalizedNameIndex =
    headers.indexOf('Normalisierte Bezeichnung');

  const modelKeyIndex =
    headers.indexOf('Modellschlüssel');

  const reviewStatusIndex =
    headers.indexOf('Prüfstatus');

  if (
    categoryIndex === -1 ||
    normalizedNameIndex === -1 ||
    modelKeyIndex === -1 ||
    reviewStatusIndex === -1
  ) {
    throw new Error(
      'Mindestens eine benötigte Spalte fehlt in EK_Normalisiert.'
    );
  }

  const values = normalizedSheet
    .getRange(
      2,
      1,
      normalizedSheet.getLastRow() - 1,
      normalizedSheet.getLastColumn()
    )
    .getDisplayValues();

  const uniqueItems = new Map();

  values.forEach(row => {
    const category =
      productCleanText_(row[categoryIndex]);

    const normalizedName =
      productCleanText_(row[normalizedNameIndex]);

    const modelKey =
      productCleanText_(row[modelKeyIndex])
        .toUpperCase();

    const reviewStatus =
      productCleanText_(row[reviewStatusIndex])
        .toUpperCase();

    if (
      !category ||
      !modelKey ||
      reviewStatus !== 'AUTOMATISCH_VERWENDBAR'
    ) {
      return;
    }

    const uniqueKey = [
      category.toUpperCase(),
      modelKey,
      productNormalizeAlias_(normalizedName)
    ].join('|');

    if (!uniqueItems.has(uniqueKey)) {
      uniqueItems.set(uniqueKey, {
        category: category,
        modelKey: modelKey,
        normalizedName: normalizedName
      });
    }
  });

  return Array.from(uniqueItems.values());
}


/**
 * Liest bereits vorhandene Produkte.
 */

function productReadExistingProducts_(productSheet) {
  const result = {
    byCompositeKey: new Map(),
    byProductId: new Map()
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
      productCleanText_(row[0]);

    const category =
      productCleanText_(row[1]);

    const modelKey =
      productCleanText_(row[2])
        .toUpperCase();

    if (!productId || !category || !modelKey) {
      return;
    }

    const product = {
      productId: productId,
      category: category,
      modelKey: modelKey,
      rowNumber: index + 2
    };

    result.byProductId.set(
      productId,
      product
    );

    /*
     * Kanonisiert wie bei der Kandidatensuche in
     * synchronisiereVerkaufsMapping, damit z.B. "A6000" und
     * "ALPHA 6000" als dasselbe Produkt erkannt werden. Ohne das
     * legt der Sync sonst einen doppelten Produktstamm-Eintrag an,
     * sobald sich die Schreibweise eines Modellschlüssels ändert
     * (z.B. durch eine Parser-Verbesserung).
     */
    result.byCompositeKey.set(
      productCreateCompositeKey_(
        category,
        salesCanonicalizeModelKey_(modelKey, category)
      ),
      product
    );
  });

  return result;
}


/**
 * Liest bestehende Aliase.
 */

function productReadExistingAliases_(aliasSheet) {
  const aliases = new Map();

  if (aliasSheet.getLastRow() < 2) {
    return aliases;
  }

  const values = aliasSheet
    .getRange(
      2,
      1,
      aliasSheet.getLastRow() - 1,
      PRODUCT_CONFIG.ALIAS_HEADERS.length
    )
    .getDisplayValues();

  values.forEach((row, index) => {
    const normalizedAlias =
      productNormalizeAlias_(row[1]);

    const productId =
      productCleanText_(row[2]);

    if (!normalizedAlias || !productId) {
      return;
    }

    aliases.set(
      productCreateAliasKey_(
        normalizedAlias,
        productId
      ),
      {
        rowNumber: index + 2
      }
    );
  });

  return aliases;
}


/**
 * Ermittelt die nächste freie fortlaufende Produktnummer.
 */

function productDetermineNextIdNumber_(
  existingProducts
) {
  let highestNumber = 0;

  existingProducts.byProductId.forEach(
    (_, productId) => {
      const match = String(productId).match(
        /^BB(\d+)$/
      );

      if (!match) {
        return;
      }

      highestNumber = Math.max(
        highestNumber,
        Number(match[1])
      );
    }
  );

  return highestNumber + 1;
}


/**
 * Formatiert eine Produkt-ID wie BB000001.
 */

function productFormatId_(number) {
  return (
    PRODUCT_CONFIG.ID_PREFIX +
    String(number).padStart(
      PRODUCT_CONFIG.ID_DIGITS,
      '0'
    )
  );
}


/**
 * Kategorie und Modellschlüssel bilden gemeinsam den
 * eindeutigen Produktstamm-Schlüssel.
 */

function productCreateCompositeKey_(
  category,
  modelKey
) {
  return [
    productCleanText_(category).toUpperCase(),
    productCleanText_(modelKey).toUpperCase()
  ].join('|');
}


/**
 * Ein Alias darf pro Produkt nur einmal vorkommen.
 */

function productCreateAliasKey_(
  normalizedAlias,
  productId
) {
  return [
    productNormalizeAlias_(normalizedAlias),
    productCleanText_(productId)
  ].join('|');
}


/**
 * Vereinheitlicht Alias-Schreibweisen.
 */

function productNormalizeAlias_(value) {
  return productCleanText_(value)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[–—]/g, '-')
    .replace(/[()[\],;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


/**
 * Erstellt zunächst einen sinnvollen Standardnamen.
 *
 * Dieser kann später manuell verbessert werden, ohne dass die
 * Produkt-ID oder das Mapping verändert werden.
 */

function productCreateStandardName_(item) {
  if (item.modelKey) {
    return item.modelKey;
  }

  return item.normalizedName;
}


/**
 * Legt ein fehlendes Tabellenblatt an.
 */

function productGetOrCreateSheet_(
  spreadsheet,
  sheetName
) {
  return (
    spreadsheet.getSheetByName(sheetName) ||
    spreadsheet.insertSheet(sheetName)
  );
}


/**
 * Setzt die Kopfzeile nur bei einem leeren Blatt.
 *
 * Bestehende Produktdaten werden niemals gelöscht.
 */

function productEnsureHeaders_(
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
    .map(productCleanText_);

  expectedHeaders.forEach(
    (expectedHeader, index) => {
      if (currentHeaders[index] !== expectedHeader) {
        throw new Error(
          `Unerwartete Kopfzeile in "${sheet.getName()}", ` +
          `Spalte ${index + 1}. Erwartet: "${expectedHeader}".`
        );
      }
    }
  );
}


/**
 * Formatiert neue Produktstamm-Zeilen.
 */

function productFormatProductRows_(
  sheet,
  firstRow,
  rowCount
) {
  sheet
    .getRange(firstRow, 7, rowCount, 2)
    .setNumberFormat('dd.MM.yyyy HH:mm:ss');

  sheet
    .getRange(
      firstRow,
      1,
      rowCount,
      PRODUCT_CONFIG.PRODUCT_HEADERS.length
    )
    .setWrap(true);

  sheet.autoResizeColumns(
    1,
    PRODUCT_CONFIG.PRODUCT_HEADERS.length
  );
}


/**
 * Formatiert neue Alias-Zeilen.
 */

function productFormatAliasRows_(
  sheet,
  firstRow,
  rowCount
) {
  sheet
    .getRange(firstRow, 6, rowCount, 2)
    .setNumberFormat('dd.MM.yyyy HH:mm:ss');

  sheet
    .getRange(
      firstRow,
      1,
      rowCount,
      PRODUCT_CONFIG.ALIAS_HEADERS.length
    )
    .setWrap(true);

  sheet.autoResizeColumns(
    1,
    PRODUCT_CONFIG.ALIAS_HEADERS.length
  );
}


/**
 * Entfernt störende Leerzeichen.
 */

function productCleanText_(value) {
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
 * Prüft Produktstamm und Produkt_Alias auf typische Fehler.
 *
 * Ergebnisblatt:
 * Produktstamm_Prüfung
 */

function deaktiviereVeralteteProduktstammEintraege() {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Eine andere Produktstamm-Bereinigung läuft bereits.'
    );
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(
      EK_CONFIG.TARGET_SPREADSHEET_ID
    );

    const normalizedSheet = spreadsheet.getSheetByName(
      EK_CONFIG.TARGET_SHEET_NORMALIZED
    );

    const productSheet = spreadsheet.getSheetByName(
      PRODUCT_CONFIG.PRODUCT_SHEET_NAME
    );

    const aliasSheet = spreadsheet.getSheetByName(
      PRODUCT_CONFIG.ALIAS_SHEET_NAME
    );

    if (!normalizedSheet || !productSheet || !aliasSheet) {
      throw new Error(
        'EK_Normalisiert, Produktstamm oder Produkt_Alias wurde nicht gefunden.'
      );
    }

    /*
     * Schritt 1:
     * Aktuell gültige Kombinationen aus Kategorie und Modellschlüssel
     * aus EK_Normalisiert einlesen.
     */
    const normalizedHeaders = normalizedSheet
      .getRange(
        1,
        1,
        1,
        normalizedSheet.getLastColumn()
      )
      .getDisplayValues()[0]
      .map(productCleanText_);

    const categoryIndex = normalizedHeaders.indexOf('Kategorie');
    const modelKeyIndex = normalizedHeaders.indexOf('Modellschlüssel');
    const reviewStatusIndex = normalizedHeaders.indexOf('Prüfstatus');

    if (
      categoryIndex === -1 ||
      modelKeyIndex === -1 ||
      reviewStatusIndex === -1
    ) {
      throw new Error(
        'Benötigte Spalten fehlen in EK_Normalisiert.'
      );
    }

    const normalizedRows =
      normalizedSheet.getLastRow() >= 2
        ? normalizedSheet
            .getRange(
              2,
              1,
              normalizedSheet.getLastRow() - 1,
              normalizedSheet.getLastColumn()
            )
            .getDisplayValues()
        : [];

    const currentCompositeKeys = new Set();

    normalizedRows.forEach(row => {
      const category = productCleanText_(row[categoryIndex]);
      const modelKey = productCleanText_(row[modelKeyIndex]).toUpperCase();
      const reviewStatus = productCleanText_(
        row[reviewStatusIndex]
      ).toUpperCase();

      if (
        !category ||
        !modelKey ||
        reviewStatus !== 'AUTOMATISCH_VERWENDBAR'
      ) {
        return;
      }

      currentCompositeKeys.add(
        productCreateCompositeKey_(category, modelKey)
      );
    });

    /*
     * Schritt 2:
     * Nur automatisch aus EK_Normalisiert erzeugte Altprodukte
     * deaktivieren. Manuelle Stammdaten bleiben unangetastet.
     */
    const productRows =
      productSheet.getLastRow() >= 2
        ? productSheet
            .getRange(
              2,
              1,
              productSheet.getLastRow() - 1,
              PRODUCT_CONFIG.PRODUCT_HEADERS.length
            )
            .getDisplayValues()
        : [];

    const obsoleteProductIds = new Set();
    const now = new Date();
    let deactivatedProducts = 0;

    productRows.forEach((row, index) => {
      const sheetRow = index + 2;
      const productId = productCleanText_(row[0]);
      const category = productCleanText_(row[1]);
      const modelKey = productCleanText_(row[2]).toUpperCase();
      const active = productCleanText_(row[5]).toUpperCase();
      const source = productCleanText_(row[8]);

      if (
        !productId ||
        !category ||
        !modelKey ||
        active === 'NEIN'
      ) {
        return;
      }

      if (source !== 'EK_Normalisiert') {
        return;
      }

      const compositeKey = productCreateCompositeKey_(
        category,
        modelKey
      );

      if (currentCompositeKeys.has(compositeKey)) {
        return;
      }

      obsoleteProductIds.add(productId);
      productSheet.getRange(sheetRow, 6).setValue('NEIN');

      const oldNote = productCleanText_(row[9]);
      const newNote =
        'Automatisch deaktiviert am ' +
        Utilities.formatDate(
          now,
          EK_CONFIG.TIMEZONE,
          'dd.MM.yyyy HH:mm:ss'
        ) +
        ': Modellschlüssel nach Regeländerung nicht mehr aktuell';

      productSheet
        .getRange(sheetRow, 10)
        .setValue(
          oldNote
            ? `${oldNote} | ${newNote}`
            : newNote
        );

      deactivatedProducts++;
    });

    /*
     * Schritt 3:
     * Aliase der deaktivierten Produkt-IDs ebenfalls deaktivieren.
     */
    let deactivatedAliases = 0;

    if (obsoleteProductIds.size > 0 && aliasSheet.getLastRow() >= 2) {
      const aliasRows = aliasSheet
        .getRange(
          2,
          1,
          aliasSheet.getLastRow() - 1,
          PRODUCT_CONFIG.ALIAS_HEADERS.length
        )
        .getDisplayValues();

      aliasRows.forEach((row, index) => {
        const productId = productCleanText_(row[2]);
        const active = productCleanText_(row[4]).toUpperCase();

        if (
          !obsoleteProductIds.has(productId) ||
          active === 'NEIN'
        ) {
          return;
        }

        aliasSheet.getRange(index + 2, 5).setValue('NEIN');
        deactivatedAliases++;
      });
    }

    console.log(
      [
        'Bereinigung veralteter Produktstamm-Einträge abgeschlossen.',
        `Aktuelle Produktkombinationen: ${currentCompositeKeys.size}.`,
        `Deaktivierte Produkte: ${deactivatedProducts}.`,
        `Deaktivierte Aliase: ${deactivatedAliases}.`
      ].join(' ')
    );

  } finally {
    lock.releaseLock();
  }
}

/**
 * ============================================================
 * SICHERE BEREINIGUNG DER AKTUELLEN DOPPELPRODUKTE
 * ============================================================
 *
 * Diese Funktion ist bewusst einfach und risikoarm:
 *
 * - Es werden keine Tabellenzeilen gelöscht.
 * - Es werden keine Aliasdaten massenhaft umgeschrieben.
 * - Die alten Produkt-IDs werden deaktiviert.
 * - Alle Aliase der alten Produkt-IDs werden deaktiviert.
 * - Die richtigen Zielprodukte und deren Aliase bleiben unverändert.
 *
 * Aktuell bereinigte Zuordnungen:
 * - BB000280 → BB000265: PlayStation Portal
 * - BB000302 → BB000285: Xbox One S 1TB
 */
