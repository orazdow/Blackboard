// Repository selection is public configuration; never put credentials in URLs.
export function parseRepository(value) {
  let path = String(value || '').trim();
  if (/^https?:\/\//i.test(path)) {
    const url = new URL(path);
    if (url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.port || url.search || url.hash) throw new Error('Use a GitHub repository URL or owner/repo.');
    path = url.pathname;
  }
  path = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  const parts = path.split('/');
  if (parts.length !== 2 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(parts[0]) || !/^[a-z0-9_.-]+$/i.test(parts[1]) || ['.', '..'].includes(parts[1])) throw new Error('Use a GitHub repository URL or owner/repo.');
  return { owner: parts[0], repo: parts[1] };
}

export const repositoryName = ({ owner, repo }) => `${owner}/${repo}`;
export const repositoryKey = (repository) => repositoryName(repository).toLowerCase();

export const RECENT_REPOSITORY_LIMIT = 4;

export function normalizeRecentRepositories(value, activeRepository = null) {
  if (!Array.isArray(value)) return [];
  const seen = new Set(activeRepository ? [repositoryKey(activeRepository)] : []);
  const repositories = [];
  for (const entry of value) {
    try {
      const repository = entry && typeof entry === 'object'
        ? parseRepository(`${entry.owner}/${entry.repo}`)
        : parseRepository(entry);
      const key = repositoryKey(repository);
      if (seen.has(key)) continue;
      seen.add(key);
      repositories.push(repository);
      if (repositories.length === RECENT_REPOSITORY_LIMIT) break;
    } catch { /* Ignore invalid saved names. */ }
  }
  return repositories;
}

export function recentRepositoriesAfterConnect(recent, previous, next) {
  const history = previous && repositoryKey(previous) !== repositoryKey(next)
    ? [previous, ...recent]
    : recent;
  return normalizeRecentRepositories(history, next);
}

// A template ships the same prebuilt client to every owner. Standard Pages URLs
// identify the new home repository without requiring a rebuild or private config.
export function repositoryFromPagesUrl(value) {
  try {
    const url = new URL(value);
    const owner = /^([a-z0-9-]+)\.github\.io$/i.exec(url.hostname)?.[1];
    if (!owner) return null;
    const first = url.pathname.split('/').filter(Boolean)[0];
    const repo = first && first !== 'index.html' ? decodeURIComponent(first) : `${owner}.github.io`;
    return repositoryName(parseRepository(`${owner}/${repo}`));
  } catch { return null; }
}
