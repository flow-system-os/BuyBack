/**
 * ============================================================
 * PRODUKT-, KATEGORIE- UND SPEICHERERKENNUNG EINKAUF
 * ============================================================
 *
 * Diese Datei gehört zum modularen BuyBack-Apps-Script-Projekt.
 * Alle .gs-Dateien im selben Apps-Script-Projekt teilen sich
 * Funktionen und Konstanten automatisch. Es sind keine Imports nötig.
 */

function ekContainsMixedMainProducts_(
  normalizedName
) {
  const productFamilies = [
    {
      key: 'PS4',
      regex: /\bps4\b|\bplaystation 4\b/
    },
    {
      key: 'PS5',
      regex: /\bps5\b|\bplaystation 5\b/
    },
    {
      key: 'XBOX',
      regex: /\bxbox\b/
    },
    {
      key: 'SWITCH',
      regex: /\bswitch\b/
    },
    {
      key: '3DS',
      regex: /\b3ds\b/
    },
    {
      key: 'IPHONE',
      regex: /\biphone\b/
    },
    {
      key: 'SAMSUNG_PHONE',
      regex:
        /\bsamsung galaxy s\d+\b|\bsamsung galaxy a\d+\b/
    },
    {
      key: 'TABLET',
      regex:
        /\bipad\b|\bgalaxy tab\b|\btablet\b/
    },
    {
      key: 'CAMERA',
      regex:
        /\bcanon\b|\bnikon\b|\bpanasonic lumix\b|\bsony alpha\b/
    },
    {
      key: 'VR',
      regex:
        /\bpico\s*\d+\b|\boculus\b|\bmeta\s*quest\b/
    }
  ];

  const matches =
    productFamilies.filter(
      family =>
        family.regex.test(normalizedName)
    );

  /*
   * Nur unterschiedliche Hauptproduktfamilien zählen.
   */
  return matches.length > 1;
}


/**
 * Ermittelt die Produktkategorie.
 *
 * Bekannte Produktfamilien haben Vorrang vor dem Quelltab,
 * weil einzelne Einkäufe historisch im falschen Tabellenblatt
 * eingetragen worden sein können.
 */

function ekDetermineCategory_(
  sourceSheetName,
  normalizedName
) {
  /*
   * Fachliche Kategorie hat Vorrang vor dem Quelltab.
   */

  if (
    /\bps4\b|\bplaystation 4\b/.test(
      normalizedName
    )
  ) {
    return 'PS4';
  }

  if (
    /\bps5\b|\bplaystation 5\b|\bplaystation portal\b/.test(
      normalizedName
    )
  ) {
    return 'PS5';
  }

  if (
    /\biphone\b/.test(normalizedName) ||
    /\bsamsung galaxy\b/.test(normalizedName) ||
    /\bgalaxy tab\b/.test(normalizedName) ||
    /\bipad\b/.test(normalizedName) ||
    /\btablet\b/.test(normalizedName) ||
    /\bhuawei\b/.test(normalizedName) ||
    /\bgoogle pixel\b/.test(normalizedName)
  ) {
    return 'Handys + Tablets';
  }

  /*
   * Falls keine eindeutige Produktfamilie erkannt wurde,
   * wird weiterhin der Quelltab verwendet.
   */
  switch (sourceSheetName) {
    case 'PS4':
      return 'PS4';

    case 'PS5':
      return 'PS5';

    case 'Nintendo':
      return 'Nintendo';

    case 'XBOX':
      return 'XBOX';

    case 'Handys + Tablets':
      return 'Handys + Tablets';

    case 'Objektive':
      return 'Objektiv';

    case 'Kameras etc.':
      if (
        /\bpico\s*\d+\b|\bvr\b|\boculus\b|\bmeta\s*quest\b/.test(
          normalizedName
        )
      ) {
        return 'VR';
      }

      if (
        /\bsonos\b|\bbose\b|\bjbl\b|\bteufel\b|\bhomepod\b|\bwh[\s-]\d{3,4}\b/.test(
          normalizedName
        )
      ) {
        return 'Audio';
      }

      if (
        /\bfritzfon\b|\btelefon\b/.test(
          normalizedName
        )
      ) {
        return 'Sonstige Elektronik';
      }

      return 'Kamera / sonstige Elektronik';

    default:
      return sourceSheetName;
  }
}

/**
 * Ermittelt einen standardisierten Modellschlüssel.
 *
 * Farben, OVP und einfaches Zubehör werden für den primären
 * Modellschlüssel weitgehend ignoriert.
 */

function ekExtractModelKey_(
  normalizedName,
  category
) {
  const searchName =
    ekPrepareNameForModelKey_(
      normalizedName,
      category
    );

  /*
   * ==========================================================
   * PLAYSTATION
   * ==========================================================
   */

  if (
    /\bplaystation portal\b|\bps5 portal\b|\bps5 portable\b/.test(
      searchName
    )
  ) {
    return 'PLAYSTATION PORTAL';
  }

  /*
   * PS5 Pro fehlte bisher komplett und fiel auf die generische
   * "unbekannte PS5"-Regel weiter unten zurück (PS5 DISC 825GB) -
   * ein deutlich anderes, teureres Produkt.
   */
  if (
    /\bps5 pro\b|\bplaystation 5 pro\b/.test(
      searchName
    )
  ) {
    return 'PS5 PRO 2TB';
  }

  if (
    /\bps5 slim disc\b|\bplaystation 5 slim disc\b/.test(
      searchName
    )
  ) {
    return ekAppendPs5Storage_(
      'PS5 SLIM DISC',
      searchName
    );
  }

  if (
    /\bps5 slim digital\b|\bplaystation 5 slim digital\b/.test(
      searchName
    )
  ) {
    return ekAppendPs5Storage_(
      'PS5 SLIM DIGITAL',
      searchName
    );
  }

  if (
    /\bps5 disc\b|\bplaystation 5 disc\b/.test(
      searchName
    )
  ) {
    return ekAppendPs5Storage_(
      'PS5 DISC',
      searchName
    );
  }

  if (
    /\bps5 digital\b|\bplaystation 5 digital\b/.test(
      searchName
    )
  ) {
    return ekAppendPs5Storage_(
      'PS5 DIGITAL',
      searchName
    );
  }

  /*
   * "PS5 Slim" ohne ausdrückliches "Disc"/"Digital" (z.B. "PlayStation 5
   * Slim 1000GB - Bianco") wurde von den beiden spezifischeren Regeln
   * oben nicht erfasst und fiel auf die normale (nicht-Slim) 825-GB-
   * Variante zurück - ohne erkennbare Speicherangabe im Schlüssel.
   * Mangels gegenteiliger Angabe wird die häufigere Disc-Variante
   * angenommen.
   */
  if (
    /\bps5 slim\b|\bplaystation 5 slim\b/.test(
      searchName
    )
  ) {
    return ekAppendPs5Storage_(
      'PS5 SLIM DISC',
      searchName
    );
  }

  if (
    /\bps5\b|\bplaystation 5\b/.test(
      searchName
    )
  ) {
    /*
     * Eine nicht näher bezeichnete PS5 wird fachlich als
     * Standard-Disc-Modell mit 825 GB behandelt.
     */
    return 'PS5 DISC 825GB';
  }

  if (
    /\bps4 pro\b|\bplaystation 4 pro\b/.test(
      searchName
    )
  ) {
    /* Die PS4 Pro wird im Produktstamm immer als 1-TB-Modell geführt. */
    return 'PS4 PRO 1TB';
  }

  if (
    /\bps4 slim\b|\bplaystation 4 slim\b/.test(
      searchName
    )
  ) {
    return ekAppendStorageWithDefault_(
      'PS4 SLIM',
      searchName,
      '500GB'
    );
  }

  if (
    /\bps4 matt\b/.test(
      searchName
    )
  ) {
    return ekAppendStorageWithDefault_(
      'PS4 MATT',
      searchName,
      '500GB'
    );
  }

  if (
    /\bps4\b|\bplaystation 4\b/.test(
      searchName
    )
  ) {
    return ekAppendStorageWithDefault_(
      'PS4',
      searchName,
      '500GB'
    );
  }

/*
 * Meta Quest / Oculus VR-Headsets
 */
const metaQuestMatch = searchName.match(
  /\b(?:meta\s*quest|oculus\s+quest)\s*(\d+)(?:\s+(pro|s))?\b/
);

if (metaQuestMatch) {
  let key = `META QUEST ${metaQuestMatch[1]}`;

  if (metaQuestMatch[2]) {
    key += ` ${metaQuestMatch[2].toUpperCase()}`;
  }

  return key;
}


/* Unpräzise Pico-Verkaufsbezeichnungen werden fachlich als Pico 4 behandelt. */
if (
  /\bpico\s*(?:4)?\s*(?:vr\s*)?(?:brille|headset)?\b/.test(searchName)
) {
  return 'PICO 4';
}

/*
 * ==========================================================
 * ACTION-CAMS UND GIMBAL-KAMERAS
 * ==========================================================
 */

const djiOsmoPocketMatch = searchName.match(
  /\bdji\s+osmo\s+pocket(?:\s+(\d+))?\b/
);

if (djiOsmoPocketMatch) {
  return djiOsmoPocketMatch[1]
    ? `DJI OSMO POCKET ${djiOsmoPocketMatch[1]}`
    : 'DJI OSMO POCKET';
}


/*
 * ==========================================================
 * CANON-KOMPAKTKAMERAS
 * ==========================================================
 */

const canonGSeriesMatch = searchName.match(
  /\bcanon\s+(g\d{1,2}x)(?:\s+(ii|iii|iv|mark\s+\d+))?\b/
);

if (canonGSeriesMatch) {
  let key = `CANON ${canonGSeriesMatch[1].toUpperCase()}`;

  if (canonGSeriesMatch[2]) {
    const generation = canonGSeriesMatch[2]
      .toUpperCase()
      .replace(/\s+/g, ' ');

    key += ` ${generation}`;
  }

  return key;
}


/*
 * ==========================================================
 * BOSE SOUNDBARS
 * ==========================================================
 */


/*
 * Sony DSC-HX ohne ausgeschriebene Modellnummer.
 *
 * Der Schlüssel ist bewusst allgemeiner. Dadurch können solche
 * unvollständig bezeichneten Einkäufe gefunden werden, sie sollten
 * später aber nicht mit einem konkreten HX-Modell vermischt werden.
 */
if (
  /\bsony\s+dsc[\s-]?hx\b/.test(searchName) ||
  /\bsony\s+dsc\s+hx\b/.test(searchName)
) {
  return 'SONY DSC-HX';
}
  /*
   * ==========================================================
   * NINTENDO
   * ==========================================================
   */

  /*
   * Pokémon-Spiele als eigenständige Hauptprodukte.
   *
   * Diese dürfen nicht mit der allgemeinen Zubehörregel
   * "Spiele = 0 EUR" verwechselt werden.
   */
  const pokemonGamePatterns = [
    {
      regex: /\bpokemon\s+smaragd(?:\s+edition)?\b/,
      key: 'POKEMON SMARAGD'
    },
    {
      regex: /\bpokemon\s+saphir(?:\s+edition)?\b/,
      key: 'POKEMON SAPHIR'
    },
    {
      regex: /\bpokemon\s+rubin(?:\s+edition)?\b/,
      key: 'POKEMON RUBIN'
    },
    {
      regex: /\bpokemon\s+feuerrot(?:\s+edition)?\b/,
      key: 'POKEMON FEUERROT'
    },
    {
      regex: /\bpokemon\s+blattgruen(?:\s+edition)?\b/,
      key: 'POKEMON BLATTGRUEN'
    },
    {
      regex: /\bpokemon\s+gold(?:\s+edition)?\b/,
      key: 'POKEMON GOLD'
    },
    {
      regex: /\bpokemon\s+silber(?:\s+edition)?\b/,
      key: 'POKEMON SILBER'
    },
    {
      regex: /\bpokemon\s+kristall(?:\s+edition)?\b/,
      key: 'POKEMON KRISTALL'
    },
    {
      regex: /\bpokemon\s+rot(?:e)?(?:\s+edition)?\b/,
      key: 'POKEMON ROT'
    },
    {
      regex: /\bpokemon\s+blau(?:e)?(?:\s+edition)?\b/,
      key: 'POKEMON BLAU'
    },
    {
      regex: /\bpokemon\s+gelb(?:e)?(?:\s+edition)?\b/,
      key: 'POKEMON GELB'
    }
  ];

  for (const pokemonPattern of pokemonGamePatterns) {
    if (pokemonPattern.regex.test(searchName)) {
      return pokemonPattern.key;
    }
  }

  /*
   * Game-Boy-Modelle.
   *
   * Farben, Taschen, OVP und Ladekabel sind für den
   * primären Modellschlüssel nicht relevant.
   */
  if (
    /\bgame\s*boy\s+advance\s+sp\b|\bgameboy\s+advance\s+sp\b/.test(
      searchName
    )
  ) {
    return 'GAMEBOY ADVANCE SP';
  }

  if (
    /\bgame\s*boy\s+advance\b|\bgameboy\s+advance\b|\bgba\b/.test(
      searchName
    )
  ) {
    return 'GAMEBOY ADVANCE';
  }

  if (
    /\bgame\s*boy\s+color\b|\bgameboy\s+color\b|\bgbc\b/.test(
      searchName
    )
  ) {
    return 'GAMEBOY COLOR';
  }

  if (
    /\bgame\s*boy\s+micro\b|\bgameboy\s+micro\b/.test(
      searchName
    )
  ) {
    return 'GAMEBOY MICRO';
  }

  if (
    /\bgame\s*boy\s+pocket\b|\bgameboy\s+pocket\b/.test(
      searchName
    )
  ) {
    return 'GAMEBOY POCKET';
  }

  if (
    /\bgame\s*boy\b|\bgameboy\b/.test(
      searchName
    )
  ) {
    return 'GAMEBOY CLASSIC';
  }

  if (
    /\bnintendo switch lite\b|\bswitch lite\b/.test(
      searchName
    )
  ) {
    return 'SWITCH LITE';
  }

  if (
    /\bnintendo switch oled\b|\bswitch oled\b/.test(
      searchName
    )
  ) {
    return 'SWITCH OLED';
  }

  /*
   * Eine bloße Erwähnung von "Switch" reicht nicht, wenn sie nicht am
   * Textanfang steht und keine Speichergröße dabeisteht - sonst
   * bekommen Spieltitel wie "Mario + Rabbids Sparks Of Hope (Nintendo
   * Switch, 2022)" den EK einer kompletten Switch-Konsole zugewiesen,
   * obwohl es sich nur um ein einzelnes Spiel handelt.
   */
  const hasSwitchStorage =
    /\b(?:32|64|128|256)\s*(?:gb|go)\b/.test(
      searchName
    );

  const switchBareAtStart =
    /^(?:nintendo\s+)?switch\b/.test(
      searchName
    );

  if (
    (/\bnintendo switch\b|\bswitch\b/.test(searchName)) &&
    (switchBareAtStart || hasSwitchStorage)
  ) {
    return 'SWITCH STANDARD';
  }

  if (
    /\bnew nintendo 3ds xl\b|\bnew 3ds xl\b/.test(
      searchName
    )
  ) {
    return 'NEW 3DS XL';
  }

  if (
    /\bnew nintendo 3ds\b|\bnew 3ds\b/.test(
      searchName
    )
  ) {
    return 'NEW 3DS';
  }

  if (
    /\bnintendo 3ds xl\b|\b3ds xl\b/.test(
      searchName
    )
  ) {
    return '3DS XL';
  }

  if (
    /\bnintendo 2ds xl\b|\b2ds xl\b/.test(
      searchName
    )
  ) {
    return '2DS XL';
  }

  if (
    /\bnintendo 3ds\b|\b3ds\b/.test(
      searchName
    )
  ) {
    return '3DS';
  }

  if (
    /\bnintendo 2ds\b|\b2ds\b/.test(
      searchName
    )
  ) {
    return '2DS';
  }

  if (
    /\bnintendo dsi xl\b|\bdsi xl\b/.test(
      searchName
    )
  ) {
    return 'DSI XL';
  }

  if (
    /\bnintendo dsi\b|\bdsi\b/.test(
      searchName
    )
  ) {
    return 'DSI';
  }

  if (
    /\bnintendo ds lite\b|\bds lite\b/.test(
      searchName
    )
  ) {
    return 'DS LITE';
  }

  if (
    /\bnintendo ds\b|\bds\b/.test(
      searchName
    )
  ) {
    return 'NINTENDO DS';
  }

  if (
    /\bwii u\b/.test(
      searchName
    )
  ) {
    return 'WII U';
  }

  if (
    /\bnintendo wii\b|\bwii\b/.test(
      searchName
    )
  ) {
    return 'WII';
  }

  /*
   * Einzeln gekaufte Joy-Cons/Pro Controller ohne Konsole.
   * Erst nach allen echten Konsolen-Mustern geprüft, damit ein
   * gebündelter Kauf ("Switch + Joy-Con") weiterhin die Konsole
   * als Schlüssel bekommt. [\s-]? erfasst auch "joycon" ohne
   * Leerzeichen. Derselbe Schlüssel wie auf der Verkaufsseite
   * (salesDetectControllerModelKey_), damit beide Seiten über die
   * Fest-EK-Regel für Controller zusammenfinden.
   */
  if (
    /\bjoy[\s-]?con(?:s)?\b|\bpro controller\b/.test(
      searchName
    )
  ) {
    return 'NINTENDO_CONTROLLER';
  }

  /*
   * ==========================================================
   * XBOX
   * ==========================================================
   */

  /*
   * "Xbox One Series S/X" ist ein verbreiteter Tippfehler für
   * "Xbox Series S/X" (die "One"-Generation hat diese Modelle nie
   * gegeben). Muss vor der generischen "xbox one"-Prüfung stehen,
   * sonst greift diese zuerst und liefert die falsche Konsolen-
   * Generation (XBOX ONE statt XBOX SERIES S/X).
   *
   * Eine bloße Erwähnung ohne Speichergröße und ohne dass die Konsole
   * am Textanfang (also als Hauptprodukt) steht, reicht NICHT - sonst
   * bekommen Spieltitel wie "Dead Island 2 (Xbox One, Series X)" oder
   * "Lost Judgment (Microsoft Xbox Series X|S)" den EK einer
   * kompletten Konsole zugewiesen.
   */
  const hasXboxSeriesStorage =
    /\b(?:500|512|825|1000)\s*(?:gb|go)\b|\b1\s*tb\b/.test(
      searchName
    );

  const xboxSeriesAtStart =
    /^(?:microsoft\s+)?xbox\s+(?:one\s+)?series\s+[sx]\b/.test(
      searchName
    );

  const xboxSeriesIsMainProduct =
    hasXboxSeriesStorage || xboxSeriesAtStart;

  if (
    /\bxbox one series x\b/.test(searchName) &&
    xboxSeriesIsMainProduct
  ) {
    return 'XBOX SERIES X 1TB';
  }

  if (
    /\bxbox one series s\b/.test(searchName) &&
    xboxSeriesIsMainProduct
  ) {
    return ekAppendStorageWithDefault_(
      'XBOX SERIES S',
      searchName,
      '512GB'
    );
  }

  if (
    /\bxbox series x\b/.test(searchName) &&
    xboxSeriesIsMainProduct
  ) {
    /* Series X wird im BuyBack-Modell standardmäßig als 1 TB geführt. */
    return 'XBOX SERIES X 1TB';
  }

  if (
    /\bxbox series s\b/.test(searchName) &&
    xboxSeriesIsMainProduct
  ) {
    /* Series S ohne Speicherangabe entspricht der 512-GB-Variante. */
    return ekAppendStorageWithDefault_(
      'XBOX SERIES S',
      searchName,
      '512GB'
    );
  }

  /*
   * "Xbox OneX"/"Xbox OneS" (ohne Leerzeichen vor dem Buchstaben) ist
   * dieselbe Schreibweise wie "Xbox One X"/"Xbox One S", nur ohne
   * Leerzeichen. \bone[\s]?x\b bzw. \bone[\s]?s\b deckt beide Formen ab.
   */
  if (
    /\bxbox one[\s]?x\b/.test(
      searchName
    )
  ) {
    /* Xbox One X wird standardmäßig als 1 TB geführt. */
    return 'XBOX ONE X 1TB';
  }

  if (
    /\bxbox one[\s]?s\b/.test(
      searchName
    )
  ) {
    return ekAppendStorageWithDefault_(
      'XBOX ONE S',
      searchName,
      '500GB'
    );
  }

  /*
   * Bloßes "Xbox One" (ohne X/S-Zusatz) läuft in dieselbe Falle wie
   * "Xbox Series S/X" oben, z.B. bei "Dead Island 2 Pulp Edition
   * (Xbox One, Series X)" - dieselbe Absicherung greift hier.
   */
  if (
    /\bxbox one\b/.test(searchName) &&
    (hasXboxSeriesStorage ||
      /^(?:microsoft\s+)?xbox\s+one\b/.test(searchName))
  ) {
    return ekAppendStorageWithDefault_(
      'XBOX ONE',
      searchName,
      '500GB'
    );
  }

  if (
    /\bxbox 360\b/.test(
      searchName
    )
  ) {
    return 'XBOX 360';
  }

  /*
   * ==========================================================
   * APPLE UND SMARTPHONES
   * ==========================================================
   */

  const iphoneMatch =
    searchName.match(
      /\biphone\s+(\d{1,2})(?:\s+(pro max|pro|plus|mini))?\b/
    );

  if (iphoneMatch) {
    let key =
      `IPHONE ${iphoneMatch[1]}`;

    if (iphoneMatch[2]) {
      key +=
        ` ${iphoneMatch[2].toUpperCase()}`;
    }

    return ekAppendStorageWithDefault_(
      key,
      searchName,
      '128GB'
    );
  }

  /*
   * iPhone X/XR/XS tragen Buchstaben statt Ziffern und wurden von der
   * numerischen Regex oben nicht erfasst.
   */
  const iphoneLetterMatch =
    searchName.match(
      /\biphone\s+(x|xr|xs)(?:\s+(max))?\b/
    );

  if (iphoneLetterMatch) {
    let key =
      `IPHONE ${iphoneLetterMatch[1].toUpperCase()}`;

    if (iphoneLetterMatch[2]) {
      key += ' MAX';
    }

    return ekAppendStorageWithDefault_(
      key,
      searchName,
      '64GB'
    );
  }

  /*
   * Apple Watch: Farbe, Gehäusematerial, Band und Gehäusegröße werden
   * für den primären Modellschlüssel ignoriert, analog zu AirPods/Buds.
   * Eine Generation wird nur übernommen, wenn sie ausdrücklich als
   * "X. Gen" im Text steht - eine reine Zahl direkt nach "SE" ist sonst
   * nicht von der Gehäusegröße (z.B. "SE 40mm") zu unterscheiden.
   */
  const appleWatchSeMatch =
    searchName.match(
      /\bapple\s*watch\s+(?:series\s+)?se\b(?:\s*(\d+)\.?\s*gen\b)?/
    );

  if (appleWatchSeMatch) {
    return appleWatchSeMatch[1]
      ? `APPLE WATCH SE ${appleWatchSeMatch[1]}`
      : 'APPLE WATCH SE';
  }

  const appleWatchSeriesMatch =
    searchName.match(
      /\bapple\s*watch\s+series\s+(\d{1,2})\b/
    );

  if (appleWatchSeriesMatch) {
    return `APPLE WATCH SERIES ${appleWatchSeriesMatch[1]}`;
  }

/*
 * Einzelne Verkaufsbezeichnungen enthalten nur die kurze Samsung-
 * Modellnummer. A04S wird verbindlich dem vollständigen Modellnamen
 * zugeordnet, damit kein zweiter Produktstamm ohne Hersteller entsteht.
 */
if (/\ba04s\b/.test(searchName)) {
  return ekAppendStorageWithDefault_(
    'SAMSUNG GALAXY A04S',
    searchName,
    '128GB'
  );
}

/*
 * "Galaxy" fehlt in manchen Verkaufsbezeichnungen ("Samsung S21 Ultra
 * 5G 256GB"), und die Note-Reihe folgt keinem S/A-Zahlenmuster
 * ("Note 10+"). Beides fiel bisher auf einen generischen Fallback-
 * Schlüssel ohne erkannte Speichergröße zurück, dem eine spätere
 * Kanonisierung dann fälschlich einen 128-GB-Standardwert anhängte,
 * unabhängig von der tatsächlich im Text stehenden Größe.
 */
const samsungGalaxyMatch =
  searchName.match(
    /\b(?:samsung\s+(?:galaxy\s+)?|galaxy\s+)((?:note\s*\d+|[sa]\d+(?:s)?)(?:\s+ultra|\s+plus|\s+fe)?)\b/
  );

if (samsungGalaxyMatch) {
  const phoneModel =
    samsungGalaxyMatch[1]
      .toUpperCase()
      .replace(/\s+/g, ' ')
      .trim();

  return ekAppendStorageWithDefault_(
    `SAMSUNG GALAXY ${phoneModel}`,
    searchName,
    '128GB'
  );
}

 const googlePixelMatch =
  searchName.match(
    /\bgoogle\s+pixel\s+(\d{1,2}[a-z]?)(?:\s+(pro|xl))?\b/
  );

if (googlePixelMatch) {
  let key =
    `GOOGLE PIXEL ${googlePixelMatch[1].toUpperCase()}`;

  if (googlePixelMatch[2]) {
    key +=
      ` ${googlePixelMatch[2].toUpperCase()}`;
  }

  return ekAppendStorageWithDefault_(
    key,
    searchName,
    '128GB'
  );
}

const samsungTabletMatch =
  searchName.match(
    /\b(?:samsung\s+)?galaxy\s+tab\s+([a-z]\d+(?:\s*\+)?(?:\s+lite)?)/i
  );

if (samsungTabletMatch) {
  const tabletModel =
    samsungTabletMatch[1]
      .toUpperCase()
      .replace(/\s*\+\s*/g, '+')
      .replace(/\s+/g, ' ')
      .trim();

  return ekAppendStorageWithDefault_(
    `SAMSUNG GALAXY TAB ${tabletModel}`,
    searchName,
    '64GB'
  );
}

  const ipadMatch =
    searchName.match(
      /\bipad(?:\s+(pro|air|mini))?(?:\s+(\d{1,2}))?\b/
    );

  if (ipadMatch) {
    let key = 'IPAD';

    if (ipadMatch[1]) {
      key +=
        ` ${ipadMatch[1].toUpperCase()}`;
    }

    if (ipadMatch[2]) {
      key +=
        ` ${ipadMatch[2]}`;
    }

    return ekAppendStorageWithDefault_(
      key,
      searchName,
      '64GB'
    );
  }

  /*
   * ==========================================================
   * KAMERAS UND OBJEKTIVE
   * ==========================================================
   */

  const sonyRxMatch = searchName.match(
    /\b(?:sony\s+)?(?:cyber[\s-]?shot\s+)?dsc[\s-]?(rx\d+(?:m\d+)?)\b|\bsony\s+(rx\d+(?:m\d+)?)\b/
  );

  if (sonyRxMatch) {
    return (sonyRxMatch[1] || sonyRxMatch[2]).toUpperCase();
  }

  /*
   * Canon PowerShot G-Serie (z.B. "G7X", "G9X Mark II"). Die
   * Kanonisierung kennt "G9X"/"G7X" bereits und kürzt "Mark II"
   * korrekt zu "II" - hier wird nur die Rohform "G<Zahl>X" erfasst,
   * damit der Schlüssel überhaupt erst gefunden wird.
   */
  const canonGxMatch = searchName.match(
    /\bg(\d+)x\b/
  );

  if (canonGxMatch) {
    return `G${canonGxMatch[1]}X`;
  }

  /*
   * "Sony Alpha 5000" hat keine eigene Kurzform im Text (anders als
   * z. B. "a5000"), fällt deshalb ohne diese Regel durch bis zum
   * Objektiv-Brennweiten-Fallback weiter unten und liefert dann
   * fälschlich das Objektiv statt der Kamera als Schlüssel.
   */
  const sonyAlphaMatch = searchName.match(
    /\b(?:sony\s+)?alpha\s*(\d{4})\b/
  );

  if (sonyAlphaMatch) {
    return `ALPHA ${sonyAlphaMatch[1]}`;
  }

    const cameraPatterns = [
      /\bdsc[\s-]?[a-z]{0,3}\d{1,4}\b/,
/\bhx[\s-]?\d{1,4}\b/,
    /\bsx\d{2,4}\b/,
    /\bsz\d{1,3}\b/,
    /\btz\d{1,3}\b/,
    /\blx\d{1,3}\b/,
    /\bfz\d{1,4}\b/,
    /\bfs\d{1,3}\b/,
    /\bfx\d{1,3}\b/,
    /\bp\d{2,4}\b/,
    /\bd\d{2,4}\b/,
    /\ba\d{4}\b/,
    /\bilce[\s-]?\d{4}\b/,
    /\beos\s+[a-z]?\d+[a-z]?\b/,
    /\bixus\s+\d+\b/,
    /\bcoolpix\s+[a-z]?\d+\b/,
    /\blumix\s+[a-z]{1,3}[\s-]?\d{1,4}\b/
  ];

  /*
   * [\s-]* statt \s* erlaubt auch "DSC HX-5" (Bindestrich statt
   * Leerzeichen zwischen "hx" und der Modellnummer).
   */
  const sonyHxMatch = searchName.match(
  /\bsony(?:\s+dsc)?\s+hx[\s-]*(\d{1,4})\b/
);

if (sonyHxMatch) {
  return `HX${sonyHxMatch[1]}`;
}

  for (const pattern of cameraPatterns) {
    const match =
      searchName.match(pattern);

    if (match) {
      return ekMinimalCameraModelKey_(
        ekUppercaseModelKey_(match[0])
      );
    }
  }

  const lensRangeMatch =
    searchName.match(
      /\b\d{2,3}\s*-\s*\d{2,3}\s*mm\b/
    );

  if (lensRangeMatch) {
    const brand =
      ekExtractBrand_(
        searchName
      );

    return [
      brand,
      ekUppercaseModelKey_(
        lensRangeMatch[0]
      )
    ]
      .filter(Boolean)
      .join(' ');
  }

  const fixedLensMatch =
    searchName.match(
      /\b\d{2,3}\s*mm\b/
    );

  if (
    fixedLensMatch &&
    category === 'Objektiv'
  ) {
    const brand =
      ekExtractBrand_(
        searchName
      );

    return [
      brand,
      ekUppercaseModelKey_(
        fixedLensMatch[0]
      )
    ]
      .filter(Boolean)
      .join(' ');
  }

/*
 * ==========================================================
 * DRUCKER UND ETIKETTIERGERÄTE
 * ==========================================================
 */

const dymoLabelWriterMatch = searchName.match(
  /\bdymo\s+label\s*writer\s*(\d{2,4})(?:\s+(turbo|duo|wireless))?\b|\bdymo\s+labelwriter\s*(\d{2,4})(?:\s+(turbo|duo|wireless))?\b/
);

if (dymoLabelWriterMatch) {
  const model =
    dymoLabelWriterMatch[1] ||
    dymoLabelWriterMatch[3];

  const variant =
    dymoLabelWriterMatch[2] ||
    dymoLabelWriterMatch[4];

  let key = `DYMO LABELWRITER ${model}`;

  if (variant) {
    key += ` ${variant.toUpperCase()}`;
  }

  return key;
}
  /*
   * ==========================================================
   * AUDIOGERÄTE
   * ==========================================================
   */

  const boseCompanionMatch =
    searchName.match(
      /\bbose\s+companion\s+(\d+)(?:\s+series\s+([ivx]+))?\b/
    );

  if (boseCompanionMatch) {
    let key =
      `BOSE COMPANION ${boseCompanionMatch[1]}`;

    if (boseCompanionMatch[2]) {
      key +=
        ` SERIES ${boseCompanionMatch[2].toUpperCase()}`;
    }

    return key;
  }

  /* Sony WH-Kopfhörer (z.B. "WH-1000XM3"). */
  const sonyWhMatch = searchName.match(
    /\bwh[\s-]?(\d{3,4})(xm\d)?\b/
  );

  if (sonyWhMatch) {
    return `SONY WH${sonyWhMatch[1]}${
      sonyWhMatch[2] ? sonyWhMatch[2].toUpperCase() : ''
    }`;
  }




/*
 * Samsung-Kopfhörer gehören zur Audiokategorie, nicht zu Handys.
 * \s* statt \s* vor der Generationszahl erlaubt auch "Buds2"
 * ohne Leerzeichen (JTL schreibt das oft zusammen).
 */
const galaxyBudsMatch = searchName.match(
  /\b(?:samsung\s+)?galaxy\s+buds\s*(?:(\d+)\s*)?(pro|live|fe)?\b/
);

if (galaxyBudsMatch) {
  const generation = galaxyBudsMatch[1] || '';
  const variant = galaxyBudsMatch[2]
    ? galaxyBudsMatch[2].toUpperCase()
    : '';

  return [
    'SAMSUNG GALAXY BUDS',
    generation,
    variant
  ].filter(Boolean).join(' ');
}

/* Apple AirPods gehören ebenfalls zur Audiokategorie. */
const airpodsMatch = searchName.match(
  /\bairpods\s*(pro)?\s*(\d+)?\b/
);

if (airpodsMatch) {
  const variant = airpodsMatch[1]
    ? airpodsMatch[1].toUpperCase()
    : '';
  const generation = airpodsMatch[2] || '';

  return [
    'APPLE AIRPODS',
    variant,
    generation
  ].filter(Boolean).join(' ');
}

if (/\bbose\s+soundsport\b/.test(searchName)) {
  return 'BOSE SOUNDSPORT';
}

if (
  /\bbose\s+(?:noise cancelling\s+)?headphones\s*700\b/.test(searchName)
) {
  return 'BOSE HEADPHONES 700';
}

if (
  /\bbose\s+tv\s+speaker\b/.test(searchName)
) {
  return 'BOSE TV SPEAKER';
}

const boseSoloMatch = searchName.match(
  /\bbose\s+solo\s*(\d+)(?:\s+soundbar)?\b/
);

if (boseSoloMatch) {
  return `BOSE SOLO ${boseSoloMatch[1]}`;
}
  const boseModelMatch =
    searchName.match(
      /\bbose\s+(soundlink|quietcomfort|soundtouch)\s*([a-z0-9-]+)?\b/
    );

  if (boseModelMatch) {
    return [
      'BOSE',
      boseModelMatch[1].toUpperCase(),
      boseModelMatch[2]
        ? boseModelMatch[2].toUpperCase()
        : ''
    ]
      .filter(Boolean)
      .join(' ');
  }

  const sonosPlayMatch =
    searchName.match(
      /\bsonos\s+play\s*:?\s*(1|3|5)\b/
    );

  if (sonosPlayMatch) {
    return `SONOS PLAY ${sonosPlayMatch[1]}`;
  }

  const sonosModelMatch =
    searchName.match(
      /\bsonos\s+(one|one sl|beam|arc|ray|move|roam|sub)(?:\s+gen\s*(\d+))?\b/
    );

  if (sonosModelMatch) {
    let key =
      `SONOS ${sonosModelMatch[1].toUpperCase()}`;

    if (sonosModelMatch[2]) {
      key +=
        ` GEN ${sonosModelMatch[2]}`;
    }

    return key;
  }

  /*
   * Blitzgeräte, VR und sonstige Elektronik.
   */

  const flashMatch =
    searchName.match(
      /\b\d{3,4}\s*(?:ex|ex ii|exiii)\b/
    );

  if (flashMatch) {
    return ekUppercaseModelKey_(
      flashMatch[0]
    );
  }

  const picoMatch =
    searchName.match(
      /\bpico\s*\d+\b/
    );

  if (picoMatch) {
    return ekUppercaseModelKey_(
      picoMatch[0]
    );
  }

  const goProMatch =
    searchName.match(
      /\bgopro\s*hero\s*(\d+)\b/
    );

  if (goProMatch) {
    return `GOPRO HERO ${goProMatch[1]}`;
  }

  if (/\basus\s*rog\s*ally\b/.test(searchName)) {
    return 'ASUS ROG ALLY';
  }

  /*
   * "PSP Street" ist die europäische Handelsbezeichnung der PSP-E1000
   * und dasselbe Gerät. PSP-E1000 wird bereits über den generischen
   * Buchstaben-Zahlen-Fallback weiter unten korrekt zu "E1000"; ohne
   * diesen Sonderfall würde "PSP Street" (keine Ziffer im Text) einen
   * eigenen, abweichenden Schlüssel bekommen und nie mit E1000 matchen.
   */
  if (/\bpsp\s*street\b/.test(searchName)) {
    return 'E1000';
  }

  const fritzFonMatch =
    searchName.match(
      /\bfritz\s*!?\s*fon\s+([a-z]\d+)\b/
    );

  if (fritzFonMatch) {
    return `FRITZFON ${fritzFonMatch[1].toUpperCase()}`;
  }

  if (/\bmagic mouse\s*2\b/.test(searchName)) {
    return 'APPLE MAGIC MOUSE 2';
  }

  /*
   * Letzter generischer Versuch:
   * Buchstaben-Zahlen-Modellcodes.
   */
  const genericModel =
    searchName.match(
      /\b[a-z]{1,10}[\s-]?\d{2,5}[a-z]{0,5}\b/
    );

  if (genericModel) {
    return ekUppercaseModelKey_(
      genericModel[0]
    );
  }

  return '';
}

/**
 * Entfernt Wörter, die für den primären Modellschlüssel
 * nicht relevant sind.
 */

function ekPrepareNameForModelKey_(
  normalizedName,
  category
) {
  let value =
    String(normalizedName || '');
  /*
   * Häufige Schreibfehler und Schreibvarianten vereinheitlichen.
   */
  value = value
    .replace(/\bswirch\b/g, 'switch')
    .replace(/\bswich\b/g, 'switch')
    .replace(/\bswtich\b/g, 'switch')
    .replace(/\bnintento\b/g, 'nintendo')
    .replace(/\bplaystationportal\b/g, 'playstation portal')
    .replace(/\bgame boy\b/g, 'gameboy');

  /*
   * OVP und allgemeine Zustands-/Verkaufsbegriffe.
   */
  value = value
    .replace(/\bovp\b/g, ' ')
    .replace(/\bneu\b/g, ' ')
    .replace(/\bgebraucht\b/g, ' ')
    .replace(/\bgetestet\b/g, ' ')
    .replace(/\bgeprueft\b/g, ' ')
    .replace(/\bmit originalverpackung\b/g, ' ');

  /*
   * Zubehör mit 0 EUR wird für den Hauptmodellschlüssel ignoriert.
   */
  value = value
    .replace(/\bladekabel\b/g, ' ')
    .replace(/\bladegeraet\b/g, ' ')
    .replace(/\btasche\b/g, ' ')
    .replace(/\bhuelle\b/g, ' ')
    .replace(/\bspiele?\b/g, ' ')
    .replace(/\bfifa\s*\d*\b/g, ' ')
    .replace(/\bred dead(?: redemption)?\s*\d*\b/g, ' ')
    .replace(/\btekken\s*\d*\b/g, ' ')
    .replace(/\bhogwarts\b/g, ' ');

  /*
   * Farben bei Kameras und Nintendo-Geräten ignorieren.
   */
  if (
    category === 'Kamera / sonstige Elektronik' ||
    category === 'Nintendo' ||
    category === 'Objektiv'
  ) {
    value =
      ekRemoveColorWords_(
        value
      );
  }

  /*
   * Bei Handys bleiben Farben in der normalisierten Bezeichnung erhalten,
   * werden aber noch nicht Teil des primären Modellschlüssels.
   */
  if (
    category === 'Handys + Tablets'
  ) {
    value =
      ekRemoveColorWords_(
        value
      );
  }

  return value
    .replace(/\s+/g, ' ')
    .trim();
}


/**
 * Entfernt gebräuchliche Farbangaben.
 */

function ekRemoveColorWords_(value) {
  const colors = [
    'schwarz',
    'weiss',
    'weiß',
    'grau',
    'silber',
    'blau',
    'rot',
    'gruen',
    'grün',
    'gelb',
    'rosa',
    'pink',
    'lila',
    'violett',
    'orange',
    'gold',
    'golden',
    'coral',
    'koralle',
    'aqua',
    'bordeaux',
    'tuerkis',
    'türkis',
    'anthrazit',
    // Fremdsprachige Farbwörter aus echten Prüffällen (Annika, 2026-08-03):
    'blanco', // Spanisch: weiß
    'valkoinen', // Finnisch: weiß
    'wit', // Niederländisch: weiß
    'zilver', // Niederländisch: silber
    'blanc', // Französisch: weiß
    'argent', // Französisch: silber
    'noir', // Französisch: schwarz
    'negro' // Spanisch: schwarz
  ];

  let result =
    String(value || '');

  colors.forEach(color => {
    const pattern =
      new RegExp(
        `\\b${ekEscapeRegExp_(color)}\\b`,
        'g'
      );

    result =
      result.replace(
        pattern,
        ' '
      );
  });

  return result;
}


/**
 * Ergänzt ausdrücklich vorhandene Speicherkapazitäten.
 *
 * Diese Funktion setzt keine Standardwerte.
 * Die Standardwerte für Einkäufe werden separat ergänzt.
 *
 * Beispiele:
 * - 1000GB → 1TB
 * - 8GB RAM + 128GB Speicher → 128GB
 * - 128 Go → 128GB
 */

function ekMinimalCameraModelKey_(modelKey) {
  /*
   * EK- und Verkaufsparser verwenden bewusst dieselbe zentrale
   * Kameranormalisierung. Dadurch kann keine zweite, abweichende
   * Schlüsselwelt entstehen.
   */
  if (typeof salesCanonicalizeCameraModelKey_ !== 'function') {
    throw new Error(
      'salesCanonicalizeCameraModelKey_ wurde nicht gefunden. ' +
      'Bitte 08_Verkaufs_Parser.gs aus Version 1.8 einsetzen.'
    );
  }

  return salesCanonicalizeCameraModelKey_(modelKey);
}


function ekAppendStorage_(
  baseKey,
  normalizedName
) {
  const value =
    String(normalizedName || '').toLowerCase();

  const storageMatches = [
    ...value.matchAll(
      /\b(\d+)\s*(gb|tb|go)\b/g
    )
  ];

  if (storageMatches.length === 0) {
    return baseKey;
  }

  const candidates =
    storageMatches.map(match => {
      const amount =
        Number(match[1]);

      const unit =
        match[2];

      const gigabytes =
        unit === 'tb'
          ? amount * 1000
          : amount;

      return {
        gigabytes: gigabytes
      };
    });

  const isPhoneOrTablet =
    /\biphone\b/.test(value) ||
    /\bsamsung galaxy\b/.test(value) ||
    /\bgalaxy tab\b/.test(value) ||
    /\bipad\b/.test(value) ||
    /\btablet\b/.test(value);

  let selected;

  if (isPhoneOrTablet) {
    /*
     * Kleine Angaben wie 4GB, 6GB, 8GB oder 12GB sind häufig RAM.
     * Wir verwenden den größten plausiblen Gerätespeicher ab 32GB.
     */
    const plausibleDeviceStorage =
      candidates.filter(candidate =>
        candidate.gigabytes >= 32
      );

    if (plausibleDeviceStorage.length === 0) {
      return baseKey;
    }

    selected =
      plausibleDeviceStorage.sort(
        (a, b) =>
          b.gigabytes - a.gigabytes
      )[0];

  } else {
    selected =
      candidates.sort(
        (a, b) =>
          b.gigabytes - a.gigabytes
      )[0];
  }

  if (!selected) {
    return baseKey;
  }

  let storageKey;

  if (selected.gigabytes === 1000) {
    storageKey = '1TB';

  } else if (
    selected.gigabytes > 1000 &&
    selected.gigabytes % 1000 === 0
  ) {
    storageKey =
      `${selected.gigabytes / 1000}TB`;

  } else {
    storageKey =
      `${selected.gigabytes}GB`;
  }

  if (
    new RegExp(
      `\\b${ekEscapeRegExp_(storageKey)}\\b`,
      'i'
    ).test(baseKey)
  ) {
    return baseKey;
  }

  return `${baseKey} ${storageKey}`;
}


/**
 * Ergänzt fehlende Speicherkapazitäten ausschließlich
 * bei der Normalisierung der Einkaufstabelle.
 *
 * Die Werte werden aus EK_Regeln gelesen.
 */

function ekApplyPurchaseStorageDefaults_(
  modelKey,
  normalizedName,
  category,
  rules
) {
  if (!modelKey) {
    return modelKey;
  }

  const value =
    String(normalizedName || '').toLowerCase();

  const currentModelKey =
    String(modelKey || '')
      .toUpperCase()
      .trim();

  /*
   * Eine ausdrücklich erkannte Kapazität hat immer Vorrang.
   */
  if (
    /\b\d+\s*(?:GB|TB)\b/i.test(
      currentModelKey
    )
  ) {
    return currentModelKey;
  }

  const storageRules =
    rules && rules.defaultStorage
      ? rules.defaultStorage
      : {
          PHONE: 128,
          TABLET: 64,
          PS4: 500,
          PS5: 825,
          XBOX_ONE: 500
        };

  const isTablet =
    /\bgalaxy\s+tab\b/.test(value) ||
    /\bsamsung\s+galaxy\s+tab\b/.test(value) ||
    /\bipad\b/.test(value) ||
    /\btablet\b/.test(value);

  const isPhone =
    !isTablet &&
    (
      /\biphone\b/.test(value) ||
      /\bsamsung\s+galaxy\b/.test(value) ||
      /\bgalaxy\s+[sa]\d+/i.test(value)
    );

  const isPs4 =
    /\bps4\b/.test(value) ||
    /\bplaystation\s+4\b/.test(value);

  const isPs5 =
    /\bps5\b/.test(value) ||
    /\bplaystation\s+5\b/.test(value);

  const isXboxOne =
    /\bxbox\s+one\b/.test(value);

  if (isTablet) {
    return (
      `${currentModelKey} ` +
      `${storageRules.TABLET}GB`
    );
  }

  if (isPhone) {
    return (
      `${currentModelKey} ` +
      `${storageRules.PHONE}GB`
    );
  }

  if (isPs4) {
    return (
      `${currentModelKey} ` +
      `${storageRules.PS4}GB`
    );
  }

  if (isPs5) {
    return (
      `${currentModelKey} ` +
      `${storageRules.PS5}GB`
    );
  }

  if (isXboxOne) {
    return (
      `${currentModelKey} ` +
      `${storageRules.XBOX_ONE}GB`
    );
  }

  return currentModelKey;
}


/**
 * Ergänzt eine ausdrücklich genannte Speicherkapazität. Fehlt sie,
 * wird der fachlich festgelegte Standardwert verwendet.
 */
function ekAppendStorageWithDefault_(
  baseKey,
  normalizedName,
  defaultStorage
) {
  const withExplicitStorage = ekAppendStorage_(
    baseKey,
    normalizedName
  );

  if (withExplicitStorage !== baseKey) {
    return withExplicitStorage;
  }

  return `${baseKey} ${defaultStorage}`;
}


/**
 * Erkennt einfache Herstellerbezeichnungen.
 */

function ekExtractBrand_(
  normalizedName
) {
  const brands = [
    'canon',
    'nikon',
    'sony',
    'panasonic',
    'sigma',
    'tamron',
    'olympus',
    'fujifilm',
    'pentax',
    'samsung',
    'apple'
  ];

  const normalized =
    String(normalizedName || '');

  const brand =
    brands.find(
      candidate =>
        new RegExp(
          `\\b${candidate}\\b`
        ).test(normalized)
    );

  return brand
    ? brand.toUpperCase()
    : '';
}


/**
 * Maskiert Sonderzeichen für reguläre Ausdrücke.
 */

function ekNormalizeProductName_(value) {
  return ekCleanText_(value)
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[–—]/g, '-')
    /*
     * Typografische Apostroph-Varianten (’ ‘ ´ ` ′) vereinheitlichen.
     * Marktplatz-Texte schreiben denselben Titel (z. B. "Marvel's
     * Spider-Man") inkonsistent mit geradem oder typografischem
     * Apostroph - ohne diese Vereinheitlichung matcht ein Spiele_Titel-
     * Eintrag nur die Hälfte der real vorkommenden Schreibweisen.
     */
    .replace(/[’‘´`′]/g, "'")
    .replace(/\+/g, ' + ')
    .replace(/[()[\],;:]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}


/**
 * Modellschlüssel einheitlich darstellen.
 */

function ekUppercaseModelKey_(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/(\d)\s*MM\b/g, '$1MM')
    .trim();
}


/**
 * Wandelt Preisangaben wie:
 *
 * 123,19€
 * 83 €
 * 1.234,56 EUR
 *
 * in eine echte Zahl um.
 */

function ekIsStandaloneGame_(normalizedName) {
  const value =
    String(normalizedName || '');

  const standaloneGamePatterns = [
    /\bpokemon\b/,
    /\bmario\b/,
    /\bzelda\b/,
    /\bmetroid\b/,
    /\bkirby\b/,
    /\bdonkey kong\b/,
    /\banimal crossing\b/,
    /\bfire emblem\b/,
    /\bprofessor layton\b/
  ];

  return standaloneGamePatterns.some(
    pattern => pattern.test(value)
  );
}

/**
 * Erstellt einen inhaltsbasierten Hash für eine Einkaufszeile.
 *
 * Die Quellzeilennummer ist absichtlich nicht enthalten.
 * Dadurch bleibt der Hash stabil, wenn oberhalb neue Zeilen
 * eingefügt werden.
 */

function ekAppendPs5Storage_(baseKey, normalizedName) {
  const value = String(normalizedName || '').toLowerCase();
  const isSlim = /^PS5 SLIM /.test(String(baseKey || '').toUpperCase());

  /*
   * Frühere 500-GB-Schlüssel waren fachlich falsch. Auch wenn 500 GB
   * ausdrücklich in Alt- oder Verkaufsdaten steht, wird daraus niemals
   * wieder ein PS5-500GB-Produkt.
   */
  if (isSlim) {
    return `${baseKey} 1TB`;
  }

  return `${baseKey} 825GB`;
}

/**
 * Bestimmt eine Kategorie aus der Verkaufsbezeichnung.
 */
