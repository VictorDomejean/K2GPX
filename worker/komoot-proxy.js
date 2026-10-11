/*
 * Worker Cloudflare de K2GPX.
 *
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const target = url.searchParams.get("url");

    // Diagnostic : /debug?url=… renvoie toujours 200 avec le code et le début de la réponse de Komoot
    if (url.pathname === "/debug" && target && TARGET.test(target)) {
      const out = {};
      for (const t of [target, target.replace("komoot.com", "komoot.fr"), target.replace("komoot.com", "komoot.de")]) {
        try {
          const r = await fetch(t, { headers: { Accept: "application/hal+json, application/json" }, redirect: "manual" });
          out[t] = { status: r.status, location: r.headers.get("location"), server: r.headers.get("server"), body: (await r.text()).slice(0, 300) };
        } catch (err) {
          out[t] = { error: String(err) };
        }
      }
      return new Response(JSON.stringify(out, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8" } });
    }

    if (url.pathname.startsWith("/api") || target) {
      return proxy(request, target || "");
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response("Relais K2GPX actif. Utilisation : /api?url=<adresse de l'API Komoot>", {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};
