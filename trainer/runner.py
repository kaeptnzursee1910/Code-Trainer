"""Führt den Code der Lernenden aus und prüft ihn mit den Lektionstests.

Dieselbe Datei wird an zwei Stellen benutzt:
  * Server-Version: als eigener Prozess gestartet (siehe ausfuehrung.py)
        python -I runner.py run   <quelle.py> <dateiname> <ergebnis.json> [modulname]
        python -I runner.py check <quelle.py> <dateiname> <ergebnis.json> <modulname> <tests.json>
    Eingaben für input() kommen über stdin, die Ausgabe erscheint auf stdout.
  * Browser-Version: in Pyodide importiert; dort werden ausfuehren_code() und
    pruefe_code() direkt aufgerufen (siehe docs/python-worker.js).

Nur Standardbibliothek. Beim Ändern danach  python werkzeuge/export.py  ausführen.
"""
import builtins
import io
import json
import linecache
import sys
import traceback

LIMIT = 100_000  # maximale Zeichen Ausgabe

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


class ZuVielAusgabe(BaseException):
    """Wird ausgelöst, wenn ein Programm zu viel ausgibt (z. B. print in Endlosschleife)."""


ABBRUCH = {
    "typ": "Abbruch",
    "meldung": "Das Programm hat mehr als 100.000 Zeichen ausgegeben und wurde gestoppt.",
    "zeile": None,
    "text": "Ausgabe zu lang – vermutlich ein print() in einer Endlosschleife.",
    "hinweis": "Prüfe, ob deine Schleife irgendwann endet.",
}


class Sammler(io.TextIOBase):
    """stdout-Ersatz: sammelt die Ausgabe, begrenzt sie und reicht sie optional weiter."""

    def __init__(self, durch=None):
        self.teile = []
        self.anzahl = 0
        self.durch = durch

    def writable(self):
        return True

    def _schreiben(self, text):
        self.teile.append(text)
        if self.durch is not None:
            self.durch.write(text)
            self.durch.flush()

    def write(self, text):
        text = str(text)
        frei = LIMIT - self.anzahl
        self.anzahl += len(text)
        if self.anzahl > LIMIT:
            if frei > 0:
                self._schreiben(text[:frei] + "\n… Ausgabe abgebrochen (mehr als 100.000 Zeichen).\n")
            raise ZuVielAusgabe()
        self._schreiben(text)
        return len(text)

    def flush(self):
        if self.durch is not None:
            self.durch.flush()

    def wert(self):
        return "".join(self.teile)


def eingabe(prompt=""):
    """input()-Ersatz: zeigt die gelesene Eingabe in der Ausgabe mit an."""
    sys.stdout.write(str(prompt))
    zeile = sys.stdin.readline()
    if not zeile:
        sys.stdout.write("\n")
        raise EOFError(
            "input() hat keine Eingabe mehr bekommen – trage Werte im Feld "
            "»Eingaben« ein (eine pro Zeile)."
        )
    zeile = zeile.rstrip("\r\n")
    sys.stdout.write(zeile + "\n")
    return zeile


builtins.input = eingabe


def fehler_info(exc, dateiname):
    """Fehlermeldung ohne die internen Zeilen des Runners, mit Hinweis auf Deutsch."""
    if isinstance(exc, ZuVielAusgabe):
        return dict(ABBRUCH)
    te = traceback.TracebackException.from_exception(exc)
    te.stack = traceback.StackSummary.from_list([f for f in te.stack if f.filename == dateiname])
    te.__context__ = te.__cause__ = None
    zeile = None
    if isinstance(exc, SyntaxError) and exc.filename == dateiname:
        zeile = exc.lineno
    elif te.stack:
        zeile = te.stack[-1].lineno
    typ = type(exc).__name__
    return {
        "typ": typ,
        "meldung": str(exc),
        "zeile": zeile,
        "text": "".join(te.format()).rstrip(),
        "hinweis": HINWEISE.get(typ, ""),
    }


def _registrieren(quelle, dateiname):
    # Damit Fehlermeldungen die Codezeile anzeigen können
    linecache.cache[dateiname] = (len(quelle), None, quelle.splitlines(True), dateiname)


def _ausfuehren(quelle, dateiname, modulname, ns=None):
    if ns is None:
        ns = {}
    ns.update({"__name__": modulname, "__file__": dateiname, "__builtins__": builtins})
    exec(compile(quelle, dateiname, "exec"), ns)
    return ns


def mit_umleitung(eingabetext, funktion, *args, durch=None, **kwargs):
    """Führt funktion mit eigener Ein-/Ausgabe aus. Liefert (Rückgabe, Ausgabe)."""
    if eingabetext and not eingabetext.endswith("\n"):
        eingabetext += "\n"
    alt = sys.stdin, sys.stdout, sys.stderr
    sammler = Sammler(durch)
    sys.stdin = io.StringIO(eingabetext or "")
    sys.stdout = sys.stderr = sammler
    try:
        rueck = funktion(*args, **kwargs)
    finally:
        sys.stdin, sys.stdout, sys.stderr = alt
    return rueck, sammler.wert()


def ausfuehren_code(quelle, dateiname="programm.py", stdin_text="", modulname="__main__", durch=None):
    """Führt ein Programm aus. Liefert {"ausgabe", "fehler"}."""
    _registrieren(quelle, dateiname)
    alt = sys.stdin, sys.stdout, sys.stderr
    sammler = Sammler(durch)
    sys.stdin = io.StringIO(stdin_text or "")
    sys.stdout = sys.stderr = sammler
    fehler = None
    try:
        _ausfuehren(quelle, dateiname, modulname)
    except SystemExit:
        pass
    except BaseException as exc:  # noqa: BLE001 – alles melden
        fehler = fehler_info(exc, dateiname)
    finally:
        sys.stdin, sys.stdout, sys.stderr = alt
    return {"ausgabe": sammler.wert(), "fehler": fehler}


def pruefe_code(quelle, dateiname, tests, stdin_text="", modulname="__main__", durch=None):
    """Führt das Programm aus und danach die Tests (Liste von [Name, Code])."""
    _registrieren(quelle, dateiname)

    # 1. Programm einmal laufen lassen und Ausgabe mitschneiden
    ns = {}
    alt = sys.stdin, sys.stdout, sys.stderr
    sammler = Sammler(durch)
    sys.stdin = io.StringIO(stdin_text or "")
    sys.stdout = sys.stderr = sammler
    fehler = None
    try:
        _ausfuehren(quelle, dateiname, modulname, ns)
    except SystemExit:
        pass
    except BaseException as exc:  # noqa: BLE001
        fehler = fehler_info(exc, dateiname)
    finally:
        sys.stdin, sys.stdout, sys.stderr = alt
    ausgabe = sammler.wert()
    if fehler:
        return {"ok": False, "fehler": fehler, "tests": [], "ausgabe": ausgabe}

    # 2. Tests ausführen
    def starte(eingabetext=""):
        return mit_umleitung(eingabetext, _ausfuehren, quelle, dateiname, "__main__")[1]

    test_ns = dict(ns)
    test_ns.update(
        AUSGABE=ausgabe,
        QUELLTEXT=quelle,
        starte=starte,
        mit_eingabe=mit_umleitung,
        __name__="__tests__",
    )
    ergebnisse = []
    for name, code in tests:
        eintrag = {"name": name, "ok": True, "meldung": ""}
        alt_out = sys.stdout
        sys.stdout = Sammler()  # Ausgaben während der Tests verwerfen
        try:
            exec(compile(code, "<test>", "exec"), test_ns)
        except AssertionError as exc:
            eintrag.update(ok=False, meldung=str(exc) or "Bedingung nicht erfüllt.")
        except NameError as exc:
            fehlend = getattr(exc, "name", None) or str(exc)
            eintrag.update(ok=False, meldung=f"»{fehlend}« ist nicht definiert – lege die Variable/Funktion mit genau diesem Namen an.")
        except BaseException as exc:  # noqa: BLE001
            info = fehler_info(exc, dateiname)
            meldung = f"{info['typ']}: {info['meldung']}"
            if info["zeile"]:
                meldung += f" (Zeile {info['zeile']} in deinem Code)"
            eintrag.update(ok=False, meldung=meldung)
        finally:
            sys.stdout = alt_out
        ergebnisse.append(eintrag)

    return {"ok": all(t["ok"] for t in ergebnisse), "fehler": None, "tests": ergebnisse, "ausgabe": ausgabe}


def main():
    modus, quelle_pfad, dateiname, ergebnis_pfad = sys.argv[1:5]
    with open(quelle_pfad, encoding="utf-8") as f:
        quelle = f.read()
    stdin_text = sys.stdin.read()
    echt = sys.stdout
    if modus == "run":
        modulname = sys.argv[5] if len(sys.argv) > 5 else "__main__"
        ergebnis = ausfuehren_code(quelle, dateiname, stdin_text, modulname, durch=echt)
    else:
        with open(sys.argv[6], encoding="utf-8") as f:
            tests = json.load(f)
        ergebnis = pruefe_code(quelle, dateiname, tests, stdin_text, sys.argv[5], durch=echt)
    with open(ergebnis_pfad, "w", encoding="utf-8") as f:
        json.dump(ergebnis, f, ensure_ascii=False)


if __name__ == "__main__":
    main()
