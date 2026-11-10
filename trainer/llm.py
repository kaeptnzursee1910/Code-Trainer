"""Anbindung an ein lokales Sprachmodell.

Unterstützt:
  * provider "ollama"  – Ollama (http://localhost:11434), Standard
  * provider "openai"  – jeder OpenAI-kompatible Server, z. B. LM Studio
                         (http://localhost:1234), llama.cpp-Server, vLLM, Jan …
Nur Standardbibliothek, keine zusätzlichen Pakete nötig.
"""
import json
import urllib.error
import urllib.request

# Lokale Server sollen nie über einen System-Proxy angesprochen werden.
_OEFFNER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class ModellFehler(Exception):
    pass


class LLM:
    def __init__(self, provider="ollama", base_url=None, modell="", api_key="", temperatur=0.3, kontext=8192):
        self.provider = provider
        self.base_url = (base_url or ("http://localhost:11434" if provider == "ollama" else "http://localhost:1234")).rstrip("/")
        self.modell = modell
        self.api_key = api_key
        self.temperatur = temperatur
        self.kontext = kontext

    # ------------------------------------------------------------ Hilfen
    def _url(self, pfad):
        if self.provider == "openai":
            basis = self.base_url if self.base_url.endswith("/v1") else self.base_url + "/v1"
            return basis + pfad
        return self.base_url + pfad

    def _anfrage(self, pfad, daten=None, timeout=5):
        kopf = {"Content-Type": "application/json"}
        if self.api_key:
            kopf["Authorization"] = f"Bearer {self.api_key}"
        req = urllib.request.Request(
            self._url(pfad),
            data=json.dumps(daten).encode() if daten is not None else None,
            headers=kopf,
            method="POST" if daten is not None else "GET",
        )
        try:
            return _OEFFNER.open(req, timeout=timeout)
        except urllib.error.HTTPError as exc:
            text = exc.read().decode("utf-8", "replace")[:300]
            raise ModellFehler(f"Der Modell-Server meldet HTTP {exc.code}: {text}") from exc
        except (urllib.error.URLError, OSError) as exc:
            raise ModellFehler(f"Kein Modell-Server erreichbar unter {self.base_url} ({exc}).") from exc

    # ------------------------------------------------------------ API
    def modelle(self):
        """Liste der installierten Modelle (wirft ModellFehler, wenn offline)."""
        with self._anfrage("/api/tags" if self.provider == "ollama" else "/models", timeout=3) as antwort:
            daten = json.load(antwort)
        if self.provider == "ollama":
            return sorted(m["name"] for m in daten.get("models", []))
        return sorted(m["id"] for m in daten.get("data", []))

    def waehle_modell(self, verfuegbar):
        """Passt self.modell an die installierten Modelle an."""
        if not verfuegbar:
            return self.modell
        if self.modell in verfuegbar:
            return self.modell
        for name in verfuegbar:  # "qwen2.5-coder" passt auf "qwen2.5-coder:7b"
            if self.modell and name.split(":")[0] == self.modell.split(":")[0]:
                self.modell = name
                return name
        self.modell = verfuegbar[0]
        return self.modell

    def status(self):
        try:
            verfuegbar = self.modelle()
        except ModellFehler as exc:
            return {"online": False, "fehler": str(exc), "modelle": [], "modell": self.modell,
                    "provider": self.provider, "base_url": self.base_url}
        self.waehle_modell(verfuegbar)
        return {"online": bool(verfuegbar), "fehler": "" if verfuegbar else "Es ist noch kein Modell installiert.",
                "modelle": verfuegbar, "modell": self.modell, "provider": self.provider, "base_url": self.base_url}

    def stream(self, nachrichten):
        """Liefert die Antwort des Modells Stück für Stück (Generator von str)."""
        if self.provider == "ollama":
            daten = {
                "model": self.modell,
                "messages": nachrichten,
                "stream": True,
                "options": {"temperature": self.temperatur, "num_ctx": self.kontext},
            }
            with self._anfrage("/api/chat", daten, timeout=300) as antwort:
                for zeile in antwort:
                    if not zeile.strip():
                        continue
                    teil = json.loads(zeile)
                    if teil.get("error"):
                        raise ModellFehler(teil["error"])
                    text = teil.get("message", {}).get("content", "")
                    if text:
                        yield text
                    if teil.get("done"):
                        break
        else:
            daten = {"model": self.modell, "messages": nachrichten, "stream": True, "temperature": self.temperatur}
            with self._anfrage("/chat/completions", daten, timeout=300) as antwort:
                for zeile in antwort:
                    zeile = zeile.decode("utf-8", "replace").strip()
                    if not zeile.startswith("data:"):
                        continue
                    nutzlast = zeile[5:].strip()
                    if nutzlast == "[DONE]":
                        break
                    teil = json.loads(nutzlast)
                    if teil.get("error"):
                        raise ModellFehler(str(teil["error"]))
                    for wahl in teil.get("choices", []):
                        text = (wahl.get("delta") or {}).get("content") or ""
                        if text:
                            yield text
