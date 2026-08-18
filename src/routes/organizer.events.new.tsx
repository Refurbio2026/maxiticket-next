// Zakladanie podujatia beží v tom istom formulári ako úprava — organizátor mal
// dovtedy vlastnú, chudobnejšiu stránku bez typu predaja, sály a cien zón, takže
// polia, ktoré tu nevyplnil, potom nemal kde doplniť.
//
// Cesta ostáva, lebo na ňu vedie bočné menu, dashboard aj pokladňa; len
// presmerúva na zoznam, kde sa formulár otvorí prázdny.
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/organizer/events/new")({
  beforeLoad: () => {
    throw redirect({ to: "/organizer/events", search: { new: true }, replace: true });
  },
});
