import { repositoryKey } from './repository-state.js';

const keyFor = (repository) => `blackboard:${repositoryKey(repository)}:credentials`;
export function normalizeCredentials(value) {
  if (!value || typeof value.token !== 'string' || typeof (value.projectToken ?? '') !== 'string') return null;
  const token = value.token.trim(), projectToken = (value.projectToken || '').trim();
  if (!token || /\s/.test(token) || /\s/.test(projectToken)) return null;
  return { token, projectToken };
}

// Tokens never enter public repository records or URLs. Unremembered tokens live
// only in this app instance; persistence failures are reported before activation.
export function createCredentialStore(storage) {
  const temporary = new Map();
  return {
    get(repository) {
      const key = keyFor(repository);
      if (temporary.has(key)) return { ...temporary.get(key), remember: false };
      try {
        const credentials = normalizeCredentials(JSON.parse(storage?.getItem(key) || 'null'));
        return credentials ? { ...credentials, remember: true } : null;
      } catch { return null; }
    },
    save(repository, value, remember) {
      const credentials = normalizeCredentials(value);
      if (!credentials) throw new Error('Enter a repository token without spaces or line breaks.');
      const key = keyFor(repository);
      try {
        if (remember) {
          if (!storage) throw new Error('Storage unavailable');
          storage.setItem(key, JSON.stringify(credentials));
          temporary.delete(key);
        } else {
          let hasSaved = false;
          try { hasSaved = Boolean(storage?.getItem(key)); } catch { /* Storage may be blocked entirely. */ }
          try { storage?.removeItem(key); } catch (failure) { if (hasSaved) throw failure; }
          temporary.set(key, credentials);
        }
      } catch { throw new Error('Browser storage is unavailable. Uncheck Remember on this browser to continue, or allow storage for this site.'); }
      return { ...credentials };
    },
    forget(repository) {
      const key = keyFor(repository);
      try {
        if (temporary.has(key)) {
          let hasSaved = false;
          try { hasSaved = Boolean(storage?.getItem(key)); } catch { /* Memory-only authentication. */ }
          try { storage?.removeItem(key); } catch (failure) { if (hasSaved) throw failure; }
        } else storage?.removeItem(key);
      } catch { throw new Error('Could not remove saved credentials. Allow browser storage or clear this site’s saved data.'); }
      temporary.delete(key);
    },
  };
}
