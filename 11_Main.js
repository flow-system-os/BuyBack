/**
 * ============================================================
 * HAUPTFUNKTIONEN / STARTPUNKTE
 * ============================================================
 *
 * Diese Datei enthält nur leicht auffindbare Startfunktionen.
 * Bestehende Trigger-Funktionen bleiben in ihren Fachdateien.
 */

/**
 * Täglicher BuyBack-Datenlauf.
 *
 * Importiert neue JTL-Dateien und synchronisiert anschließend nur
 * neue oder geänderte Einkäufe sowie den Produktstamm.
 *
 * HINWEIS: Erst verwenden, wenn alle Einzelschritte erfolgreich
 * getestet wurden.
 */
function taeglicherBuyBackDatenlauf() {
  importiereNeueJtlDateien();
  aktualisiereNeueUndGeaenderteEinkaeufe();
  synchronisiereProduktstamm();
  synchronisiereVerkaufsMapping();
}

/**
 * Vollständiger Neuaufbau nach größeren Parser- oder Regeländerungen.
 *
 * Diese Funktion bewusst nur manuell ausführen.
 */
function kompletterBuyBackNeuaufbau() {
  normalisiereEinkaufstabelle();
  synchronisiereProduktstamm();
  deaktiviereVeralteteProduktstammEintraege();
  pruefeProduktstamm();
}
