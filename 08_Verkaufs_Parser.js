/**
 * ============================================================
 * ZENTRALE NORMALISIERUNG UND KATEGORIEN VERKAUF
 * ============================================================
 *
 * Diese Datei gehört zum modularen BuyBack-Apps-Script-Projekt.
 * Alle .gs-Dateien im selben Apps-Script-Projekt teilen sich
 * Funktionen und Konstanten automatisch. Es sind keine Imports nötig.
 */

function salesIsVideoGame_(normalizedName) {
  const value = String(normalizedName || '').toLowerCase();

  const knownGamePatterns = [
    /\bthe last of us\b/,
    /\blandwirtschafts[\s-]*simulator\b/,
    /\bcall of duty\b/,
    /\bminecraft\b/,
    /\brocket league\b/,
    /\bdragon age\b/,
    /\bthe hunter[\s-]*call of the wild\b/
  ];

  return knownGamePatterns.some(pattern => pattern.test(value));
}

/**
 * Ordnet Controller nur nach Plattform zu. Farbe sowie V1/V2
 * verändern den für die EK-Regel verwendeten Schlüssel nicht.
 */

function salesDetectControllerModelKey_(normalizedName) {
  const value = String(normalizedName || '').toLowerCase();

  const isController =
    /\bcontroller\b/.test(value) ||
    /\bgamepad\b/.test(value) ||
    /\bdualshock\b/.test(value) ||
    /\bdualsense\b/.test(value) ||
    /\bjoy[\s-]?con(?:s)?\b/.test(value) ||
    /\bpro controller\b/.test(value);

  if (!isController) {
    return '';
  }

  if (/\bdualshock\b|\bps4\b|\bplaystation 4\b/.test(value)) {
    return 'PS4_CONTROLLER';
  }

  if (/\bdualsense\b|\bps5\b|\bplaystation 5\b/.test(value)) {
    return 'PS5_CONTROLLER';
  }

  if (/\bxbox series\b/.test(value)) {
    return 'XBOX_SERIES_CONTROLLER';
  }

  if (/\bxbox\b|\bmicrosoft tf5-00003\b/.test(value)) {
    return 'XBOX_ONE_CONTROLLER';
  }

  if (/\bnintendo\b|\bswitch\b|\bjoy[\s-]?con/.test(value)) {
    return 'NINTENDO_CONTROLLER';
  }

  return '';
}


/**
 * Erkennt, ob der Titel tatsächlich eine Konsole als Hauptprodukt beschreibt.
 * Eine bloße Plattformangabe bei einem Controller genügt ausdrücklich nicht.
 */
function salesDetectConsoleCategory_(normalizedName) {
  const value = String(normalizedName || '').toLowerCase();

  const isController =
    /\bcontroller\b|\bgamepad\b|\bdualshock\b|\bdualsense\b|\bjoy[\s-]?con(?:s)?\b|\bpro controller\b/.test(value);

  const hasConsoleStorage =
    /\b(?:500|512|825|1000)\s*(?:gb|go)\b|\b1\s*tb\b/.test(value);

  /*
   * Kompatibilitätsangaben bei Controllern dürfen nicht zur
   * Erkennung einer Konsole führen. Ein Paket mit klarer
   * Speicherangabe bleibt dagegen ein Konsolen-Hauptprodukt.
   */
  if (isController && !hasConsoleStorage) {
    return '';
  }

  const ps4Main =
    /\bps4\s+(?:pro|slim|matt)\b/.test(value) ||
    /\bplaystation\s*4\s+(?:pro|slim)\b/.test(value) ||
    (/\b(?:sony\s+)?playstation\s*4\b/.test(value) && hasConsoleStorage);

  const ps5Main =
    /\bps5\s+(?:slim|digital|disc)\b/.test(value) ||
    /\bplaystation\s*5\s+(?:slim|digital|disc)\b/.test(value) ||
    (/\b(?:sony\s+)?playstation\s*5\b/.test(value) && hasConsoleStorage);

  /*
   * "Xbox One Series S/X" existiert nicht und wird als Tippfehler
   * für "Xbox Series S/X" verstanden. "Xbox One S/X" bleibt eine
   * eigenständige Produktfamilie.
   */
  const xboxMain =
    /\bxbox\s+one\s+series\s+[sx]\b/.test(value) ||
    /\bxbox\s+one\s?[sx]\b/.test(value) ||
    /\bxbox\s+series\s+[sx]\b/.test(value) ||
    (/\bxbox\s+one\b/.test(value) && hasConsoleStorage);

  const nintendoMain =
    /\bnintendo\s+switch(?:\s+(?:lite|oled))?\b/.test(value) ||
    /\bnew\s+nintendo\s+3ds\b/.test(value) ||
    /\bnintendo\s+(?:3ds|2ds|dsi|ds lite|wii)\b/.test(value) ||
    /\bgame\s?boy\b/.test(value);

  if (ps4Main) return 'PS4';
  if (ps5Main) return 'PS5';
  if (xboxMain) return 'XBOX';
  if (nintendoMain && !isController) return 'Nintendo';

  return '';
}

/**
 * Prüft, ob der Verkaufstitel ein Kamerahauptgerät enthält.
 */

function salesContainsCameraMainProduct_(normalizedName) {
  const value = String(normalizedName || '').toLowerCase();

  return (
    /\bcyber[\s-]?shot\b/.test(value) ||
    /\bdsc[\s-]?[a-z]{0,3}\d+/i.test(value) ||
    /\bcoolpix\s+[a-z]?\d+/i.test(value) ||
    /\bpowershot\s+[a-z]?\d+/i.test(value) ||
    /\blumix\s+(?:dmc[\s-]?)?[a-z]{1,4}\d+/i.test(value) ||
    /\bsony\s+(?:alpha|a\s+ilce|ilce)[\s-]?\d+/i.test(value) ||
    /\balpha\s+\d+/i.test(value) ||
    /\bcanon\s+eos\b/.test(value) ||
    /\bbridge\s*(?:kamera|camera|compacta|compatta)?\b/.test(value) ||
    /\bkompakt(?:kamera| camera)?\b/.test(value) ||
    /\bcompact(?: camera)?\b/.test(value) ||
    /\bfotocamera\b/.test(value) ||
    /\bmacchina fotografica\b/.test(value) ||
    /\b(?:hx|sx|sz|tz|lx|fz|ft|fs|wx|w|rx)\s*-?\d{1,4}\b/i.test(value) ||
    /\b(?:ixus|coolpix)\s+[a-z]?\d+\b/i.test(value) ||
    /\beos\s+[a-z]?\d+[a-z]?\b/i.test(value)
  );
}

/**
 * Normalisiert PS5-Speicher für das EK-Matching.
 * 825 GB gehört intern zur kleineren 500-GB-Preisklasse.
 */

function salesDetermineCategory_(normalizedName) {
  const value = String(normalizedName || '').toLowerCase();

  if (salesIsVideoGame_(value)) return 'Spiel';

  const consoleCategory = salesDetectConsoleCategory_(value);
  if (consoleCategory) return consoleCategory;

  const controllerKey = salesDetectControllerModelKey_(value);
  if (controllerKey) return 'Controller';

  if (
    /\bgalaxy buds\b|\bsonos\b|\bbose\b|\bjbl\b|\bteufel\b|\bhomepod\b/.test(value)
  ) {
    return 'Audio';
  }

  if (
    /\bspeedlite\b|\b(?:kamera[\s-]?)?blitz\b|\bflashgun\b/.test(value)
  ) {
    return 'Kamera / sonstige Elektronik';
  }

  if (/\bfritz\s*!?\s*fon\b|\bmagic mouse\b/.test(value)) {
    return 'Sonstige Elektronik';
  }

  if (
    /\biphone\b|\bsamsung galaxy\b|\bgalaxy tab\b|\bipad\b|\btablet\b|\bhuawei\b/.test(value)
  ) {
    return 'Handys + Tablets';
  }

  if (
    /\bpico(?:\s*4)?\b|\bmeta quest\b|\boculus\b|\bvr brille\b|\bvr headset\b/.test(value)
  ) {
    return 'VR';
  }

  if (salesContainsCameraMainProduct_(value)) {
    return 'Kamera / sonstige Elektronik';
  }

  /*
   * Kein führendes \b vor "objektiv": erfasst damit auch
   * zusammengeschriebene Formen wie "Teleobjektiv" oder
   * "Weitwinkelobjektiv", nicht nur das eigenständige Wort.
   */
  if (
    /\b\d{2,3}\s*-\s*\d{2,3}\s*mm\b|objektiv|\bnikkor\b|\blens\b/.test(value)
  ) {
    return 'Objektiv';
  }

  return 'UNBEKANNT';
}



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


/**
 * Überführt unterschiedliche Schreibweisen desselben Modells in einen
 * gemeinsamen Vergleichsschlüssel. Der sichtbare Modellschlüssel im
 * Mapping bleibt unverändert; nur die Produktsuche nutzt diesen Wert.
 */
function salesCanonicalizeModelKey_(modelKey, category) {
  let key = salesCleanText_(modelKey)
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/\s*\+\s*/g, '+')
    .replace(/\b1000\s*(?:GB|GO)\b/g, '1TB')
    .replace(/\b0[,.]5\s*TB\b/g, '500GB')
    .replace(/\s+/g, ' ')
    .trim();

  const normalizedCategory = salesCleanText_(category).toUpperCase();

  if (normalizedCategory === 'KAMERA / SONSTIGE ELEKTRONIK') {
    return salesCanonicalizeCameraModelKey_(key);
  }

  if (normalizedCategory === 'OBJEKTIV') {
    /*
     * Bei Objektiven ist der Hersteller beziehungsweise Anschluss
     * modellrelevant. Canon und Nikon dürfen niemals allein aufgrund
     * derselben Brennweite zusammengeführt werden.
     */
    const maker =
      /\bNIKON\b|\bNIKKOR\b/.test(key) ? 'NIKON' :
      /\bCANON\b/.test(key) ? 'CANON' :
      /\bSONY\b/.test(key) ? 'SONY' :
      /\bSIGMA\b/.test(key) ? 'SIGMA' :
      /\bTAMRON\b/.test(key) ? 'TAMRON' : '';

    const focal = key.match(/\b(\d{1,3})\s*-\s*(\d{1,3})\s*MM\b/);
    if (maker && focal) return `${maker} ${focal[1]}-${focal[2]}MM`;

    return key.replace(/\s+/g, ' ').trim();
  }

  if (normalizedCategory === 'HANDYS + TABLETS') {
    const isTablet = /\b(?:GALAXY TAB|IPAD|TABLET)\b/.test(key);

    key = key
      .replace(/^A04S(?=\s|$)/, 'SAMSUNG GALAXY A04S')
      .replace(/\bGALAXY TAB A(\d+)\s*\+\b/g, 'GALAXY TAB A$1+')
      .replace(/\bGALAXY A(\d+)\s*\+\b/g, 'GALAXY A$1+');

    if (!/\b\d+\s*(?:GB|TB)\b/.test(key)) {
      key += isTablet ? ' 64GB' : ' 128GB';
    }

    return key
      .replace(/\s*\+\s*/g, '+')
      .replace(/\b(\d+)\s*GB\b/g, '$1GB')
      .replace(/\s+/g, ' ')
      .trim();
  }

  if (normalizedCategory === 'PS4') {
    key = key
      .replace(/^SONY\s+/, '')
      .replace(/^PLAYSTATION\s*4/, 'PS4')
      .replace(/\s+/g, ' ')
      .trim();

    if (/^PS4\s+PRO(?:\s+500GB)?$/.test(key)) return 'PS4 PRO 1TB';
    if (/^PS4\s+SLIM$/.test(key)) return 'PS4 SLIM 500GB';
    if (/^PS4\s+MATT$/.test(key)) return 'PS4 MATT 500GB';
    if (key === 'PS4') return 'PS4 500GB';
    return key;
  }

  if (normalizedCategory === 'PS5') {
    key = key
      .replace(/^SONY\s+/, '')
      .replace(/^PLAYSTATION\s*5/, 'PS5')
      .replace(/\s+/g, ' ')
      .trim();

    if (/^PS5(?:\s+500GB)?$/.test(key)) return 'PS5 DISC 825GB';
    if (/^PS5\s+DISC(?:\s+(?:500GB|825GB))?$/.test(key)) return 'PS5 DISC 825GB';
    if (/^PS5\s+DIGITAL(?:\s+(?:500GB|825GB))?$/.test(key)) return 'PS5 DIGITAL 825GB';
    if (/^PS5\s+SLIM\s+DISC(?:\s+(?:500GB|825GB|1TB))?$/.test(key)) return 'PS5 SLIM DISC 1TB';
    if (/^PS5\s+SLIM\s+DIGITAL(?:\s+(?:500GB|825GB|1TB))?$/.test(key)) return 'PS5 SLIM DIGITAL 1TB';
    return key;
  }

  if (normalizedCategory === 'XBOX') {
    key = key
      .replace(/^MICROSOFT\s+/, '')
      .replace(/\bXBOX\s+ONE\s+SERIES\s+S\b/g, 'XBOX SERIES S')
      .replace(/\bXBOX\s+ONE\s+SERIES\s+X\b/g, 'XBOX SERIES X')
      .replace(/\s+/g, ' ')
      .trim();

    if (key === 'XBOX ONE') return 'XBOX ONE 500GB';
    if (/^XBOX ONE S(?:\s+(?:500GB|1TB))?$/.test(key)) {
      return /\b1TB\b/.test(key) ? 'XBOX ONE S 1TB' : 'XBOX ONE S 500GB';
    }
    if (/^XBOX ONE X(?:\s+(?:500GB|1TB))?$/.test(key)) return 'XBOX ONE X 1TB';
    if (/^XBOX SERIES S(?:\s+(?:500GB|512GB))?$/.test(key)) return 'XBOX SERIES S 512GB';
    if (/^XBOX SERIES X(?:\s+(?:500GB|1TB))?$/.test(key)) return 'XBOX SERIES X 1TB';
    return key;
  }

  return key;
}

/**
 * Erzeugt einen lesbaren, minimalen Kameraschlüssel.
 *
 * Wichtig:
 * - Nur sicher erkannte Kamerafamilien werden verändert.
 * - Sonstige Elektronik im gemeinsamen Tabellenblatt bleibt unangetastet.
 * - Hersteller- und Marketingpräfixe werden entfernt, wenn das eigentliche
 *   Modell danach weiterhin eindeutig ist.
 * - Canon-Familien wie EOS und IXUS behalten ein Leerzeichen, weil dies die
 *   natürliche und lesbare Modellschreibweise ist.
 */
function salesCanonicalizeCameraModelKey_(modelKey) {
  const original = salesCleanText_(modelKey)
    .toUpperCase()
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();

  if (!original) return '';

  let key = original;

  const exactAliases = {
    'PANASONIC LUMIX DMC-G70KAEGK': 'G70',
    'LUMIX DMC-G70KAEGK': 'G70',
    'DMC-G70KAEGK': 'G70',
    'G70KAEGK': 'G70',
    'SONY ILCE-5000L': 'A5000',
    'ILCE-5000L': 'A5000',
    'SONY ALPHA 5000': 'A5000',
    'ALPHA 5000': 'A5000'
  };
  if (exactAliases[key]) return exactAliases[key];

  let match = key.match(/\b(?:CANON\s+)?SPEEDLITE\s*(\d{3})\s*EX\s*(II|III|2|3)?\b/);
  if (match) {
    const version = match[2]
      ? ({'2': 'II', '3': 'III'}[match[2]] || match[2])
      : '';
    return `${match[1]}EX${version ? ` ${version}` : ''}`;
  }

  match = key.match(/(?:^|\b)(?:CANON\s+)?EOS[\s-]*(M?\d+[A-Z]?)(?:\b|$)/);
  if (match) return `EOS ${match[1]}`;

  match = key.match(/(?:^|\b)(?:CANON\s+)?IXUS[\s-]*(\d+[A-Z]?)(?:\b|$)/);
  if (match) return `IXUS ${match[1]}`;

  match = key.match(/(?:^|\b)(?:CANON\s+)?G(\d+)\s*X(?:\s*(II|III))?(?:\b|$)/);
  if (match) return `G${match[1]}X${match[2] ? ` ${match[2]}` : ''}`;

  match = key.match(/(?:^|\b)(?:SONY\s+)?(?:ALPHA\s*|ILCE[\s-]*)(\d{4})(?:L)?(?:\b|$)/);
  if (match) return `A${match[1]}`;

  /*
   * Für BuyBack werden HX400V/HX400 und HX20V/HX20 jeweils als
   * gemeinsame Preisgruppe geführt. Andere Suffixe bleiben erhalten.
   */
  match = key.match(
    /(?:^|\b)(?:SONY\s+)?(?:CYBER[\s-]?SHOT\s+)?(?:DSC[\s-]*)?((?:HX|WX|RX|H|W)[\s-]?\d+[A-Z]?)(?:\b|$)/
  );
  if (match) {
    return match[1]
      .replace(/[\s-]/g, '')
      .replace(/^HX400V$/, 'HX400')
      .replace(/^HX20V$/, 'HX20');
  }

  match = key.match(
    /(?:^|\b)(?:PANASONIC\s+)?(?:LUMIX\s+)?(?:DMC[\s-]*)?((?:TZ|FZ|FT|FS|LX|SZ|G|LF)\d+[A-Z]?)(?:\b|$)/
  );
  if (match) return match[1];

  match = key.match(/(?:^|\b)(?:NIKON\s+)?COOLPIX\s+([A-Z]?\d+)(?:\b|$)/);
  if (match) return match[1];

  match = key.match(
    /(?:^|\b)(?:CANON\s+)?(?:POWERSHOT\s+)?((?:SX|S|A)\d+(?:\s*HS)?)(?:\b|$)/
  );
  if (
    match &&
    (
      /POWERSHOT|CANON/.test(key) ||
      /^(?:SX|S|A)\d+(?:\s*HS)?$/.test(key)
    )
  ) {
    /*
     * Der "HS"-Zusatz (z. B. "SX240HS") wird bewusst entfernt:
     * Einkaufstabelle schreibt oft nur "SX240 HS" mit Leerzeichen,
     * wodurch die Modellschlüssel-Erkennung dort schon vor der
     * Kanonisierung nur "SX240" liefert. Ohne dieses Kürzen würden
     * EK- und Verkaufsseite dauerhaft auf unterschiedlichen
     * Schlüsseln (SX240 vs. SX240HS) landen.
     */
    return match[1]
      .replace(/\s+/g, '')
      .replace(/HS$/, '');
  }

  if (
    /^(?:HX|WX|RX|H|W|TZ|FZ|FT|FS|LX|SZ|SX|G|LF)\d+[A-Z]?$/.test(key) ||
    /^(?:D|P|L|A)\d{2,4}$/.test(key) ||
    /^EOS M\d+$/.test(key) ||
    /^EOS \d+[A-Z]?$/.test(key) ||
    /^IXUS \d+[A-Z]?$/.test(key) ||
    /^\d{3}EX(?: II| III)?$/.test(key)
  ) {
    return key
      .replace(/^HX400V$/, 'HX400')
      .replace(/^HX20V$/, 'HX20');
  }

  return original;
}


/**
 * Liest bestehende Verkaufs-Mappings.
 */
