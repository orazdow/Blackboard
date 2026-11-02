const DISCUSSION_ID = /^discussion:[A-Za-z0-9_=-]{1,256}$/;

export function readView(url) {
  try {
    const value = new URL(url).searchParams.get('view');
    if (!value) return null;
    const colon = value.indexOf(':');
    const kind = value.slice(0, colon);
    const rawId = value.slice(colon + 1);
    if (kind === 'topic') {
      if (DISCUSSION_ID.test(rawId)) return { kind, id: rawId };
      if (/^[1-9]\d*$/.test(rawId) && Number.isSafeInteger(Number(rawId))) return { kind, id: Number(rawId) };
    }
    if (kind === 'goal' && /^[1-9]\d*$/.test(rawId) && Number.isSafeInteger(Number(rawId))) return { kind, id: Number(rawId) };
  } catch { /* Invalid URLs have no selected view. */ }
  return null;
}

export function urlForView(url, view) {
  const next = new URL(url);
  if (view) next.searchParams.set('view', `${view.kind}:${view.id}`);
  else next.searchParams.delete('view');
  return next;
}
