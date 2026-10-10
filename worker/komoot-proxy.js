/*
 * Relais Cloudflare Worker pour K2GPX.
 *
 * Il relaie uniquement les appels vers l'API des sorties Komoot et ajoute
 * l'en-tête CORS qui permet à la page GitHub Pages de lire la réponse.
 * Ce n'est pas un relais ouvert : toute autre adresse est refusée.
 *
 * Usage : https://<votre-worker>.workers.dev/?url=https://www.komoot.com/api/v007/tours/...
 */

// Origines autorisées à utiliser le relais ("*" pour toutes)
const ALLOWED_ORIGINS = ["https://victordomejean.github.io", "http://localhost:8000"];

const TARGET = /^https:\/\/www\.komoot\.(com|fr|de)\/api\/v007\/tours\/\d+(\/coordinates)?(\?.*)?$/;

function cors(origin) {
  const allowed = ALLOWED_ORIGINS.includes("*") || ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": allowed ? origin || "*" : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Accept",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

export default {
  async fetch(request) {
    const origin = request.headers.get("Origin") || "";
    const headers = cors(origin);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "GET") return new Response("Méthode non autorisée", { status: 405, headers });

    const target = new URL(request.url).searchParams.get("url") || "";
    if (!TARGET.test(target)) {
      return new Response("Adresse non autorisée", { status: 400, headers });
    }

    const upstream = await fetch(target, {
      headers: { Accept: "application/json", "User-Agent": "K2GPX (+https://github.com/VictorDomejean/K2GPX)" },
      cf: { cacheTtl: 300, cacheEverything: true },
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...headers, "Content-Type": upstream.headers.get("Content-Type") || "application/json" },
    });
  },
};
