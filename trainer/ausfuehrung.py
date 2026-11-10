"""Server-Version: startet runner.py als eigenen Prozess (mit Zeitlimit)."""
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

RUNNER = Path(__file__).with_name("runner.py")
ZEITLIMIT = 10  # Sekunden


def _zeitlimit(was):
    return {
        "typ": "Zeitlimit",
        "meldung": f"Das Programm lief länger als {ZEITLIMIT} Sekunden und wurde abgebrochen.",
        "zeile": None,
        "text": f"Zeitlimit überschritten ({ZEITLIMIT} s) – {was}",
        "hinweis": "Prüfe, ob sich die Bedingung deiner Schleife irgendwann ändert.",
    }


def _starte(argumente, stdin_text, ergebnis_pfad):
    """Liefert (Ergebnis-Dict oder None, Prozessausgabe, Zeitlimit?, Dauer)."""
    beginn = time.monotonic()
    try:
        proc = subprocess.run(
            [sys.executable, "-I", "-X", "utf8", str(RUNNER), *argumente],
            input=stdin_text or "",
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=ZEITLIMIT,
            cwd=tempfile.gettempdir(),
        )
        ausgabe, timeout = proc.stdout + proc.stderr, False
    except subprocess.TimeoutExpired as exc:
        teil = exc.stdout or ""
        if isinstance(teil, bytes):
            teil = teil.decode("utf-8", "replace")
        ausgabe, timeout = teil[-20_000:], True
    dauer = round(time.monotonic() - beginn, 3)
    ergebnis = None
    if not timeout and ergebnis_pfad.exists():
        ergebnis = json.loads(ergebnis_pfad.read_text("utf-8"))
    return ergebnis, ausgabe, timeout, dauer


def ausfuehren(code: str, dateiname: str, stdin_text: str = "", modulname: str = "__main__") -> dict:
    with tempfile.TemporaryDirectory(prefix="codetrainer-") as tmp:
        quelle = Path(tmp, "quelle.py")
        quelle.write_text(code, encoding="utf-8")
        ergebnis_pfad = Path(tmp, "ergebnis.json")
        ergebnis, ausgabe, timeout, dauer = _starte(
            ["run", str(quelle), dateiname, str(ergebnis_pfad), modulname], stdin_text, ergebnis_pfad)
        if timeout:
            fehler = _zeitlimit("vermutlich eine Endlosschleife.")
        elif ergebnis is None:
            fehler = {"typ": "Abbruch", "meldung": "Das Programm wurde unerwartet beendet.",
                      "zeile": None, "text": ausgabe[-500:], "hinweis": ""}
        else:
            fehler, ausgabe = ergebnis["fehler"], ergebnis["ausgabe"]
        return {"ausgabe": ausgabe, "fehler": fehler, "dauer": dauer}


def pruefen(code: str, lektion: dict) -> dict:
    with tempfile.TemporaryDirectory(prefix="codetrainer-") as tmp:
        quelle = Path(tmp, "quelle.py")
        quelle.write_text(code, encoding="utf-8")
        tests_pfad = Path(tmp, "tests.json")
        tests_pfad.write_text(json.dumps(lektion["tests"], ensure_ascii=False), encoding="utf-8")
        ergebnis_pfad = Path(tmp, "ergebnis.json")
        ergebnis, ausgabe, timeout, dauer = _starte(
            ["check", str(quelle), lektion["datei"], str(ergebnis_pfad), lektion["modulname"], str(tests_pfad)],
            lektion.get("stdin", ""), ergebnis_pfad)
        if ergebnis is None:
            fehler = _zeitlimit("Endlosschleife oder ein input(), das auf mehr Eingaben wartet?") if timeout else {
                "typ": "Abbruch", "meldung": "Das Programm wurde unerwartet beendet.",
                "zeile": None, "text": ausgabe[-500:], "hinweis": ""}
            return {"ok": False, "ausgabe": ausgabe, "dauer": dauer, "tests": [], "fehler": fehler}
        ergebnis["dauer"] = dauer
        return ergebnis
