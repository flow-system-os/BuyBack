/**
 * ============================================================
 * 99_Hauptlauf.gs
 * ============================================================
 *
 * Zentrale Ablaufsteuerung für den täglichen BuyBack-Datenlauf.
 *
 * Regulärer Benutzerprozess:
 * 1. JTL-CSV in den vorgesehenen Drive-Ordner hochladen.
 * 2. Der tägliche Trigger startet diese Funktion automatisch.
 *
 * WICHTIG:
 * Diese Hauptfunktion verwendet bewusst keinen eigenen ScriptLock.
 * Die bestehenden Teilfunktionen besitzen bereits eigene Locks.
 */

function taeglicherBuyBackDatenlauf() {
  const gestartetAm = new Date();
  const ergebnisse = [];

  try {
    hauptlaufFuehreSchrittAus_(
      ergebnisse,
      'JTL-Import',
      importiereNeueJtlDateien
    );

    hauptlaufFuehreSchrittAus_(
      ergebnisse,
      'Verkaufs-Mapping synchronisieren',
      synchronisiereVerkaufsMapping
    );

    hauptlaufFuehreSchrittAus_(
      ergebnisse,
      'Tagesprofite aktualisieren',
      BBP2_aktualisiereTagesprofite
    );

    const beendetAm = new Date();
    const dauerSekunden = Math.round(
      (beendetAm.getTime() - gestartetAm.getTime()) / 1000
    );

    console.log(
      'Täglicher BuyBack-Datenlauf erfolgreich abgeschlossen. ' +
      'Dauer: ' + dauerSekunden + ' Sekunden.'
    );

    hauptlaufZeigeToast_(
      'Datenlauf erfolgreich abgeschlossen (' +
      dauerSekunden + ' Sek.).'
    );

    return {
      status: 'ERFOLGREICH',
      gestartetAm: gestartetAm,
      beendetAm: beendetAm,
      dauerSekunden: dauerSekunden,
      schritte: ergebnisse
    };
  } catch (error) {
    const fehlermeldung =
      error && error.message
        ? error.message
        : String(error);

    console.error(
      'Täglicher BuyBack-Datenlauf abgebrochen: ' +
      fehlermeldung
    );

    hauptlaufZeigeToast_(
      'Datenlauf abgebrochen: ' + fehlermeldung
    );

    throw error;
  }
}

function hauptlaufFuehreSchrittAus_(
  ergebnisse,
  bezeichnung,
  funktion
) {
  if (typeof funktion !== 'function') {
    throw new Error(
      'Die Funktion für den Schritt "' +
      bezeichnung + '" wurde nicht gefunden.'
    );
  }

  const gestartetAm = new Date();

  console.log('Starte: ' + bezeichnung);

  const rueckgabe = funktion();

  const beendetAm = new Date();
  const dauerSekunden = Math.round(
    (beendetAm.getTime() - gestartetAm.getTime()) / 1000
  );

  ergebnisse.push({
    schritt: bezeichnung,
    status: 'ERFOLGREICH',
    dauerSekunden: dauerSekunden,
    rueckgabe: rueckgabe || null
  });

  console.log(
    'Abgeschlossen: ' + bezeichnung +
    ' (' + dauerSekunden + ' Sek.).'
  );

  return rueckgabe;
}

/**
 * Einmalig manuell ausführen.
 *
 * Entfernt alte Zeittrigger für den direkten Import bzw. den Hauptlauf
 * und legt genau einen täglichen Trigger um ca. 11:00 Uhr an.
 */
function erstelleOderAktualisiereBuyBackHaupttrigger() {
  const alteHandler = new Set([
    'importiereNeueJtlDateien',
    'taeglicherBuyBackDatenlauf'
  ]);

  ScriptApp.getProjectTriggers().forEach(trigger => {
    if (
      trigger.getEventType() === ScriptApp.EventType.CLOCK &&
      alteHandler.has(trigger.getHandlerFunction())
    ) {
      ScriptApp.deleteTrigger(trigger);
    }
  });

  ScriptApp
    .newTrigger('taeglicherBuyBackDatenlauf')
    .timeBased()
    .atHour(11)
    .everyDays(1)
    .inTimezone(
      CONFIG && CONFIG.TIMEZONE
        ? CONFIG.TIMEZONE
        : 'Europe/Berlin'
    )
    .create();

  console.log(
    'Der tägliche Haupttrigger wurde für ca. 11:00 Uhr angelegt.'
  );

  hauptlaufZeigeToast_(
    'Täglicher Haupttrigger für ca. 11:00 Uhr angelegt.'
  );
}

function starteBuyBackDatenlaufManuell() {
  return taeglicherBuyBackDatenlauf();
}

function hauptlaufZeigeToast_(message) {
  try {
    const spreadsheet = SpreadsheetApp.openById(
      CONFIG.SPREADSHEET_ID
    );

    spreadsheet.toast(
      message,
      'BuyBack Hauptlauf',
      10
    );
  } catch (toastError) {
    console.log(
      'Toast konnte nicht angezeigt werden: ' +
      toastError.message
    );
  }
}
