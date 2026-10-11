/*
 * Worker Cloudflare de K2GPX.
 *
 * - /api/tour/<id>/<share_token> : récupère auprès de Komoot le nom, la distance,
 *   le dénivelé et les points de la sortie, et les renvoie en un seul appel.
 *   Seule l'API des sorties Komoot est contactée ; aucun en-tête CORS n'est
 *   ajouté, donc seule la page servie par ce Worker peut l'utiliser depuis un
 *   navigateur.
 * - tout le reste : les fichiers du site (index.html, app.js…), voir wrangler.jsonc.
 */

const KOMOOT = "https://www.komoot.com/api/v007/tours/";

function json(body, status = 200, extra = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extra },
  });
}

function komoot(path, token) {
  const qs = token ? "?share_token=" + encodeURIComponent(token) : "";
  return fetch(KOMOOT + path + qs, {
    headers: {
      Accept: "application/hal+json, application/json",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; K2GPX; +https://github.com/VictorDomejean/K2GPX)",
    },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
}

async function tour(id, token) {
  let infoRes, coordRes;
  try {
    [infoRes, coordRes] = await Promise.all([komoot(id, token), komoot(id + "/coordinates", token)]);
  } catch {
    return json({ status: 502, message: "Komoot injoignable" }, 502);
  }

  // En cas de refus (403 sans share_token, 404…), on renvoie le code de Komoot
  for (const r of [infoRes, coordRes]) {
    if (!r.ok) return json(await r.text(), r.status);
  }

  const info = await infoRes.json();
  const coords = await coordRes.json();
  return json(
    {
      id: info.id,
      name: info.name,
      distance: info.distance,
      elevation_up: info.elevation_up,
      items: (coords.items || []).map((p) => ({ lat: p.lat, lng: p.lng, alt: p.alt })),
    },
    200,
    { "Cache-Control": "private, max-age=300" }
  );
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "GET") return json({ message: "Méthode non autorisée" }, 405);
      const m = url.pathname.match(/^\/api\/tour\/(\d+)(?:\/([A-Za-z0-9_-]+))?\/?$/);
      if (!m) return json({ message: "Introuvable" }, 404);
      return tour(m[1], m[2]);
    }

    return env.ASSETS.fetch(request);
  },
};
