// Backend für die reine Browser-Version (z. B. iPad):
//   * Python läuft mit Pyodide in einem Web Worker (python-worker.js)
//   * das Sprachmodell läuft mit WebLLM über WebGPU (llm-worker.js)
//   * Fortschritt und Code liegen im localStorage des Browsers

import { fehlerText, kiHinweisZuFehler } from "./fehler.js";

const WEBLLM_URL = "https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.85/+esm";
const ZEITLIMIT_MS = 10_000;
const SPEICHER = "codetrainer.fortschritt";
const MODELL_SCHLUESSEL = "codetrainer.modell";

// Bevorzugte kleine Modelle (Reihenfolge = Empfehlung). Die genauen IDs werden zur
// Laufzeit in der WebLLM-Modellliste nachgeschlagen.
const WUNSCHMODELLE = [
  ["Qwen2.5-1.5B-Instruct", "empfohlen"],
  ["Qwen2.5-3B-Instruct", "besser, braucht mehr Speicher"],
  ["gemma-2-2b-it", "gutes Deutsch"],
  ["Llama-3.2-3B-Instruct", ""],
  ["Qwen2.5-Coder-1.5B-Instruct", "auf Code spezialisiert"],
  ["Llama-3.2-1B-Instruct", "klein & schnell"],
  ["Qwen2.5-0.5B-Instruct", "sehr klein, eher schwach"],
];

const ZEITLIMIT_FEHLER = {
  typ: "Zeitlimit",
  meldung: "Das Programm lief länger als 10 Sekunden und wurde abgebrochen.",
  zeile: null,
  text: "Zeitlimit überschritten (10 s) – vermutlich eine Endlosschleife oder ein input(), das auf mehr Eingaben wartet.",
  hinweis: "Prüfe, ob sich die Bedingung deiner Schleife irgendwann ändert.",
};

function leer() { return { aktuell: 1, erledigt: [], code: {} }; }
function lesen() {
  try { return { ...leer(), ...JSON.parse(localStorage.getItem(SPEICHER) || "{}") }; }
  catch { return leer(); }
}
function schreiben(f) {
  try { localStorage.setItem(SPEICHER, JSON.stringify(f)); } catch { /* privater Modus */ }
  return f;
}

export function erstelleBrowserBackend() {
  const zuhoerer = new Set();
  const melden = () => zuhoerer.forEach((f) => { try { f(); } catch {} });

  /* ------------------------------------------------------------ Python */
  let worker = null, workerBereit = null, naechsteId = 1;
  const wartend = new Map();
  const python = { bereit: false, version: "", fehler: "" };

  function workerStarten() {
    python.bereit = false;
    worker = new Worker("python-worker.js");
    workerBereit = new Promise((ok, fehler) => {
      worker.onmessage = (e) => {
        const d = e.data;
        if (d.typ === "bereit") { python.bereit = true; python.version = d.version; ok(); melden(); }
        else if (d.typ === "ladefehler") { python.fehler = d.meldung; fehler(new Error("Python konnte nicht geladen werden: " + d.meldung)); melden(); }
        else if (d.typ === "ergebnis") {
          const w = wartend.get(d.id);
          if (!w) return;
          wartend.delete(d.id);
          clearTimeout(w.timer);
          d.fehler ? w.fehler(new Error(d.fehler)) : w.ok(d.ergebnis);
        }
      };
      worker.onerror = (ev) => fehler(new Error(ev.message || "Python-Worker konnte nicht starten"));
    });
    workerBereit.catch(() => {});
  }

  async function imWorker(art, args) {
    await workerBereit;
    const id = naechsteId++;
    const start = performance.now();
    const ergebnis = await new Promise((ok, fehler) => {
      const timer = setTimeout(() => {
        // Endlosschleife: Worker hart beenden und neu starten (Pyodide kommt aus dem Cache)
        wartend.delete(id);
        worker.terminate();
        workerStarten();
        ok({ zeitlimit: true });
      }, ZEITLIMIT_MS);
      wartend.set(id, { ok, fehler, timer });
      worker.postMessage({ id, art, args });
    });
    return { ...ergebnis, dauer: (performance.now() - start) / 1000 };
  }

  /* ------------------------------------------------------------ Sprachmodell */
  let webllm = null, engine = null, llmWorker = null, geladenesModell = "";
  let liste = [], gpu = null, laedt = false, ladeFehler = "";
  let gewaehlt = "";
  try { gewaehlt = localStorage.getItem(MODELL_SCHLUESSEL) || ""; } catch {}

  async function gpuPruefen() {
    if (!("gpu" in navigator)) return { ok: false, grund: "Dieser Browser unterstützt kein WebGPU – der Chat mit dem KI-Tutor ist deshalb nicht verfügbar. Auf dem iPad brauchst du ein aktuelles iPadOS (ab Version 26) mit Safari." };
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) return { ok: false, grund: "WebGPU ist vorhanden, aber es wurde keine passende Grafikeinheit gefunden." };
      return { ok: true, f16: adapter.features.has("shader-f16") };
    } catch (err) {
      return { ok: false, grund: "WebGPU-Fehler: " + fehlerText(err) };
    }
  }

  async function listeLaden() {
    webllm ||= await import(WEBLLM_URL);
    const alle = webllm.prebuiltAppConfig.model_list;
    const quant = gpu.f16 ? ["q4f16_1", "q4f32_1"] : ["q4f32_1"];
    const gefunden = [];
    for (const [name, notiz] of WUNSCHMODELLE) {
      for (const q of quant) {
        const m = alle.find((x) => x.model_id === `${name}-${q}-MLC`);
        if (m) {
          const gb = m.vram_required_MB ? ` · ~${(m.vram_required_MB / 1024).toFixed(1).replace(".", ",")} GB` : "";
          gefunden.push({ id: m.model_id, label: `${name}${gb}${notiz ? " · " + notiz : ""}`, mb: m.vram_required_MB || 0 });
          break;
        }
      }
    }
    if (!gefunden.length) { // Fallback: alles, was als ressourcenschonend markiert ist
      for (const m of alle.filter((x) => x.low_resource_required).slice(0, 8)) gefunden.push({ id: m.model_id, label: m.model_id, mb: m.vram_required_MB || 0 });
    }
    liste = gefunden;
  }

  // Beendet das Modell vollständig und gibt den Grafikspeicher frei.
  // Wichtig auf dem iPad: Ohne terminate() blieben alte Kopien im Speicher.
  async function entsorgen() {
    const e = engine, w = llmWorker;
    engine = null;
    llmWorker = null;
    geladenesModell = "";
    if (e) {
      try { await Promise.race([e.unload(), new Promise((r) => setTimeout(r, 3000))]); } catch { /* war schon kaputt */ }
    }
    try { w?.terminate(); } catch {}
  }

  async function imCache(id) {
    try { return webllm.hasModelInCache ? await webllm.hasModelInCache(id) : false; } catch { return false; }
  }

  const backend = {
    name: "browser",
    kompakt: true, // kleine Modelle bekommen kürzeren Kontext
    python,
    beiAenderung(f) { zuhoerer.add(f); },
    beiLadefortschritt: null, // wird von der Oberfläche gesetzt: (bericht) => …

    async init() {
      workerStarten();
      gpu = await gpuPruefen();
      if (!gpu.ok) return;
      // Modellliste im Hintergrund holen, danach ggf. das zuletzt benutzte Modell aus dem Cache laden
      (async () => {
        try {
          await listeLaden();
          melden();
          if (gewaehlt && liste.some((m) => m.id === gewaehlt) && (await imCache(gewaehlt))) {
            await backend.modellWaehlen(gewaehlt);
          }
        } catch (err) {
          ladeFehler = "WebLLM konnte nicht geladen werden: " + fehlerText(err);
          melden();
        }
      })();
    },

    /* Fortschritt */
    async fortschrittLaden() { return lesen(); },
    async fortschrittSpeichern(teil) {
      const f = lesen();
      if ("aktuell" in teil) f.aktuell = teil.aktuell;
      for (const [k, v] of Object.entries(teil.code || {})) f.code[k] = v;
      if (teil.erledigt && !f.erledigt.includes(teil.erledigt)) f.erledigt = [...f.erledigt, teil.erledigt].sort((a, b) => a - b);
      return schreiben(f);
    },
    async fortschrittZuruecksetzen() { return schreiben(leer()); },

    /* Python */
    async ausfuehren({ lektion, code, stdin }) {
      const r = await imWorker("ausfuehren", { quelle: code, dateiname: lektion.datei, stdin_text: stdin || "", modulname: "__main__" });
      if (r.zeitlimit) return { ausgabe: "", fehler: ZEITLIMIT_FEHLER, dauer: r.dauer };
      return r;
    },
    async pruefen({ lektion, code }) {
      const r = await imWorker("pruefen", {
        quelle: code, dateiname: lektion.datei, tests: lektion.tests, stdin_text: lektion.stdin || "", modulname: lektion.modulname,
      });
      if (r.zeitlimit) return { ok: false, ausgabe: "", tests: [], fehler: ZEITLIMIT_FEHLER, dauer: r.dauer };
      return r;
    },

    /* Modell */
    letztesModell() { return gewaehlt; },

    async status() {
      if (!gpu) return { online: false, modelle: [], modell: "", fehler: "", laedt: false };
      const geladen = !!engine && !laedt && geladenesModell;
      return {
        online: !!geladen,
        modelle: liste,
        modell: laedt ? gewaehlt : geladenesModell || "",
        laedt,
        webgpu: gpu.ok,
        fehler: !gpu.ok ? gpu.grund : ladeFehler || (geladen ? "" : "Noch kein KI-Modell geladen."),
        empfohlen: liste[0] || null,
      };
    },

    async modellWaehlen(id) {
      if (!gpu?.ok) throw new Error(gpu?.grund || "Kein WebGPU");
      if (laedt) throw new Error("Es wird bereits ein Modell geladen.");
      webllm ||= await import(WEBLLM_URL);
      laedt = true;
      ladeFehler = "";
      gewaehlt = id;
      melden();
      const fortschritt = (bericht) => backend.beiLadefortschritt?.(bericht);
      try {
        // Immer frisch starten: reload() auf einer beschädigten Engine scheitert oft
        await entsorgen();
        llmWorker = new Worker(new URL("llm-worker.js", import.meta.url), { type: "module" });
        engine = await webllm.CreateWebWorkerMLCEngine(llmWorker, id, { initProgressCallback: fortschritt });
        geladenesModell = id;
        try { localStorage.setItem(MODELL_SCHLUESSEL, id); } catch {}
        // Bitte den Browser, die großen Modelldaten nicht automatisch zu löschen
        navigator.storage?.persist?.().catch(() => {});
      } catch (err) {
        const text = fehlerText(err);
        console.error("[Code-Trainer] Modell laden:", err);
        ladeFehler = "Modell konnte nicht geladen werden: " + text + " – " +
          (kiHinweisZuFehler(text) || "Evtl. reicht der Speicher nicht. Probiere ein kleineres Modell.");
        await entsorgen(); // sauber neu anfangen
        throw new Error(ladeFehler);
      } finally {
        laedt = false;
        melden();
      }
      return backend.status();
    },

    async *chat(nachrichten, signal) {
      if (!engine || !geladenesModell) {
        const fehler = new Error("Es ist kein Modell geladen.");
        fehler.wiederherstellbar = !!gewaehlt; // zuletzt benutztes Modell kann neu gestartet werden
        throw fehler;
      }
      const stopp = () => { try { engine.interruptGenerate(); } catch {} };
      signal?.addEventListener("abort", stopp);
      try {
        const stuecke = await engine.chat.completions.create({
          messages: nachrichten, stream: true, temperature: 0.3, max_tokens: 800,
        });
        for await (const s of stuecke) {
          if (signal?.aborted) break;
          const t = s.choices?.[0]?.delta?.content;
          if (t) yield t;
        }
        if (signal?.aborted) throw new DOMException("abgebrochen", "AbortError");
      } catch (err) {
        if (signal?.aborted || err?.name === "AbortError") throw new DOMException("abgebrochen", "AbortError");
        console.error("[Code-Trainer] Chat-Fehler:", err);
        const text = fehlerText(err);
        const fehler = new Error(text);
        fehler.hinweis = kiHinweisZuFehler(text);
        // Nach schweren Fehlern (Grafikeinheit verloren, Modell abgeräumt) ist die Engine unbrauchbar.
        // Auf dem iPad passiert das z. B., wenn die App im Hintergrund war oder der Speicher knapp wurde.
        if (/lost|disposed|not loaded|no model|reload|destroyed|OOM|out of memory/i.test(text)) {
          fehler.wiederherstellbar = true;
          await entsorgen();
          melden();
        }
        throw fehler;
      } finally {
        signal?.removeEventListener("abort", stopp);
      }
    },
  };
  return backend;
}
