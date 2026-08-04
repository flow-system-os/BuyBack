/**
 * ============================================================
 * EINKAUFSDATEN NORMALISIEREN UND SYNCHRONISIEREN
 * ============================================================
 *
 * Diese Datei gehört zum modularen BuyBack-Apps-Script-Projekt.
 * Alle .gs-Dateien im selben Apps-Script-Projekt teilen sich
 * Funktionen und Konstanten automatisch. Es sind keine Imports nötig.
 */

function normalisiereEinkaufstabelle() {
  const lock = LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Die Normalisierung der Einkaufstabelle läuft bereits.'
    );
  }

  try {
    const sourceSpreadsheet =
      SpreadsheetApp.openById(
        EK_CONFIG.SOURCE_SPREADSHEET_ID
      );

    const targetSpreadsheet =
      SpreadsheetApp.openById(
        EK_CONFIG.TARGET_SPREADSHEET_ID
      );

    const normalizedSheet =
      ekGetOrCreateSheet_(
        targetSpreadsheet,
        EK_CONFIG.TARGET_SHEET_NORMALIZED
      );

    const rulesSheet =
      ekGetOrCreateSheet_(
        targetSpreadsheet,
        EK_CONFIG.TARGET_SHEET_RULES
      );

    const reviewSheet =
      ekGetOrCreateSheet_(
        targetSpreadsheet,
        EK_CONFIG.TARGET_SHEET_REVIEW
      );

    const logSheet =
      ekGetOrCreateSheet_(
        targetSpreadsheet,
        EK_CONFIG.TARGET_SHEET_LOG
      );

    ekInitializeRuleSheet_(rulesSheet);

    ekPrepareOutputSheet_(
      normalizedSheet,
      EK_CONFIG.NORMALIZED_HEADERS
    );

    ekPrepareOutputSheet_(
      reviewSheet,
      EK_CONFIG.REVIEW_HEADERS
    );

    ekEnsureHeaderOnly_(
      logSheet,
      EK_CONFIG.LOG_HEADERS
    );

    const rules =
      ekLoadRules_(rulesSheet);

    const importTimestamp =
      new Date();

    const normalizedRows = [];
    const reviewRows = [];

    let totalSourceRows = 0;

    EK_CONFIG.SOURCE_SHEETS.forEach(
      sourceSheetName => {
        const sourceSheet =
          sourceSpreadsheet.getSheetByName(
            sourceSheetName
          );

        if (!sourceSheet) {
          reviewRows.push([
            importTimestamp,
            sourceSheetName,
            '',
            '',
            '',
            '',
            '',
            'QUELLTAB_NICHT_GEFUNDEN',
            'OFFEN',
            '',
            '',
            ''
          ]);

          return;
        }

        /*
         * Ausschließlich lesender Zugriff auf die Quelle.
         */
        const sourceValues =
          sourceSheet
            .getDataRange()
            .getDisplayValues();

        totalSourceRows += sourceValues.length;

        const parsedResult =
          ekNormalizeSourceSheet_(
            sourceSheetName,
            sourceValues,
            rules,
            importTimestamp
          );

        normalizedRows.push(
          ...parsedResult.normalizedRows
        );

        reviewRows.push(
          ...parsedResult.reviewRows
        );
      }
    );
ekAddSyncKeys_(normalizedRows);
    if (normalizedRows.length > 0) {
      normalizedSheet
        .getRange(
          2,
          1,
          normalizedRows.length,
          EK_CONFIG.NORMALIZED_HEADERS.length
        )
        .setValues(normalizedRows);

      ekFormatNormalizedSheet_(
        normalizedSheet,
        normalizedRows.length
      );
    }

    if (reviewRows.length > 0) {
      reviewSheet
        .getRange(
          2,
          1,
          reviewRows.length,
          EK_CONFIG.REVIEW_HEADERS.length
        )
        .setValues(reviewRows);

      ekFormatReviewSheet_(
        reviewSheet,
        reviewRows.length
      );
    }

    logSheet.appendRow([
      importTimestamp,
      EK_CONFIG.SOURCE_SHEETS.join(', '),
      totalSourceRows,
      normalizedRows.length,
      reviewRows.length,
      'ERFOLGREICH'
    ]);

    console.log(
      [
        'Normalisierung erfolgreich.',
        `Quellzeilen: ${totalSourceRows}`,
        `Einkaufszeilen: ${normalizedRows.length}`,
        `Prüffälle: ${reviewRows.length}`
      ].join(' ')
    );

  } catch (error) {
    console.error(
      `EK-Normalisierung fehlgeschlagen: ${error.message}`
    );

    throw error;

  } finally {
    lock.releaseLock();
  }
}


/**
 * Verarbeitet einen einzelnen Quelltab.
 *
 * Leere Datumsfelder übernehmen das zuletzt erkannte Datum.
 */

function ekNormalizeSourceSheet_(
  sourceSheetName,
  sourceValues,
  rules,
  importTimestamp
) {
  const normalizedRows = [];
  const reviewRows = [];

  let currentDate = '';

  sourceValues.forEach(
    (sourceRow, rowIndex) => {
      const sourceRowNumber =
        rowIndex + 1;

      const rawDate =
        ekCleanText_(
          sourceRow[
            EK_CONFIG.COLUMNS.DATE
          ]
        );

      const originalProduct =
        ekCleanText_(
          sourceRow[
            EK_CONFIG.COLUMNS.PRODUCT
          ]
        );

      const rawPrice =
        ekCleanText_(
          sourceRow[
            EK_CONFIG.COLUMNS.TOTAL_PRICE
          ]
        );

      const location =
        ekCleanText_(
          sourceRow[
            EK_CONFIG.COLUMNS.LOCATION
          ]
        );

      const additionalInfo =
        ekCleanText_(
          sourceRow[
            EK_CONFIG.COLUMNS.ADDITIONAL_INFO
          ]
        );

      const seller =
        ekCleanText_(
          sourceRow[
            EK_CONFIG.COLUMNS.SELLER
          ]
        );

      /*
       * Vollständig leere Zeilen werden ignoriert.
       */
      if (
        !rawDate &&
        !originalProduct &&
        !rawPrice &&
        !location &&
        !additionalInfo &&
        !seller
      ) {
        return;
      }

      /*
       * Ein gültiges neues Datum wird gespeichert.
       * Folgende Zeilen ohne Datum übernehmen dieses Datum.
       */
      if (rawDate) {
        const parsedDate =
          ekParseDate_(rawDate);

        if (parsedDate) {
          currentDate = parsedDate;
        }
      }

      /*
       * Zeilen ohne Produktbezeichnung sind keine verwertbaren
       * Einkaufspositionen.
       */
      if (!originalProduct) {
        return;
      }

      const totalPrice =
        ekParseMoney_(rawPrice);

      const normalizedName =
        ekNormalizeProductName_(
          originalProduct
        );

      const category =
        ekDetermineCategory_(
          sourceSheetName,
          normalizedName
        );

      let modelKey =
  ekExtractModelKey_(
    normalizedName,
    category
  );

/*
 * Dieselbe Kanonisierung wie auf der Verkaufsseite anwenden,
 * damit Schreibweisen (römische Ziffern, V-Suffix, Alias-Tabelle
 * für Modellcodes) auf beiden Seiten übereinstimmen und der
 * Abgleich über den Modellschlüssel funktioniert.
 */
modelKey =
  salesCanonicalizeModelKey_(
    modelKey,
    category
  );

/*
 * Nur auf der Einkaufsseite werden fehlende Kapazitäten
 * mit den Unternehmensstandards ergänzt.
 */
modelKey =
  ekApplyPurchaseStorageDefaults_(
    modelKey,
    normalizedName,
    category,
    rules
  );

      const packageAnalysis =
        ekAnalyzePackage_(
          normalizedName,
          category,
          rules
        );

      const reviewReasons = [];

      if (!currentDate) {
        reviewReasons.push(
          'KAUFDATUM_FEHLT'
        );
      }

      if (totalPrice === null) {
        reviewReasons.push(
          'EINKAUFSPREIS_NICHT_LESBAR'
        );
      }

      if (!modelKey) {
        reviewReasons.push(
          'MODELLSCHLUESSEL_NICHT_ERKANNT'
        );
      }

      if (
        packageAnalysis.hasMixedMainProducts
      ) {
        reviewReasons.push(
          'GEMISCHTE_HAUPTPRODUKTE'
        );
      }

      if (
        packageAnalysis.requiresAccessoryReview
      ) {
        reviewReasons.push(
          packageAnalysis.accessoryReviewReason
        );
      }

      if (
        packageAnalysis.controllerType ===
        'UNBEKANNT'
      ) {
        reviewReasons.push(
          'CONTROLLER_TYP_UNKLAR'
        );
      } else if (
        packageAnalysis.controllerPriceMissing
      ) {
        reviewReasons.push(
          'CONTROLLER_EK_REGEL_FEHLT'
        );
      }

      let adjustedMainProductPrice = '';

      if (
        totalPrice !== null &&
        !packageAnalysis.hasMixedMainProducts &&
        !packageAnalysis.requiresAccessoryReview &&
        packageAnalysis.controllerType !== 'UNBEKANNT' &&
        !packageAnalysis.controllerPriceMissing
      ) {
        adjustedMainProductPrice =
          Math.max(
            0,
            totalPrice -
            packageAnalysis.controllerDeduction
          );
      }

      const reviewStatus =
        reviewReasons.length > 0
          ? 'ZU_PRUEFEN'
          : 'AUTOMATISCH_VERWENDBAR';

      const sourceRecordId =
  ekCreateSourceRecordId_(
    sourceSheetName,
    sourceRowNumber,
    currentDate,
    originalProduct,
    rawPrice
  );

/*
 * Der Quelldaten-Hash wird aus dem tatsächlichen Inhalt der
 * Einkaufszeile gebildet. Dadurch bleibt er auch dann stabil,
 * wenn Zeilen in der Quelltabelle nach unten verschoben werden.
 */
const sourceContentHash =
  ekCreateSourceContentHash_(
    sourceSheetName,
    currentDate,
    originalProduct,
    rawPrice,
    location,
    additionalInfo,
    seller
  );

      normalizedRows.push([
        importTimestamp,
        sourceSheetName,
        sourceRowNumber,
        currentDate || '',
        originalProduct,
        normalizedName,
        category,
        modelKey,
        totalPrice !== null
          ? totalPrice
          : '',
        packageAnalysis.controllerCount,
        packageAnalysis.controllerType,
        packageAnalysis.controllerDeduction,
        packageAnalysis.zeroValueAccessories.join(
          ', '
        ),
        adjustedMainProductPrice,
        location,
        additionalInfo,
        seller,
        reviewStatus,
reviewReasons.join(' | '),
sourceRecordId,
sourceContentHash,
'' // Wird nach der Erkennung identischer Mehrfacheinträge ergänzt.
      ]);

      if (reviewReasons.length > 0) {
        reviewRows.push([
          importTimestamp,
          sourceSheetName,
          sourceRowNumber,
          currentDate || '',
          originalProduct,
          totalPrice !== null
            ? totalPrice
            : '',
          modelKey,
          reviewReasons.join(' | '),
          'OFFEN',
          '',
          '',
          ''
        ]);
      }
    }
  );

  return {
    normalizedRows,
    reviewRows
  };
}


/**
 * Analysiert Zubehör und Paketbestandteile.
 */

function ekAnalyzePackage_(
  normalizedName,
  category,
  rules
) {
  const result = {
    controllerCount: 0,
    controllerType: '',
    controllerDeduction: 0,
    controllerPriceMissing: false,
    zeroValueAccessories: [],
    requiresAccessoryReview: false,
    accessoryReviewReason: '',
    hasMixedMainProducts: false
  };

  /*
   * Mehrere verschiedene Hauptgeräte in einer Einkaufszeile.
   */
  result.hasMixedMainProducts =
    ekContainsMixedMainProducts_(
      normalizedName
    );

  /*
   * Zubehör mit EK 0 EUR.
   */
  const zeroValuePatterns = [

    {
  regex: /\betiketten?\s*rollen?\b/g,
  label: 'Etikettenrolle'
},
{
  regex: /\brollen?\b/g,
  label: 'Rolle'
},
{
  regex: /\betiketten?\b/g,
  label: 'Etiketten'
},
    {
      regex: /\bspiel(?:e|en)?\b/g,
      label: 'Spiele'
    },
    {
      regex: /\bfifa\b/g,
      label: 'Spiele'
    },
    {
      regex: /\bred dead\b/g,
      label: 'Spiele'
    },
    {
      regex: /\btekken\b/g,
      label: 'Spiele'
    },
    {
      regex: /\bhogwarts\b/g,
      label: 'Spiele'
    },
    {
      regex: /\btransformers\b/g,
      label: 'Spiele'
    },
    {
      regex: /\bladekabel\b/g,
      label: 'Ladekabel'
    },
    {
      regex: /\bladegeraet\b/g,
      label: 'Ladegerät'
    },
    {
      regex: /\btasche\b/g,
      label: 'Tasche'
    },
    {
      regex: /\bhuelle\b/g,
      label: 'Hülle'
    }
  ];

    const containsConsoleMainProduct =
    /\bps4\b|\bps5\b|\bplaystation\b|\bxbox\b|\bswitch\b|\b3ds\b|\b2ds\b|\bdsi\b|\bds lite\b|\bwii\b|\bgameboy\b|\bgame boy\b/.test(
      normalizedName
    );

  const appearsToBeStandaloneGame =
    ekIsStandaloneGame_(normalizedName);

  zeroValuePatterns.forEach(item => {
    const isGameRule =
      item.label === 'Spiele';

    /*
     * Spiele werden nur dann als Zubehör mit 0 EUR behandelt,
     * wenn sie Bestandteil eines Konsolenpakets sind.
     *
     * Ein eigenständig eingekauftes Pokémon-Spiel bleibt dagegen
     * ein eigenes Hauptprodukt mit vollständigem Einkaufspreis.
     */
    if (
      isGameRule &&
      (
        !containsConsoleMainProduct ||
        appearsToBeStandaloneGame
      )
    ) {
      item.regex.lastIndex = 0;
      return;
    }

    if (
      item.regex.test(normalizedName) &&
      !result.zeroValueAccessories.includes(
        item.label
      )
    ) {
      result.zeroValueAccessories.push(
        item.label
      );
    }

    item.regex.lastIndex = 0;
  });

  /*
   * Zubehör, das nicht automatisch mit 0 EUR angesetzt werden darf.
   */
  if (
    /\bobjektiv\b/.test(normalizedName) &&
    category !== 'Objektiv'
  ) {
    result.requiresAccessoryReview = true;
    result.accessoryReviewReason =
      'OBJEKTIV_IM_PAKET';
  }

  /*
 * Tastaturen werden bei Tablets und Smartphones als Beigabe
 * mit 0 EUR behandelt.
 *
 * Außerhalb dieser Produktgruppe bleibt eine Tastatur weiterhin
 * ein Prüffall, weil es sich um ein eigenständiges hochwertiges
 * Produkt handeln könnte.
 */
if (
  /\btastatur\b/.test(normalizedName)
) {
  if (
    category === 'Handys + Tablets' &&
    (
      /\bgalaxy tab\b/.test(normalizedName) ||
      /\bipad\b/.test(normalizedName) ||
      /\btablet\b/.test(normalizedName)
    )
  ) {
    if (
      !result.zeroValueAccessories.includes('Tastatur')
    ) {
      result.zeroValueAccessories.push('Tastatur');
    }
  } else {
    result.requiresAccessoryReview = true;
    result.accessoryReviewReason =
      'TASTATUR_IM_PAKET';
  }
}
/*
 * Eine Maus im Tablet-Paket wird im MVP mit 0 EUR bewertet.
 */
if (
  /\bmaus\b/.test(normalizedName) &&
  category === 'Handys + Tablets' &&
  (
    /\bgalaxy tab\b/.test(normalizedName) ||
    /\bipad\b/.test(normalizedName) ||
    /\btablet\b/.test(normalizedName)
  )
) {
  if (
    !result.zeroValueAccessories.includes('Maus')
  ) {
    result.zeroValueAccessories.push('Maus');
  }
}

  if (
    /\bvr\b|\bvirtual reality\b/.test(
      normalizedName
    ) &&
    category !== 'VR'
  ) {
    result.requiresAccessoryReview = true;
    result.accessoryReviewReason =
      'VR_ZUBEHOER_ODER_VR_GERAET';
  }

  const controllerInfo =
    ekDetectControllers_(
      normalizedName,
      category,
      rules
    );

  result.controllerCount =
    controllerInfo.count;

  result.controllerType =
    controllerInfo.type;

  result.controllerDeduction =
    controllerInfo.deduction;

  result.controllerPriceMissing =
    controllerInfo.priceMissing || false;

  return result;
}


/**
 * Erkennt Controlleranzahl und passenden Fest-EK.
 */

function ekDetectControllers_(
  normalizedName,
  category,
  rules
) {
  let count = 0;

  /*
   * Erfasst beispielsweise:
   * "2 controller"
   * "1 controller"
   */
  const explicitCountMatch =
    normalizedName.match(
      /\b(\d+)\s*(?:x\s*)?controller\b/
    );

  if (explicitCountMatch) {
    count =
      Number(explicitCountMatch[1]);

  } else if (
    /\bcontroller\b/.test(normalizedName)
  ) {
    /*
     * Wenn nur "Controller" ohne Anzahl steht,
     * wird zunächst ein Controller angenommen.
     */
    count = 1;
  }

  /*
   * Nintendo Joy-Cons oder Pro Controller.
   */
  let type = '';

  if (
    /\bjoy[\s-]?con(?:s)?\b/.test(
      normalizedName
    ) ||
    (
      /\bpro controller\b/.test(normalizedName) &&
      category === 'Nintendo'
    )
  ) {
    count = count || 1;
    type = 'NINTENDO_CONTROLLER';
  } else if (count === 0) {
    return {
      count: 0,
      type: '',
      deduction: 0
    };
  } else if (category === 'PS4') {
    type = 'PS4_CONTROLLER';
  } else if (category === 'PS5') {
    type = 'PS5_CONTROLLER';
  } else if (category === 'XBOX') {
    const isSeries =
      /\bseries\s+[sx]\b/.test(
        normalizedName
      );

    type =
      isSeries
        ? 'XBOX_SERIES_CONTROLLER'
        : 'XBOX_ONE_CONTROLLER';
  } else if (category === 'Nintendo') {
    type = 'NINTENDO_CONTROLLER';
  } else {
    return {
      count,
      type: 'UNBEKANNT',
      deduction: 0
    };
  }

  /*
   * Der Fest-EK kommt ausschließlich aus EK_Regeln. Fehlt dort eine
   * aktive Zeile für diesen Controller-Typ, wird kein Wert erraten
   * oder mit einem abweichenden Code-Fallback verrechnet, sondern
   * ein Prüffall ausgelöst (siehe CONTROLLER_EK_REGEL_FEHLT).
   */
  const price =
    rules.controllerPrices[type];

  if (price === undefined) {
    return {
      count,
      type,
      deduction: 0,
      priceMissing: true
    };
  }

  return {
    count,
    type,
    deduction: count * price
  };
}


/**
 * Prüft, ob in einer Zeile mehrere verschiedene Hauptgeräte
 * enthalten sein könnten.
 *
 * Beispiel:
 * "xbox series x + ps4 slim"
 */

function testeEinkaufstabellenZugriff() {
  const sourceSpreadsheet =
    SpreadsheetApp.openById(
      EK_CONFIG.SOURCE_SPREADSHEET_ID
    );

  const sheetNames =
    sourceSpreadsheet
      .getSheets()
      .map(sheet => sheet.getName());

  console.log(
    'Gefundene Einkaufstabs:'
  );

  console.log(sheetNames);

  EK_CONFIG.SOURCE_SHEETS.forEach(
    expectedName => {
      console.log(
        `${expectedName}: ${
          sheetNames.includes(expectedName)
            ? 'GEFUNDEN'
            : 'NICHT GEFUNDEN'
        }`
      );
    }
  );
}



/**
 * Erstellt eine kompakte Auswertung aller offenen Prüfgründe.
 *
 * Ergebnisblatt:
 * EK_Prüfstatistik
 */

function erstelleEkPruefstatistik() {
  const spreadsheet = SpreadsheetApp.openById(
    EK_CONFIG.TARGET_SPREADSHEET_ID
  );

  const reviewSheet = spreadsheet.getSheetByName(
    EK_CONFIG.TARGET_SHEET_REVIEW
  );

  if (!reviewSheet) {
    throw new Error(
      'Das Tabellenblatt "Mapping_Prüfung" wurde nicht gefunden.'
    );
  }

  const statisticsSheet = ekGetOrCreateSheet_(
    spreadsheet,
    'EK_Prüfstatistik'
  );

  statisticsSheet.clearContents();

  const headers = [
    'Prüfgrund',
    'Anzahl',
    'Anteil an Prüffällen',
    'Beispiele'
  ];

  statisticsSheet
    .getRange(1, 1, 1, headers.length)
    .setValues([headers])
    .setFontWeight('bold');

  if (reviewSheet.getLastRow() < 2) {
    statisticsSheet.appendRow([
      'KEINE_PRUEFFAELLE',
      0,
      0,
      ''
    ]);

    return;
  }

  const values = reviewSheet
    .getRange(
      2,
      1,
      reviewSheet.getLastRow() - 1,
      EK_CONFIG.REVIEW_HEADERS.length
    )
    .getDisplayValues();

  /*
   * Spalten in Mapping_Prüfung:
   * E = Originalbezeichnung
   * H = Prüfgrund
   * I = Status
   */
  const PRODUCT_INDEX = 4;
  const REASON_INDEX = 7;
  const STATUS_INDEX = 8;

  const counts = {};
  let totalOpenCases = 0;

  values.forEach(row => {
    const status = ekCleanText_(row[STATUS_INDEX])
      .toUpperCase();

    if (status && status !== 'OFFEN') {
      return;
    }

    const product = ekCleanText_(row[PRODUCT_INDEX]);
    const reasonText = ekCleanText_(row[REASON_INDEX]);

    if (!reasonText) {
      return;
    }

    totalOpenCases++;

    /*
     * Mehrere Gründe stehen getrennt durch:
     * " | "
     */
    const reasons = reasonText
      .split('|')
      .map(reason => reason.trim())
      .filter(Boolean);

    reasons.forEach(reason => {
      if (!counts[reason]) {
        counts[reason] = {
          count: 0,
          examples: []
        };
      }

      counts[reason].count++;

      if (
        product &&
        counts[reason].examples.length < 5 &&
        !counts[reason].examples.includes(product)
      ) {
        counts[reason].examples.push(product);
      }
    });
  });

  const outputRows = Object.entries(counts)
    .map(([reason, data]) => [
      reason,
      data.count,
      totalOpenCases > 0
        ? data.count / totalOpenCases
        : 0,
      data.examples.join(' || ')
    ])
    .sort((a, b) => b[1] - a[1]);

  if (outputRows.length > 0) {
    statisticsSheet
      .getRange(
        2,
        1,
        outputRows.length,
        headers.length
      )
      .setValues(outputRows);

    statisticsSheet
      .getRange(
        2,
        3,
        outputRows.length,
        1
      )
      .setNumberFormat('0.0%');

    statisticsSheet
      .getRange(
        1,
        1,
        outputRows.length + 1,
        headers.length
      )
      .setWrap(true);
  }

  statisticsSheet.setFrozenRows(1);
  statisticsSheet.autoResizeColumns(1, headers.length);

  console.log(
    `Prüfstatistik erstellt. Offene Fälle: ${totalOpenCases}`
  );
}



/**
 * Erkennt typische eigenständige Spiele.
 *
 * Diese Produkte sind selbst die eingekaufte Ware und dürfen
 * nicht mit einem Zubehörwert von 0 EUR behandelt werden.
 */

function aktualisiereNeueUndGeaenderteEinkaeufe() {
  const lock =
    LockService.getScriptLock();

  if (!lock.tryLock(30000)) {
    throw new Error(
      'Eine andere EK-Synchronisierung läuft bereits.'
    );
  }
/*
 * Produktstamm nach jedem erfolgreichen EK-Sync fortlaufend ergänzen.
 */
synchronisiereProduktstamm();
  try {
    const sourceSpreadsheet =
      SpreadsheetApp.openById(
        EK_CONFIG.SOURCE_SPREADSHEET_ID
      );

    const targetSpreadsheet =
      SpreadsheetApp.openById(
        EK_CONFIG.TARGET_SPREADSHEET_ID
      );

    const normalizedSheet =
      targetSpreadsheet.getSheetByName(
        EK_CONFIG.TARGET_SHEET_NORMALIZED
      );

    const rulesSheet =
      targetSpreadsheet.getSheetByName(
        EK_CONFIG.TARGET_SHEET_RULES
      );

    const reviewSheet =
      targetSpreadsheet.getSheetByName(
        EK_CONFIG.TARGET_SHEET_REVIEW
      );

    const logSheet =
      targetSpreadsheet.getSheetByName(
        EK_CONFIG.TARGET_SHEET_LOG
      );

    if (
      !normalizedSheet ||
      !rulesSheet ||
      !reviewSheet ||
      !logSheet
    ) {
      throw new Error(
        'Mindestens eines der benötigten EK-Tabellenblätter fehlt.'
      );
    }

    ekValidateIncrementalHeaders_(
      normalizedSheet
    );

    const rules =
      ekLoadRules_(rulesSheet);

    const syncTimestamp =
      new Date();

    const currentNormalizedRows = [];
    const currentReviewRows = [];

    let totalSourceRows = 0;

    /*
     * Die Quelle wird weiterhin vollständig gelesen.
     * Es werden aber nur Änderungen in das Ziel geschrieben.
     */
    EK_CONFIG.SOURCE_SHEETS.forEach(
      sourceSheetName => {
        const sourceSheet =
          sourceSpreadsheet.getSheetByName(
            sourceSheetName
          );

        if (!sourceSheet) {
          currentReviewRows.push([
            syncTimestamp,
            sourceSheetName,
            '',
            '',
            '',
            '',
            '',
            'QUELLTAB_NICHT_GEFUNDEN',
            'OFFEN',
            '',
            '',
            ''
          ]);

          return;
        }

        const sourceValues =
          sourceSheet
            .getDataRange()
            .getDisplayValues();

        totalSourceRows +=
          sourceValues.length;

        const parsedResult =
          ekNormalizeSourceSheet_(
            sourceSheetName,
            sourceValues,
            rules,
            syncTimestamp
          );

        currentNormalizedRows.push(
          ...parsedResult.normalizedRows
        );

        currentReviewRows.push(
          ...parsedResult.reviewRows
        );
      }
    );

    ekAddSyncKeys_(
      currentNormalizedRows
    );

    const result =
      ekSynchronizeNormalizedRows_(
        normalizedSheet,
        currentNormalizedRows
      );

    /*
     * Die Prüfliste ist klein und wird vollständig neu aufgebaut.
     * So verschwinden erledigte Prüffälle automatisch.
     */
    ekRebuildReviewSheet_(
      reviewSheet,
      currentReviewRows
    );

    logSheet.appendRow([
      syncTimestamp,
      EK_CONFIG.SOURCE_SHEETS.join(', '),
      totalSourceRows,
      currentNormalizedRows.length,
      currentReviewRows.length,
      [
        'INKREMENTELL_ERFOLGREICH',
        `Neu: ${result.added}`,
        `Aktualisiert: ${result.updated}`,
        `Entfernt: ${result.removed}`,
        `Unverändert: ${result.unchanged}`
      ].join(' | ')
    ]);

    console.log(
      [
        'Inkrementelle EK-Synchronisierung erfolgreich.',
        `Neu: ${result.added}.`,
        `Aktualisiert: ${result.updated}.`,
        `Entfernt: ${result.removed}.`,
        `Unverändert: ${result.unchanged}.`,
        `Prüffälle: ${currentReviewRows.length}.`
      ].join(' ')
    );

  } catch (error) {
    console.error(
      `Inkrementelle EK-Synchronisierung fehlgeschlagen: ${error.message}`
    );

    throw error;

  } finally {
    lock.releaseLock();
  }
}


/**
 * Vergleicht aktuelle Quelldaten mit EK_Normalisiert.
 */

function ekSynchronizeNormalizedRows_(
  normalizedSheet,
  currentRows
) {
  const headers =
    EK_CONFIG.NORMALIZED_HEADERS;

  const syncKeyIndex =
    headers.indexOf('Sync-Schlüssel');

  if (syncKeyIndex === -1) {
    throw new Error(
      'Die Spalte "Sync-Schlüssel" wurde nicht gefunden.'
    );
  }

  const existingRows =
    normalizedSheet.getLastRow() >= 2
      ? normalizedSheet
          .getRange(
            2,
            1,
            normalizedSheet.getLastRow() - 1,
            headers.length
          )
          .getValues()
      : [];

  /*
   * Sync-Schlüssel → bestehende Tabellenzeile und Werte
   */
  const existingMap =
    new Map();

  existingRows.forEach(
    (row, arrayIndex) => {
      const syncKey =
        ekCleanText_(
          row[syncKeyIndex]
        );

      if (!syncKey) {
        return;
      }

      existingMap.set(
        syncKey,
        {
          sheetRow: arrayIndex + 2,
          values: row
        }
      );
    }
  );

  const currentKeys =
    new Set();

  const rowsToAppend = [];
  const rowsToUpdate = [];

  let unchanged = 0;

  currentRows.forEach(currentRow => {
    const syncKey =
      ekCleanText_(
        currentRow[syncKeyIndex]
      );

    currentKeys.add(syncKey);

    const existing =
      existingMap.get(syncKey);

    if (!existing) {
      rowsToAppend.push(
        currentRow
      );

      return;
    }

    if (
      ekNormalizedRowsDiffer_(
        existing.values,
        currentRow
      )
    ) {
      rowsToUpdate.push({
        sheetRow:
          existing.sheetRow,
        values:
          currentRow
      });
    } else {
      unchanged++;
    }
  });

  /*
   * Neue Datensätze gesammelt anhängen.
   */
  if (rowsToAppend.length > 0) {
    const firstAppendRow =
      normalizedSheet.getLastRow() + 1;

    normalizedSheet
      .getRange(
        firstAppendRow,
        1,
        rowsToAppend.length,
        headers.length
      )
      .setValues(rowsToAppend);

    ekFormatIncrementalRows_(
      normalizedSheet,
      firstAppendRow,
      rowsToAppend.length
    );
  }

  /*
   * Nur tatsächlich veränderte Datensätze aktualisieren.
   */
  rowsToUpdate.forEach(item => {
    normalizedSheet
      .getRange(
        item.sheetRow,
        1,
        1,
        headers.length
      )
      .setValues([
        item.values
      ]);

    ekFormatIncrementalRows_(
      normalizedSheet,
      item.sheetRow,
      1
    );
  });

  /*
   * Datensätze, die in der aktuellen Quelle nicht mehr existieren,
   * werden entfernt. Löschung immer von unten nach oben, damit sich
   * Zeilennummern nicht gegenseitig verschieben.
   */
  const rowsToDelete = [];

  existingMap.forEach(
    (existing, syncKey) => {
      if (!currentKeys.has(syncKey)) {
        rowsToDelete.push(
          existing.sheetRow
        );
      }
    }
  );

  rowsToDelete
    .sort((a, b) => b - a)
    .forEach(sheetRow => {
      normalizedSheet.deleteRow(
        sheetRow
      );
    });

  return {
    added:
      rowsToAppend.length,

    updated:
      rowsToUpdate.length,

    removed:
      rowsToDelete.length,

    unchanged:
      unchanged
  };
}


/**
 * Vergleicht zwei normalisierte Datensätze.
 *
 * Der Importzeitpunkt wird ignoriert, weil er sich bei jedem
 * Verarbeitungslauf ändern würde.
 */

function ekNormalizedRowsDiffer_(
  existingRow,
  currentRow
) {
  for (
    let columnIndex = 1;
    columnIndex <
      EK_CONFIG.NORMALIZED_HEADERS.length;
    columnIndex++
  ) {
    const existingValue =
      ekComparableCellValue_(
        existingRow[columnIndex]
      );

    const currentValue =
      ekComparableCellValue_(
        currentRow[columnIndex]
      );

    if (
      existingValue !== currentValue
    ) {
      return true;
    }
  }

  return false;
}


/**
 * Vereinheitlicht Zellwerte für den Vergleich.
 */

function ekComparableCellValue_(value) {
  if (value instanceof Date) {
    return Utilities.formatDate(
      value,
      EK_CONFIG.TIMEZONE,
      'yyyy-MM-dd HH:mm:ss'
    );
  }

  if (typeof value === 'number') {
    return String(
      Math.round(
        value * 1000000
      ) / 1000000
    );
  }

  return ekCleanText_(value);
}


/**
 * Baut Mapping_Prüfung aus den aktuellen Quelldaten neu auf.
 */

function ekRebuildReviewSheet_(
  reviewSheet,
  reviewRows
) {
  reviewSheet.clearContents();

  reviewSheet
    .getRange(
      1,
      1,
      1,
      EK_CONFIG.REVIEW_HEADERS.length
    )
    .setValues([
      EK_CONFIG.REVIEW_HEADERS
    ])
    .setFontWeight('bold');

  reviewSheet.setFrozenRows(1);

  if (reviewRows.length === 0) {
    return;
  }

  reviewSheet
    .getRange(
      2,
      1,
      reviewRows.length,
      EK_CONFIG.REVIEW_HEADERS.length
    )
    .setValues(reviewRows);

  ekFormatReviewSheet_(
    reviewSheet,
    reviewRows.length
  );
}


/**
 * Formatiert nur neue oder aktualisierte Zeilen.
 */

function ekFormatIncrementalRows_(
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
      4,
      rowCount,
      1
    )
    .setNumberFormat(
      'dd.MM.yyyy'
    );

  [
    9,  // Gesamtpreis
    12, // Controller-Abzugswert
    14  // Bereinigter Hauptprodukt-EK
  ].forEach(column => {
    sheet
      .getRange(
        firstRow,
        column,
        rowCount,
        1
      )
      .setNumberFormat(
        '#,##0.00 [$€-407]'
      );
  });
}


/**
 * Prüft, ob EK_Normalisiert bereits die neue Struktur besitzt.
 */

function ekValidateIncrementalHeaders_(
  normalizedSheet
) {
  const expectedHeaders =
    EK_CONFIG.NORMALIZED_HEADERS;

  if (
    normalizedSheet.getLastColumn() <
    expectedHeaders.length
  ) {
    throw new Error(
      'EK_Normalisiert besitzt noch nicht die neuen Hash- und Sync-Spalten. ' +
      'Führe zuerst normalisiereEinkaufstabelle() vollständig aus.'
    );
  }

  const currentHeaders =
    normalizedSheet
      .getRange(
        1,
        1,
        1,
        expectedHeaders.length
      )
      .getDisplayValues()[0]
      .map(ekCleanText_);

  expectedHeaders.forEach(
    (expectedHeader, index) => {
      if (
        currentHeaders[index] !==
        expectedHeader
      ) {
        throw new Error(
          `Unerwartete Spalte ${index + 1}: ` +
          `Erwartet "${expectedHeader}", ` +
          `gefunden "${currentHeaders[index]}".`
        );
      }
    }
  );
}


/**
 * ============================================================
 * PRODUKTSTAMM UND PRODUKT-ALIASE
 * ============================================================
 *
 * Erstellt automatisch stabile BuyBack-Produkt-IDs aus den
 * Modellschlüsseln in EK_Normalisiert.
 *
 * Grundsätze:
 * - Bestehende Produkt-IDs werden niemals geändert.
 * - Neue Modellschlüssel erhalten fortlaufende IDs.
 * - Bestehende Produkte werden nicht gelöscht.
 * - Neue Alias-Schreibweisen werden automatisch ergänzt.
 */
