"""Baut die Prompts für den Tutor-Agenten."""
from .lektionen import LEKTIONEN

SYSTEM = """Du bist der KI-Tutor im „Code-Trainer“, einer Lernumgebung im Browser, die Anfängerinnen und Anfängern Schritt für Schritt Python beibringt.
Aufbau der Oberfläche: Links schreibt der Lernende Code im Editor, rechts oben sprichst du mit ihm, rechts unten erscheint die Ausgabe seines Programms.

So arbeitest du:
- Antworte immer auf Deutsch, freundlich, klar und knapp (meist 3–8 Sätze). Keine langen Einleitungen, keine Wiederholung der Frage.
- Lehre in kleinen Schritten und baue auf dem Gelernten auf. Benutze nur Python-Konzepte, die bis zur aktuellen Lektion behandelt wurden. Wäre etwas Späteres nötig, sag, in welcher Lektion es kommt.
- Verrate nicht die vollständige Lösung der aktuellen Aufgabe. Gib Hinweise, stelle eine Rückfrage oder zeige ein kleines Beispiel mit anderen Namen und Werten. Nur wenn das System dir ausdrücklich die Musterlösung gibt, darfst du sie zeigen.
- Code zeigst du immer in ```python-Blöcken, kurz und mit Kommentaren.
- Bei Fehlermeldungen: Erkläre in einfachen Worten, was Python meint, nenne die betroffene Zeile und deute an, wie man es behebt.
- Ob die Aufgabe gelöst ist, entscheidet die automatische Prüfung, nicht du. Behaupte nie, Tests seien bestanden, wenn es dir nicht gemeldet wurde.
- Weise bei Bedarf auf die Befehle hin: /prüfen (Aufgabe prüfen), /tipp, /erklär (Code erklären), /fehler (letzten Fehler erklären), /lösung, /weiter. Ausführen geht mit Strg+Enter.
- Fragen, die nichts mit Programmieren zu tun haben, beantwortest du kurz und lenkst freundlich zurück zur Lektion."""


def _kontext(lektion, code, ausgabe):
    nr = lektion["id"]
    frueher = [f"{l['id']}. {l['titel']} ({', '.join(l['konzepte'])})" for l in LEKTIONEN[: nr - 1]]
    naechste = LEKTIONEN[nr]["titel"] if nr < len(LEKTIONEN) else None
    teile = [
        f"## Aktuelle Lektion {nr} von {len(LEKTIONEN)}: {lektion['titel']}",
        "Neue Konzepte dieser Lektion: " + ", ".join(lektion["konzepte"]),
        "Bereits gelernt: " + ("; ".join(frueher) if frueher else "noch nichts – das ist die erste Lektion."),
        f"Nächste Lektion: {naechste}" if naechste else "Das ist die letzte Lektion des Kurses.",
        "",
        "### Aufgabe der Lektion",
        lektion["aufgabe"],
        "",
        f"## Aktueller Code im Editor ({lektion['datei']})",
        "```python\n" + (code.strip() or "# (noch leer)") + "\n```",
    ]
    if ausgabe and ausgabe.strip():
        gekuerzt = ausgabe if len(ausgabe) < 2500 else ausgabe[:1200] + "\n…\n" + ausgabe[-1200:]
        teile += ["", "## Letzte Ausgabe des Programms", "```text\n" + gekuerzt.rstrip() + "\n```"]
    return "\n".join(teile)


def _pruefbericht(pruefung):
    zeilen = []
    if pruefung.get("fehler"):
        f = pruefung["fehler"]
        zeilen.append(f"Das Programm ist mit einem Fehler abgebrochen: {f.get('text') or f.get('meldung')}")
    for t in pruefung.get("tests", []):
        zeilen.append(f"- {'✓' if t['ok'] else '✗'} {t['name']}" + (f" → {t['meldung']}" if t.get("meldung") else ""))
    return "\n".join(zeilen) or "(keine Details)"


def baue_nachrichten(modus, lektion, verlauf, code="", ausgabe="", text="", pruefung=None, tipp_nr=1):
    """Erzeugt die Nachrichtenliste für das Modell."""
    system = SYSTEM + "\n\n" + _kontext(lektion, code, ausgabe)
    nachrichten = [{"role": "system", "content": system}]
    for n in verlauf[-12:]:
        if n.get("role") in ("user", "assistant") and n.get("content"):
            nachrichten.append({"role": n["role"], "content": n["content"][:4000]})

    nr = lektion["id"]
    naechste = LEKTIONEN[nr]["titel"] if nr < len(LEKTIONEN) else None

    if modus == "pruefung" and pruefung is not None:
        if pruefung.get("ok"):
            anweisung = (
                "[System] Die automatische Prüfung meldet: ALLE TESTS BESTANDEN.\n"
                f"{_pruefbericht(pruefung)}\n\n"
                "Gratuliere kurz und konkret: Was ist an diesem Code gut gelöst? Gib, falls sinnvoll, einen kleinen "
                "Profi-Tipp, wie man ihn noch eleganter schreiben könnte (nur mit bekannten Konzepten). "
                + (f"Kündige zum Schluss in einem Satz die nächste Lektion „{naechste}“ an und erwähne /weiter."
                   if naechste else "Das war die letzte Lektion – gratuliere zum Abschluss des Kurses und schlage zwei kleine eigene Projektideen vor.")
            )
        else:
            anweisung = (
                "[System] Die automatische Prüfung meldet: NOCH NICHT BESTANDEN.\n"
                f"{_pruefbericht(pruefung)}\n\n"
                "Erkläre ermutigend und konkret, woran es liegt (bezogen auf den Code oben), und gib einen gezielten "
                "Hinweis für den nächsten Schritt. Keine vollständige Lösung."
            )
    elif modus == "tipp":
        tipps = "\n".join(f"{i}. {t}" for i, t in enumerate(lektion["tipps"], 1))
        anweisung = (
            f"[System] Der Lernende bittet um Tipp Nr. {tipp_nr}. Gib genau EINEN kleinen, konkreten Hinweis für den "
            "nächsten Schritt, passend zu seinem aktuellen Code. Je höher die Tipp-Nummer, desto konkreter darfst du "
            "werden – aber keine komplette Lösung.\nOrientierung aus dem Lehrplan:\n" + tipps
        )
    elif modus == "erklaeren":
        anweisung = (
            "[System] Erkläre den aktuellen Code im Editor Abschnitt für Abschnitt in einfachen Worten. "
            "Weise freundlich auf Fehler oder Verbesserungsmöglichkeiten hin, ohne die Aufgabe komplett zu lösen."
        )
    elif modus == "fehler":
        anweisung = (
            "[System] Das Programm ist zuletzt mit dieser Fehlermeldung abgebrochen:\n```text\n"
            + (text or "(unbekannt)")
            + "\n```\nErkläre, was die Meldung bedeutet, welche Zeile betroffen ist und wie man den Fehler findet und behebt."
        )
    elif modus == "loesung":
        anweisung = (
            "[System] Der Lernende hat die Musterlösung angefordert. Sie wurde ihm bereits angezeigt:\n```python\n"
            + lektion["loesung"]
            + "```\nErkläre sie kurz Schritt für Schritt und vergleiche sie mit seinem Code. Wiederhole die Lösung nicht komplett."
        )
    elif modus == "lektion":
        anweisung = (
            "[System] Der Lernende möchte das Thema dieser Lektion noch einmal anders erklärt bekommen. Erkläre die neuen "
            "Konzepte mit einer anschaulichen Alltags-Analogie und einem neuen, kurzen Codebeispiel (nicht die Aufgabe). "
            "Verbinde es mit dem bisher Gelernten. Keine Lösung der Aufgabe."
        )
    else:  # freie Frage
        anweisung = text

    nachrichten.append({"role": "user", "content": anweisung})
    return nachrichten
