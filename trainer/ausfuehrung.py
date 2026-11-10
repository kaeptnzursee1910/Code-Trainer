"""Startet den Runner als eigenen Prozess (mit Zeitlimit) und wertet ihn aus."""
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

RUNNER = Path(__file__).with_name("runner.py")
ZEITLIMIT = 10  # Sekunden

HINWEISE = {
    "SyntaxError": "Python versteht den Aufbau dieser Zeile nicht – oft fehlt ein Doppelpunkt, eine Klammer oder ein Anführungszeichen.",
    "IndentationError": "Die Einrückung stimmt nicht. Blöcke nach einem Doppelpunkt werden mit 4 Leerzeichen eingerückt.",
    "NameError": "Ein Name ist unbekannt – vertippt (Groß-/Kleinschreibung!) oder vor der Zuweisung benutzt?",
    "TypeError": "Ein Wert hat den falschen Typ, z. B. Text + Zahl. Wandle mit int(), float() oder str() um.",
    "ValueError": "Der Typ passt, der Wert nicht – z. B. int(\"abc\").",
    "ZeroDivisionError": "Es wurde durch 0 geteilt.",
    "IndexError": "Diese Position gibt es nicht. Indizes beginnen bei 0 und enden bei len(...) - 1.",
    "KeyError": "Diesen Schlüssel gibt es im Dictionary nicht. Tipp: .get() mit Ersatzwert.",
    "AttributeError": "Dieses Objekt hat die genannte Methode/Eigenschaft nicht – vertippt?",
    "EOFError": "Dein Programm wartet auf eine Eingabe. Trage Werte unter »⌨ Eingaben« ein, eine pro Zeile.",
    "RecursionError": "Eine Funktion ruft sich endlos selbst auf.",
}


def _starte(argumente, stdin_text):
    beginn = time.monotonic()
    try:
        proc = subprocess.run(
            [sys.executable, "-I", "-X", "utf8", str(RUNNER), *argumente],
            input=stdin_text,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=ZEITLIMIT,
            cwd=tempfile.gettempdir(),
        )
        ausgabe = proc.stdout + proc.stderr
        return ausgabe, proc.returncode, False, time.monotonic() - beginn
    except subprocess.TimeoutExpired as exc:
        teil = exc.stdout or ""
        if isinstance(teil, bytes):
            teil = teil.decode("utf-8", "replace")
        return teil[-20_000:], -1, True, time.monotonic() - beginn


def _ergaenze_hinweis(fehler):
    if fehler:
        fehler["hinweis"] = HINWEISE.get(fehler["typ"], "")
    return fehler


def ausfuehren(code: str, dateiname: str, stdin_text: str = "", modulname: str = "__main__") -> dict:
    with tempfile.TemporaryDirectory(prefix="codetrainer-") as tmp:
        quelle = Path(tmp, "quelle.py")
        quelle.write_text(code, encoding="utf-8")
        ergebnis_pfad = Path(tmp, "ergebnis.json")
        ausgabe, code_rc, timeout, dauer = _starte(
            ["run", str(quelle), dateiname, str(ergebnis_pfad), modulname], stdin_text
        )
        fehler = None
        if timeout:
            fehler = {
                "typ": "Zeitlimit",
                "meldung": f"Das Programm lief länger als {ZEITLIMIT} Sekunden und wurde abgebrochen.",
                "zeile": None,
                "text": f"Zeitlimit überschritten ({ZEITLIMIT} s) – vermutlich eine Endlosschleife.",
                "hinweis": "Prüfe, ob sich die Bedingung deiner Schleife irgendwann ändert.",
            }
        elif ergebnis_pfad.exists():
            fehler = _ergaenze_hinweis(json.loads(ergebnis_pfad.read_text("utf-8"))["fehler"])
        else:
            fehler = {
                "typ": "Abbruch",
                "meldung": "Das Programm hat zu viel ausgegeben und wurde gestoppt.",
                "zeile": None,
                "text": "Mehr als 100.000 Zeichen Ausgabe – vermutlich ein print() in einer Endlosschleife.",
                "hinweis": "Prüfe, ob deine Schleife irgendwann endet.",
            }
        return {"ausgabe": ausgabe, "fehler": fehler, "dauer": round(dauer, 3), "returncode": code_rc}


def pruefen(code: str, lektion: dict) -> dict:
    with tempfile.TemporaryDirectory(prefix="codetrainer-") as tmp:
        quelle = Path(tmp, "quelle.py")
        quelle.write_text(code, encoding="utf-8")
        tests_pfad = Path(tmp, "tests.json")
        tests_pfad.write_text(json.dumps(lektion["tests"], ensure_ascii=False), encoding="utf-8")
        ergebnis_pfad = Path(tmp, "ergebnis.json")
        ausgabe, _, timeout, dauer = _starte(
            ["check", str(quelle), lektion["datei"], str(ergebnis_pfad), lektion["modulname"], str(tests_pfad)],
            lektion.get("stdin", ""),
        )
        if timeout:
            return {
                "ok": False,
                "ausgabe": ausgabe,
                "dauer": round(dauer, 3),
                "tests": [],
                "fehler": {
                    "typ": "Zeitlimit",
                    "meldung": f"Länger als {ZEITLIMIT} Sekunden – vermutlich eine Endlosschleife oder ein input(), das auf mehr Eingaben wartet.",
                    "zeile": None,
                    "text": f"Zeitlimit überschritten ({ZEITLIMIT} s).",
                    "hinweis": "Prüfe deine Schleifenbedingungen.",
                },
            }
        if not ergebnis_pfad.exists():
            return {
                "ok": False,
                "ausgabe": ausgabe,
                "dauer": round(dauer, 3),
                "tests": [],
                "fehler": {"typ": "Abbruch", "meldung": "Das Programm wurde vorzeitig beendet (z. B. zu viel Ausgabe).",
                           "zeile": None, "text": ausgabe[-500:], "hinweis": ""},
            }
        ergebnis = json.loads(ergebnis_pfad.read_text("utf-8"))
        ergebnis["ausgabe"] = ausgabe
        ergebnis["dauer"] = round(dauer, 3)
        _ergaenze_hinweis(ergebnis.get("fehler"))
        return ergebnis
