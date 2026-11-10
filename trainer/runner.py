"""Führt den Code der Lernenden in einem eigenen Python-Prozess aus.

Aufruf (vom Server):
    python -I runner.py run   <quelle.py> <dateiname> <ergebnis.json> [modulname]
    python -I runner.py check <quelle.py> <dateiname> <ergebnis.json> <modulname> <tests.json>

Die Programmausgabe landet auf stdout, das strukturierte Ergebnis
(Fehler, Testergebnisse) in <ergebnis.json>.
"""
import builtins
import io
import json
import linecache
import os
import sys
import traceback

LIMIT = 100_000  # maximale Zeichen Ausgabe


class Begrenzt(io.TextIOBase):
    """stdout-Ersatz, der zu lange Ausgaben (Endlos-print) abbricht."""

    def __init__(self, ziel):
        self.ziel = ziel
        self.anzahl = 0

    def writable(self):
        return True

    def write(self, text):
        text = str(text)
        frei = LIMIT - self.anzahl
        self.anzahl += len(text)
        if self.anzahl > LIMIT:
            self.ziel.write(text[: max(frei, 0)])
            self.ziel.write("\n… Ausgabe abgebrochen: mehr als 100.000 Zeichen.\n")
            self.ziel.flush()
            sys.__stdout__.flush()
            os._exit(3)
        self.ziel.write(text)
        return len(text)

    def flush(self):
        self.ziel.flush()


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
    """Fehlermeldung ohne die internen Zeilen des Runners."""
    te = traceback.TracebackException.from_exception(exc)
    te.stack = traceback.StackSummary.from_list(
        [f for f in te.stack if f.filename == dateiname]
    )
    te.__context__ = te.__cause__ = None
    zeile = None
    if isinstance(exc, SyntaxError) and exc.filename == dateiname:
        zeile = exc.lineno
    elif te.stack:
        zeile = te.stack[-1].lineno
    return {
        "typ": type(exc).__name__,
        "meldung": str(exc),
        "zeile": zeile,
        "text": "".join(te.format()).rstrip(),
    }


def ausfuehren(quelle, dateiname, modulname, ns=None):
    if ns is None:
        ns = {}
    ns.update({"__name__": modulname, "__file__": dateiname, "__builtins__": builtins})
    exec(compile(quelle, dateiname, "exec"), ns)
    return ns


def umgeleitet(eingabetext, funktion, *args, **kwargs):
    """Führt funktion mit eigener Ein-/Ausgabe aus. Liefert (Rückgabe, Ausgabe)."""
    if eingabetext and not eingabetext.endswith("\n"):
        eingabetext += "\n"
    alt_in, alt_out = sys.stdin, sys.stdout
    puffer = io.StringIO()
    sys.stdin, sys.stdout = io.StringIO(eingabetext or ""), Begrenzt(puffer)
    try:
        rueck = funktion(*args, **kwargs)
    finally:
        sys.stdin, sys.stdout = alt_in, alt_out
    return rueck, puffer.getvalue()


def schreibe(pfad, daten):
    with open(pfad, "w", encoding="utf-8") as f:
        json.dump(daten, f, ensure_ascii=False)


def modus_run(quelle, dateiname, ergebnis_pfad, modulname="__main__"):
    ergebnis = {"fehler": None}
    try:
        ausfuehren(quelle, dateiname, modulname)
    except SystemExit:
        pass
    except BaseException as exc:  # noqa: BLE001 – alles melden
        ergebnis["fehler"] = fehler_info(exc, dateiname)
    finally:
        sys.stdout.flush()
        schreibe(ergebnis_pfad, ergebnis)


def modus_check(quelle, dateiname, ergebnis_pfad, modulname, tests_pfad):
    with open(tests_pfad, encoding="utf-8") as f:
        tests = json.load(f)

    # 1. Programm einmal laufen lassen und Ausgabe mitschneiden
    ns = {}
    fehler = None
    echt = sys.stdout
    puffer = io.StringIO()
    sys.stdout = Begrenzt(puffer)
    try:
        ausfuehren(quelle, dateiname, modulname, ns)
    except SystemExit:
        pass
    except BaseException as exc:  # noqa: BLE001
        fehler = fehler_info(exc, dateiname)
    finally:
        sys.stdout = echt
    ausgabe = puffer.getvalue()
    echt.write(ausgabe)
    echt.flush()

    if fehler:
        schreibe(ergebnis_pfad, {"ok": False, "fehler": fehler, "tests": [], "ausgabe": ausgabe})
        return

    # 2. Tests ausführen
    def starte(eingabetext=""):
        return umgeleitet(eingabetext, ausfuehren, quelle, dateiname, "__main__")[1]

    test_ns = dict(ns)
    test_ns.update(
        AUSGABE=ausgabe,
        QUELLTEXT=quelle,
        starte=starte,
        mit_eingabe=umgeleitet,
        __name__="__tests__",
    )
    ergebnisse = []
    for name, code in tests:
        eintrag = {"name": name, "ok": True, "meldung": ""}
        sys.stdout = Begrenzt(io.StringIO())  # Ausgaben während Tests verwerfen
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
            sys.stdout = echt
        ergebnisse.append(eintrag)

    schreibe(
        ergebnis_pfad,
        {"ok": all(t["ok"] for t in ergebnisse), "fehler": None, "tests": ergebnisse, "ausgabe": ausgabe},
    )


def main():
    modus, quelle_pfad, dateiname, ergebnis_pfad = sys.argv[1:5]
    with open(quelle_pfad, encoding="utf-8") as f:
        quelle = f.read()
    # Damit Fehlermeldungen die Codezeile anzeigen können
    linecache.cache[dateiname] = (len(quelle), None, quelle.splitlines(True), dateiname)
    sys.stdout = Begrenzt(sys.stdout)
    sys.stderr = sys.stdout
    if modus == "run":
        modus_run(quelle, dateiname, ergebnis_pfad, *sys.argv[5:6])
    else:
        modus_check(quelle, dateiname, ergebnis_pfad, sys.argv[5], sys.argv[6])


if __name__ == "__main__":
    main()
