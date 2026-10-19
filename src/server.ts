import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { jeOdpojenyKlient } from "./lib/odpojeny-klient";
import { pridajBezpecnostneHlavicky } from "./lib/bezpecnostne-hlavicky";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!body.includes('"unhandled":true') || !body.includes('"message":"HTTPError"')) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      // Hlavičky sa pridávajú tu, na jedinom mieste, kadiaľ prejde každá
      // odpoveď aplikácie — vrátane chybových stránok nižšie.
      return pridajBezpecnostneHlavicky(await normalizeCatastrophicSsrResponse(response), request);
    } catch (error) {
      if (jeOdpojenyKlient(error)) {
        // Odpovedať sa nekomu — klient je dávno inde. 499 je nginxov zvyk pre
        // „spojenie zavrel klient", takže to bude vidieť v access logu
        // a nie medzi chybami aplikácie.
        return new Response(null, { status: 499 });
      }
      console.error(error);
      return pridajBezpecnostneHlavicky(
        new Response(renderErrorPage(), {
          status: 500,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
        request,
      );
    }
  },
};
