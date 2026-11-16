(() => {
  "use strict";

  const C = window.KALENDER || {};
  let T = {};            // Inhalte der Türchen (kommen entschlüsselt aus geheim/inhalt.enc)
  let schluessel = null; // AES-Schlüssel, abgeleitet aus dem Passwort

  const jahr = C.jahr || new Date().getFullYear();

  // Zum Testen: ?vorschau an die Adresse hängen -> alle Türchen offen,
  // nichts wird gespeichert. (Das Passwort wird trotzdem gebraucht.)
  const vorschau = new URLSearchParams(location.search).has("vorschau");

  const reduziert = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (id) => document.getElementById(id);

  /* ==KRYPTO== */
  const b64zuBytes = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  async function ableiten(passwort, meta) {
    const roh = await crypto.subtle.importKey(
      "raw", new TextEncoder().encode(passwort), "PBKDF2", false, ["deriveKey"]
    );
    return crypto.subtle.deriveKey(
      { name: "PBKDF2", salt: b64zuBytes(meta.salt), iterations: meta.iter, hash: "SHA-256" },
      roh, { name: "AES-GCM", length: 256 }, false, ["decrypt"]
    );
  }

  // Dateiformat: 12 Byte IV, danach der verschlüsselte Inhalt
  async function entschluessle(key, buf) {
    const u = new Uint8Array(buf);
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: u.slice(0, 12) }, key, u.slice(12));
  }
  /* ==/KRYPTO== */

  /* ---------- Entschlüsselte Medien laden ---------- */
  const MIME = {
    m4a: "audio/mp4", mp3: "audio/mpeg", mp4: "video/mp4", webm: "video/webm",
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif"
  };
  const cache = new Map();

  function medium(pfad) {
    if (cache.has(pfad)) return cache.get(pfad);
    const p = (async () => {
      const r = await fetch(`geheim/${pfad}.enc`);
      if (!r.ok) throw new Error("nicht gefunden");
      const klar = await entschluessle(schluessel, await r.arrayBuffer());
      const ende = pfad.split(".").pop().toLowerCase();
      return URL.createObjectURL(new Blob([klar], { type: MIME[ende] || "application/octet-stream" }));
    })();
    cache.set(pfad, p);
    p.catch(() => cache.delete(pfad));
    return p;
  }

  /* ---------- Merken, was schon geöffnet / angehört wurde ---------- */
  const KEY_OFFEN = `advent-${jahr}-offen`;
  const KEY_GEHOERT = `advent-${jahr}-gehoert`;
  const KEY_PW = "advent-passwort";

  function lade(key) {
    try { return new Set(JSON.parse(localStorage.getItem(key) || "[]")); }
    catch { return new Set(); }
  }
  function speichere(key, set) {
    if (vorschau) return;
    try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* egal */ }
  }
  const offen = vorschau ? new Set() : lade(KEY_OFFEN);
  const gehoert = vorschau ? new Set() : lade(KEY_GEHOERT);

  /* ---------- Datum ---------- */
  const freigabe = (n) => new Date(jahr, 11, n, 0, 0, 0);
  const istFrei = (n) => vorschau || new Date() >= freigabe(n);
  const istHeute = (n) => {
    const d = new Date();
    return d.getFullYear() === jahr && d.getMonth() === 11 && d.getDate() === n;
  };

  /* ---------- Kopf ---------- */
  document.title = C.titel || "Adventskalender";
  $("titel").textContent = C.titel || "Adventskalender";
  $("untertitel").textContent = C.untertitel || "";
  $("untertitel").hidden = !C.untertitel;
  $("tor-text").textContent = C.torText || "";
  $("tor-text").hidden = !C.torText;

  /* ---------- Passwort-Tor ---------- */
  async function entsperre(passwort) {
    if (!window.crypto || !crypto.subtle) {
      throw new Error("Diese Seite muss über https geöffnet werden.");
    }
    const metaAntwort = await fetch("geheim/meta.json", { cache: "no-cache" });
    if (!metaAntwort.ok) throw new Error("Die verschlüsselten Inhalte wurden nicht gefunden.");
    const meta = await metaAntwort.json();
    const key = await ableiten(passwort, meta);

    const inhaltAntwort = await fetch("geheim/inhalt.enc", { cache: "no-cache" });
    if (!inhaltAntwort.ok) throw new Error("Die verschlüsselten Inhalte wurden nicht gefunden.");
    const klar = await entschluessle(key, await inhaltAntwort.arrayBuffer()); // wirft bei falschem Passwort
    T = JSON.parse(new TextDecoder().decode(klar));
    schluessel = key;
  }

  async function versuche(passwort, still) {
    const btn = $("tor-btn");
    const fehler = $("tor-fehler");
    btn.disabled = true;
    fehler.textContent = "";
    if (!still) btn.textContent = "Wird geprüft …";
    try {
      await entsperre(passwort);
    } catch (e) {
      btn.disabled = false;
      btn.textContent = "Kalender öffnen";
      if (e && e.name === "OperationError") {
        fehler.textContent = still ? "" : "Das Passwort stimmt nicht.";
        try { localStorage.removeItem(KEY_PW); } catch { /* egal */ }
      } else {
        fehler.textContent = (e && e.message) || "Die Inhalte konnten nicht geladen werden.";
      }
      return;
    }
    try {
      if ($("merken").checked) localStorage.setItem(KEY_PW, passwort);
      else localStorage.removeItem(KEY_PW);
    } catch { /* egal */ }
    starteKalender();
  }

  $("tor-form").addEventListener("submit", (e) => {
    e.preventDefault();
    versuche($("pw").value, false);
  });

  /* ---------- Kalender ---------- */
  const tueren = new Map();

  function starteKalender() {
    $("tor").hidden = true;
    $("bereich").hidden = false;
    $("fuss").textContent = C.fuss || "";
    $("fuss").hidden = !C.fuss;

    const reihenfolge =
      Array.isArray(C.reihenfolge) && C.reihenfolge.length === 24
        ? C.reihenfolge
        : Array.from({ length: 24 }, (_, i) => i + 1);

    const liste = $("kalender");
    reihenfolge.forEach((n) => {
      const li = document.createElement("li");
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tuer";
      b.innerHTML =
        `<span class="licht"><span class="nr">${n}</span></span>` +
        `<span class="blatt"><span class="nr">${n}</span></span>`;
      b.addEventListener("click", () => klick(n, b));
      li.append(b);
      liste.append(li);
      tueren.set(n, b);
    });

    aktualisiere();
    setInterval(aktualisiere, 60 * 1000); // falls die Seite über Mitternacht offen bleibt
  }

  function aktualisiere() {
    tueren.forEach((b, n) => {
      const frei = istFrei(n);
      b.classList.toggle("gesperrt", !frei);
      b.classList.toggle("heute", frei && istHeute(n));
      b.classList.toggle("offen", frei && offen.has(n));
      b.setAttribute("aria-disabled", String(!frei));
      b.setAttribute(
        "aria-label",
        frei ? `Türchen ${n} öffnen` : `Türchen ${n}, öffnet sich am ${n}. Dezember`
      );
    });
  }

  /* ---------- Hinweis (Toast) ---------- */
  let hinweisTimer;
  function hinweis(text) {
    const el = $("hinweis");
    el.textContent = text;
    el.classList.add("sichtbar");
    clearTimeout(hinweisTimer);
    hinweisTimer = setTimeout(() => el.classList.remove("sichtbar"), 2800);
  }

  /* ---------- Klick auf ein Türchen ---------- */
  function klick(n, b) {
    if (!istFrei(n)) {
      hinweis(`Türchen ${n} öffnet sich am ${n}. Dezember.`);
      b.classList.remove("wackeln");
      void b.offsetWidth; // Animation neu starten
      b.classList.add("wackeln");
      return;
    }
    const neu = !offen.has(n);
    if (neu) {
      offen.add(n);
      speichere(KEY_OFFEN, offen);
      aktualisiere();
    }
    setTimeout(() => zeigeAudio(n), neu && !reduziert ? 450 : 0);
  }

  /* ---------- Fenster 1: Audio ---------- */
  const dlgAudio = $("tuerchen-dialog");
  const dlgLoesung = $("aufloesung-dialog");
  const player = $("player");
  const btnLoesung = $("aufloesung-btn");
  const status = $("audio-status");
  let aktuell = null;
  let tokenAudio = 0;
  let tokenLoesung = 0;

  function loesungBereit(bereit, text = "") {
    btnLoesung.disabled = !bereit;
    status.textContent = text;
  }

  async function zeigeAudio(n) {
    const d = T[n] || {};
    aktuell = n;
    const mein = ++tokenAudio;

    $("tuerchen-tag").textContent = `${n}. Dezember`;
    $("tuerchen-ueberschrift").textContent = d.titel || `Türchen ${n}`;
    $("tuerchen-intro").textContent = C.audioHinweis || "";
    $("tuerchen-intro").hidden = !C.audioHinweis;

    player.pause();
    player.removeAttribute("src");
    player.load();

    const sperren = C.aufloesungErstNachDemHoeren !== false && !gehoert.has(n);
    const wartetext = sperren ? "Die Auflösung gibt es nach dem Anhören." : "";

    dlgAudio.showModal();

    if (!d.audio) {
      player.hidden = true;
      loesungBereit(true, "Für dieses Türchen fehlt noch die Aufnahme.");
      return;
    }

    player.hidden = false;
    loesungBereit(!sperren, "Aufnahme wird geladen …");
    try {
      const url = await medium(d.audio);
      if (mein !== tokenAudio) return;
      player.src = url;
      loesungBereit(!sperren, wartetext);
    } catch {
      if (mein !== tokenAudio) return;
      loesungBereit(true, "Die Aufnahme konnte nicht geladen werden.");
    }
  }

  function alsGehoertMerken() {
    if (aktuell === null) return;
    gehoert.add(aktuell);
    speichere(KEY_GEHOERT, gehoert);
    loesungBereit(true);
  }

  player.addEventListener("ended", alsGehoertMerken);
  player.addEventListener("timeupdate", () => {
    // Auch freischalten, wenn fast bis zum Ende gehört wurde
    if (player.duration && player.currentTime / player.duration >= 0.9) alsGehoertMerken();
  });
  player.addEventListener("error", () => {
    if (!player.getAttribute("src")) return;
    loesungBereit(true, "Die Aufnahme konnte nicht geladen werden.");
  });

  dlgAudio.addEventListener("close", () => {
    tokenAudio++;
    player.pause();
  });

  /* ---------- Fenster 2: Auflösung ---------- */
  const medien = $("medien");

  function meldung(text) {
    medien.replaceChildren();
    const p = document.createElement("p");
    p.className = "fehler";
    p.textContent = text;
    medien.append(p);
  }

  btnLoesung.addEventListener("click", async () => {
    const n = aktuell;
    const d = T[n] || {};
    const mein = ++tokenLoesung;
    player.pause();

    $("aufloesung-ueberschrift").textContent = `Auflösung zu Türchen ${n}`;
    $("aufloesung-text").textContent = d.text || "";
    medien.replaceChildren();
    medien.hidden = !d.datei;
    if (d.datei) meldung("Wird geladen …");

    dlgLoesung.showModal();
    if (!d.datei) return;

    try {
      const url = await medium(d.datei);
      if (mein !== tokenLoesung) return;

      if (d.typ === "video") {
        const v = document.createElement("video");
        v.controls = true;
        v.playsInline = true;
        v.preload = "metadata";
        if (d.poster) {
          try { v.poster = await medium(d.poster); } catch { /* ohne Vorschaubild */ }
          if (mein !== tokenLoesung) return;
        }
        v.src = url;
        v.addEventListener("error", () => meldung("Das Video konnte nicht abgespielt werden."));
        medien.replaceChildren(v);
      } else {
        const img = document.createElement("img");
        img.alt = d.alt || "";
        img.src = url;
        img.addEventListener("error", () => meldung("Das Foto konnte nicht angezeigt werden."));
        medien.replaceChildren(img);
      }
    } catch {
      if (mein !== tokenLoesung) return;
      meldung("Die Datei konnte nicht geladen werden.");
    }
  });

  dlgLoesung.addEventListener("close", () => {
    tokenLoesung++;
    medien.replaceChildren(); // stoppt das Video
  });

  /* ---------- Schließen: Kreuz & Klick daneben ---------- */
  document.querySelectorAll("[data-close]").forEach((btn) =>
    btn.addEventListener("click", () => btn.closest("dialog").close())
  );
  [dlgAudio, dlgLoesung].forEach((dlg) =>
    dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close(); })
  );

  /* ---------- Gespeichertes Passwort automatisch versuchen ---------- */
  let gespeichert = null;
  try { gespeichert = localStorage.getItem(KEY_PW); } catch { /* egal */ }
  if (gespeichert) versuche(gespeichert, true);
})();
