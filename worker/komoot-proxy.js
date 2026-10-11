/*
 * Worker Cloudflare de K2GPX.
 *
 * - /api/tour/<id>/<share_token>  renvoie le nom, la distance, le dénivelé et
 *               les points de la sortie en un seul appel (utilisé par la page).
 * - /api?url=…  relaie l'appel vers l'API des sorties Komoot et ajoute l'en-tête
 *               CORS qui permet à la page (GitHub Pages ou workers.dev) de lire
 *               la réponse. Ce n'est pas un relais ouvert : seule l'API des
 *               sorties Komoot est acceptée.
 * - le reste    sert les fichiers du site (index.html, app.js…) quand le Worker
 *               est déployé avec wrangler.jsonc. Sans fichiers, il ne fait que relais.
 */

// Origines autorisées à appeler le relais depuis un autre site
const ALLOWED_ORIGINS = [
  "https://victordomejean.github.io",
  "http://localhost:8000",
];

const TARGET = /^https:\/\/www\.komoot\.(com|fr|de)\/api\/v007\/tours\/\d+(\/coordinates)?(\?.*)?$/;

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

async function proxy(request, target) {
  const headers = corsHeaders(request.headers.get("Origin") || "");

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "GET") return new Response("Méthode non autorisée", { status: 405, headers });
  if (!TARGET.test(target)) return new Response("Adresse non autorisée", { status: 400, headers });

  let upstream;
  try {
    upstream = await fetch(target, {
      headers: {
        Accept: "application/hal+json, application/json",
        "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        "User-Agent": "Mozilla/5.0 (compatible; K2GPX; +https://github.com/VictorDomejean/K2GPX)",
      },
      cf: { cacheTtl: 300, cacheEverything: true },
    });
  } catch (err) {
    return new Response("Komoot injoignable : " + err, { status: 502, headers });
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      ...headers,
      "Content-Type": upstream.headers.get("Content-Type") || "application/json",
      "Cache-Control": "public, max-age=300",
    },
  });
}

async function komoot(path, token) {
  const qs = token ? "?share_token=" + encodeURIComponent(token) : "";
  return fetch("https://www.komoot.com/api/v007/tours/" + path + qs, {
    headers: {
      Accept: "application/hal+json, application/json",
      "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
      "User-Agent": "Mozilla/5.0 (compatible; K2GPX; +https://github.com/VictorDomejean/K2GPX)",
    },
    cf: { cacheTtl: 300, cacheEverything: true },
  });
}

async function tour(request, id, token) {
  const headers = { ...corsHeaders(request.headers.get("Origin") || ""), "Content-Type": "application/json; charset=utf-8" };
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });

  let infoRes, coordRes;
  try {
    [infoRes, coordRes] = await Promise.all([komoot(id, token), komoot(id + "/coordinates", token)]);
  } catch (err) {
    return new Response(JSON.stringify({ status: 502, message: "Komoot injoignable" }), { status: 502, headers });
  }

  // En cas de refus, on renvoie la réponse de Komoot telle quelle (403, 404…)
  for (const r of [infoRes, coordRes]) {
    if (!r.ok) return new Response(r.body, { status: r.status, headers });
  }

  const info = await infoRes.json();
  const coords = await coordRes.json();
  const body = {
    id: info.id,
    name: info.name,
    sport: info.sport,
    distance: info.distance,
    elevation_up: info.elevation_up,
    elevation_down: info.elevation_down,
    items: (coords.items || []).map((p) => ({ lat: p.lat, lng: p.lng, alt: p.alt })),
  };
  return new Response(JSON.stringify(body), {
    headers: { ...headers, "Cache-Control": "public, max-age=300" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = url.searchParams.get("url");

    // /api/tour/<id>[/<share_token>] : nom, distance, dénivelé et points en un seul appel
    const m = url.pathname.match(/^\/api\/tour\/(\d+)(?:\/([A-Za-z0-9_-]+))?\/?$/);
    if (m) return tour(request, m[1], m[2]);

    if (url.pathname.startsWith("/api") || target) {
      return proxy(request, target || "");
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Relais K2GPX actif. Utilisation : /api?url=<adresse de l'API Komoot>", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
