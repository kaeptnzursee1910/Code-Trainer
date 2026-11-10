/* Code-Trainer – Oberfläche
 * links: Editor · rechts oben: Agent · rechts unten: Ausgabe
 */
import { baueNachrichten } from "./agent.js";
import { erstelleServerBackend } from "./backend-server.js";
import { erstelleBrowserBackend } from "./backend-browser.js";

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

const S = {
  lektionen: [],
  fortschritt: { aktuell: 1, erledigt: [], code: {} },
  nr: 0,               // 0 = noch keine Lektion geladen
  verlauf: {},          // Chatverlauf je Lektion: [{role, content}]
  tippNr: {},           // wie viele Tipps je Lektion
  loesungGefragt: {},
  letzteAusgabe: "",
  letzterFehler: null,
  status: { online: false, modelle: [], modell: "" },
  abbruch: null,        // AbortController der laufenden Antwort
  beschaeftigt: false,
  folgen: true,         // Log automatisch nach unten scrollen
};

/* ================================================================ Syntax-Highlighting */
const KW = new Set("False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield".split(" "));
const BI = new Set("print input len range int float str bool list dict set tuple type sum min max abs round sorted reversed enumerate zip open isinstance map filter any all super object Exception ValueError TypeError ZeroDivisionError KeyError IndexError NameError EOFError".split(" "));
const TOKEN = /(#.*)|((?:\b[rRbBfFuU]{1,2})?(?:"""[\s\S]*?(?:"""|$(?![\s\S]))|'''[\s\S]*?(?:'''|$(?![\s\S]))|"(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?))|(\b\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?\b)|(@\w+)|([A-Za-z_À-ɏ][\wÀ-ɏ]*)/g;

function highlight(code) {
  let out = "", last = 0, prev = "";
  for (const m of code.matchAll(TOKEN)) {
    out += esc(code.slice(last, m.index));
    const t = m[0];
    let cls = "";
    if (m[1]) cls = "c";
    else if (m[2]) cls = "s";
    else if (m[3]) cls = "n";
    else if (m[4]) cls = "d";
    if (m[5]) {
      if (KW.has(t)) cls = "k";
      else if (prev === "def" || prev === "class") cls = "f";
      else if (t === "self") cls = "sf";
      else if (BI.has(t)) cls = "b";
      else if (/^\s*\(/.test(code.slice(m.index + t.length, m.index + t.length + 4))) cls = "f";
      prev = t;
    } else prev = "";
    out += cls ? `<span class="${cls}">${esc(t)}</span>` : esc(t);
    last = m.index + t.length;
  }
  return out + esc(code.slice(last));
}

/* ================================================================ Mini-Markdown */
function inline(text) {
  const codes = [];
  let t = text.replace(/`([^`\n]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  t = esc(t)
    .replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?![\w*])/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  return t.replace(/\u0000(\d+)\u0000/g, (_, n) => `<code class="inline">${esc(codes[n])}</code>`);
}

function codeBlock(code, lang = "python", extra = "") {
  const py = !lang || /^(py|python|python3)$/i.test(lang);
  return `<div class="codeblock" data-code="${esc(code)}"><div class="cb-head"><span>${esc(lang || "code")}</span>` +
    `<button data-akt="kopieren">Kopieren</button>${py ? '<button data-akt="einfuegen" title="An der Cursorposition einfügen">→ Editor</button>' : ""}${extra}</div>` +
    `<pre><code>${py ? highlight(code) : esc(code)}</code></pre></div>`;
}

function bloecke(text) {
  const z = text.split("\n");
  let html = "", i = 0;
  const istSonder = (s) => /^\s*([-*•]\s+|\d+[.)]\s+|#{1,4}\s|>\s?|\|)/.test(s);
  while (i < z.length) {
    const zeile = z[i];
    if (!zeile.trim()) { i++; continue; }
    let m;
    if ((m = zeile.match(/^(#{1,4})\s+(.*)/))) {
      const h = Math.min(m[1].length + 1, 4);
      html += `<h${h}>${inline(m[2])}</h${h}>`; i++; continue;
    }
    if (/^\s*\|.*\|\s*$/.test(zeile) && i + 1 < z.length && /^\s*\|[\s:|-]+\|\s*$/.test(z[i + 1])) {
      const zellen = (r) => r.trim().replace(/^\||\|$/g, "").split("|").map((c) => inline(c.trim()));
      html += "<table><thead><tr>" + zellen(zeile).map((c) => `<th>${c}</th>`).join("") + "</tr></thead><tbody>";
      i += 2;
      while (i < z.length && /^\s*\|.*\|\s*$/.test(z[i])) {
        html += "<tr>" + zellen(z[i]).map((c) => `<td>${c}</td>`).join("") + "</tr>"; i++;
      }
      html += "</tbody></table>"; continue;
    }
    const liste = (re, tag) => {
      html += `<${tag}>`;
      while (i < z.length && re.test(z[i])) {
        let punkt = z[i].replace(re, ""); i++;
        while (i < z.length && /^\s{2,}\S/.test(z[i]) && !re.test(z[i])) { punkt += " " + z[i].trim(); i++; }
        html += `<li>${inline(punkt)}</li>`;
      }
      html += `</${tag}>`;
    };
    if (/^\s*[-*•]\s+/.test(zeile)) { liste(/^\s*[-*•]\s+/, "ul"); continue; }
    if (/^\s*\d+[.)]\s+/.test(zeile)) { liste(/^\s*\d+[.)]\s+/, "ol"); continue; }
    if (/^>\s?/.test(zeile)) {
      let q = [];
      while (i < z.length && /^>\s?/.test(z[i])) { q.push(z[i].replace(/^>\s?/, "")); i++; }
      html += `<blockquote>${inline(q.join(" "))}</blockquote>`; continue;
    }
    let p = [zeile]; i++;
    while (i < z.length && z[i].trim() && !istSonder(z[i])) { p.push(z[i]); i++; }
    html += `<p>${p.map(inline).join("<br>")}</p>`;
  }
  return html;
}

function md(src) {
  return String(src).split("```").map((teil, i) => {
    if (i % 2 === 0) return bloecke(teil);
    const nl = teil.indexOf("\n");
    const lang = (nl >= 0 ? teil.slice(0, nl) : teil).trim();
    const code = nl >= 0 ? teil.slice(nl + 1).replace(/\n$/, "") : "";
    return codeBlock(code, lang);
  }).join("");
}

/* ================================================================ Editor */
const ta = $("#code"), hlPre = $("#highlight"), hlCode = $("#highlight code"), gutter = $("#gutter");
let fehlerZeile = null, speicherTimer = null;

function editorAktualisieren() {
  hlCode.innerHTML = highlight(ta.value) + "\n";
  gutterAktualisieren();
}
function gutterAktualisieren() {
  const n = ta.value.split("\n").length;
  const vor = ta.value.slice(0, ta.selectionStart).split("\n");
  const aktuell = vor.length;
  let g = "";
  for (let i = 1; i <= n; i++) g += `<div class="${i === fehlerZeile ? "fehler" : i === aktuell ? "aktiv" : ""}">${i}</div>`;
  gutter.innerHTML = g + "<div></div><div></div>";
  $("#cursorPos").textContent = `Z ${aktuell}, S ${vor[vor.length - 1].length + 1}`;
  syncScroll();
}
function syncScroll() {
  hlPre.scrollTop = ta.scrollTop;
  hlPre.scrollLeft = ta.scrollLeft;
  gutter.scrollTop = ta.scrollTop;
}
function einfuegen(text) {
  ta.focus();
  if (!document.execCommand("insertText", false, text)) {
    ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, "end");
    ta.dispatchEvent(new Event("input"));
  }
}
function editorSetzen(text, rueckgaengigMoeglich = false) {
  if (rueckgaengigMoeglich) { ta.focus(); ta.select(); einfuegen(text); }
  else { ta.value = text; editorAktualisieren(); }
  ta.setSelectionRange(text.length, text.length);
  gutterAktualisieren();
}
function setFehlerZeile(n) { fehlerZeile = n || null; gutterAktualisieren(); }

function codeGeaendert() {
  S.fortschritt.code[S.nr] = ta.value;
  $("#ungespeichert").hidden = false;
  clearTimeout(speicherTimer);
  speicherTimer = setTimeout(speichern, 700);
}
async function speichern() {
  clearTimeout(speicherTimer);
  if (!S.nr) return;
  try {
    await B.fortschrittSpeichern({ code: { [S.nr]: ta.value } });
    $("#ungespeichert").hidden = true;
  } catch { /* nächster Versuch beim nächsten Tastendruck */ }
}

// iPad/Mac ersetzen " und ' gern durch typografische Anführungszeichen – Python versteht die nicht.
const SMART = /[“”„‟″‘’‚‛′]/g;
const SMART_ERSATZ = { "“": '"', "”": '"', "„": '"', "‟": '"', "″": '"', "‘": "'", "’": "'", "‚": "'", "‛": "'", "′": "'" };
ta.addEventListener("input", () => {
  if (SMART.test(ta.value)) {
    const { selectionStart: a, selectionEnd: b } = ta;
    ta.value = ta.value.replace(SMART, (c) => SMART_ERSATZ[c]);
    ta.setSelectionRange(a, b);
  }
  if (fehlerZeile) fehlerZeile = null;
  editorAktualisieren();
  codeGeaendert();
});

// Tastenleiste für Touch-Geräte
$("#tastenleiste").addEventListener("pointerdown", (e) => e.preventDefault()); // Fokus im Editor halten
$("#tastenleiste").addEventListener("click", (e) => {
  const k = e.target.closest("[data-taste]");
  if (!k) return;
  ta.focus();
  const t = k.dataset.taste;
  if (t === "tab" || t === "untab") {
    ta.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", shiftKey: t === "untab", bubbles: true, cancelable: true }));
    return;
  }
  const paar = { "()": 1, "[]": 1, "{}": 1, '""': 1, "print()": 1 }[t];
  const markiert = ta.value.slice(ta.selectionStart, ta.selectionEnd);
  if (paar) {
    const auf = t.slice(0, -1), zu = t.slice(-1);
    einfuegen(auf + markiert + zu);
    if (!markiert) ta.setSelectionRange(ta.selectionStart - 1, ta.selectionStart - 1);
  } else {
    einfuegen(t === "==" ? " == " : t === "=" ? " = " : t);
  }
  gutterAktualisieren();
});
ta.addEventListener("scroll", syncScroll);
ta.addEventListener("click", gutterAktualisieren);
ta.addEventListener("keyup", (e) => { if (e.key.startsWith("Arrow") || e.key === "Home" || e.key === "End") gutterAktualisieren(); });

ta.addEventListener("keydown", (e) => {
  const strg = e.ctrlKey || e.metaKey;
  if (strg && e.key === "Enter") { e.preventDefault(); e.shiftKey ? pruefen() : ausfuehren(); return; }
  if (strg && e.key.toLowerCase() === "s") { e.preventDefault(); speichern(); return; }
  const { selectionStart: a, selectionEnd: b, value: v } = ta;
  const zs = v.lastIndexOf("\n", a - 1) + 1;   // Zeilenanfang

  if (e.key === "Tab") {
    e.preventDefault();
    if (a === b && !e.shiftKey) { einfuegen(" ".repeat(4 - ((a - zs) % 4))); return; }
    let ende = v.indexOf("\n", b > a && v[b - 1] === "\n" ? b - 1 : b);
    if (ende < 0) ende = v.length;
    const neu = v.slice(zs, ende).split("\n").map((z) => (e.shiftKey ? z.replace(/^ {1,4}/, "") : "    " + z)).join("\n");
    ta.setSelectionRange(zs, ende);
    einfuegen(neu);
    ta.setSelectionRange(zs, zs + neu.length);
    return;
  }
  if (e.key === "Enter" && !strg) {
    e.preventDefault();
    const zeile = v.slice(zs, a);
    let einz = zeile.match(/^ */)[0];
    if (/:\s*(#.*)?$/.test(zeile)) einz += "    ";
    else if (/^\s*(return|break|continue|pass|raise)\b/.test(zeile)) einz = einz.slice(0, Math.max(0, einz.length - 4));
    einfuegen("\n" + einz);
    return;
  }
  if (e.key === "Backspace" && a === b && a > zs) {
    const vor = v.slice(zs, a);
    if (/^ +$/.test(vor)) {
      e.preventDefault();
      const n = vor.length % 4 || 4;
      ta.setSelectionRange(a - n, a);
      if (!document.execCommand("delete")) { ta.setRangeText("", a - n, a, "end"); ta.dispatchEvent(new Event("input")); }
    }
  }
});

/* ================================================================ Agent-Log */
const log = $("#log");
log.addEventListener("scroll", () => { S.folgen = log.scrollHeight - log.scrollTop - log.clientHeight < 80; });
function nachUnten(erzwingen = false) {
  if (erzwingen || S.folgen) { log.scrollTop = log.scrollHeight; S.folgen = true; }
}
function eintrag(klasse, bullet, html, scrollen = true) {
  const el = document.createElement("div");
  el.className = "msg " + klasse;
  el.innerHTML = `<span class="bullet">${bullet}</span><div class="body">${html}</div>`;
  log.append(el);
  if (scrollen) nachUnten(true);
  return el;
}
const logUser = (text) => eintrag("user", "&gt;", esc(text));
const logSystem = (html, bullet = "⏺") => eintrag("system", bullet, html);
const logAgentText = (markdown) => eintrag("agent", "⏺", md(markdown));

function logTool(name, arg) {
  const el = eintrag("tool pending", "⏺",
    `<div class="tool-name"><b>${esc(name)}</b><span class="arg">(${esc(arg)})</span></div>` +
    `<div class="result" hidden><span class="corner">⎿</span><div class="lines"></div></div>`);
  return {
    fertig(zeilen, fehlgeschlagen = false) {
      el.classList.remove("pending");
      if (fehlgeschlagen) el.classList.add("failed");
      const r = el.querySelector(".result");
      r.hidden = false;
      r.querySelector(".lines").innerHTML = zeilen.map((z) => `<div>${z}</div>`).join("");
      nachUnten();
    },
  };
}

const SPIN = "·✢✳✶✻✽✻✶✳✢";
const VERBEN = ["Denkt nach", "Überlegt", "Tüftelt", "Grübelt", "Formuliert", "Kombiniert", "Sortiert Gedanken"];
function spinner() {
  const el = document.createElement("div");
  el.className = "spinner";
  log.append(el);
  const start = Date.now();
  const verb = VERBEN[Math.floor(Math.random() * VERBEN.length)];
  let i = 0;
  const tick = () => {
    const s = Math.floor((Date.now() - start) / 1000);
    el.innerHTML = `<span>${SPIN[i++ % SPIN.length]}</span><span>${verb}…</span><span class="zeit">(${s} s · Esc zum Abbrechen)</span>`;
  };
  tick();
  const t = setInterval(tick, 120);
  nachUnten();
  return { entfernen() { clearInterval(t); el.remove(); }, el };
}

log.addEventListener("click", async (e) => {
  const knopf = e.target.closest("button[data-akt]");
  if (!knopf) return;
  const code = knopf.closest(".codeblock").getAttribute("data-code");
  const akt = knopf.dataset.akt;
  if (akt === "kopieren") {
    try { await navigator.clipboard.writeText(code); knopf.textContent = "Kopiert ✓"; }
    catch { knopf.textContent = "Nicht möglich"; }
    setTimeout(() => (knopf.textContent = "Kopieren"), 1500);
  } else if (akt === "einfuegen") {
    einfuegen(code.endsWith("\n") ? code : code + "\n");
  } else if (akt === "ersetzen") {
    editorSetzen(code, true);
    logSystem('<span class="dim">Lösung in den Editor übernommen – Strg+Z macht es rückgängig.</span>', "↺");
  }
});

/* ================================================================ Backend & Modell */
// Server-Version (python server.py) oder reine Browser-Version (z. B. GitHub Pages / iPad)?
async function backendWaehlen() {
  const erzwungen = new URLSearchParams(location.search).get("modus");
  if (erzwungen !== "browser" && !location.hostname.endsWith(".github.io")) {
    try {
      const res = await fetch("api/status", { cache: "no-store" });
      if (res.ok && (await res.json()).modus === "server") return erstelleServerBackend();
    } catch { /* kein Server → Browser-Version */ }
  }
  return erstelleBrowserBackend();
}

let B = null; // aktives Backend

async function statusLaden() {
  S.status = await B.status();
  const st = S.status;
  $("#modellPunkt").className = "dot " + (st.laedt ? "laedt" : st.online ? "online" : "offline");
  const wahl = $("#modellWahl");
  if (B.name === "browser") {
    const opt = st.modelle.map((m) => `<option value="${esc(m.id)}" ${m.id === st.modell ? "selected" : ""}>${esc(m.label)}</option>`).join("");
    wahl.innerHTML = (st.modell ? "" : `<option value="" selected>${st.webgpu === false ? "KI nicht verfügbar" : st.modelle.length ? "KI-Modell wählen …" : "Modelle werden gesucht …"}</option>`) + opt;
    wahl.disabled = !st.modelle.length || st.laedt;
  } else {
    wahl.innerHTML = st.modelle.length
      ? st.modelle.map((m) => `<option value="${esc(m.id)}" ${m.id === st.modell ? "selected" : ""}>${esc(m.label)}</option>`).join("")
      : `<option>${st.online ? "kein Modell" : "offline"}</option>`;
    wahl.disabled = !st.modelle.length;
  }
  $("#agentStatus").textContent = st.laedt ? "· Modell wird geladen …" : st.online ? `· ${kurzname(st.modell)}` : "· ohne KI – Kurs funktioniert trotzdem";
  clearTimeout(statusLaden.t);
  if (B.name === "server" && !st.online) statusLaden.t = setTimeout(statusLaden, 10000);
  return st;
}
const kurzname = (id) => String(id || "").replace(/-q4f(16|32)_1-MLC$/, "");

async function modellLaden(id) {
  if (!id) return;
  if (B.name === "server") {
    await B.modellWaehlen(id);
    await statusLaden();
    logSystem(`Modell gewechselt zu <b>${esc(S.status.modell)}</b>.`);
    return;
  }
  const m = S.status.modelle.find((x) => x.id === id);
  const el = logSystem(`<b>Lade KI-Modell ${esc(kurzname(id))}</b>` +
    `<div class="dim" data-text>Startet … ${m?.mb ? `(beim ersten Mal ca. ${(m.mb / 1024).toFixed(1).replace(".", ",")} GB Download, danach aus dem Speicher)` : ""}</div>` +
    `<div class="ladebalken"><div></div></div>`, "⬇");
  const text = $("[data-text]", el), balken = $(".ladebalken div", el);
  B.beiLadefortschritt = (r) => {
    balken.style.width = `${Math.round((r.progress || 0) * 100)}%`;
    text.textContent = (r.text || "").replace(/\[\d+\/\d+\]:?\s*/, "").slice(0, 160);
  };
  const statusTimer = setInterval(statusLaden, 1500);
  statusLaden();
  try {
    await B.modellWaehlen(id);
    balken.style.width = "100%";
    text.innerHTML = `<span class="ok">Bereit.</span> Das Modell läuft jetzt komplett auf deinem Gerät – frag einfach los.`;
    balken.parentElement.remove();
  } catch (err) {
    text.innerHTML = `<span class="err">${esc(err.message)}</span>`;
  } finally {
    clearInterval(statusTimer);
    B.beiLadefortschritt = null;
    await statusLaden();
  }
}

$("#modellWahl").addEventListener("change", (e) => modellLaden(e.target.value));

/* ================================================================ Agent (Sprachmodell) */
const NUTZERTEXT = {
  pruefung: "Ich habe meine Lösung prüfen lassen.",
  tipp: "Gib mir bitte einen Tipp.",
  erklaeren: "Erklär mir bitte meinen Code.",
  fehler: "Was bedeutet dieser Fehler?",
  loesung: "Zeig mir die Lösung.",
  lektion: "Erklär mir das Thema bitte noch einmal anders.",
};

function stoppKnopf(an) { $("#knopfStopp").hidden = !an; }
function abbrechen() { if (S.abbruch) S.abbruch.abort(); }
$("#knopfStopp").addEventListener("click", abbrechen);

async function agentFragen(modus, extras = {}) {
  if (!S.status.online && B.name === "server") await statusLaden();
  if (!S.status.online) return offlineAntwort(modus, extras);
  abbrechen();
  const verlauf = (S.verlauf[S.nr] ||= []);
  const ctrl = new AbortController();
  S.abbruch = ctrl;
  stoppKnopf(true);

  const el = eintrag("agent", "⏺", "");
  el.hidden = true;
  const body = $(".body", el);
  const sp = spinner();
  let text = "", geplant = false;
  const zeichnen = () => { geplant = false; el.hidden = !text; body.innerHTML = md(text); nachUnten(); };

  const nachrichten = baueNachrichten(modus, {
    lektion: aktuelleLektion(), alle: S.lektionen, verlauf, code: ta.value, ausgabe: S.letzteAusgabe,
    text: extras.text || "", pruefung: extras.pruefung || null, tippNr: extras.tipp_nr || 1, kompakt: B.kompakt,
  });

  try {
    for await (const stueck of B.chat(nachrichten, ctrl.signal)) {
      text += stueck;
      if (!geplant) { geplant = true; requestAnimationFrame(zeichnen); }
    }
    zeichnen();
    if (!text.trim()) { el.hidden = false; body.innerHTML = '<span class="dim">(Das Modell hat nichts geantwortet.)</span>'; }
    else verlauf.push({ role: "user", content: extras.text && modus === "frage" ? extras.text : NUTZERTEXT[modus] || modus },
                      { role: "assistant", content: text });
  } catch (err) {
    el.hidden = false;
    if (err.name === "AbortError" || ctrl.signal.aborted) {
      body.innerHTML = (text ? md(text) : "") + '<p class="dim">– abgebrochen –</p>';
    } else {
      body.innerHTML = (text ? md(text) : "") + `<p class="err">Fehler: ${esc(err.message)}</p>`;
      statusLaden();
    }
  } finally {
    sp.entfernen();
    if (S.abbruch === ctrl) { S.abbruch = null; stoppKnopf(false); }
    nachUnten();
  }
}

function offlineAntwort(modus, extras) {
  const l = aktuelleLektion();
  if (modus === "tipp") {
    const n = Math.min(extras.tipp_nr || 1, l.tipps.length);
    logAgentText(`**Tipp ${n}/${l.tipps.length}:** ${l.tipps[n - 1]}` + (n < l.tipps.length ? "\n\nNoch einer? Tippe erneut /tipp." : ""));
    return;
  }
  if (modus === "pruefung") {
    const p = extras.pruefung;
    if (p.ok) { logAgentText("Stark – alle Tests bestanden! 🎉"); return; }
    if (p.fehler) { logAgentText(`Dein Programm bricht mit einem **${p.fehler.typ}** ab. ${p.fehler.hinweis || ""}`); return; }
    const t = p.tests.find((x) => !x.ok);
    logAgentText(`Fast! Schau dir diesen Punkt an: **${t.name}** – ${t.meldung}\n\nBrauchst du Hilfe? Tippe /tipp.`);
    return;
  }
  if (modus === "fehler" && S.letzterFehler) {
    logAgentText(`**${S.letzterFehler.typ}**${S.letzterFehler.zeile ? ` in Zeile ${S.letzterFehler.zeile}` : ""}: ${S.letzterFehler.hinweis || S.letzterFehler.meldung}`);
    return;
  }
  if (modus === "loesung") return;
  kiHinweis();
}

// Erklärt, wie man die KI einschaltet – je nach Version
function kiHinweis() {
  const st = S.status;
  const ohne = "Ohne KI funktionieren weiterhin: **/prüfen**, **/tipp**, **/lösung** und alle Lektionen.";
  if (B.name === "server") {
    logSystem(`<b>Kein lokales Modell erreichbar.</b> <span class="dim">${esc(st.fehler || "")}</span>` + md("\n" + B.offlineHilfe + "\n" + ohne), "⚠");
    return;
  }
  if (st.webgpu === false) {
    logSystem(`<b>KI-Tutor auf diesem Gerät nicht verfügbar.</b> <span class="dim">${esc(st.fehler)}</span>` + md("\n" + ohne), "⚠");
    return;
  }
  if (st.laedt) { logSystem("Das KI-Modell wird gerade geladen – einen Moment noch.", "⬇"); return; }
  const e = st.empfohlen;
  const el = logSystem(
    "<b>KI-Tutor einschalten?</b>" +
    md("\nDas Sprachmodell läuft **komplett auf deinem Gerät** – nichts verlässt den Browser. Beim ersten Mal wird es einmalig heruntergeladen" +
       (e?.mb ? ` (ca. ${(e.mb / 1024).toFixed(1).replace(".", ",")} GB, am besten im WLAN)` : "") + ", danach startet es aus dem Speicher.\n\n" + ohne) +
    (e ? `<button class="inline-btn" data-laden="${esc(e.id)}">⬇ ${esc(kurzname(e.id))} laden</button>` : "") +
    `<button class="inline-btn zweit" data-modellwahl>Anderes Modell …</button>`, "◆");
  el.addEventListener("click", (ev) => {
    const k = ev.target.closest("[data-laden]");
    if (k) { el.querySelectorAll("button").forEach((b) => (b.disabled = true)); modellLaden(k.dataset.laden); }
    if (ev.target.closest("[data-modellwahl]")) { $("#modellWahl").focus(); $("#modellWahl").showPicker?.(); }
  });
}

/* ================================================================ Lektionen */
const aktuelleLektion = () => S.lektionen[S.nr - 1];
const datei = () => aktuelleLektion().datei;
const erledigt = (nr) => S.fortschritt.erledigt.includes(nr);
const freigeschaltet = (nr) => nr === 1 || erledigt(nr) || erledigt(nr - 1);

function fortschrittAnzeigen() {
  const n = S.fortschritt.erledigt.length, g = S.lektionen.length;
  $("#fortschrittBalken").style.width = `${(100 * n) / g}%`;
  $("#fortschrittText").textContent = `${n}/${g}`;
  const l = aktuelleLektion();
  $("#lektionTitel").textContent = `${erledigt(l.id) ? "✓ " : ""}Lektion ${l.id} · ${l.titel}`;
}

function zeigeLektion(l) {
  const el = eintrag("lesson", "⏺",
    `<div class="tool-name"><b>Lektion ${l.id}/${S.lektionen.length}</b><span class="arg"> · ${esc(l.titel)}</span></div>` +
    md(l.erklaerung) +
    `<div class="aufgabe"><div class="label">◆ Aufgabe</div>${md(l.aufgabe)}</div>` +
    `<p class="dim" style="margin-top:8px">Schreib deinen Code links · <b>Strg+Enter</b> führt aus · <b>/prüfen</b> prüft · <b>/tipp</b> hilft weiter</p>`,
    false);
  requestAnimationFrame(() => { log.scrollTop = el.offsetTop - log.offsetTop - 8; S.folgen = false; });
}

async function oeffneLektion(nr, { zeigen = true } = {}) {
  if (nr < 1 || nr > S.lektionen.length) return;
  if (!freigeschaltet(nr)) {
    logSystem(`Lektion ${nr} ist noch gesperrt – schließe zuerst Lektion ${nr - 1} mit <b>/prüfen</b> ab.`, "⊘");
    return;
  }
  if (S.nr && S.nr !== nr) await speichern();
  abbrechen();
  S.nr = nr;
  S.fortschritt.aktuell = nr;
  const l = aktuelleLektion();
  editorSetzen(S.fortschritt.code[nr] ?? l.starter);
  setFehlerZeile(null);
  $("#dateiname").textContent = l.datei;
  document.title = `${l.datei} · Code-Trainer`;
  $("#stdin").value = l.stdin || "";
  stdinZeigen(!!l.stdin);
  S.letzteAusgabe = "";
  S.letzterFehler = null;
  ausgabe.innerHTML = `<span class="dim">Hier erscheint die Ausgabe von ${esc(l.datei)}. ▶ Ausführen mit Strg+Enter.</span>`;
  $("#laufInfo").textContent = "";
  fortschrittAnzeigen();
  B.fortschrittSpeichern({ aktuell: nr }).catch(() => {});
  if (zeigen) zeigeLektion(l);
  ta.focus();
}

function lektionMenue(offen) {
  const m = $("#lektionMenue");
  if (offen === undefined) offen = m.hidden;
  if (!offen) { m.hidden = true; return; }
  const r = $("#lektionKnopf").getBoundingClientRect();
  m.style.left = `${Math.max(8, r.left)}px`;
  m.style.top = `${r.bottom + 6}px`;
  m.innerHTML = S.lektionen.map((l) => {
    const frei = freigeschaltet(l.id);
    const cls = ["eintrag", l.id === S.nr ? "aktuell" : "", frei ? "" : "gesperrt"].join(" ");
    const status = erledigt(l.id) ? '<span class="status ok">✓</span>' : l.id === S.nr ? '<span class="accent">▸</span>' : frei ? "○" : '<span class="faint">·</span>';
    return `<div class="${cls}" data-nr="${l.id}" title="${frei ? "" : "noch gesperrt"}"><span class="status">${status}</span><span class="nr">${l.id}</span><span>${esc(l.titel)}</span><i class="k">${esc(l.konzepte.join(" · "))}</i></div>`;
  }).join("") + '<div class="fuss"><button data-reset>Fortschritt zurücksetzen</button></div>';
  m.hidden = false;
}
$("#lektionKnopf").addEventListener("click", (e) => { e.stopPropagation(); lektionMenue(); });
$("#lektionMenue").addEventListener("click", async (e) => {
  e.stopPropagation();
  if (e.target.closest("[data-reset]")) {
    if (!confirm("Wirklich den gesamten Fortschritt und deinen Code löschen?")) return;
    S.fortschritt = await B.fortschrittZuruecksetzen();
    S.verlauf = {};
    lektionMenue(false);
    log.innerHTML = "";
    willkommen();
    S.nr = 0;
    return oeffneLektion(1);
  }
  const zeile = e.target.closest(".eintrag");
  if (!zeile || zeile.classList.contains("gesperrt")) return;
  lektionMenue(false);
  oeffneLektion(+zeile.dataset.nr);
});
document.addEventListener("click", () => lektionMenue(false));

/* ================================================================ Ausführen & Prüfen */
const ausgabe = $("#ausgabe");

function beschaeftigt(an) {
  S.beschaeftigt = an;
  $("#knopfAusfuehren").disabled = an;
  $("#knopfPruefen").disabled = an;
}

function ausgabeHtml(r, kopf) {
  let h = `<span class="trenner">$ ${esc(kopf)}</span>\n`;
  if (r.ausgabe) h += esc(r.ausgabe) + (r.ausgabe.endsWith("\n") ? "" : "\n");
  if (r.fehler) {
    h += `<span class="fehler">${esc(r.fehler.text || r.fehler.meldung)}</span>\n`;
    if (r.fehler.hinweis) h += `<span class="hinweis">Hinweis: ${esc(r.fehler.hinweis)}</span>\n`;
  }
  return h;
}

async function ausfuehren() {
  if (S.beschaeftigt) return;
  beschaeftigt(true);
  await speichern();
  const t = logTool("Ausführen", `python ${datei()}`);
  ausgabe.innerHTML = `<span class="trenner">$ python ${esc(datei())}</span>\n<span class="dim">${pythonLaedt() ? "Python wird beim ersten Mal geladen (einige Sekunden) …" : "läuft …"}</span>`;
  $("#laufInfo").textContent = "";
  try {
    const r = await B.ausfuehren({ lektion: aktuelleLektion(), code: ta.value, stdin: $("#stdin").value });
    ausgabe.innerHTML = ausgabeHtml(r, `python ${datei()}`) +
      `<span class="trenner">[beendet · ${r.dauer.toFixed(2)} s]</span>`;
    ausgabe.scrollTop = ausgabe.scrollHeight;
    $("#laufInfo").textContent = r.fehler ? `· ${r.fehler.typ}` : `· ${r.dauer.toFixed(2)} s`;
    S.letzteAusgabe = r.ausgabe + (r.fehler ? "\n" + (r.fehler.text || r.fehler.meldung) : "");
    S.letzterFehler = r.fehler;
    if (r.fehler) {
      setFehlerZeile(r.fehler.zeile);
      t.fertig([
        `<span class="err">${esc(r.fehler.typ)}${r.fehler.zeile ? ` in Zeile ${r.fehler.zeile}` : ""}</span>: ${esc(r.fehler.meldung)}`,
        '<span class="faint">/fehler – lass dir den Fehler erklären</span>',
      ], true);
    } else {
      const n = r.ausgabe.split("\n").filter((z) => z.length).length;
      t.fertig([`${n} Zeile${n === 1 ? "" : "n"} Ausgabe · ${r.dauer.toFixed(2)} s`]);
    }
  } catch (err) {
    t.fertig([esc(err.message)], true);
    ausgabe.innerHTML = `<span class="fehler">${esc(err.message)}</span>`;
  } finally {
    beschaeftigt(false);
  }
}

async function pruefen() {
  if (S.beschaeftigt) return;
  beschaeftigt(true);
  await speichern();
  const nr = S.nr;
  const t = logTool("Prüfen", datei());
  ausgabe.innerHTML = `<span class="trenner">$ prüfe ${esc(datei())}</span>\n<span class="dim">${pythonLaedt() ? "Python wird beim ersten Mal geladen (einige Sekunden) …" : "Tests laufen …"}</span>`;
  let r;
  try {
    r = await B.pruefen({ lektion: aktuelleLektion(), code: ta.value });
  } catch (err) {
    t.fertig([esc(err.message)], true);
    beschaeftigt(false);
    return;
  }
  beschaeftigt(false);

  let h = ausgabeHtml(r, `python ${datei()}`) + `<span class="trenner">── Tests ──</span>\n`;
  const zeilen = [];
  if (r.fehler && !r.tests.length) {
    setFehlerZeile(r.fehler.zeile);
    zeilen.push(`<span class="err">${esc(r.fehler.typ)}${r.fehler.zeile ? ` in Zeile ${r.fehler.zeile}` : ""}</span>: ${esc(r.fehler.meldung)}`);
    h += `<span class="test-fail">Das Programm ist abgebrochen – Tests nicht ausgeführt.</span>\n`;
  }
  for (const test of r.tests) {
    h += test.ok ? `<span class="test-ok">✓ ${esc(test.name)}</span>\n`
                 : `<span class="test-fail">✗ ${esc(test.name)}</span>\n  <span class="dim">${esc(test.meldung)}</span>\n`;
    zeilen.push(test.ok ? `<span class="ok">✓</span> ${inline(test.name)}` : `<span class="err">✗</span> ${inline(test.name)} <span class="faint">– ${esc(test.meldung)}</span>`);
  }
  const bestanden = r.tests.filter((x) => x.ok).length;
  h += `\n${r.ok ? '<span class="test-ok">' : '<span class="test-fail">'}${bestanden}/${r.tests.length} Tests bestanden</span>`;
  ausgabe.innerHTML = h;
  ausgabe.scrollTop = ausgabe.scrollHeight;
  $("#laufInfo").textContent = `· ${bestanden}/${r.tests.length} Tests`;
  S.letzteAusgabe = r.ausgabe + (r.fehler ? "\n" + r.fehler.text : "");
  S.letzterFehler = r.fehler;
  t.fertig(zeilen, !r.ok);

  if (r.ok) {
    S.fortschritt = await B.fortschrittSpeichern({ erledigt: nr, code: { [nr]: ta.value } });
    fortschrittAnzeigen();
    const letzte = nr === S.lektionen.length;
    logSystem(`<span class="erfolg">Lektion ${nr} geschafft!</span> ` +
      (letzte ? "Du hast den ganzen Kurs abgeschlossen – großartig! 🎉" : `Weiter mit <b>/weiter</b> zu Lektion ${nr + 1}: ${esc(S.lektionen[nr].titel)}.`), "✔");
  }
  agentFragen("pruefung", { pruefung: { ok: r.ok, fehler: r.fehler, tests: r.tests } });
}

$("#knopfAusfuehren").addEventListener("click", ausfuehren);
$("#knopfPruefen").addEventListener("click", pruefen);
$("#knopfReset").addEventListener("click", () => befehl("/reset"));
$("#knopfLeeren").addEventListener("click", () => { ausgabe.innerHTML = ""; $("#laufInfo").textContent = ""; });
function stdinZeigen(an) {
  $("#stdinBox").hidden = !an;
  $("#knopfStdin").classList.toggle("aktiv", an);
}
$("#knopfStdin").addEventListener("click", () => {
  stdinZeigen($("#stdinBox").hidden);
  if (!$("#stdinBox").hidden) $("#stdin").focus();
});

/* ================================================================ Befehle */
const BEFEHLE = [
  ["/hilfe", "Alle Befehle anzeigen"],
  ["/prüfen", "Aufgabe automatisch prüfen (Strg+⇧+Enter)"],
  ["/ausführen", "Programm ausführen (Strg+Enter)"],
  ["/tipp", "Einen Hinweis zur Aufgabe bekommen"],
  ["/erklär", "Den Code im Editor erklären lassen"],
  ["/fehler", "Den letzten Fehler erklären lassen"],
  ["/nochmal", "Das Thema der Lektion anders erklärt bekommen"],
  ["/aufgabe", "Lektion und Aufgabe erneut anzeigen"],
  ["/lösung", "Musterlösung anzeigen"],
  ["/weiter", "Zur nächsten Lektion"],
  ["/zurück", "Zur vorherigen Lektion"],
  ["/lektionen", "Übersicht aller Lektionen"],
  ["/lektion", "Zu Lektion N springen, z. B. /lektion 3"],
  ["/reset", "Editor auf den Startcode zurücksetzen"],
  ["/neu", "Chat leeren (Code bleibt erhalten)"],
  ["/modell", "Modell anzeigen oder wechseln, z. B. /modell llama3.1"],
];
const norm = (s) => s.toLowerCase().replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss");
const ALIAS = { "/help": "/hilfe", "/check": "/pruefen", "/run": "/ausfuehren", "/hint": "/tipp", "/next": "/weiter",
  "/erklaere": "/erklaer", "/erklaeren": "/erklaer", "/zurueck": "/zurueck", "/clear": "/neu", "/model": "/modell" };

async function befehl(eingabeText) {
  const [roh, ...rest] = eingabeText.trim().split(/\s+/);
  let cmd = norm(roh);
  cmd = ALIAS[cmd] || cmd;
  const arg = rest.join(" ");
  const l = aktuelleLektion();
  switch (cmd) {
    case "/hilfe":
      logSystem("<b>Befehle</b>" + `<table>${BEFEHLE.map(([n, b]) => `<tr><td class="accent">${n}</td><td class="dim">${b}</td></tr>`).join("")}</table>` +
        '<p class="dim">Tastatur: Strg+Enter ausführen · Strg+⇧+Enter prüfen · Esc Antwort abbrechen · Alt+L Lektionen. Alles andere, was du hier eintippst, beantwortet der Agent.</p>', "?");
      break;
    case "/pruefen": pruefen(); break;
    case "/ausfuehren": ausfuehren(); break;
    case "/tipp": {
      const n = (S.tippNr[S.nr] = (S.tippNr[S.nr] || 0) + 1);
      agentFragen("tipp", { tipp_nr: n });
      break;
    }
    case "/erklaer": agentFragen("erklaeren"); break;
    case "/fehler":
      if (!S.letzterFehler) { logSystem('<span class="dim">Zuletzt gab es keinen Fehler. Führe dein Programm mit Strg+Enter aus.</span>'); break; }
      agentFragen("fehler", { text: S.letzterFehler.text || S.letzterFehler.meldung });
      break;
    case "/nochmal": agentFragen("lektion"); break;
    case "/aufgabe": zeigeLektion(l); break;
    case "/loesung":
      if (!S.loesungGefragt[S.nr] && !erledigt(S.nr)) {
        S.loesungGefragt[S.nr] = true;
        logSystem("Sicher? Selbst draufzukommen bringt am meisten – probier es ruhig mit <b>/tipp</b>. Wenn du die Lösung trotzdem sehen willst, tippe nochmal <b>/lösung</b>.", "?");
        break;
      }
      logAgentText(`**Musterlösung zu Lektion ${l.id}:**`).querySelector(".body")
        .insertAdjacentHTML("beforeend", codeBlock(l.loesung.replace(/\n$/, ""), "python", '<button data-akt="ersetzen">Editor ersetzen</button>'));
      nachUnten(true);
      if (S.status.online) agentFragen("loesung");
      break;
    case "/weiter":
      if (S.nr >= S.lektionen.length) { logSystem("Das war die letzte Lektion. Frag den Agenten nach Ideen für eigene Projekte!"); break; }
      if (!erledigt(S.nr)) { logSystem(`Schließe zuerst diese Lektion mit <b>/prüfen</b> ab. Hilfe gibt es mit <b>/tipp</b>.`, "⊘"); break; }
      oeffneLektion(S.nr + 1);
      break;
    case "/zurueck": oeffneLektion(S.nr - 1); break;
    case "/lektionen":
      logSystem("<b>Lektionen</b>" + `<table>${S.lektionen.map((x) =>
        `<tr><td>${erledigt(x.id) ? '<span class="ok">✓</span>' : x.id === S.nr ? '<span class="accent">▸</span>' : freigeschaltet(x.id) ? "○" : '<span class="faint">·</span>'}</td>` +
        `<td class="dim">${x.id}</td><td>${esc(x.titel)}</td><td class="faint">${esc(x.konzepte.slice(0, 3).join(", "))}</td></tr>`).join("")}</table>` +
        '<p class="dim">Springen mit /lektion N oder über das Menü oben.</p>', "≡");
      break;
    case "/lektion": {
      const n = parseInt(arg, 10);
      if (!n) { befehl("/lektionen"); break; }
      oeffneLektion(n);
      break;
    }
    case "/reset":
      editorSetzen(l.starter, true);
      setFehlerZeile(null);
      logSystem('<span class="dim">Startcode wiederhergestellt – Strg+Z im Editor macht es rückgängig.</span>', "↺");
      break;
    case "/neu":
      log.innerHTML = "";
      S.verlauf[S.nr] = [];
      willkommen(true);
      break;
    case "/modell":
      await statusLaden();
      if (arg) {
        const treffer = S.status.modelle.find((m) => m.id === arg) ||
          S.status.modelle.find((m) => m.id.toLowerCase().includes(arg.toLowerCase()));
        if (treffer || B.name === "server") await modellLaden(treffer ? treffer.id : arg);
        else logSystem(`Kein Modell gefunden, das zu <b>${esc(arg)}</b> passt.`, "?");
      } else {
        logSystem(`Modell: <b>${esc(kurzname(S.status.modell) || "–")}</b> · ${S.status.online ? '<span class="ok">bereit</span>' : '<span class="err">nicht geladen</span>'}` +
          ` <span class="dim">(${B.name === "browser" ? "läuft im Browser" : "lokaler Server"})</span>` +
          (S.status.modelle.length ? `<br><span class="dim">Verfügbar: ${S.status.modelle.map((m) => esc(kurzname(m.id))).join(", ")}</span>` : ""));
        if (!S.status.online && B.name === "browser") kiHinweis();
      }
      break;
    default:
      logSystem(`Unbekannter Befehl <b>${esc(roh)}</b> – /hilfe zeigt alle Befehle.`, "?");
  }
}

/* ================================================================ Eingabezeile */
const eingabe = $("#eingabe"), menue = $("#befehlMenue");
let menueAuswahl = 0, menueTreffer = [];

function eingabeHoehe() { eingabe.style.height = "auto"; eingabe.style.height = Math.min(eingabe.scrollHeight, 160) + "px"; }
function menueAktualisieren() {
  const v = eingabe.value;
  if (!v.startsWith("/") || /\s/.test(v)) { menue.hidden = true; return; }
  const n = norm(v);
  menueTreffer = BEFEHLE.filter(([name]) => norm(name).startsWith(n));
  if (!menueTreffer.length) { menue.hidden = true; return; }
  menueAuswahl = Math.min(menueAuswahl, menueTreffer.length - 1);
  menue.innerHTML = menueTreffer.map(([name, b], i) =>
    `<div class="${i === menueAuswahl ? "aktiv" : ""}" data-i="${i}"><span class="name">${name}</span><span class="beschr">${b}</span></div>`).join("");
  menue.hidden = false;
}
function menueUebernehmen(ausfuehrenSofort) {
  const [name] = menueTreffer[menueAuswahl];
  menue.hidden = true;
  if (["/lektion", "/modell"].includes(name) || !ausfuehrenSofort) { eingabe.value = name + " "; eingabeHoehe(); return; }
  eingabe.value = name;
  senden();
}
menue.addEventListener("mousedown", (e) => {
  const z = e.target.closest("[data-i]");
  if (!z) return;
  e.preventDefault();
  menueAuswahl = +z.dataset.i;
  menueUebernehmen(true);
});

function senden() {
  const text = eingabe.value.trim();
  if (!text) return;
  eingabe.value = "";
  eingabeHoehe();
  menue.hidden = true;
  logUser(text);
  if (text.startsWith("/")) befehl(text);
  else agentFragen("frage", { text });
}

eingabe.addEventListener("input", () => { menueAuswahl = 0; eingabeHoehe(); menueAktualisieren(); });
$("#knopfSenden").addEventListener("click", () => { senden(); eingabe.focus(); });
eingabe.addEventListener("keydown", (e) => {
  if (!menue.hidden) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      menueAuswahl = (menueAuswahl + (e.key === "ArrowDown" ? 1 : -1) + menueTreffer.length) % menueTreffer.length;
      menueAktualisieren();
      return;
    }
    if (e.key === "Tab") { e.preventDefault(); menueUebernehmen(false); return; }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); menueUebernehmen(true); return; }
    if (e.key === "Escape") { menue.hidden = true; return; }
  }
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); senden(); }
});

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") { abbrechen(); lektionMenue(false); }
  if (e.altKey && e.key.toLowerCase() === "l") { e.preventDefault(); lektionMenue(); }
  if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && document.activeElement !== ta) {
    e.preventDefault(); e.shiftKey ? pruefen() : ausfuehren();
  }
});

/* ================================================================ Trennbalken */
function splitter(el, achse) {
  el.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.classList.add("drag");
    document.body.classList.add("ziehen");
    const box = achse === "x" ? $("#layout") : $("#right");
    const variable = achse === "x" ? "--split-x" : "--split-y";
    const bewegen = (ev) => {
      const r = box.getBoundingClientRect();
      let p = achse === "x" ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
      p = Math.min(0.85, Math.max(0.15, p));
      document.documentElement.style.setProperty(variable, (p * 100).toFixed(1) + "%");
    };
    const los = () => {
      el.removeEventListener("pointermove", bewegen);
      el.classList.remove("drag");
      document.body.classList.remove("ziehen");
      try { localStorage.setItem("ct" + variable, getComputedStyle(document.documentElement).getPropertyValue(variable).trim()); } catch {}
    };
    el.addEventListener("pointermove", bewegen);
    el.addEventListener("pointerup", los, { once: true });
  });
}
splitter($("#splitV"), "x");
splitter($("#splitH"), "y");
for (const v of ["--split-x", "--split-y"]) {
  try { const w = localStorage.getItem("ct" + v); if (w) document.documentElement.style.setProperty(v, w); } catch {}
}

/* ================================================================ Start */
function willkommen(kurz = false) {
  const n = S.fortschritt.erledigt.length;
  const el = document.createElement("div");
  el.className = "welcome";
  el.innerHTML =
    `<div class="head"><b>◆</b> Willkommen beim <b>Code-Trainer</b>!</div>` +
    (kurz ? "" : `<div class="sub">Lerne Python Schritt für Schritt – mit einem KI-Tutor, der ${B.name === "browser" ? "komplett in deinem Browser" : "lokal auf deinem Computer"} läuft.<br>` +
      `${S.lektionen.length} Lektionen · Fortschritt ${n}/${S.lektionen.length}</div>`) +
    `<div class="sub">/hilfe für Befehle · Fragen einfach eintippen</div>`;
  log.append(el);
}

function pythonLaedt() { return B.name === "browser" && !B.python.bereit; }

function laufzeitAnzeigen() {
  const info = $("#laufzeitInfo");
  if (B.name === "server") { info.textContent = "Python 3 · lokaler Server"; return; }
  const p = B.python;
  info.textContent = p.fehler ? "⚠ Python nicht geladen" : p.bereit ? `Python ${p.version} · im Browser` : "Python wird geladen …";
  info.title = p.fehler || "";
}

async function start() {
  B = await backendWaehlen();
  const lektionenLaden = fetch("lektionen.json", { cache: "no-cache" }).then((r) => {
    if (!r.ok) throw new Error("lektionen.json nicht gefunden");
    return r.json();
  });
  await B.init();
  const [lektionen, fortschritt] = await Promise.all([lektionenLaden, B.fortschrittLaden()]);
  S.lektionen = lektionen;
  S.fortschritt = fortschritt;
  if (B.name === "browser") {
    B.beiAenderung(() => { laufzeitAnzeigen(); statusLaden(); });
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
  }
  laufzeitAnzeigen();
  await statusLaden();
  willkommen();
  if (B.name === "browser" && B.python.fehler) logSystem(`<b>Python konnte nicht geladen werden.</b> <span class="dim">${esc(B.python.fehler)} – Beim ersten Start braucht der Browser eine Internetverbindung.</span>`, "⚠");
  if (!S.status.online) {
    // Browser-Version: Modellliste kommt im Hintergrund – kurz warten, dann ggf. Einschalt-Hinweis
    if (B.name === "browser" && S.status.webgpu !== false) {
      setTimeout(async () => { await statusLaden(); if (!S.status.online && !S.status.laedt) kiHinweis(); }, 1500);
    } else offlineAntwort("hinweis", {});
  }
  let nr = fortschritt.aktuell || 1;
  while (nr > 1 && !freigeschaltet(nr)) nr--;
  if (fortschritt.erledigt.length || fortschritt.code[nr]) {
    logSystem(`Willkommen zurück! Du warst bei <b>Lektion ${nr}</b>. Mit <b>/aufgabe</b> siehst du die Aufgabe, mit <b>/lektionen</b> alle Lektionen.`, "↻");
    await oeffneLektion(nr, { zeigen: false });
    nachUnten(true);
  } else {
    await oeffneLektion(nr);
  }
}

start().catch((err) => {
  log.innerHTML = `<div class="msg system"><span class="bullet">⚠</span><div class="body err">Start fehlgeschlagen: ${esc(err.message)}<br>Lade die Seite neu – beim ersten Start braucht der Browser eine Internetverbindung.</div></div>`;
});
