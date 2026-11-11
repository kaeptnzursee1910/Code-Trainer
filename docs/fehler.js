// Macht aus jedem Fehlerwert einen lesbaren Text.
// Wichtig, weil WebLLM Fehler aus seinem Worker oft als reinen Text oder als
// einfaches Objekt liefert – err.message ist dann leer.

export function fehlerText(err, tiefe = 0) {
  if (err == null) return "Unbekannter Fehler (keine Meldung)";
  if (typeof err === "string") return err.trim() || "Unbekannter Fehler (leere Meldung)";
  if (typeof err !== "object") return String(err);
  const teile = [];
  const name = err.name && !["Error", "TypeError"].includes(err.name) ? err.name : "";
  if (err.message) teile.push(name && !String(err.message).startsWith(name) ? `${name}: ${err.message}` : String(err.message));
  else if (name) teile.push(name);
  else if (err.reason) teile.push(String(err.reason));          // z. B. GPUDeviceLostInfo
  if (err.cause && tiefe < 3) teile.push("Ursache: " + fehlerText(err.cause, tiefe + 1));
  if (!teile.length) {
    try {
      const j = JSON.stringify(err);
      if (j && j !== "{}") teile.push(j.slice(0, 500));
    } catch { /* zirkulär */ }
  }
  if (!teile.length) {
    const s = String(err);
    if (s && s !== "[object Object]") teile.push(s);
  }
  return teile.join(" – ") || `Unbekannter Fehler (${Object.prototype.toString.call(err)})`;
}

// Hinweise zu typischen Problemen mit Sprachmodellen im Browser
export function kiHinweisZuFehler(text) {
  if (/device.*lost|GPUDevice|lost the device|out of memory|OOM|allocation|buffer.*size|maxStorageBuffer|exceeds.*limit/i.test(text))
    return "Der Grafikspeicher des Geräts reicht für dieses Modell vermutlich nicht. Wähle oben rechts ein kleineres Modell (z. B. Llama-3.2-1B oder Qwen2.5-0.5B) und schließe andere Tabs/Apps.";
  if (/context.*(window|length|size)|ContextWindow|too long|prompt.*exceed/i.test(text))
    return "Der Gesprächsverlauf ist zu lang für das kleine Modell. Tippe /neu, um den Chat zu leeren.";
  if (/load failed|failed to fetch|network|NetworkError/i.test(text))
    return "Eine Datei konnte nicht geladen werden. Prüfe die Internetverbindung (beim ersten Laden des Modells nötig) und versuche es erneut.";
  if (/not loaded|no model|reload|disposed|unload/i.test(text))
    return "Das Modell ist nicht mehr geladen. Wähle es oben rechts erneut aus.";
  if (/shader-f16|f16/i.test(text))
    return "Dieses Gerät unterstützt die f16-Variante nicht richtig. Wähle oben rechts ein anderes Modell.";
  return "";
}
