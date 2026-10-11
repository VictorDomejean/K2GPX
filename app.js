"use strict";

/*
 * Komoot vers GPX — tout se passe dans le navigateur.
 *
 * 1. On lit le numéro de la sortie (et le share_token éventuel) dans le lien collé.
 * 2. On interroge l'API de Komoot pour obtenir le nom et les points.
 * 3. On fabrique le fichier GPX localement.
 *
 * Komoot n'autorise pas les appels venant d'autres sites (CORS) : la page passe
 * donc par le relais Cloudflare du dossier worker/ (OWN_PROXY). S'il ne répond
 * pas, des relais publics gratuits sont essayés l'un après l'autre.
 */

const API = "https://www.komoot.com/api/v007/tours/";

// Adresse du relais Cloudflare (dossier worker/). Si la page est elle-même servie
// par ce Worker, le relais est sur la même adresse.
const OWN_PROXY = location.hostname.endsWith(".workers.dev")
  ? location.origin
  : "https://k2gpx.victor-domejean.workers.dev";

const enc = encodeURIComponent;

/*
 * Chaque relais renvoie { status, text } : le code HTTP de Komoot et le contenu.
 * « fiable » = le relais transmet le vrai code de Komoot. Un refus venant d'un
 * relais non fiable peut être le relais lui-même : on passe alors au suivant.
 */
const RELAYS = [
  { name: "direct", reliable: true, get: (url) => plain(url) },
  {
    name: "allorigins",
    reliable: true,
    get: async (url) => {
      const res = await fetch("https://api.allorigins.win/get?url=" + enc(url), { cache: "no-store" });
      if (!res.ok) return { status: 0, text: "" };
      const j = await res.json();
      return { status: j?.status?.http_code ?? 0, text: j?.contents ?? "" };
    },
  },
  { name: "codetabs", reliable: false, get: (url) => plain("https://api.codetabs.com/v1/proxy/?quest=" + enc(url)) },
  { name: "corsproxy", reliable: false, get: (url) => plain("https://corsproxy.io/?url=" + enc(url)) },
];

async function plain(url) {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  return { status: res.status, text: await res.text() };
}

let workingRelay = 0; // on mémorise le premier relais qui a fonctionné

const $ = (id) => document.getElementById(id);
const form = $("form");
const input = $("link");
const submitBtn = $("submitBtn");
const statusEl = $("status");
const result = $("result");

let current = null; // { name, gpx, filename, blobUrl }

/* ---------- Lecture du lien ---------- */

function parseLink(text) {
  const raw = (text || "").trim();
  if (!raw) throw new UserError("Collez d'abord le lien d'une sortie Komoot.");

  // Un simple numéro de sortie
  if (/^\d{4,}$/.test(raw)) return { id: raw, token: null };

  // Le lien peut être noyé dans un message de partage : on prend la première URL
  const match = raw.match(/https?:\/\/\S+/i);
  if (!match) throw new UserError("Ce texte ne contient pas de lien. Collez l'adresse complète de la sortie.");

  let url;
  try {
    url = new URL(match[0]);
  } catch {
    throw new UserError("Ce lien n'est pas valide.");
  }

  if (!/(^|\.)komoot\.(com|de|fr|nl|it|es)$/i.test(url.hostname)) {
    throw new UserError("Ce lien ne vient pas de Komoot.");
  }

  const idMatch = url.pathname.match(/\/(?:tour|smarttour)\/(\d+)/);
  if (!idMatch) {
    throw new UserError(
      "Ce lien ne pointe pas vers une sortie. Ouvrez-le dans le navigateur, puis copiez l'adresse qui contient /tour/."
    );
  }

  return { id: idMatch[1], token: url.searchParams.get("share_token") };
}

/* ---------- Appels à Komoot ---------- */

class UserError extends Error {}

async function fetchJson(url) {
  let refused = null; // code de refus transmis par un relais fiable

  for (let i = workingRelay; i < RELAYS.length; i++) {
    const relay = RELAYS[i];
    let r;
    try {
      r = await relay.get(url);
    } catch (err) {
      console.info(`[${relay.name}] injoignable ou bloqué`, err);
      continue;
    }

    if (r.status >= 200 && r.status < 300) {
      try {
        const data = JSON.parse(r.text);
        workingRelay = i;
        return data;
      } catch {
        console.info(`[${relay.name}] réponse illisible`);
        continue;
      }
    }

    console.info(`[${relay.name}] HTTP ${r.status}`);
    if (relay.reliable && [401, 403, 404].includes(r.status)) refused = r.status;
  }

  if (refused === 404) {
    throw new UserError("Sortie introuvable. Vérifiez le lien, elle a peut-être été supprimée.");
  }
  if (refused) {
    throw new UserError(NO_TOKEN_MSG);
  }
  throw new UserError(
    "Impossible de joindre Komoot pour le moment. Réessayez dans quelques minutes."
  );
}

const NO_TOKEN_MSG =
  "Komoot n'ouvre la trace qu'avec le lien de partage. Dans Komoot, touchez Partager puis Copier le lien, et collez ce lien complet (il contient share_token).";

// Relais Cloudflare : nom, distance, dénivelé et points en un seul appel.
// Renvoie null si le relais ne répond pas, pour passer aux relais publics.
async function loadFromOwnProxy(id, token) {
  let res;
  try {
    res = await fetch(`${OWN_PROXY}/api/tour/${id}${token ? "/" + encodeURIComponent(token) : ""}`, {
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    console.info("[relais Cloudflare] injoignable", err);
    return null;
  }
  if (res.ok) return res.json();
  if (res.status === 404) throw new UserError("Sortie introuvable. Vérifiez le lien, elle a peut-être été supprimée.");
  if (res.status === 401 || res.status === 403) {
    throw new UserError(token ? "Komoot refuse l'accès à cette sortie : elle est peut-être redevenue privée, ou le lien de partage a expiré." : NO_TOKEN_MSG);
  }
  console.info("[relais Cloudflare] HTTP " + res.status);
  return null;
}

async function loadTour({ id, token }) {
  const fast = await loadFromOwnProxy(id, token);
  if (fast) return toTour(id, fast, fast.items);

  const qs = new URLSearchParams({ _embedded: "coordinates" });
  if (token) qs.set("share_token", token);

  const tour = await fetchJson(API + id + "?" + qs);

  let items = tour?._embedded?.coordinates?.items;
  if (!Array.isArray(items) || items.length === 0) {
    const qs2 = token ? "?share_token=" + encodeURIComponent(token) : "";
    const coords = await fetchJson(API + id + "/coordinates" + qs2);
    items = coords?.items;
  }
  return toTour(id, tour, items);
}

function toTour(id, tour, items) {
  if (!Array.isArray(items) || items.length < 2) {
    throw new UserError("Cette sortie ne contient pas de tracé exploitable.");
  }

  const points = items
    .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng))
    .map((p) => ({ lat: p.lat, lng: p.lng, alt: Number.isFinite(p.alt) ? p.alt : null }));

  return {
    id,
    name: (tour?.name || "Sortie Komoot " + id).trim(),
    distance: Number.isFinite(tour?.distance) ? tour.distance : pathLength(points),
    up: Number.isFinite(tour?.elevation_up) ? tour.elevation_up : elevationGain(points),
    points,
  };
}

/* ---------- Calculs ---------- */

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function pathLength(points) {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += haversine(points[i - 1], points[i]);
  return d;
}

function elevationGain(points) {
  let up = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1].alt, b = points[i].alt;
    if (a != null && b != null && b > a) up += b - a;
  }
  return up;
}

/* ---------- Fabrication du GPX ---------- */

function escapeXml(s) {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]);
}

function buildGpx(tour) {
  const name = escapeXml(tour.name);
  const link = "https://www.komoot.com/tour/" + tour.id;
  const pts = tour.points
    .map((p) => {
      const ele = p.alt != null ? `<ele>${round(p.alt, 1)}</ele>` : "";
      return `      <trkpt lat="${p.lat}" lon="${p.lng}">${ele}</trkpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Komoot vers GPX" xmlns="http://www.topografix.com/GPX/1/1"
     xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
     xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd">
  <metadata>
    <name>${name}</name>
    <link href="${link}"><text>Komoot</text></link>
  </metadata>
  <trk>
    <name>${name}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

function round(n, d) {
  const f = 10 ** d;
  return Math.round(n * f) / f;
}

function slugify(s) {
  return (
    s
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "sortie-komoot"
  );
}

/* ---------- Aperçu du tracé ---------- */

function drawTrace(points) {
  const svg = $("trace");
  const W = 320, H = 200, PAD = 18;

  // Projection simple : longitude corrigée par le cosinus de la latitude
  const midLat = points.reduce((s, p) => s + p.lat, 0) / points.length;
  const k = Math.cos((midLat * Math.PI) / 180);
  const xy = points.map((p) => [p.lng * k, -p.lat]);

  const xs = xy.map((p) => p[0]), ys = xy.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((W - 2 * PAD) / (maxX - minX || 1), (H - 2 * PAD) / (maxY - minY || 1));
  const offX = (W - (maxX - minX) * scale) / 2;
  const offY = (H - (maxY - minY) * scale) / 2;

  const step = Math.max(1, Math.floor(xy.length / 800));
  const pts = xy.filter((_, i) => i % step === 0 || i === xy.length - 1)
    .map(([x, y]) => [round(offX + (x - minX) * scale, 1), round(offY + (y - minY) * scale, 1)]);

  const d = "M" + pts.map((p) => p.join(",")).join("L");
  const [sx, sy] = pts[0];
  const [ex, ey] = pts[pts.length - 1];
  const loop = Math.hypot(ex - sx, ey - sy) < 4;

  svg.classList.remove("draw");
  svg.innerHTML = `
    <path class="route-casing" d="${d}"/>
    <path class="route" d="${d}"/>
    ${loop ? "" : `<circle class="end" cx="${ex}" cy="${ey}" r="5"/>`}
    <circle class="start" cx="${sx}" cy="${sy}" r="5.5"/>`;

  const route = svg.querySelector(".route");
  const len = route.getTotalLength();
  route.style.strokeDasharray = len;
  route.style.strokeDashoffset = matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : len;
  void svg.getBoundingClientRect();
  svg.classList.add("draw");
}

/* ---------- Interface ---------- */

const fmtKm = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
const fmtInt = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function showResult(tour) {
  const gpx = buildGpx(tour);
  const filename = slugify(tour.name) + ".gpx";
  if (current?.blobUrl) URL.revokeObjectURL(current.blobUrl);
  const blob = new Blob([gpx], { type: "application/gpx+xml" });
  current = { name: tour.name, gpx, filename, blobUrl: URL.createObjectURL(blob) };

  $("tourName").textContent = tour.name;
  $("statDist").textContent = fmtKm.format(tour.distance / 1000) + " km";
  $("statUp").textContent = fmtInt.format(tour.up) + " m";
  $("statPts").textContent = fmtInt.format(tour.points.length);

  const dl = $("downloadBtn");
  dl.href = current.blobUrl;
  dl.download = filename;

  result.hidden = false;
  drawTrace(tour.points);
  setStatus("");
  result.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  let ref;
  try {
    ref = parseLink(input.value);
  } catch (err) {
    setStatus(err.message, true);
    input.focus();
    return;
  }

  submitBtn.disabled = true;
  submitBtn.textContent = "Récupération…";
  setStatus("Lecture de la sortie sur Komoot…");
  try {
    showResult(await loadTour(ref));
  } catch (err) {
    result.hidden = true;
    setStatus(err instanceof UserError ? err.message : "Une erreur inattendue est survenue.", true);
    if (!(err instanceof UserError)) console.error(err);
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Récupérer la trace";
  }
});

// « Ouvrir le GPX » : sur mobile, ouvre le menu de partage pour choisir
// Garmin Connect, Strava, OsmAnd… ; sinon, affiche le fichier dans un nouvel onglet.
$("openBtn").addEventListener("click", async () => {
  if (!current) return;
  const file = new File([current.gpx], current.filename, { type: "application/gpx+xml" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: current.name });
      return;
    } catch (err) {
      if (err.name === "AbortError") return;
    }
  }
  window.open(current.blobUrl, "_blank", "noopener");
});

// Bouton « Coller » quand le navigateur autorise la lecture du presse-papiers
if (navigator.clipboard?.readText) {
  const pasteBtn = $("pasteBtn");
  pasteBtn.hidden = false;
  pasteBtn.addEventListener("click", async () => {
    try {
      input.value = (await navigator.clipboard.readText()).trim();
      input.focus();
      if (input.value) form.requestSubmit();
    } catch {
      setStatus("Le navigateur a refusé l'accès au presse-papiers. Collez le lien à la main.", true);
    }
  });
}

// Lancement direct avec ?url=… dans l'adresse de la page
const preset = new URLSearchParams(location.search).get("url");
if (preset) {
  input.value = preset;
  form.requestSubmit();
}
