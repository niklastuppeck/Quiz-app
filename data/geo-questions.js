// Generiert Geo-Fragen aus COUNTRIES und fügt sie zu QUESTIONS hinzu.
// Muss nach countries.js und questions.js geladen werden.
// Deterministische Generierung: beide Battle-Spieler erhalten identische Fragen.

(function () {
  if (typeof COUNTRIES === 'undefined' || typeof QUESTIONS === 'undefined') return;

  // Deterministischer LCG-Zufallsgenerator (seedbasiert)
  function seedRng(seed) {
    let s = seed >>> 0;
    return function () {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  function detShuffle(arr, rng) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  // Erstellt eine Frage mit deterministischen Falschantworten.
  // type-Buchstabe dient als zusätzlicher Seed-Offset pro Modus.
  function makeQuestion(country, allCountries, idx, typeChar, questionText, getCorrect, getWrong) {
    const rng = seedRng(idx * 97 + typeChar);

    const sameContinent = allCountries.filter(c => c.code !== country.code && c.continent === country.continent);
    const otherContinent = allCountries.filter(c => c.code !== country.code && c.continent !== country.continent);

    // Bevorzuge gleichen Kontinent für Falschantworten (realistischer)
    const wrongPool = [
      ...detShuffle(sameContinent, rng),
      ...detShuffle(otherContinent, seedRng(idx * 97 + typeChar + 1)),
    ].map(getWrong).filter((v, i, a) => a.indexOf(v) === i); // Duplikate entfernen

    const wrong3 = wrongPool.slice(0, 3);
    const correct = getCorrect(country);

    // Richtige Antwort an deterministisch bestimmter Position einfügen
    const correctPos = Math.floor(rng() * 4);
    const answers = [...wrong3];
    answers.splice(correctPos, 0, correct);

    return {
      question: questionText,
      answers,
      correctIndex: correctPos,
      difficulty: 'leicht',
    };
  }

  // ── Flaggen ──
  QUESTIONS['geo_flaggen'] = COUNTRIES.map((country, idx) =>
    makeQuestion(
      country, COUNTRIES, idx, 70, // 'F' = 70
      `__geo_flag__:${country.code}`,
      c => c.name,
      c => c.name
    )
  );

  // ── Hauptstädte ──
  QUESTIONS['geo_hauptstaedte'] = COUNTRIES.map((country, idx) =>
    makeQuestion(
      country, COUNTRIES, idx, 72, // 'H' = 72
      `Was ist die Hauptstadt von ${country.name}?`,
      c => c.capital,
      c => c.capital
    )
  );

  // ── Umrisse (nur Länder mit Topojson-Eintrag und sichtbarer Fläche) ──
  const outlineCountries = COUNTRIES.filter(c => c.numeric && !c.noOutline);
  QUESTIONS['geo_umrisse'] = outlineCountries.map((country, idx) =>
    makeQuestion(
      country, COUNTRIES, idx, 85, // 'U' = 85
      `__geo_outline__:${country.code}`,
      c => c.name,
      c => c.name
    )
  );

  // ── Geo-Themen für Battle-Auswahl ──
  window.GEO_TOPICS = [
    { id: 'geo_flaggen',      name: 'Flaggen',     description: 'Erkenne Flaggen der Welt',       icon: '🚩', color: '#10b981' },
    { id: 'geo_hauptstaedte', name: 'Hauptstädte', description: 'Ländernamen und Hauptstädte',    icon: '🏛️', color: '#06b6d4' },
    { id: 'geo_umrisse',      name: 'Umrisse',     description: 'Erkenne Länder an ihrer Form',   icon: '🗺️', color: '#8b5cf6' },
  ];
})();
