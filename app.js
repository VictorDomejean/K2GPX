"use strict";

/*
 * K2GPX — Komoot vers GPX.
 *
 * 1. On lit le numéro de la sortie et son share_token dans le lien collé.
 * 2. Le Worker Cloudflare (worker/komoot-proxy.js), sur la même adresse que la
 *    page, récupère le nom et les points auprès de Komoot.
 * 3. Le fichier GPX est fabriqué dans le navigateur.
 */

const $ = (id) => document.getElementById(id);
const form = $("form");
const input = $("link");
const submitBtn = $("submitBtn");
const statusEl = $("status");
const result = $("result");

let blobUrl = null;

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

const NO_TOKEN_MSG =
  "Komoot n'ouvre la trace qu'avec le lien de partage. Dans Komoot, touchez Partager puis Copier le lien, et collez ce lien complet (il contient share_token).";

async function loadTour({ id, token }) {
  let res;
  try {
    res = await fetch(`/api/tour/${id}${token ? "/" + encodeURIComponent(token) : ""}`, {
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new UserError("Pas de connexion. Vérifiez votre réseau et réessayez.");
  }

  if (res.status === 404) throw new UserError("Sortie introuvable. Vérifiez le lien, elle a peut-être été supprimée.");
  if (res.status === 401 || res.status === 403) {
    throw new UserError(
      token
        ? "Komoot refuse l'accès à cette sortie : elle est peut-être redevenue privée, ou le lien de partage a expiré."
        : NO_TOKEN_MSG
    );
  }
  if (!res.ok) throw new UserError("Impossible de joindre Komoot pour le moment. Réessayez dans quelques minutes.");

  const data = await res.json();
  return toTour(id, data, data.items);
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
<gpx version="1.1" creator="K2GPX" xmlns="http://www.topografix.com/GPX/1/1"
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
  if (blobUrl) URL.revokeObjectURL(blobUrl);
  blobUrl = URL.createObjectURL(new Blob([gpx], { type: "application/gpx+xml" }));

  $("tourName").textContent = tour.name;
  $("statDist").textContent = fmtKm.format(tour.distance / 1000) + " km";
  $("statUp").textContent = fmtInt.format(tour.up) + " m";
  $("statPts").textContent = fmtInt.format(tour.points.length);

  const dl = $("downloadBtn");
  dl.href = blobUrl;
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
