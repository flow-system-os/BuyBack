/**
 * ============================================================
 * EK-REGELN, FORMATIERUNG UND HASH-HILFEN
 * ============================================================
 *
 * Diese Datei gehört zum modularen BuyBack-Apps-Script-Projekt.
 * Alle .gs-Dateien im selben Apps-Script-Projekt teilen sich
 * Funktionen und Konstanten automatisch. Es sind keine Imports nötig.
 */

function ekInitializeRuleSheet_(
  rulesSheet
) {
  const headers = [
    'Regel-ID',
    'Regeltyp',
    'Schlüssel',
    'Wert',
    'Einheit / Methode',
    'Priorität',
    'Aktiv',
    'Kommentar'
  ];

  if (
    rulesSheet.getLastRow() === 0
  ) {
    rulesSheet
      .getRange(
        1,
        1,
        1,
        headers.length
      )
      .setValues([headers]);

    rulesSheet
      .getRange(
        1,
        1,
        1,
        headers.length
      )
      .setFontWeight('bold');

    const initialRules = [
      [
        'STANDARD_EK',
        'PREISREGEL',
        'STANDARD',
        60,
        'LETZTE_3_IN_ZEITRAUM',
        100,
        'JA',
        'MVP-Standardregel'
      ],
      [
        'PS4_CONTROLLER',
        'CONTROLLER_EK',
        'PS4_CONTROLLER',
        15,
        'EUR',
        10,
        'JA',
        'Vorläufiger Fest-EK'
      ],
      [
        'PS5_CONTROLLER',
        'CONTROLLER_EK',
        'PS5_CONTROLLER',
        27,
        'EUR',
        10,
        'JA',
        'Vorläufiger Fest-EK'
      ],
      [
        'XBOX_ONE_CONTROLLER',
        'CONTROLLER_EK',
        'XBOX_ONE_CONTROLLER',
        15,
        'EUR',
        10,
        'JA',
        'Vorläufiger Fest-EK'
      ],
      [
        'XBOX_SERIES_CONTROLLER',
        'CONTROLLER_EK',
        'XBOX_SERIES_CONTROLLER',
        20,
        'EUR',
        10,
        'JA',
        'Vorläufiger Fest-EK'
      ],
      [
        'NINTENDO_CONTROLLER',
        'CONTROLLER_EK',
        'NINTENDO_CONTROLLER',
        20,
        'EUR',
        10,
        'JA',
        'Joy-Cons oder Pro Controller'
      ],
      [
        'SPIELE',
        'ZUBEHOER_EK',
        'SPIELE',
        0,
        'EUR',
        10,
        'JA',
        'Spiele werden nicht separat herausgerechnet'
      ],
      [
        'LADEKABEL',
        'ZUBEHOER_EK',
        'LADEKABEL',
        0,
        'EUR',
        10,
        'JA',
        'MVP-Regel'
      ],
      [
        'TASCHEN',
        'ZUBEHOER_EK',
        'TASCHEN',
        0,
        'EUR',
        10,
        'JA',
        'MVP-Regel'
      ],
      [
        'HUELLEN',
        'ZUBEHOER_EK',
        'HUELLEN',
        0,
        'EUR',
        10,
        'JA',
        'Einfache Hüllen'
      ],
      [
        'OBJEKTIV_PAKET',
        'PRUEFREGEL',
        'OBJEKTIV_IM_PAKET',
        '',
        'TO_CHECK',
        10,
        'JA',
        'Nicht automatisch auf 0 EUR setzen'
      ],
      [
        'TASTATUR_PAKET',
        'PRUEFREGEL',
        'TASTATUR_IM_PAKET',
        '',
        'TO_CHECK',
        10,
        'JA',
        'Nicht automatisch auf 0 EUR setzen'
      ],
      [
        'VR_ZUBEHOER',
        'PRUEFREGEL',
        'VR_ZUBEHOER',
        '',
        'TO_CHECK',
        10,
        'JA',
        'Nicht automatisch auf 0 EUR setzen'
      ],
      [
        'GEMISCHTE_HAUPTGERAETE',
        'PRUEFREGEL',
        'GEMISCHTE_HAUPTGERAETE',
        '',
        'TO_CHECK',
        10,
        'JA',
        'Preisaufteilung erforderlich'
      ]
    ];

    rulesSheet
      .getRange(
        2,
        1,
        initialRules.length,
        headers.length
      )
      .setValues(initialRules);

    rulesSheet.setFrozenRows(1);
    rulesSheet.autoResizeColumns(
      1,
      headers.length
    );
  }
}


/**
 * Liest fachliche Regeln aus EK_Regeln.
 *
 * Enthalten:
 * - Controller-Festpreise
 * - Standard-Speicherwerte für unvollständige Einkaufseinträge
 */

function ekLoadRules_(rulesSheet) {
  const defaultStorage = {
    PHONE: 128,
    TABLET: 64,
    PS4: 500,
    PS5: 825,
    XBOX_ONE: 500
  };

  /*
   * Controller-Festpreise haben keinen Code-Fallback mehr.
   * Einzige Quelle ist eine aktive CONTROLLER_EK-Zeile in EK_Regeln;
   * fehlt sie, bleibt der Schlüssel unbesetzt und der Aufrufer löst
   * dafür einen Prüffall aus, statt mit einem geratenen Wert weiterzurechnen.
   */
  if (rulesSheet.getLastRow() < 2) {
    return {
      controllerPrices: {},
      defaultStorage: defaultStorage
    };
  }

  const values = rulesSheet
    .getRange(
      2,
      1,
      rulesSheet.getLastRow() - 1,
      8
    )
    .getDisplayValues();

  const controllerPrices = {};

  const loadedDefaultStorage = {
    ...defaultStorage
  };

  values.forEach(row => {
    const ruleType =
      ekCleanText_(row[1]).toUpperCase();

    const key =
      ekCleanText_(row[2]).toUpperCase();

    const active =
      ekCleanText_(row[6]).toUpperCase();

    if (active !== 'JA') {
      return;
    }

    if (
      ruleType === 'CONTROLLER_EK' &&
      key
    ) {
      const price =
        ekParseMoney_(row[3]);

      if (price !== null) {
        controllerPrices[key] = price;
      }

      return;
    }

    if (
      ruleType === 'STANDARD_STORAGE' &&
      Object.prototype.hasOwnProperty.call(
        loadedDefaultStorage,
        key
      )
    ) {
      const storage =
        ekParseMoney_(row[3]);

      if (storage !== null) {
        loadedDefaultStorage[key] = storage;
      }
    }
  });

  return {
    controllerPrices: controllerPrices,
    defaultStorage: loadedDefaultStorage
  };
}

/**
 * Löscht ausschließlich die alte normalisierte Arbeitskopie
 * im Ziel-Spreadsheet und setzt die Kopfzeile neu.
 *
 * Die externe Einkaufstabelle wird nicht verändert.
 */

function ekPrepareOutputSheet_(
  sheet,
  headers
) {
  sheet.clearContents();

  sheet
    .getRange(
      1,
      1,
      1,
      headers.length
    )
    .setValues([headers]);

  sheet
    .getRange(
      1,
      1,
      1,
      headers.length
    )
    .setFontWeight('bold');

  sheet.setFrozenRows(1);
}


/**
 * Legt nur dann eine Kopfzeile an, wenn das Log leer ist.
 */

function ekEnsureHeaderOnly_(
  sheet,
  headers
) {
  if (
    sheet.getLastRow() > 0
  ) {
    return;
  }

  sheet
    .getRange(
      1,
      1,
      1,
      headers.length
    )
    .setValues([headers]);

  sheet
    .getRange(
      1,
      1,
      1,
      headers.length
    )
    .setFontWeight('bold');

  sheet.setFrozenRows(1);
}


/**
 * Formatiert die normalisierten Daten.
 */

function ekFormatNormalizedSheet_(
  sheet,
  dataRowCount
) {
  if (dataRowCount <= 0) {
    return;
  }

  sheet
    .getRange(
      2,
      1,
      dataRowCount,
      1
    )
    .setNumberFormat(
      'dd.MM.yyyy HH:mm:ss'
    );

  sheet
    .getRange(
      2,
      4,
      dataRowCount,
      1
    )
    .setNumberFormat(
      'dd.MM.yyyy'
    );

  /*
   * Gesamtpreis
   */
  sheet
    .getRange(
      2,
      9,
      dataRowCount,
      1
    )
    .setNumberFormat(
      '#,##0.00 [$€-407]'
    );

  /*
   * Controller-Abzugswert
   */
  sheet
    .getRange(
      2,
      12,
      dataRowCount,
      1
    )
    .setNumberFormat(
      '#,##0.00 [$€-407]'
    );

  /*
   * Bereinigter Hauptprodukt-EK
   */
  sheet
    .getRange(
      2,
      14,
      dataRowCount,
      1
    )
    .setNumberFormat(
      '#,##0.00 [$€-407]'
    );

  sheet
    .getRange(
      1,
      1,
      dataRowCount + 1,
      EK_CONFIG.NORMALIZED_HEADERS.length
    )
    .setWrap(true);

  sheet.autoResizeColumns(
    1,
    EK_CONFIG.NORMALIZED_HEADERS.length
  );
}


/**
 * Formatiert die Prüfliste.
 */

function ekFormatReviewSheet_(
  sheet,
  dataRowCount
) {
  if (dataRowCount <= 0) {
    return;
  }

  sheet
    .getRange(
      2,
      1,
      dataRowCount,
      1
    )
    .setNumberFormat(
      'dd.MM.yyyy HH:mm:ss'
    );

  sheet
    .getRange(
      2,
      4,
      dataRowCount,
      1
    )
    .setNumberFormat(
      'dd.MM.yyyy'
    );

  sheet
    .getRange(
      2,
      6,
      dataRowCount,
      1
    )
    .setNumberFormat(
      '#,##0.00 [$€-407]'
    );

  sheet
    .getRange(
      1,
      1,
      dataRowCount + 1,
      EK_CONFIG.REVIEW_HEADERS.length
    )
    .setWrap(true);

  sheet.autoResizeColumns(
    1,
    EK_CONFIG.REVIEW_HEADERS.length
  );
}


/**
 * Gibt ein vorhandenes Blatt zurück oder legt es im Ziel an.
 */

function ekGetOrCreateSheet_(
  spreadsheet,
  sheetName
) {
  const existingSheet =
    spreadsheet.getSheetByName(
      sheetName
    );

  if (existingSheet) {
    return existingSheet;
  }

  return spreadsheet.insertSheet(
    sheetName
  );
}


/**
 * Entfernt technisch störende Leerzeichen.
 */

function ekCleanText_(value) {
  return String(
    value === null ||
    value === undefined
      ? ''
      : value
  )
    .replace(/\u00A0/g, ' ')
    .replace(/\u0000/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}


/**
 * Reiner Verbindungstest.
 *
 * Diese Funktion liest nur die Namen der vorhandenen Quelltabs.
 */

function ekParseMoney_(value) {
  if (
    value === null ||
    value === undefined ||
    value === ''
  ) {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? value
      : null;
  }

  let text =
    String(value)
      .trim()
      .replace(/\s/g, '')
      .replace(/€/gi, '')
      .replace(/eur/gi, '')
      .replace(/[^\d,.\-]/g, '');

  if (!text) {
    return null;
  }

  const hasComma =
    text.includes(',');

  const hasDot =
    text.includes('.');

  if (hasComma && hasDot) {
    if (
      text.lastIndexOf(',') >
      text.lastIndexOf('.')
    ) {
      text =
        text
          .replace(/\./g, '')
          .replace(',', '.');
    } else {
      text =
        text.replace(/,/g, '');
    }

  } else if (hasComma) {
    text =
      text.replace(',', '.');
  } else if (hasDot) {
    /*
     * Kein Komma vorhanden: ein einzelner Punkt kann deutsches
     * Tausendertrennzeichen sein (z.B. "1.650" = 1650 EUR) oder ein
     * Dezimalpunkt (z.B. "199.99"). Deutsche Tausendergruppen haben
     * immer genau drei Ziffern, ein Preis mit Nachkommastellen hat
     * ein oder zwei - das unterscheidet beide Fälle zuverlässig.
     */
    if (/^\d{1,3}(\.\d{3})+$/.test(text)) {
      text = text.replace(/\./g, '');
    }
  }

  const parsed =
    Number(text);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}


/**
 * Erkennt deutsche Datumsangaben.
 *
 * Rückgabe ist ein echtes Date-Objekt.
 */

function ekParseDate_(value) {
  if (value instanceof Date) {
    return value;
  }

  const text =
    ekCleanText_(value);

  if (!text) {
    return null;
  }

  const match =
    text.match(
      /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/
    );

  if (!match) {
    return null;
  }

  const day =
    Number(match[1]);

  const month =
    Number(match[2]);

  let year =
    Number(match[3]);

  if (year < 100) {
    year += 2000;
  }

  const date =
    new Date(
      year,
      month - 1,
      day
    );

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return null;
  }

  return date;
}


/**
 * Erstellt eine reproduzierbare Datensatz-ID.
 */

function ekCreateSourceRecordId_(
  sheetName,
  rowNumber,
  date,
  product,
  price
) {
  const rawKey = [
    sheetName,
    rowNumber,
    date instanceof Date
      ? Utilities.formatDate(
          date,
          EK_CONFIG.TIMEZONE,
          'yyyy-MM-dd'
        )
      : '',
    product,
    price
  ].join('|');

  const digest =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      rawKey,
      Utilities.Charset.UTF_8
    );

  return digest
    .map(byte => {
      const normalized =
        byte < 0
          ? byte + 256
          : byte;

      return normalized
        .toString(16)
        .padStart(2, '0');
    })
    .join('');
}


/**
 * Legt die anfänglichen fachlichen Regeln an.
 *
 * Bereits vorhandene Regeln werden nicht überschrieben.
 */

function ekCreateSourceContentHash_(
  sheetName,
  date,
  product,
  price,
  location,
  additionalInfo,
  seller
) {
  const normalizedDate =
    date instanceof Date
      ? Utilities.formatDate(
          date,
          EK_CONFIG.TIMEZONE,
          'yyyy-MM-dd'
        )
      : ekCleanText_(date);

  const rawKey = [
    ekCleanText_(sheetName).toUpperCase(),
    normalizedDate,
    ekCleanText_(product).toLowerCase(),
    ekCleanText_(price).toLowerCase(),
    ekCleanText_(location).toLowerCase(),
    ekCleanText_(additionalInfo).toLowerCase(),
    ekCleanText_(seller).toLowerCase()
  ].join('|');

  return ekCreateSha256_(rawKey);
}


/**
 * Erstellt einen SHA-256-Hash.
 */

function ekCreateSha256_(value) {
  const digest =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      String(value || ''),
      Utilities.Charset.UTF_8
    );

  return digest
    .map(byte => {
      const unsignedByte =
        byte < 0
          ? byte + 256
          : byte;

      return unsignedByte
        .toString(16)
        .padStart(2, '0');
    })
    .join('');
}

/**
 * Ergänzt je identischem Quelldaten-Hash eine laufende Nummer.
 *
 * Beispiel:
 * abc123#1
 * abc123#2
 *
 * So bleiben auch zwei inhaltlich identische Einkäufe als
 * zwei getrennte Datensätze erhalten.
 */

function ekAddSyncKeys_(normalizedRows) {
  const hashCounts = {};

  const hashIndex =
    EK_CONFIG.NORMALIZED_HEADERS.indexOf(
      'Quelldaten-Hash'
    );

  const syncKeyIndex =
    EK_CONFIG.NORMALIZED_HEADERS.indexOf(
      'Sync-Schlüssel'
    );

  if (
    hashIndex === -1 ||
    syncKeyIndex === -1
  ) {
    throw new Error(
      'Quelldaten-Hash oder Sync-Schlüssel fehlt in NORMALIZED_HEADERS.'
    );
  }

  normalizedRows.forEach(row => {
    const hash =
      ekCleanText_(row[hashIndex]);

    if (!hash) {
      throw new Error(
        'Für eine normalisierte Einkaufszeile konnte kein Hash erzeugt werden.'
      );
    }

    hashCounts[hash] =
      (hashCounts[hash] || 0) + 1;

    row[syncKeyIndex] =
      `${hash}#${hashCounts[hash]}`;
  });

  return normalizedRows;
}

/**
 * ============================================================
 * INKREMENTELLE EK-SYNCHRONISIERUNG
 * ============================================================
 *
 * Diese Funktion ist für den täglichen Betrieb vorgesehen.
 *
 * Sie:
 * - liest die relevanten Einkaufstabs,
 * - normalisiert die Daten im Arbeitsspeicher,
 * - vergleicht sie über stabile Sync-Schlüssel,
 * - ergänzt neue Einkäufe,
 * - aktualisiert geänderte Einkäufe,
 * - entfernt nicht mehr vorhandene Datensätze,
 * - baut die kleine Prüfliste neu auf.
 *
 * Die externe Einkaufstabelle wird ausschließlich gelesen.
 */
