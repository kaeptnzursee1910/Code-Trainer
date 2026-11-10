// Baut die Nachrichten für den Tutor-Agenten – für Server- und Browser-Version gleich.

const SYSTEM = `Du bist der KI-Tutor im „Code-Trainer“, einer Lernumgebung im Browser, die Anfängerinnen und Anfängern Schritt für Schritt Python beibringt.
Aufbau der Oberfläche: Links schreibt der Lernende Code im Editor, rechts oben sprichst du mit ihm, rechts unten erscheint die Ausgabe seines Programms.

So arbeitest du:
- Antworte immer auf Deutsch, freundlich, klar und knapp (meist 3–8 Sätze). Keine langen Einleitungen, keine Wiederholung der Frage.
- Lehre in kleinen Schritten und baue auf dem Gelernten auf. Benutze nur Python-Konzepte, die bis zur aktuellen Lektion behandelt wurden. Wäre etwas Späteres nötig, sag, in welcher Lektion es kommt.
- Verrate nicht die vollständige Lösung der aktuellen Aufgabe. Gib Hinweise, stelle eine Rückfrage oder zeige ein kleines Beispiel mit anderen Namen und Werten. Nur wenn das System dir ausdrücklich die Musterlösung gibt, darfst du sie zeigen.
- Code zeigst du immer in \`\`\`python-Blöcken, kurz und mit Kommentaren.
- Bei Fehlermeldungen: Erkläre in einfachen Worten, was Python meint, nenne die betroffene Zeile und deute an, wie man es behebt.
- Ob die Aufgabe gelöst ist, entscheidet die automatische Prüfung, nicht du. Behaupte nie, Tests seien bestanden, wenn es dir nicht gemeldet wurde.
- Weise bei Bedarf auf die Befehle hin: /prüfen (Aufgabe prüfen), /tipp, /erklär (Code erklären), /fehler (letzten Fehler erklären), /lösung, /weiter. Ausführen geht mit Strg+Enter oder dem Knopf ▶.
- Fragen, die nichts mit Programmieren zu tun haben, beantwortest du kurz und lenkst freundlich zurück zur Lektion.`;

// Kleinere Modelle (Browser) bekommen einen kompakteren Kontext.
function kontext(lektion, alle, code, ausgabe, kompakt) {
  const nr = lektion.id;
  const frueher = alle.slice(0, nr - 1).map((l) => kompakt ? l.titel : `${l.id}. ${l.titel} (${l.konzepte.join(", ")})`);
  const naechste = nr < alle.length ? alle[nr].titel : null;
  const max = kompakt ? 1200 : 2500;
  const teile = [
    `## Aktuelle Lektion ${nr} von ${alle.length}: ${lektion.titel}`,
    "Neue Konzepte dieser Lektion: " + lektion.konzepte.join(", "),
    "Bereits gelernt: " + (frueher.length ? frueher.join("; ") : "noch nichts – das ist die erste Lektion."),
    naechste ? `Nächste Lektion: ${naechste}` : "Das ist die letzte Lektion des Kurses.",
    "",
    "### Aufgabe der Lektion",
    lektion.aufgabe,
    "",
    `## Aktueller Code im Editor (${lektion.datei})`,
    "```python\n" + (code.trim() || "# (noch leer)") + "\n```",
  ];
  if (ausgabe && ausgabe.trim()) {
    const g = ausgabe.length < max ? ausgabe : ausgabe.slice(0, max / 2) + "\n…\n" + ausgabe.slice(-max / 2);
    teile.push("", "## Letzte Ausgabe des Programms", "```text\n" + g.trimEnd() + "\n```");
  }
  return teile.join("\n");
}

function pruefbericht(p) {
  const z = [];
  if (p.fehler) z.push(`Das Programm ist mit einem Fehler abgebrochen: ${p.fehler.text || p.fehler.meldung}`);
  for (const t of p.tests || []) z.push(`- ${t.ok ? "✓" : "✗"} ${t.name}${t.meldung ? " → " + t.meldung : ""}`);
  return z.join("\n") || "(keine Details)";
}

/**
 * @param {string} modus  frage | pruefung | tipp | erklaeren | fehler | loesung | lektion
 * @param {object} o      { lektion, alle, verlauf, code, ausgabe, text, pruefung, tippNr, kompakt }
 */
export function baueNachrichten(modus, o) {
  const { lektion, alle, verlauf = [], code = "", ausgabe = "", text = "", pruefung = null, tippNr = 1, kompakt = false } = o;
  const nachrichten = [{ role: "system", content: SYSTEM + "\n\n" + kontext(lektion, alle, code, ausgabe, kompakt) }];
  for (const n of verlauf.slice(kompakt ? -6 : -12)) {
    if ((n.role === "user" || n.role === "assistant") && n.content) nachrichten.push({ role: n.role, content: n.content.slice(0, kompakt ? 1500 : 4000) });
  }
  const nr = lektion.id;
  const naechste = nr < alle.length ? alle[nr].titel : null;
  let anweisung;

  if (modus === "pruefung" && pruefung) {
    if (pruefung.ok) {
      anweisung = "[System] Die automatische Prüfung meldet: ALLE TESTS BESTANDEN.\n" + pruefbericht(pruefung) + "\n\n" +
        "Gratuliere kurz und konkret: Was ist an diesem Code gut gelöst? Gib, falls sinnvoll, einen kleinen Profi-Tipp, " +
        "wie man ihn noch eleganter schreiben könnte (nur mit bekannten Konzepten). " +
        (naechste ? `Kündige zum Schluss in einem Satz die nächste Lektion „${naechste}“ an und erwähne /weiter.`
                  : "Das war die letzte Lektion – gratuliere zum Abschluss des Kurses und schlage zwei kleine eigene Projektideen vor.");
    } else {
      anweisung = "[System] Die automatische Prüfung meldet: NOCH NICHT BESTANDEN.\n" + pruefbericht(pruefung) + "\n\n" +
        "Erkläre ermutigend und konkret, woran es liegt (bezogen auf den Code oben), und gib einen gezielten Hinweis " +
        "für den nächsten Schritt. Keine vollständige Lösung.";
    }
  } else if (modus === "tipp") {
    anweisung = `[System] Der Lernende bittet um Tipp Nr. ${tippNr}. Gib genau EINEN kleinen, konkreten Hinweis für den nächsten ` +
      "Schritt, passend zu seinem aktuellen Code. Je höher die Tipp-Nummer, desto konkreter darfst du werden – aber keine komplette Lösung.\n" +
      "Orientierung aus dem Lehrplan:\n" + lektion.tipps.map((t, i) => `${i + 1}. ${t}`).join("\n");
  } else if (modus === "erklaeren") {
    anweisung = "[System] Erkläre den aktuellen Code im Editor Abschnitt für Abschnitt in einfachen Worten. " +
      "Weise freundlich auf Fehler oder Verbesserungsmöglichkeiten hin, ohne die Aufgabe komplett zu lösen.";
  } else if (modus === "fehler") {
    anweisung = "[System] Das Programm ist zuletzt mit dieser Fehlermeldung abgebrochen:\n```text\n" + (text || "(unbekannt)") +
      "\n```\nErkläre, was die Meldung bedeutet, welche Zeile betroffen ist und wie man den Fehler findet und behebt.";
  } else if (modus === "loesung") {
    anweisung = "[System] Der Lernende hat die Musterlösung angefordert. Sie wurde ihm bereits angezeigt:\n```python\n" + lektion.loesung +
      "```\nErkläre sie kurz Schritt für Schritt und vergleiche sie mit seinem Code. Wiederhole die Lösung nicht komplett.";
  } else if (modus === "lektion") {
    anweisung = "[System] Der Lernende möchte das Thema dieser Lektion noch einmal anders erklärt bekommen. Erkläre die neuen " +
      "Konzepte mit einer anschaulichen Alltags-Analogie und einem neuen, kurzen Codebeispiel (nicht die Aufgabe). " +
      "Verbinde es mit dem bisher Gelernten. Keine Lösung der Aufgabe.";
  } else {
    anweisung = text;
  }
  nachrichten.push({ role: "user", content: anweisung });
  return nachrichten;
}
