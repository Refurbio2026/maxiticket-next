// Na ktorej adrese sme — hlavný obchod, alebo obchod jedného organizátora.
//
// Hlavička `Host` je serverová vec, prehliadač si ju musí vyžiadať; preto jedna
// serverová funkcia a jeden dopyt na celé načítanie stránky. Odpoveď sa počas
// života stránky nemení, takže sa už neobnovuje.
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getSubdomainContext, type KontextSubdomeny } from "@/lib/subdomena.server";

export type { KontextSubdomeny };

export function useSubdomena() {
  const fn = useServerFn(getSubdomainContext);
  return useQuery({
    queryKey: ["subdomena"],
    queryFn: (): Promise<KontextSubdomeny> => fn({ data: undefined as never }),
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });
}
