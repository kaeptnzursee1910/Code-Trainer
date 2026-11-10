# ◆ Code-Trainer

Ein KI-Agent, der dir **Python** beibringt – im Browser, im Terminal-Look von Claude Code, mit einem **lokalen** Sprachmodell. Keine Cloud, kein Konto. Läuft entweder **komplett im Browser** (auch auf dem iPad) oder mit einem Modell auf deinem Computer.

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

## Zwei Varianten

| | **Browser-Version** (z. B. iPad) | **Server-Version** (Computer) |
|---|---|---|
| Start | Webseite öffnen – nichts installieren | `python server.py` |
| Python | läuft im Browser (Pyodide) | echtes Python auf dem Computer |
| KI-Tutor | kleines Modell auf der Grafikeinheit des Geräts (WebLLM, 1–3 Mrd. Parameter) | beliebiges Modell über Ollama, LM Studio … (z. B. 7–14 Mrd.) |
| Fortschritt | im Browser gespeichert | im Ordner `daten/` |
| Offline | nach dem ersten Laden ja | ja |

Beide nutzen dieselbe Oberfläche aus dem Ordner [`docs/`](docs) und denselben Lehrplan.

## Browser-Version (iPad, Tablet, jeder aktuelle Browser)

**→ https://kaeptnzursee1910.github.io/Code-Trainer/**

1. Seite in Safari öffnen. Für ein App-Gefühl: Teilen → **Zum Home-Bildschirm**.
2. Lektionen, Ausführen, Prüfen, Tipps und Lösungen funktionieren sofort. Python wird beim ersten Start einmalig geladen (~10 MB).
3. Für den KI-Tutor im Agent-Fenster auf **⬇ Modell laden** tippen. Das Modell wird einmalig heruntergeladen (Qwen2.5-1.5B: ca. 1,6 GB, am besten im WLAN) und danach aus dem Speicher gestartet. Alles bleibt auf dem Gerät.

**Voraussetzungen für den KI-Tutor:** ein Browser mit **WebGPU** – auf dem iPad iPadOS 26 oder neuer mit Safari, am Computer aktuelles Chrome/Edge (bzw. Safari 26). Auf älteren Geräten läuft der Kurs ohne Chat. Auf iPads mit wenig Arbeitsspeicher (unter 6 GB) kann das Laden abbrechen – dann im Menü oben rechts ein kleineres Modell wählen (z. B. Llama-3.2-1B).

Kleine Modelle erklären einfacher und machen öfter Fehler als die großen Modelle der Server-Version; die automatischen Tests entscheiden aber immer zuverlässig, ob eine Aufgabe gelöst ist.

Unter dem Editor gibt es auf Touch-Geräten eine **Tastenleiste** für Einrücken, Klammern, Anführungszeichen usw. Typografische Anführungszeichen („…“), die iPadOS automatisch einsetzt, werden im Editor sofort in normale `"` umgewandelt.

**Selbst veröffentlichen:** In den Repository-Einstellungen unter *Pages* als Quelle den Branch `main` und den Ordner `/docs` wählen. Lokal testen: `python -m http.server -d docs` und `http://localhost:8000/?modus=browser` öffnen.

## Server-Version (Computer mit lokalem Modell)

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

**iPad als Bildschirm:** `python server.py --host 0.0.0.0` starten und auf dem iPad `http://<IP-des-Computers>:8000` öffnen (nur in vertrauenswürdigen Netzen – siehe Sicherheit).

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

Alle Lektionen stehen in [`trainer/lektionen.py`](trainer/lektionen.py). Jede Lektion hat Erklärung, Aufgabe, Startcode, Tests (Python-`assert`s), Tipps und Musterlösung. In den Tests stehen `AUSGABE`, `QUELLTEXT`, `starte(eingabe)` und `mit_eingabe(eingabe, funktion, *args)` sowie alle Namen aus dem Lernenden-Code zur Verfügung. Danach die Browser-Dateien aktualisieren und prüfen:

```bash
python werkzeuge/export.py
python -m unittest discover tests
```

## Aufbau

```
server.py               Server-Version: HTTP-Server (nur Standardbibliothek)
trainer/
  lektionen.py          Lehrplan mit Tests (Quelle)
  runner.py             führt Code + Tests aus – im Prozess (Server) und in Pyodide (Browser)
  ausfuehrung.py        Server: startet runner.py mit Zeitlimit als eigenen Prozess
  llm.py                Server: Anbindung an Ollama / OpenAI-kompatible Server
docs/                   Oberfläche – zugleich die Browser-Version (GitHub Pages)
  app.js                Editor, Agent-Fenster, Befehle
  agent.js              System-Prompt und Kontext für den Tutor
  backend-server.js     spricht mit server.py
  backend-browser.js    Pyodide + WebLLM + localStorage
  python-worker.js      Python im Web Worker (Zeitlimit durch Neustart des Workers)
  llm-worker.js         WebLLM im Web Worker
  lektionen.json, py/   von werkzeuge/export.py erzeugt
  sw.js, manifest       Offline-Nutzung und „Zum Home-Bildschirm“
werkzeuge/export.py     überträgt Lehrplan und Runner nach docs/
tests/                  prüft Musterlösungen, Runner und Export
daten/                  Fortschritt der Server-Version (nicht im Git)
```

## Sicherheit

In der **Browser-Version** läuft der Code abgeschottet in der Sandbox des Browsers.

In der **Server-Version** gilt: Der Code der Lernenden läuft **ungesichert auf deinem Rechner** (eigener Prozess, 10 s Zeitlimit, Ausgabelimit) – genau wie bei einem normalen Python-Aufruf. Der Server lauscht deshalb nur auf `127.0.0.1` und weist Anfragen fremder Webseiten ab. Starte ihn mit `--host 0.0.0.0` nur in einem Netz, dem du vertraust.
