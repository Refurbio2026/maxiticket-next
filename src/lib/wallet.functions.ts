import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { buildGoogleWalletSaveLink, type WalletLinkResult } from "./google-wallet.server";

// Server function: build a signed "Add to Google Wallet" link for one ticket.
// The heavy lifting (env read + RS256 signing) lives in google-wallet.server.ts
// so it is tree-shaken from the client bundle. Returns a structured result the
// button can act on: { ok: true, url } → open the link; { ok: false, message }
// → show a toast.
export const getGoogleWalletSaveLink = createServerFn({ method: "POST" })
  .inputValidator(
    z.object({
      ticketId: z.string().min(1),
      qrValue: z.string().min(1),
      eventTitle: z.string().min(1),
      eventDateISO: z.string().optional(),
      venue: z.string().optional(),
      city: z.string().optional(),
      seatLabel: z.string().optional(),
      holderName: z.string().optional(),
      originUrl: z.string().optional(),
    }),
  )
  .handler(async ({ data }): Promise<WalletLinkResult> => {
    return buildGoogleWalletSaveLink(data);
  });
