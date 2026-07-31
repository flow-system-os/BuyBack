/**
 * ============================================================
 * PROJEKTWEITE ALLGEMEINE HILFSFUNKTIONEN
 * ============================================================
 *
 * Diese Datei gehört zum modularen BuyBack-Apps-Script-Projekt.
 * Alle .gs-Dateien im selben Apps-Script-Projekt teilen sich
 * Funktionen und Konstanten automatisch. Es sind keine Imports nötig.
 */

function getRequiredSheet_(spreadsheet, sheetName) {
  const sheet = spreadsheet.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error(
      `Das Tabellenblatt "${sheetName}" wurde nicht gefunden.`
    );
  }

  return sheet;
}


/**
 * Entfernt ein eventuell vorhandenes UTF-8-BOM.
 */

function removeBom_(content) {
  return String(content || '').replace(/^\uFEFF/, '');
}


/**
 * Vereinheitlicht Spaltennamen für sichere Vergleiche.
 */

function normalizeHeader_(value) {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .replace(/\u00A0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}


/**
 * Bereinigt nur technisch störende Zeichen am Anfang und Ende.
 * Der Inhalt des CSV-Feldes wird ansonsten nicht interpretiert.
 */

function cleanCellValue_(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value)
    .replace(/\u0000/g, '')
    .trim();
}


/**
 * Erkennt vollständig leere CSV-Zeilen.
 */

function isEmptyRow_(row) {
  return row.every(
    cell => String(cell || '').trim() === ''
  );
}


/**
 * Lesbare Bezeichnung für das Importprotokoll.
 */

function delimiterDisplayName_(delimiter) {
  if (delimiter === ';') {
    return 'Semikolon';
  }

  if (delimiter === ',') {
    return 'Komma';
  }

  if (delimiter === '\t') {
    return 'Tabulator';
  }

  return delimiter;
}


/**
 * Einmalig ausführen, um einen täglichen Zeittrigger anzulegen.
 *
 * Der Trigger startet täglich ungefähr zwischen 08:00 und 09:00 Uhr.
 * Die genaue Uhrzeit kann unten angepasst werden.
 */

function parseGermanNumber_(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  let text = String(value)
    .trim()
    .replace(/\s/g, '')
    .replace(/€/g, '')
    .replace(/[^\d,.\-]/g, '');

  if (!text) {
    return null;
  }

  const hasComma = text.includes(',');
  const hasDot = text.includes('.');

  if (hasComma && hasDot) {
    /*
     * Das zuletzt auftretende Zeichen wird als Dezimaltrennzeichen
     * interpretiert.
     */
    if (text.lastIndexOf(',') > text.lastIndexOf('.')) {
      // Deutsches Format: 1.234,56
      text = text.replace(/\./g, '').replace(',', '.');
    } else {
      // Internationales Format: 1,234.56
      text = text.replace(/,/g, '');
    }
  } else if (hasComma) {
    // Deutsches Dezimaltrennzeichen: 99,90
    text = text.replace(',', '.');
  }

  const number = Number(text);

  return Number.isFinite(number) ? number : null;
}


/**
 * Verschiebt eine erfolgreich importierte Datei in den Unterordner "Archiv".
 *
 * Falls der Archivordner noch nicht existiert, wird er automatisch
 * innerhalb des JTL-Importordners angelegt.
 */

function ekEscapeRegExp_(value) {
  return String(value || '')
    .replace(
      /[.*+?^${}()|[\]\\]/g,
      '\\$&'
    );
}

/**
 * Normalisiert Produkttexte für die technische Suche.
 *
 * Die Originalbezeichnung bleibt separat erhalten.
 */
