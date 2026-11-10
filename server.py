#!/usr/bin/env python3
"""Code-Trainer – ein lokaler KI-Agent, der im Browser Python beibringt.

Start:  python server.py            → http://127.0.0.1:8000
Hilfe:  python server.py --help

Benötigt nur Python 3.10+ (keine Zusatzpakete) und ein lokales Modell,
z. B. über Ollama:  ollama pull qwen2.5-coder:7b
"""
import argparse
import json
import mimetypes
import os
import sys
import threading
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

BASIS = Path(__file__).resolve().parent
sys.path.insert(0, str(BASIS))

from trainer import agent, ausfuehrung  # noqa: E402
from trainer.lektionen import LEKTIONEN, lektion, oeffentlich  # noqa: E402
from trainer.llm import LLM, ModellFehler  # noqa: E402

WEB = BASIS / "web"
DATEN = BASIS / "daten"
CONFIG_DATEI = DATEN / "config.json"
FORTSCHRITT_DATEI = DATEN / "fortschritt.json"

STANDARD = {
    "provider": "ollama",
    "base_url": "",
    "modell": "qwen2.5-coder:7b",
    "api_key": "",
    "temperatur": 0.3,
}

_sperre = threading.Lock()


# ---------------------------------------------------------------- Speicher
def lade_json(pfad, standard):
    try:
        return json.loads(pfad.read_text("utf-8"))
    except (OSError, ValueError):
        return standard


def speichere_json(pfad, daten):
    DATEN.mkdir(exist_ok=True)
    tmp = pfad.with_suffix(".tmp")
    tmp.write_text(json.dumps(daten, ensure_ascii=False, indent=2), "utf-8")
    os.replace(tmp, pfad)


def lade_fortschritt():
    f = lade_json(FORTSCHRITT_DATEI, {})
    f.setdefault("aktuell", 1)
    f.setdefault("erledigt", [])
    f.setdefault("code", {})
    return f


# ---------------------------------------------------------------- HTTP
class Handler(BaseHTTPRequestHandler):
    server_version = "CodeTrainer/1.0"

    def log_message(self, fmt, *args):  # ruhigere Konsole
        if self.server.ausfuehrlich:
            super().log_message(fmt, *args)

    # -- Hilfen
    def _json(self, daten, status=200):
        roh = json.dumps(daten, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(roh)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(roh)

    def _body(self):
        laenge = int(self.headers.get("Content-Length") or 0)
        if laenge > 2_000_000:
            raise ValueError("Anfrage zu groß")
        return json.loads(self.rfile.read(laenge) or b"{}")

    def _lokal(self):
        # Schutz vor Anfragen fremder Webseiten (DNS-Rebinding/CSRF)
        host = (self.headers.get("Host") or "").split(":")[0]
        if host not in ("127.0.0.1", "localhost", "[::1]", "::1") and not self.server.offen:
            return False
        herkunft = self.headers.get("Origin")
        if herkunft and self.command == "POST":
            o = herkunft.split("//")[-1].split(":")[0]
            if o not in ("127.0.0.1", "localhost", "[::1]") and not self.server.offen:
                return False
        return True

    # -- GET
    def do_GET(self):
        if not self._lokal():
            return self._json({"fehler": "Nur lokaler Zugriff erlaubt."}, 403)
        pfad = self.path.split("?")[0]
        if pfad == "/api/lektionen":
            return self._json([oeffentlich(l) for l in LEKTIONEN])
        if pfad == "/api/fortschritt":
            with _sperre:
                return self._json(lade_fortschritt())
        if pfad == "/api/status":
            return self._json(self.server.llm.status())
        return self._datei(pfad)

    def _datei(self, pfad):
        if pfad in ("", "/"):
            pfad = "/index.html"
        ziel = (WEB / pfad.lstrip("/")).resolve()
        if WEB not in ziel.parents or not ziel.is_file():
            return self._json({"fehler": "Nicht gefunden"}, 404)
        roh = ziel.read_bytes()
        typ = mimetypes.guess_type(ziel.name)[0] or "application/octet-stream"
        if typ.startswith("text/") or typ.endswith("javascript"):
            typ += "; charset=utf-8"
        self.send_response(200)
        self.send_header("Content-Type", typ)
        self.send_header("Content-Length", str(len(roh)))
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()
        self.wfile.write(roh)

    # -- POST
    def do_POST(self):
        if not self._lokal():
            return self._json({"fehler": "Nur lokaler Zugriff erlaubt."}, 403)
        try:
            daten = self._body()
        except ValueError as exc:
            return self._json({"fehler": str(exc)}, 400)
        pfad = self.path.split("?")[0]
        try:
            if pfad == "/api/ausfuehren":
                l = lektion(int(daten.get("lektion", 1)))
                return self._json(ausfuehrung.ausfuehren(
                    daten.get("code", ""), l["datei"], daten.get("stdin", ""), "__main__"))
            if pfad == "/api/pruefen":
                l = lektion(int(daten.get("lektion", 1)))
                ergebnis = ausfuehrung.pruefen(daten.get("code", ""), l)
                if ergebnis.get("ok"):
                    with _sperre:
                        f = lade_fortschritt()
                        if l["id"] not in f["erledigt"]:
                            f["erledigt"].append(l["id"])
                            f["erledigt"].sort()
                        f["code"][str(l["id"])] = daten.get("code", "")
                        speichere_json(FORTSCHRITT_DATEI, f)
                    ergebnis["erledigt"] = f["erledigt"]
                return self._json(ergebnis)
            if pfad == "/api/fortschritt":
                with _sperre:
                    f = lade_fortschritt()
                    if "aktuell" in daten:
                        f["aktuell"] = int(daten["aktuell"])
                    for k, v in (daten.get("code") or {}).items():
                        f["code"][str(k)] = v
                    if daten.get("zuruecksetzen"):
                        f = {"aktuell": 1, "erledigt": [], "code": {}}
                    speichere_json(FORTSCHRITT_DATEI, f)
                    return self._json(f)
            if pfad == "/api/einstellungen":
                llm = self.server.llm
                if daten.get("modell"):
                    llm.modell = str(daten["modell"])
                konfig = lade_json(CONFIG_DATEI, {})
                konfig["modell"] = llm.modell
                speichere_json(CONFIG_DATEI, konfig)
                return self._json(llm.status())
            if pfad == "/api/chat":
                return self._chat(daten)
        except KeyError:
            return self._json({"fehler": "Unbekannte Lektion"}, 404)
        return self._json({"fehler": "Nicht gefunden"}, 404)

    def _chat(self, daten):
        l = lektion(int(daten.get("lektion", 1)))
        nachrichten = agent.baue_nachrichten(
            daten.get("modus", "frage"),
            l,
            daten.get("verlauf") or [],
            code=daten.get("code", ""),
            ausgabe=daten.get("ausgabe", ""),
            text=daten.get("text", ""),
            pruefung=daten.get("pruefung"),
            tipp_nr=int(daten.get("tipp_nr") or 1),
        )
        self.send_response(200)
        self.send_header("Content-Type", "application/x-ndjson; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        def senden(obj):
            self.wfile.write((json.dumps(obj, ensure_ascii=False) + "\n").encode())
            self.wfile.flush()

        try:
            for stueck in self.server.llm.stream(nachrichten):
                senden({"t": stueck})
            senden({"fertig": True})
        except ModellFehler as exc:
            try:
                senden({"fehler": str(exc)})
            except OSError:
                pass
        except (BrokenPipeError, ConnectionResetError):
            pass  # Browser hat abgebrochen (Esc)


class Server(ThreadingHTTPServer):
    daemon_threads = True


def main():
    konfig = {**STANDARD, **lade_json(CONFIG_DATEI, {})}
    for schluessel in ("provider", "base_url", "modell", "api_key"):
        wert = os.environ.get(f"CODETRAINER_{schluessel.upper()}")
        if wert:
            konfig[schluessel] = wert

    p = argparse.ArgumentParser(description="Code-Trainer – lerne Python mit einem lokalen KI-Agenten.")
    p.add_argument("--port", type=int, default=8000)
    p.add_argument("--host", default="127.0.0.1", help="Standard: nur lokal erreichbar")
    p.add_argument("--provider", choices=["ollama", "openai"], default=konfig["provider"],
                   help="ollama (Standard) oder openai (OpenAI-kompatibel: LM Studio, llama.cpp, …)")
    p.add_argument("--base-url", default=konfig["base_url"],
                   help="Adresse des Modell-Servers (Standard: http://localhost:11434 bzw. :1234)")
    p.add_argument("--modell", "--model", default=konfig["modell"], help="Modellname, z. B. qwen2.5-coder:7b")
    p.add_argument("--api-key", default=konfig["api_key"])
    p.add_argument("--kein-browser", action="store_true", help="Browser nicht automatisch öffnen")
    p.add_argument("-v", "--ausfuehrlich", action="store_true", help="Jede Anfrage protokollieren")
    args = p.parse_args()

    server = Server((args.host, args.port), Handler)
    server.llm = LLM(args.provider, args.base_url or None, args.modell, args.api_key, float(konfig["temperatur"]))
    server.ausfuehrlich = args.ausfuehrlich
    server.offen = args.host not in ("127.0.0.1", "localhost", "::1")

    url = f"http://{'127.0.0.1' if not server.offen else args.host}:{args.port}"
    status = server.llm.status()
    print("◆ Code-Trainer läuft auf", url)
    if status["online"]:
        print(f"  Modell: {status['modell']} ({args.provider}, {server.llm.base_url})")
    else:
        print(f"  ⚠ Kein Modell erreichbar: {status['fehler']}")
        print("    Der Kurs funktioniert trotzdem (Prüfen, Tipps, Lösungen) – nur der Chat braucht ein Modell.")
        print("    Ollama: https://ollama.com  →  ollama pull qwen2.5-coder:7b")
    if server.offen:
        print("  ⚠ Achtung: Der Server ist im Netzwerk erreichbar und führt Python-Code aus!")
    print("  Beenden mit Strg+C")

    if not args.kein_browser:
        threading.Timer(0.6, lambda: webbrowser.open(url)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nTschüss!")


if __name__ == "__main__":
    main()
