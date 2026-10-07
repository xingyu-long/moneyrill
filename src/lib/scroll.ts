// The page scrolls as one window, so without this a new page opens at the previous page's scroll position.
// Each page (by path) keeps its own position for the session; a page not visited yet opens at the top.
export function createScrollMemory() {
  const saved = new Map<string, number>();
  return {
    save: (path: string, y: number) => void saved.set(path, y),
    restoreFor: (path: string) => saved.get(path) ?? 0,
  };
}
