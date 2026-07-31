/**
 * ============================================================
 * QUALITÄTSPRÜFUNGEN UND DIAGNOSE
 * ============================================================
 *
 * Diese Datei gehört zum modularen BuyBack-Apps-Script-Projekt.
 * Alle .gs-Dateien im selben Apps-Script-Projekt teilen sich
 * Funktionen und Konstanten automatisch. Es sind keine Imports nötig.
 */

function pruefeProduktstamm() {
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
    throw new Error(
      'Produktstamm oder Produkt_Alias wurde nicht gefunden.'
    );
  }

  const reviewSheetName = 'Produktstamm_Prüfung';

  const reviewSheet =
    spreadsheet.getSheetByName(reviewSheetName) ||
    spreadsheet.insertSheet(reviewSheetName);

  reviewSheet.clearContents();

  const productData = readProductMasterForReview_(productSheet);
  const aliasData = readProductAliasesForReview_(aliasSheet);

  const results = [];

  /*
   * 1. Doppelte Kombination aus Kategorie und Modellschlüssel.
   */
  const compositeGroups = new Map();

  productData.forEach(product => {
    const key = [
      product.category.toUpperCase(),
      product.modelKey.toUpperCase()
    ].join('|');

    if (!compositeGroups.has(key)) {
      compositeGroups.set(key, []);
    }

    compositeGroups.get(key).push(product);
  });

  compositeGroups.forEach(products => {
    if (products.length <= 1) {
      return;
    }

    results.push([
      'DOPPELTER_KATEGORIE_MODELLSCHLUESSEL',
      'HOCH',
      products.map(item => item.productId).join(', '),
      products[0].category,
      products[0].modelKey,
      '',
      `${products.length} Produkt-IDs für dieselbe Kombination`,
      'Produkt-IDs prüfen und gegebenenfalls zusammenführen'
    ]);
  });

  /*
   * 2. Derselbe Modellschlüssel in mehreren Kategorien.
   */
  const modelGroups = new Map();

  productData.forEach(product => {
    const key = product.modelKey.toUpperCase();

    if (!modelGroups.has(key)) {
      modelGroups.set(key, []);
    }

    modelGroups.get(key).push(product);
  });

  modelGroups.forEach(products => {
    const categories = [
      ...new Set(
        products.map(item => item.category)
      )
    ];

    if (categories.length <= 1) {
      return;
    }

    results.push([
      'MODELLSCHLUESSEL_MEHRERE_KATEGORIEN',
      'MITTEL',
      products.map(item => item.productId).join(', '),
      categories.join(', '),
      products[0].modelKey,
      '',
      `Modellschlüssel kommt in ${categories.length} Kategorien vor`,
      'Prüfen, ob Kategorien fachlich getrennt bleiben müssen'
    ]);
  });

  /*
   * 3. Derselbe normalisierte Alias zeigt auf mehrere Produkt-IDs.
   */
  const aliasGroups = new Map();

  aliasData.forEach(alias => {
    const key = alias.normalizedAlias;

    if (!aliasGroups.has(key)) {
      aliasGroups.set(key, []);
    }

    aliasGroups.get(key).push(alias);
  });

  aliasGroups.forEach(aliases => {
    const productIds = [
      ...new Set(
        aliases.map(item => item.productId)
      )
    ];

    if (productIds.length <= 1) {
      return;
    }

    results.push([
      'ALIAS_MEHRERE_PRODUKT_IDS',
      'HOCH',
      productIds.join(', '),
      '',
      '',
      aliases[0].normalizedAlias,
      `Alias verweist auf ${productIds.length} Produkt-IDs`,
      'Alias-Zuordnung prüfen'
    ]);
  });

  /*
   * 4. Produkte ohne Alias.
   */
  const aliasedProductIds = new Set(
    aliasData.map(alias => alias.productId)
  );

  productData.forEach(product => {
    if (aliasedProductIds.has(product.productId)) {
      return;
    }

    results.push([
      'PRODUKT_OHNE_ALIAS',
      'MITTEL',
      product.productId,
      product.category,
      product.modelKey,
      '',
      'Keine Alias-Zuordnung vorhanden',
      'Mindestens Modellschlüssel als Alias ergänzen'
    ]);
  });

  /*
   * 5. Leere oder unvollständige Produktstamm-Zeilen.
   */
  productData.forEach(product => {
    const missingFields = [];

    if (!product.productId) {
      missingFields.push('Produkt-ID');
    }

    if (!product.category) {
      missingFields.push('Kategorie');
    }

    if (!product.modelKey) {
      missingFields.push('Modellschlüssel');
    }

    if (missingFields.length === 0) {
      return;
    }

    results.push([
      'UNVOLLSTAENDIGER_PRODUKTSTAMM',
      'HOCH',
      product.productId,
      product.category,
      product.modelKey,
      '',
      `Fehlende Felder: ${missingFields.join(', ')}`,
      'Produktstamm-Zeile korrigieren'
    ]);
  });

  /*
   * 6. Auffällig allgemeine Modellschlüssel.
   */
  const generalModelKeyPatterns = [
    /^SONY DSC-HX$/,
    /^PS4$/,
    /^PS5$/,
    /^XBOX$/,
    /^KAMERA$/,
    /^SONSTIGE ELEKTRONIK$/,
    /^NINTENDO DS$/,
    /^GAMEBOY CLASSIC$/
  ];

  productData.forEach(product => {
    const isGeneral = generalModelKeyPatterns.some(
      pattern => pattern.test(product.modelKey.toUpperCase())
    );

    if (!isGeneral) {
      return;
    }

    results.push([
      'ALLGEMEINER_MODELLSCHLUESSEL',
      'NIEDRIG',
      product.productId,
      product.category,
      product.modelKey,
      '',
      'Modellschlüssel ist relativ allgemein',
      'Prüfen, ob konkretere Varianten getrennt werden müssen'
    ]);
  });

  /*
   * Ergebnis schreiben.
   */
  const headers = [
    'Prüfart',
    'Priorität',
    'Produkt-ID(s)',
    'Kategorie',
    'Modellschlüssel',
    'Alias',
    'Beschreibung',
    'Empfohlene Aktion'
  ];

  reviewSheet
    .getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold');

  if (results.length > 0) {
    results.sort((a, b) => {
      const priorityOrder = {
        HOCH: 1,
        MITTEL: 2,
        NIEDRIG: 3
      };

      return (
        priorityOrder[a[1]] -
        priorityOrder[b[1]]
      );
    });

    reviewSheet
      .getRange(
        2,
        1,
        results.length,
        headers.length
      )
      .setValues(results);
  } else {
    reviewSheet.appendRow([
      'KEINE_AUFFAELLIGKEITEN',
      '',
      '',
      '',
      '',
      '',
      'Keine automatischen Prüfprobleme gefunden.',
      ''
    ]);
  }

  reviewSheet.setFrozenRows(1);

  reviewSheet
    .getRange(
      1,
      1,
      Math.max(reviewSheet.getLastRow(), 1),
      headers.length
    )
    .setWrap(true);

  reviewSheet.autoResizeColumns(
    1,
    headers.length
  );

  console.log(
    `Produktstamm-Prüfung abgeschlossen. Auffälligkeiten: ${results.length}`
  );
}


/**
 * Liest nur aktive Produkte aus dem Produktstamm für die Prüfung.
 *
 * Zusammengeführte Produkte mit Aktiv = NEIN werden nicht mehr
 * als Doppelung oder Produkt ohne Alias gemeldet.
 */

function readProductMasterForReview_(productSheet) {
  if (productSheet.getLastRow() < 2) {
    return [];
  }

  const values = productSheet
    .getRange(
      2,
      1,
      productSheet.getLastRow() - 1,
      PRODUCT_CONFIG.PRODUCT_HEADERS.length
    )
    .getDisplayValues();

  return values
    .map((row, index) => ({
      rowNumber: index + 2,
      productId: productCleanText_(row[0]),
      category: productCleanText_(row[1]),
      modelKey: productCleanText_(row[2]),
      standardName: productCleanText_(row[3]),
      active: productCleanText_(row[5]).toUpperCase()
    }))
    .filter(product => {
      /*
       * Nur aktive Produkte prüfen.
       * Leere Aktiv-Felder behandeln wir vorsichtshalber ebenfalls als aktiv.
       */
      return (
        product.active === '' ||
        product.active === 'JA'
      );
    });
}

/**
 * Liest nur aktive Alias-Zuordnungen für die Prüfung.
 */

function readProductAliasesForReview_(aliasSheet) {
  if (aliasSheet.getLastRow() < 2) {
    return [];
  }

  const values = aliasSheet
    .getRange(
      2,
      1,
      aliasSheet.getLastRow() - 1,
      PRODUCT_CONFIG.ALIAS_HEADERS.length
    )
    .getDisplayValues();

  return values
    .map((row, index) => ({
      rowNumber: index + 2,
      alias: productCleanText_(row[0]),
      normalizedAlias: productNormalizeAlias_(row[1]),
      productId: productCleanText_(row[2]),
      active: productCleanText_(row[4]).toUpperCase()
    }))
    .filter(item => {
      const isActive =
        item.active === '' ||
        item.active === 'JA';

      return (
        isActive &&
        item.normalizedAlias &&
        item.productId
      );
    });
}

/**
 * ============================================================
 * PRODUKTSTAMM – KONTROLLIERTE ZUSAMMENFÜHRUNG
 * ============================================================
 *
 * Verarbeitet freigegebene Zusammenführungen aus:
 * Produkt_Zusammenführung
 *
 * Es werden keine Produktstamm-Zeilen gelöscht.
 * Alte Produkt-IDs werden deaktiviert und alle Aliase auf die
 * Ziel-Produkt-ID umgestellt.
 */

function pruefeJtlArtikelbestand() {
  const spreadsheet = SpreadsheetApp.openById(
    EK_CONFIG.TARGET_SPREADSHEET_ID
  );

  const rawSheet = spreadsheet.getSheetByName(
    'JTL_Rohdaten'
  );

  if (!rawSheet) {
    throw new Error(
      'Das Tabellenblatt "JTL_Rohdaten" wurde nicht gefunden.'
    );
  }

  const statisticsSheetName = 'JTL_Artikelstatistik';

  const statisticsSheet =
    spreadsheet.getSheetByName(statisticsSheetName) ||
    spreadsheet.insertSheet(statisticsSheetName);

  statisticsSheet.clearContents();

  if (rawSheet.getLastRow() < 2) {
    throw new Error(
      'JTL_Rohdaten enthält noch keine Verkaufsdaten.'
    );
  }

  const headers = rawSheet
    .getRange(
      1,
      1,
      1,
      rawSheet.getLastColumn()
    )
    .getDisplayValues()[0]
    .map(value => String(value || '').trim());

  const articleNumberIndex =
    headers.indexOf('Artikelnummer');

  const descriptionIndex =
    headers.indexOf('Bezeichnung (Position)');

  const positionTypeIndex =
    headers.indexOf('Positionsart');

  const quantityIndex =
    headers.indexOf('Menge');

  const salesDateIndex =
    headers.indexOf('Auftragsdatum');

  if (
    articleNumberIndex === -1 ||
    descriptionIndex === -1
  ) {
    throw new Error(
      'Artikelnummer oder Bezeichnung (Position) wurde nicht gefunden.'
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

  const articleMap = new Map();
  const descriptions = new Set();
  const salesDates = new Set();

  let rowsWithArticleNumber = 0;
  let rowsWithoutArticleNumber = 0;
  let totalQuantity = 0;

  values.forEach(row => {
    const articleNumber =
      String(row[articleNumberIndex] || '').trim();

    const description =
      String(row[descriptionIndex] || '').trim();

    const positionType =
      positionTypeIndex !== -1
        ? String(row[positionTypeIndex] || '').trim()
        : '';

    const salesDate =
      salesDateIndex !== -1
        ? String(row[salesDateIndex] || '').trim()
        : '';

    const quantity =
      quantityIndex !== -1
        ? parseGermanNumber_(row[quantityIndex])
        : null;

    if (salesDate) {
      salesDates.add(salesDate);
    }

    if (description) {
      descriptions.add(description.toLowerCase());
    }

    if (!articleNumber) {
      rowsWithoutArticleNumber++;
      return;
    }

    rowsWithArticleNumber++;

    if (quantity !== null) {
      totalQuantity += quantity;
    }

    if (!articleMap.has(articleNumber)) {
      articleMap.set(articleNumber, {
        articleNumber: articleNumber,
        descriptions: new Set(),
        positionTypes: new Set(),
        rows: 0,
        quantity: 0
      });
    }

    const article = articleMap.get(articleNumber);

    if (description) {
      article.descriptions.add(description);
    }

    if (positionType) {
      article.positionTypes.add(positionType);
    }

    article.rows++;

    if (quantity !== null) {
      article.quantity += quantity;
    }
  });

  const summaryHeaders = [
    'Kennzahl',
    'Wert'
  ];

  const summaryRows = [
    ['Datenzeilen insgesamt', values.length],
    ['Zeilen mit Artikelnummer', rowsWithArticleNumber],
    ['Zeilen ohne Artikelnummer', rowsWithoutArticleNumber],
    ['Eindeutige Artikelnummern', articleMap.size],
    ['Eindeutige Bezeichnungen', descriptions.size],
    ['Verkaufte Gesamtmenge', totalQuantity],
    ['Enthaltene Verkaufstage', salesDates.size]
  ];

  statisticsSheet
    .getRange(
      1,
      1,
      1,
      summaryHeaders.length
    )
    .setValues([summaryHeaders])
    .setFontWeight('bold');

  statisticsSheet
    .getRange(
      2,
      1,
      summaryRows.length,
      summaryHeaders.length
    )
    .setValues(summaryRows);

  const detailStartRow =
    summaryRows.length + 4;

  const detailHeaders = [
    'Artikelnummer',
    'Bezeichnung(en)',
    'Positionsart(en)',
    'Anzahl Verkaufszeilen',
    'Verkaufte Menge'
  ];

  statisticsSheet
    .getRange(
      detailStartRow,
      1,
      1,
      detailHeaders.length
    )
    .setValues([detailHeaders])
    .setFontWeight('bold');

  const detailRows =
    Array.from(articleMap.values())
      .map(article => [
        article.articleNumber,
        Array.from(article.descriptions).join(' || '),
        Array.from(article.positionTypes).join(' || '),
        article.rows,
        article.quantity
      ])
      .sort((a, b) => b[3] - a[3]);

  if (detailRows.length > 0) {
    statisticsSheet
      .getRange(
        detailStartRow + 1,
        1,
        detailRows.length,
        detailHeaders.length
      )
      .setValues(detailRows);
  }

  statisticsSheet.setFrozenRows(1);
  statisticsSheet.autoResizeColumns(
    1,
    detailHeaders.length
  );

  console.log(
    [
      'JTL-Artikelanalyse abgeschlossen.',
      `Datenzeilen: ${values.length}.`,
      `Eindeutige Artikelnummern: ${articleMap.size}.`,
      `Eindeutige Bezeichnungen: ${descriptions.size}.`,
      `Verkaufstage: ${salesDates.size}.`
    ].join(' ')
  );
}

/**
 * ============================================================
 * PRODUKTSTAMM – VERALTETE AUTOMATISCHE EINTRÄGE DEAKTIVIEREN
 * ============================================================
 *
 * Wann ausführen?
 * Nach Änderungen an Modellschlüssel-, Kategorie- oder Speicherregeln,
 * nachdem normalisiereEinkaufstabelle() und
 * synchronisiereProduktstamm() erfolgreich ausgeführt wurden.
 *
 * Was macht die Funktion?
 * - Sie vergleicht den aktiven Produktstamm mit EK_Normalisiert.
 * - Automatisch erzeugte Produkte, die dort nicht mehr vorkommen,
 *   werden auf Aktiv = NEIN gesetzt.
 * - Die zugehörigen Aliase werden ebenfalls deaktiviert.
 * - Es wird nichts endgültig gelöscht.
 * - Manuell angelegte Produkte werden nicht verändert.
 */
