"""Prüft den Lehrplan: Jede Musterlösung muss bestehen, jeder Startcode durchfallen.

Ausführen:  python -m unittest discover tests
"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from trainer.ausfuehrung import ausfuehren, pruefen  # noqa: E402
from trainer.lektionen import LEKTIONEN  # noqa: E402


class LehrplanTest(unittest.TestCase):
    def test_musterloesungen_bestehen(self):
        for l in LEKTIONEN:
            with self.subTest(lektion=l["id"]):
                r = pruefen(l["loesung"], l)
                fehlgeschlagen = [t for t in r["tests"] if not t["ok"]]
                self.assertTrue(r["ok"], f"{r.get('fehler')} {fehlgeschlagen}")

    def test_startcode_besteht_nicht(self):
        for l in LEKTIONEN:
            with self.subTest(lektion=l["id"]):
                self.assertFalse(pruefen(l["starter"], l)["ok"])

    def test_lektionen_vollstaendig(self):
        for l in LEKTIONEN:
            with self.subTest(lektion=l["id"]):
                for feld in ("titel", "konzepte", "erklaerung", "aufgabe", "tests", "tipps", "loesung"):
                    self.assertTrue(l[feld], feld)


class RunnerTest(unittest.TestCase):
    def test_fehler_mit_zeile(self):
        r = ausfuehren("x = 1\nprint(y)\n", "test.py")
        self.assertEqual(r["fehler"]["typ"], "NameError")
        self.assertEqual(r["fehler"]["zeile"], 2)
        self.assertIn("test.py", r["fehler"]["text"])

    def test_eingaben(self):
        r = ausfuehren('n = input("Name: ")\nprint("Hi", n)\n', "test.py", "Ada\n")
        self.assertIsNone(r["fehler"])
        self.assertIn("Hi Ada", r["ausgabe"])

    def test_zu_viel_ausgabe(self):
        r = ausfuehren("while True:\n    print('x' * 1000)\n", "test.py")
        self.assertEqual(r["fehler"]["typ"], "Abbruch")


if __name__ == "__main__":
    unittest.main()
