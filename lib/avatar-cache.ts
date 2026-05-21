// Module-level cache: survives React re-renders and client-side navigation.
// Each WCA ID is fetched at most once per browser session.
const cache = new Map<string, string | null>();
const inflight = new Map<string, Promise<string | null>>();

export async function getAvatarUrl(wcaId: string): Promise<string | null> {
  if (cache.has(wcaId)) return cache.get(wcaId)!;
  if (inflight.has(wcaId)) return inflight.get(wcaId)!;

  const promise = fetch(`https://www.worldcubeassociation.org/api/v0/persons/${wcaId}`)
    .then((r) => r.json())
    .then((d) => {
      const url: string | null = d?.person?.avatar?.thumb_url ?? null;
      cache.set(wcaId, url);
      inflight.delete(wcaId);
      return url;
    })
    .catch(() => {
      cache.set(wcaId, null);
      inflight.delete(wcaId);
      return null;
    });

  inflight.set(wcaId, promise);
  return promise;
}
