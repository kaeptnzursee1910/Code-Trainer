// Web Worker: führt Python mit Pyodide aus (Browser-Version).
// Läuft in einem eigenen Thread – bei Endlosschleifen beendet die Seite den Worker einfach.

const VERSIONEN = ["314.0.7", "0.27.7"]; // Fallback, falls eine Version nicht erreichbar ist
let pyodide = null;

const bereit = (async () => {
  let letzterFehler;
  for (const v of VERSIONEN) {
    const basis = `https://cdn.jsdelivr.net/npm/pyodide@${v}/`;
    try {
      importScripts(basis + "pyodide.js");
      pyodide = await loadPyodide({ indexURL: basis });
      break;
    } catch (err) {
      letzterFehler = err;
    }
  }
  if (!pyodide) throw letzterFehler || new Error("Pyodide konnte nicht geladen werden");
  const quelle = await (await fetch("py/runner.py")).text();
  pyodide.FS.mkdirTree("/home/pyodide/trainer");
  pyodide.FS.writeFile("/home/pyodide/trainer/runner.py", quelle);
  pyodide.runPython("import sys, json\nsys.path.insert(0, '/home/pyodide/trainer')\nimport runner");
  return pyodide.runPython("sys.version.split()[0]");
})();

bereit.then(
  (version) => postMessage({ typ: "bereit", version }),
  (err) => postMessage({ typ: "ladefehler", meldung: String(err && err.message || err) }),
);

self.onmessage = async (e) => {
  const { id, art, args } = e.data;
  try {
    await bereit;
    pyodide.globals.set("_args", JSON.stringify(args));
    const funktion = art === "pruefen" ? "pruefe_code" : "ausfuehren_code";
    const json = pyodide.runPython(`json.dumps(runner.${funktion}(**json.loads(_args)), ensure_ascii=False)`);
    postMessage({ typ: "ergebnis", id, ergebnis: JSON.parse(json) });
  } catch (err) {
    postMessage({ typ: "ergebnis", id, fehler: String(err && err.message || err) });
  }
};
