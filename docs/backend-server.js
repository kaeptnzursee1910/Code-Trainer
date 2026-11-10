// Backend für die Server-Version (python server.py): Python und Modell laufen auf dem Computer.

async function api(pfad, daten) {
  const res = await fetch(pfad, daten === undefined ? { cache: "no-store" } : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(daten),
  });
  if (!res.ok) throw new Error(`Server antwortet mit ${res.status}`);
  return res.json();
}

export function erstelleServerBackend() {
  return {
    name: "server",
    kompakt: false,
    async init() {},
    fortschrittLaden: () => api("/api/fortschritt"),
    fortschrittSpeichern: (teil) => api("/api/fortschritt", teil),
    fortschrittZuruecksetzen: () => api("/api/fortschritt", { zuruecksetzen: true }),
    ausfuehren: ({ lektion, code, stdin }) => api("/api/ausfuehren", { lektion: lektion.id, code, stdin }),
    pruefen: ({ lektion, code }) => api("/api/pruefen", { lektion: lektion.id, code }),
    async status() {
      try {
        const s = await api("/api/status");
        return { ...s, modelle: s.modelle.map((m) => ({ id: m, label: m })) };
      } catch {
        return { online: false, modelle: [], modell: "", fehler: "Code-Trainer-Server nicht erreichbar." };
      }
    },
    modellWaehlen: (id) => api("/api/einstellungen", { modell: id }),
    async *chat(nachrichten, signal) {
      const res = await fetch("/api/chat", {
        method: "POST", headers: { "Content-Type": "application/json" }, signal,
        body: JSON.stringify({ nachrichten }),
      });
      if (!res.ok) throw new Error(`Server antwortet mit ${res.status}`);
      const leser = res.body.getReader();
      const dec = new TextDecoder();
      let puffer = "";
      for (;;) {
        const { value, done } = await leser.read();
        if (done) return;
        puffer += dec.decode(value, { stream: true });
        let i;
        while ((i = puffer.indexOf("\n")) >= 0) {
          const zeile = puffer.slice(0, i);
          puffer = puffer.slice(i + 1);
          if (!zeile.trim()) continue;
          const ev = JSON.parse(zeile);
          if (ev.t) yield ev.t;
          else if (ev.fehler) throw new Error(ev.fehler);
          else if (ev.fertig) return;
        }
      }
    },
    offlineHilfe: "So startest du ein lokales Modell (einmalig):\n```bash\n# Ollama installieren: https://ollama.com\nollama pull qwen2.5-coder:7b\nollama serve\n```",
  };
}
