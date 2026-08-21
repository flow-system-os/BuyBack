/**
 * ============================================================
 * JTL-CSV-IMPORT UND ARCHIVIERUNG
 * ============================================================
 *
 * Diese Datei gehört zum modularen BuyBack-Apps-Script-Projekt.
 * Alle .gs-Dateien im selben Apps-Script-Projekt teilen sich
 * Funktionen und Konstanten automatisch. Es sind keine Imports nötig.
 */

function importiereNeueJtlDateien() {
  const lock = LockService.getScriptLock();

  // Verhindert, dass zwei Trigger denselben Import gleichzeitig starten.
  if (!lock.tryLock(30000)) {
    console.log('Ein anderer Import läuft bereits.');
    return;
  }

  try {
    const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

    const rawSheet = getRequiredSheet_(
      spreadsheet,
      CONFIG.RAW_SHEET_NAME
    );

    const logSheet = getRequiredSheet_(
      spreadsheet,
      CONFIG.LOG_SHEET_NAME
    );

    const errorSheet = getRequiredSheet_(
      spreadsheet,
      CONFIG.ERROR_SHEET_NAME
    );

    initializeSheets_(rawSheet, logSheet, errorSheet);

    const processedFileIds = getProcessedFileIds_(logSheet);
    const newFiles = getNewCsvFiles_(processedFileIds);

    if (newFiles.length === 0) {
      const message = 'Upload fehlt zur Verarbeitung';

      console.log(message);

      writeErrorLog_(
        errorSheet,
        '',
        '',
        'KEINE_NEUE_DATEI',
        message
      );

      // Sobald der gewünschte Chat-Kanal feststeht,
      // wird hier zusätzlich die Chat-Nachricht versendet.
      sendMissingUploadNotification_(message);

      return;
    }

    // Älteste noch nicht verarbeitete Datei zuerst.
    newFiles.sort(
      (a, b) => a.getDateCreated().getTime() - b.getDateCreated().getTime()
    );

    newFiles.forEach(file => {
      try {
        importSingleFile_(file, rawSheet, logSheet, errorSheet);
      } catch (error) {
        console.error(
          `Fehler bei Datei "${file.getName()}": ${error.message}`
        );

        writeErrorLog_(
          errorSheet,
          file.getName(),
          file.getId(),
          'IMPORT_FEHLGESCHLAGEN',
          error.message
        );
      }
    });

  } catch (error) {
    console.error(`Allgemeiner Importfehler: ${error.message}`);
    throw error;
  } finally {
    lock.releaseLock();
  }
}


/**
 * Importiert eine einzelne CSV-Datei.
 *
 * Nach erfolgreichem Import wird die Quelldatei in den
 * Unterordner "Archiv" verschoben.
 */

function importSingleFile_(file, rawSheet, logSheet, errorSheet) {
  const fileName = file.getName();
  const fileId = file.getId();

  console.log(`Verarbeite Datei: ${fileName}`);

  const csvResult = readAndParseCsv_(file);
  const csvRows = csvResult.rows;

  if (!csvRows || csvRows.length === 0) {
    throw new Error('Die CSV-Datei ist leer.');
  }

  const headerInfo = findHeaderRow_(csvRows);

  if (!headerInfo) {
    throw new Error(
      'Die erwartete Kopfzeile wurde nicht gefunden. Erwartete Spalten: ' +
      CONFIG.EXPECTED_HEADERS.join(', ')
    );
  }

  const sourceHeaders = headerInfo.headers;
  const headerRowIndex = headerInfo.rowIndex;

  const columnIndexes = createColumnIndexMap_(sourceHeaders);
  const dataRows = csvRows.slice(headerRowIndex + 1);

  const importTimestamp = new Date();
  const outputRows = [];

  const quantitySourceIndex =
    columnIndexes[normalizeHeader_('Menge')];

  const grossSalesPriceSourceIndex =
    columnIndexes[normalizeHeader_('Brutto-VK')];

  const currencySourceIndex =
    columnIndexes[normalizeHeader_('Währung')];

  dataRows.forEach((sourceRow, relativeIndex) => {
    if (isEmptyRow_(sourceRow)) {
      return;
    }

    const selectedValues = CONFIG.EXPECTED_HEADERS.map(header => {
      const columnIndex = columnIndexes[normalizeHeader_(header)];

      if (columnIndex === undefined) {
        return '';
      }

      return cleanCellValue_(sourceRow[columnIndex]);
    });

    const quantity = parseGermanNumber_(
      sourceRow[quantitySourceIndex]
    );

    const rawUnitGrossSalesPrice = parseGermanNumber_(
      sourceRow[grossSalesPriceSourceIndex]
    );

    /*
     * Brutto-VK steht im Rohexport in der jeweiligen Original-Waehrung
     * (siehe EXPECTED_HEADERS/Waehrung). Einzel-VK/Gesamtumsatz werden
     * hier bereits nach EUR umgerechnet, weil Tagesprofite bevorzugt
     * diese abgeleiteten Spalten liest - Brutto-VK selbst bleibt
     * unveraendert zur Nachvollziehbarkeit stehen.
     */
    const currencyCode =
      currencySourceIndex !== undefined
        ? cleanCellValue_(sourceRow[currencySourceIndex]).toUpperCase()
        : '';

    const exchangeRate =
      CONFIG.CURRENCY_RATES_TO_EUR[currencyCode] || 1;

    const unitGrossSalesPrice =
      rawUnitGrossSalesPrice !== null
        ? Math.round((rawUnitGrossSalesPrice * exchangeRate + Number.EPSILON) * 100) / 100
        : null;

    /*
     * Vorläufige fachliche Annahme:
     * Brutto-VK ist der Bruttoverkaufspreis pro Stück.
     */
    const totalGrossSales =
      quantity !== null && unitGrossSalesPrice !== null
        ? quantity * unitGrossSalesPrice
        : '';

    /*
     * Arrays beginnen bei 0.
     * Die tatsächliche CSV-Zeilennummer beginnt bei 1.
     */
    const csvSourceRowNumber =
      headerRowIndex + relativeIndex + 2;

    outputRows.push([
      importTimestamp,
      fileName,
      fileId,
      csvSourceRowNumber,
      ...selectedValues,
      unitGrossSalesPrice !== null
        ? unitGrossSalesPrice
        : '',
      totalGrossSales
    ]);
  });

  if (outputRows.length === 0) {
    throw new Error(
      'Unterhalb der Kopfzeile wurden keine Datenzeilen gefunden.'
    );
  }

  validateOutputStructure_(rawSheet);

  const firstTargetRow = rawSheet.getLastRow() + 1;

  const outputColumnCount =
    CONFIG.TECHNICAL_HEADERS.length +
    CONFIG.EXPECTED_HEADERS.length +
    CONFIG.DERIVED_HEADERS.length;

  rawSheet
    .getRange(
      firstTargetRow,
      1,
      outputRows.length,
      outputColumnCount
    )
    .setValues(outputRows);

  formatImportedRows_(
    rawSheet,
    firstTargetRow,
    outputRows.length
  );

  const salesDate = detectSalesDate_(
    outputRows,
    fileName
  );

  /*
   * Zuerst wird der erfolgreiche Import protokolliert.
   * Dadurch kann die Datei bei einem möglichen Archivierungsfehler
   * trotzdem nicht versehentlich ein zweites Mal importiert werden.
   */
  logSheet.appendRow([
    importTimestamp,
    fileName,
    fileId,
    salesDate,
    outputRows.length,
    delimiterDisplayName_(csvResult.delimiter),
    'ERFOLGREICH'
  ]);

  /*
   * Die Archivierung ist ein nachgelagerter Schritt.
   * Falls sie fehlschlägt, bleiben Import und Import-Log trotzdem gültig.
   */
  try {
    archiveImportedFile_(file);

    console.log(
      `Import und Archivierung erfolgreich: ` +
      `${fileName}, ${outputRows.length} Zeilen.`
    );
  } catch (archiveError) {
    console.error(
      `Import erfolgreich, Archivierung fehlgeschlagen: ` +
      archiveError.message
    );

    writeErrorLog_(
      errorSheet,
      fileName,
      fileId,
      'ARCHIVIERUNG_FEHLGESCHLAGEN',
      archiveError.message
    );
  }
}


/**
 * Liest eine Datei und versucht automatisch:
 * - UTF-8
 * - Windows-1252
 * - Semikolon
 * - Komma
 * - Tabulator
 */

function readAndParseCsv_(file) {
  const blob = file.getBlob();

  let content = blob.getDataAsString('UTF-8');
  content = removeBom_(content);

  /*
   * Das Zeichen � weist häufig darauf hin, dass eine Windows-1252-Datei
   * fälschlicherweise als UTF-8 gelesen wurde.
   */
  if (content.includes('\uFFFD')) {
    content = blob.getDataAsString('Windows-1252');
    content = removeBom_(content);
  }

  if (!content.trim()) {
    throw new Error('Die CSV-Datei enthält keinen lesbaren Inhalt.');
  }

  const delimiter = detectDelimiter_(content);
  const rows = Utilities.parseCsv(content, delimiter);

  if (!rows || rows.length === 0) {
    throw new Error('Die CSV-Datei konnte nicht geparst werden.');
  }

  return {
    rows: rows,
    delimiter: delimiter
  };
}


/**
 * Erkennt das wahrscheinlich verwendete Trennzeichen.
 *
 * Deutsche JTL-Exporte verwenden häufig ein Semikolon.
 * Trotzdem werden auch Komma und Tabulator unterstützt.
 */

function detectDelimiter_(content) {
  const lines = content
    .split(/\r?\n/)
    .filter(line => line.trim() !== '')
    .slice(0, 10);

  if (lines.length === 0) {
    return ';';
  }

  const candidates = [';', '\t', ','];
  let bestDelimiter = ';';
  let bestScore = -1;

  candidates.forEach(delimiter => {
    let score = 0;

    lines.forEach(line => {
      score += countDelimiterOutsideQuotes_(line, delimiter);
    });

    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = delimiter;
    }
  });

  return bestDelimiter;
}


/**
 * Zählt Trennzeichen außerhalb von Anführungszeichen.
 */

function countDelimiterOutsideQuotes_(line, delimiter) {
  let count = 0;
  let insideQuotes = false;

  for (let index = 0; index < line.length; index++) {
    const character = line[index];

    if (character === '"') {
      /*
       * Zwei aufeinanderfolgende Anführungszeichen innerhalb eines
       * CSV-Feldes stellen ein maskiertes Anführungszeichen dar.
       */
      if (
        insideQuotes &&
        index + 1 < line.length &&
        line[index + 1] === '"'
      ) {
        index++;
        continue;
      }

      insideQuotes = !insideQuotes;
      continue;
    }

    if (!insideQuotes && character === delimiter) {
      count++;
    }
  }

  return count;
}


/**
 * Sucht die Kopfzeile in den ersten zehn CSV-Zeilen.
 */

function findHeaderRow_(rows) {
  const maximumRowsToCheck = Math.min(rows.length, 10);

  for (let rowIndex = 0; rowIndex < maximumRowsToCheck; rowIndex++) {
    const normalizedHeaders = rows[rowIndex].map(normalizeHeader_);

    const allHeadersPresent = CONFIG.EXPECTED_HEADERS.every(
      expectedHeader =>
        normalizedHeaders.includes(
          normalizeHeader_(expectedHeader)
        )
    );

    if (allHeadersPresent) {
      return {
        rowIndex: rowIndex,
        headers: rows[rowIndex]
      };
    }
  }

  return null;
}


/**
 * Erstellt aus der CSV-Kopfzeile eine Zuordnung:
 *
 * normalisierter Spaltenname → Spaltenindex
 */

function createColumnIndexMap_(headers) {
  const indexMap = {};

  headers.forEach((header, index) => {
    const normalizedHeader = normalizeHeader_(header);

    if (
      normalizedHeader &&
      indexMap[normalizedHeader] === undefined
    ) {
      indexMap[normalizedHeader] = index;
    }
  });

  const missingHeaders = CONFIG.EXPECTED_HEADERS.filter(
    expectedHeader =>
      indexMap[normalizeHeader_(expectedHeader)] === undefined
  );

  if (missingHeaders.length > 0) {
    throw new Error(
      'Folgende Pflichtspalten fehlen: ' +
      missingHeaders.join(', ')
    );
  }

  return indexMap;
}


/**
 * Holt alle noch nicht importierten CSV-Dateien aus dem Drive-Ordner.
 */

function getNewCsvFiles_(processedFileIds) {
  const folder = DriveApp.getFolderById(
    CONFIG.DRIVE_FOLDER_ID
  );

  const files = folder.getFiles();
  const newFiles = [];

  while (files.hasNext()) {
    const file = files.next();

    if (!isCsvFile_(file)) {
      continue;
    }

    if (processedFileIds.has(file.getId())) {
      continue;
    }

    newFiles.push(file);
  }

  return newFiles;
}


/**
 * Erkennt CSV-Dateien auch dann, wenn Drive die Endung nicht deutlich anzeigt.
 */

function isCsvFile_(file) {
  const name = file.getName().toLowerCase();
  const mimeType = String(file.getMimeType()).toLowerCase();

  return (
    name.endsWith('.csv') ||
    mimeType === 'text/csv' ||
    mimeType.includes('csv')
  );
}


/**
 * Liest aus dem Import_Log alle erfolgreich verarbeiteten Drive-Datei-IDs.
 */

function getProcessedFileIds_(logSheet) {
  const processedIds = new Set();

  if (logSheet.getLastRow() < 2) {
    return processedIds;
  }

  const values = logSheet
    .getRange(
      2,
      1,
      logSheet.getLastRow() - 1,
      CONFIG.LOG_HEADERS.length
    )
    .getValues();

  values.forEach(row => {
    const fileId = String(row[2] || '').trim();
    const status = String(row[6] || '').trim().toUpperCase();

    if (fileId && status === 'ERFOLGREICH') {
      processedIds.add(fileId);
    }
  });

  return processedIds;
}


/**
 * Legt die Kopfzeilen an, sofern die Tabellenblätter noch leer sind.
 */

function initializeSheets_(rawSheet, logSheet, errorSheet) {
 const rawHeaders = [
  ...CONFIG.TECHNICAL_HEADERS,
  ...CONFIG.EXPECTED_HEADERS,
  ...CONFIG.DERIVED_HEADERS
];

  ensureHeaderRow_(rawSheet, rawHeaders);
  ensureHeaderRow_(logSheet, CONFIG.LOG_HEADERS);
  ensureHeaderRow_(errorSheet, CONFIG.ERROR_HEADERS);

  rawSheet.setFrozenRows(1);
  logSheet.setFrozenRows(1);
  errorSheet.setFrozenRows(1);
}


/**
 * Schreibt bei einem leeren Tabellenblatt die gewünschte Kopfzeile.
 */

function ensureHeaderRow_(sheet, expectedHeaders) {
  if (sheet.getLastRow() === 0) {
    sheet
      .getRange(1, 1, 1, expectedHeaders.length)
      .setValues([expectedHeaders]);

    sheet
      .getRange(1, 1, 1, expectedHeaders.length)
      .setFontWeight('bold');

    return;
  }

  const currentHeaders = sheet
    .getRange(1, 1, 1, expectedHeaders.length)
    .getValues()[0]
    .map(value => String(value).trim());

  const headerIsCorrect = expectedHeaders.every(
    (header, index) => currentHeaders[index] === header
  );

  if (!headerIsCorrect) {
    throw new Error(
      `Die Kopfzeile im Tabellenblatt "${sheet.getName()}" ` +
      'entspricht nicht der erwarteten Struktur.'
    );
  }
}


/**
 * Zusätzliche Sicherheitsprüfung vor dem Schreiben der Rohdaten.
 */

function validateOutputStructure_(rawSheet) {
  const expectedHeaders = [
  ...CONFIG.TECHNICAL_HEADERS,
  ...CONFIG.EXPECTED_HEADERS,
  ...CONFIG.DERIVED_HEADERS
];

  const currentHeaders = rawSheet
    .getRange(1, 1, 1, expectedHeaders.length)
    .getValues()[0]
    .map(value => String(value).trim());

  expectedHeaders.forEach((expectedHeader, index) => {
    if (currentHeaders[index] !== expectedHeader) {
      throw new Error(
        `Unerwartete Zielstruktur in Spalte ${index + 1}. ` +
        `Erwartet: "${expectedHeader}", ` +
        `gefunden: "${currentHeaders[index]}".`
      );
    }
  });
}


/**
 * Formatiert die neu importierten Zeilen.
 */

function formatImportedRows_(sheet, firstRow, rowCount) {
  if (rowCount <= 0) {
    return;
  }

  // Importzeitpunkt
  sheet
    .getRange(firstRow, 1, rowCount, 1)
    .setNumberFormat('dd.MM.yyyy HH:mm:ss');

  const technicalColumnCount =
    CONFIG.TECHNICAL_HEADERS.length;

  const orderNumberColumn =
    technicalColumnCount +
    CONFIG.EXPECTED_HEADERS.indexOf('Auftragsnummer') +
    1;

  const externalDocumentColumn =
    technicalColumnCount +
    CONFIG.EXPECTED_HEADERS.indexOf('Externe Belegnummer') +
    1;

  const itemNumberColumn =
    technicalColumnCount +
    CONFIG.EXPECTED_HEADERS.indexOf('Artikelnummer') +
    1;

  /*
   * IDs werden als Text formatiert, damit führende Nullen erhalten bleiben
   * und lange Nummern nicht in wissenschaftlicher Schreibweise erscheinen.
   */
  [
    orderNumberColumn,
    externalDocumentColumn,
    itemNumberColumn
  ].forEach(column => {
    sheet
      .getRange(firstRow, column, rowCount, 1)
      .setNumberFormat('@');
  });

  const derivedStartColumn =
    CONFIG.TECHNICAL_HEADERS.length +
    CONFIG.EXPECTED_HEADERS.length +
    1;

  const unitSalesPriceColumn = derivedStartColumn;
  const totalSalesColumn = derivedStartColumn + 1;

  sheet
    .getRange(
      firstRow,
      unitSalesPriceColumn,
      rowCount,
      1
    )
    .setNumberFormat('#,##0.00 [$€-407]');

  sheet
    .getRange(
      firstRow,
      totalSalesColumn,
      rowCount,
      1
    )
    .setNumberFormat('#,##0.00 [$€-407]');
}


/**
 * Erkennt das Verkaufsdatum bevorzugt aus der Spalte Auftragsdatum.
 * Falls das nicht möglich ist, wird das Datum aus dem Dateinamen gelesen.
 */

function detectSalesDate_(outputRows, fileName) {
  const technicalColumnCount = CONFIG.TECHNICAL_HEADERS.length;
  const orderDateIndex =
    technicalColumnCount +
    CONFIG.EXPECTED_HEADERS.indexOf('Auftragsdatum');

  for (const row of outputRows) {
    const value = String(row[orderDateIndex] || '').trim();

    if (value) {
      return value;
    }
  }

  const dateFromFileName = extractDateFromFileName_(fileName);

  return dateFromFileName || 'NICHT_ERKANNT';
}


/**
 * Unterstützt zum Beispiel:
 * 13.07.26_JTL-Export-Aufträge-14072026.csv
 */

function extractDateFromFileName_(fileName) {
  const match = fileName.match(
    /\b(\d{2})[.\-_](\d{2})[.\-_](\d{2}|\d{4})\b/
  );

  if (!match) {
    return '';
  }

  const day = match[1];
  const month = match[2];
  let year = match[3];

  if (year.length === 2) {
    year = `20${year}`;
  }

  return `${day}.${month}.${year}`;
}


/**
 * Schreibt einen Eintrag in Import_Fehler.
 */

function writeErrorLog_(
  errorSheet,
  fileName,
  fileId,
  errorType,
  errorMessage
) {
  errorSheet.appendRow([
    new Date(),
    fileName,
    fileId,
    errorType,
    errorMessage
  ]);
}


/**
 * Platzhalter für die spätere Chat-Benachrichtigung.
 *
 * Aktuell wird die Nachricht im Ausführungsprotokoll und im Tabellenblatt
 * Import_Fehler gespeichert.
 */

function sendMissingUploadNotification_(message) {
  console.log(`Benachrichtigung: ${message}`);

  /*
   * Noch keine Chat-Schnittstelle eingerichtet.
   *
   * Später kann hier beispielsweise eingefügt werden:
   *
   * sendGoogleChatMessage_(message);
   * sendTelegramMessage_(message);
   * sendOpenClawMessage_(message);
   */
}


/**
 * Gibt ein vorhandenes Tabellenblatt zurück.
 * Es werden keine Tabellenblätter automatisch neu angelegt.
 */

function archiveImportedFile_(file) {
  const sourceFolder = DriveApp.getFolderById(
    CONFIG.DRIVE_FOLDER_ID
  );

  const archiveFolder = getOrCreateSubfolder_(
    sourceFolder,
    CONFIG.ARCHIVE_FOLDER_NAME
  );

  file.moveTo(archiveFolder);
}


/**
 * Gibt einen vorhandenen Unterordner zurück oder erstellt ihn.
 */

function getOrCreateSubfolder_(parentFolder, folderName) {
  const folders = parentFolder.getFoldersByName(folderName);

  if (folders.hasNext()) {
    return folders.next();
  }

  return parentFolder.createFolder(folderName);
}


/**
 * ============================================================
 * BUYBACK – NORMALISIERUNG DER EINKAUFSTABELLE
 * ============================================================
 *
 * Quelle:
 * Externe BuyBack-Einkaufstabelle – ausschließlich lesend.
 *
 * Ziel:
 * BuyBack – Profit
 *
 * Dieser Teil des Scripts:
 * - schreibt niemals in die Einkaufstabelle,
 * - verändert keine Einkaufsdaten,
 * - erstellt nur eine normalisierte Kopie im Ziel-Spreadsheet.
 */


/**
 * Eigene Konfiguration, damit keine Namen mit dem bestehenden
 * JTL-Import-Code kollidieren.
 */

function erstelleTaeglichenTrigger() {
  const functionName = 'importiereNeueJtlDateien';

  // Verhindert mehrere identische Trigger.
  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (
      trigger.getHandlerFunction() === functionName &&
      trigger.getEventType() === ScriptApp.EventType.CLOCK
    ) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp
    .newTrigger(functionName)
    .timeBased()
    .atHour(11)
    .everyDays(1)
    .inTimezone(CONFIG.TIMEZONE)
    .create();

  console.log(
    'Der tägliche Import-Trigger wurde erfolgreich angelegt.'
  );
}


/**
 * Nur zum Testen:
 * Listet im Ausführungsprotokoll alle erkannten Dateien im Drive-Ordner auf.
 */

function testeDriveOrdner() {
  const folder = DriveApp.getFolderById(
    CONFIG.DRIVE_FOLDER_ID
  );

  const files = folder.getFiles();
  let count = 0;

  while (files.hasNext()) {
    const file = files.next();

    console.log({
      name: file.getName(),
      id: file.getId(),
      mimeType: file.getMimeType(),
      isCsv: isCsvFile_(file)
    });

    count++;
  }

  console.log(`Gefundene Dateien insgesamt: ${count}`);
}


/**
 * Einmalige Migration: fügt die neue Spalte "Währung" in das bereits
 * befüllte Tabellenblatt "JTL_Rohdaten" ein, direkt nach "Brutto-VK".
 *
 * Ohne diese Spalte bricht der nächste Import ab (siehe
 * validateOutputStructure_/ensureHeaderRow_ - beide prüfen die
 * Kopfzeile strikt gegen CONFIG.EXPECTED_HEADERS, das "Währung" jetzt
 * enthält). Bestehende Zeilen bleiben in der neuen Spalte leer -
 * das entspricht dem bisherigen Verhalten (unbekannte/leere Währung
 * wird beim Import 1:1 als EUR behandelt, siehe CONFIG.CURRENCY_RATES_TO_EUR).
 *
 * Einmal ausführen, danach nicht mehr nötig - kann gefahrlos mehrfach
 * aufgerufen werden (bricht ohne Änderung ab, falls die Spalte schon
 * existiert).
 */
function fuegeWaehrungsSpalteInJtlRohdatenEin() {
  const spreadsheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);

  const rawSheet = getRequiredSheet_(
    spreadsheet,
    CONFIG.RAW_SHEET_NAME
  );

  const lastColumn = rawSheet.getLastColumn();

  const headerRow = rawSheet
    .getRange(1, 1, 1, lastColumn)
    .getValues()[0]
    .map(value => String(value).trim());

  if (headerRow.includes('Währung')) {
    console.log(
      'Spalte "Währung" ist bereits vorhanden, keine Änderung vorgenommen.'
    );
    return;
  }

  const grossVkColumnIndex = headerRow.indexOf('Brutto-VK');

  if (grossVkColumnIndex === -1) {
    throw new Error(
      'Spalte "Brutto-VK" wurde in "JTL_Rohdaten" nicht gefunden - ' +
      'Abbruch, keine Änderung vorgenommen.'
    );
  }

  const newColumnNumber = grossVkColumnIndex + 2;

  rawSheet.insertColumnAfter(grossVkColumnIndex + 1);

  rawSheet
    .getRange(1, newColumnNumber)
    .setValue('Währung')
    .setFontWeight('bold');

  console.log(
    `Spalte "Währung" wurde an Position ${newColumnNumber} eingefügt ` +
    '(direkt nach "Brutto-VK"). Bestehende Zeilen bleiben dort leer ' +
    'und werden weiterhin wie EUR behandelt.'
  );
}


/**
 * Wandelt deutsche und internationale Zahlenformate sicher um.
 *
 * Beispiele:
 *  "1.234,56" → 1234.56
 *  "99,90 €"  → 99.90
 *  "12.50"    → 12.50
 *  "2"        → 2
 *
 * Gibt null zurück, wenn kein gültiger Zahlenwert erkannt wird.
 */
