/**
 * Eigener Einstiegspunkt für die Verkaufserkennung.
 *
 * Die bestehende, breit getestete Roh-Extraktion wird weiterverwendet;
 * sämtliche Verkaufsergebnisse werden danach zwingend über die zentrale
 * Verkaufskanonisierung vereinheitlicht. Dadurch bleiben Einkauf und
 * Verkauf fachlich getrennt, ohne die vorhandene Modellabdeckung zu verlieren.
 */
function salesExtractModelKey_(normalizedName, category) {
  const rawModelKey = ekExtractModelKey_(normalizedName, category);
  if (!rawModelKey) return '';
  return salesCanonicalizeModelKey_(rawModelKey, category);
}
