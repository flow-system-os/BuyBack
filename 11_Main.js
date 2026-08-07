/**
 * ============================================================
 * HAUPTFUNKTIONEN / STARTPUNKTE
 * ============================================================
 *
 * Diese Datei enthält nur leicht auffindbare Startfunktionen.
 * Bestehende Trigger-Funktionen bleiben in ihren Fachdateien.
 */

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
