# ◆ Code-Trainer

Ein KI-Agent, der dir **Python** beibringt – im Browser, im Terminal-Look von Claude Code, mit einem **lokalen** Sprachmodell. Keine Cloud, kein Konto, keine Zusatzpakete.

```
┌──────────────────────────┬──────────────────────────────┐
│                          │  ◆ Agent                     │
│   Editor                 │  Lektion, Erklärungen, Chat, │
│   (dein Python-Code)     │  Tipps, Feedback zu Tests    │
│                          ├──────────────────────────────┤
│                          │  Ausgabe                     │
│                          │  Programmausgabe & Tests     │
└──────────────────────────┴──────────────────────────────┘
```

## Schnellstart

Voraussetzung: **Python 3.10 oder neuer**.

```bash
# 1. Lokales Modell bereitstellen (einmalig) – z. B. mit Ollama: https://ollama.com
ollama pull qwen2.5-coder:7b

# 2. Code-Trainer starten
git clone https://github.com/kaeptnzursee1910/Code-Trainer.git
cd Code-Trainer
python server.py
```

Der Browser öffnet sich automatisch unter <http://127.0.0.1:8000>.

> Ohne laufendes Modell funktioniert der Kurs trotzdem: Lektionen, Ausführen, automatische Prüfung, gestufte Tipps und Musterlösungen. Nur der freie Chat und die individuellen Erklärungen brauchen das Modell.

### Andere lokale Modell-Server

Jeder OpenAI-kompatible Server funktioniert (LM Studio, llama.cpp-Server, Jan, vLLM …):

```bash
python server.py --provider openai --base-url http://localhost:1234 --modell qwen2.5-coder-7b-instruct
```

Alle Optionen: `python server.py --help`. Alternativ per Umgebungsvariable: `CODETRAINER_PROVIDER`, `CODETRAINER_BASE_URL`, `CODETRAINER_MODELL`, `CODETRAINER_API_KEY`. Das Modell lässt sich auch oben rechts in der Oberfläche wechseln.

**Modell-Empfehlungen:** `qwen2.5-coder:7b` (guter Kompromiss), `qwen2.5-coder:14b` (besser, braucht ~10 GB RAM), `llama3.1:8b` oder `gemma2:9b` (gutes Deutsch).

## So funktioniert's

1. Der Agent stellt eine **Lektion** vor: Erklärung mit Beispielen und eine Aufgabe.
2. Du schreibst links den Code und führst ihn mit **Strg+Enter** aus. Die Ausgabe erscheint unten rechts, Fehlerzeilen werden im Editor rot markiert.
3. Mit **/prüfen** (Strg+Shift+Enter) laufen automatische Tests. Der Agent gibt dir Feedback – bei Fehlern einen Hinweis statt der Lösung.
4. Ist alles grün, schaltest du mit **/weiter** die nächste Lektion frei. Dein Fortschritt und Code werden automatisch gespeichert.

### Befehle im Agent-Fenster

| Befehl | Wirkung |
|---|---|
| `/hilfe` | alle Befehle |
| `/prüfen` | Aufgabe prüfen |
| `/ausführen` | Programm ausführen |
| `/tipp` | gestufter Hinweis (mehrfach aufrufbar) |
| `/erklär` | Agent erklärt deinen Code |
| `/fehler` | Agent erklärt die letzte Fehlermeldung |
| `/nochmal` | Thema anders erklärt, mit neuem Beispiel |
| `/aufgabe` | Lektion erneut anzeigen |
| `/lösung` | Musterlösung (mit Rückfrage) |
| `/weiter`, `/zurück`, `/lektion N`, `/lektionen` | Navigation |
| `/reset` | Startcode wiederherstellen |
| `/neu` | Chat leeren |
| `/modell [name]` | Modell anzeigen/wechseln |

Alles andere, was du eintippst, beantwortet der Agent – er kennt deine aktuelle Lektion, deinen Code und die letzte Ausgabe.

**Tastatur:** Strg+Enter ausführen · Strg+Shift+Enter prüfen · Esc Antwort abbrechen · Alt+L Lektionsmenü · Tab/Shift+Tab ein-/ausrücken · Enter rückt nach `:` automatisch ein.

`input()` bekommt seine Eingaben aus dem Feld **⌨ Eingaben** im Ausgabe-Bereich (eine Eingabe pro Zeile).

## Lehrplan

| # | Lektion | Inhalte |
|---|---|---|
| 1 | Hallo, Python! | `print()`, Strings, Kommentare |
| 2 | Variablen | Zuweisung, Neu-Zuweisung, Namensregeln |
| 3 | Datentypen | `int`, `float`, `str`, `bool`, `type()`, Umwandlung |
| 4 | Rechnen | Operatoren, `//`, `%`, `**`, `round()`, `+=` |
| 5 | Strings | Index, Slicing, `len()`, Methoden, f-Strings |
| 6 | Eingaben | `input()`, `int(input())` |
| 7 | Entscheidungen | `if`/`elif`/`else`, Vergleiche, `and`/`or`/`not` |
| 8 | while-Schleifen | Zähler, `break`, Endlosschleifen |
| 9 | for-Schleifen | `range()`, Aufsummieren |
| 10 | Listen | Methoden, Sortieren, Schleifen über Listen |
| 11 | Dictionaries | Schlüssel/Wert, `.get()`, `.items()` |
| 12 | Funktionen | `def`, Parameter, `return`, Standardwerte |
| 13 | Fehler behandeln | Tracebacks lesen, `try`/`except`, `raise` |
| 14 | Module & Comprehensions | `import`, `math`, `random`, List/Dict Comprehensions |
| 15 | Klassen & Objekte | `class`, `__init__`, `self`, Methoden, `__str__` |
| 16 | Abschlussprojekt | Zahlenraten mit allem Gelernten |

### Eigene Lektionen hinzufügen

Alle Lektionen stehen in [`trainer/lektionen.py`](trainer/lektionen.py). Jede Lektion hat Erklärung, Aufgabe, Startcode, Tests (Python-`assert`s), Tipps und Musterlösung. In den Tests stehen `AUSGABE`, `QUELLTEXT`, `starte(eingabe)` und `mit_eingabe(eingabe, funktion, *args)` sowie alle Namen aus dem Lernenden-Code zur Verfügung. Danach prüfen:

```bash
python -m unittest discover tests
```

## Aufbau

```
server.py               HTTP-Server (nur Standardbibliothek) und Einstiegspunkt
trainer/
  lektionen.py          Lehrplan mit Tests
  agent.py              System-Prompt und Kontext für den Tutor
  llm.py                Anbindung an Ollama / OpenAI-kompatible Server (Streaming)
  ausfuehrung.py        startet den Code mit Zeitlimit in eigenem Prozess
  runner.py             führt Code + Tests aus, bereitet Fehlermeldungen auf
web/                    Oberfläche (HTML/CSS/JS ohne Build-Schritt)
tests/                  prüft, dass alle Musterlösungen bestehen
daten/                  Fortschritt und Einstellungen (wird angelegt, nicht im Git)
```

## Sicherheit

Der Code der Lernenden läuft **ungesichert auf deinem Rechner** (eigener Prozess, 10 s Zeitlimit, Ausgabelimit) – genau wie bei einem normalen Python-Aufruf. Der Server lauscht deshalb nur auf `127.0.0.1` und weist Anfragen fremder Webseiten ab. Starte ihn mit `--host 0.0.0.0` nur in einem Netz, dem du vertraust.
