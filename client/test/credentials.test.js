import test from 'node:test';
import assert from 'node:assert/strict';
import { createCredentialStore, normalizeCredentials } from '../src/credentials.js';
import { createGitHubClient } from '../src/api.js';

const repository = { owner: 'Alice', repo: 'Board' };
const tokens = { token: 'repository-token', projectToken: 'projects-token' };
function memoryStorage() {
  const data = new Map();
  return { getItem: (key) => data.get(key) ?? null, setItem: (key, value) => data.set(key, value), removeItem: (key) => data.delete(key) };
}

test('remembered credentials survive a new application instance and remain repository-specific', () => {
  const storage = memoryStorage();
  createCredentialStore(storage).save(repository, tokens, true);
  const reloaded = createCredentialStore(storage);
  assert.deepEqual(reloaded.get({ owner: 'alice', repo: 'board' }), { ...tokens, remember: true });
  assert.equal(reloaded.get({ owner: 'Alice', repo: 'Other' }), null);
  assert.equal(storage.getItem('blackboard:recent-repositories'), null);
});

test('unremembered credentials survive workspace switches but disappear on reload', () => {
  const storage = memoryStorage(), store = createCredentialStore(storage);
  store.save(repository, tokens, false);
  assert.deepEqual(store.get(repository), { ...tokens, remember: false });
  assert.equal(createCredentialStore(storage).get(repository), null);
});

test('unchecking Remember removes previously persistent credentials', () => {
  const storage = memoryStorage(), store = createCredentialStore(storage);
  store.save(repository, tokens, true);
  store.save(repository, { token: 'replacement', projectToken: '' }, false);
  assert.equal(store.get(repository).token, 'replacement');
  assert.equal(createCredentialStore(storage).get(repository), null);
});

test('forgetting credentials clears both memory and persistence for only that repository', () => {
  const storage = memoryStorage(), store = createCredentialStore(storage);
  const other = { owner: 'Alice', repo: 'Other' };
  store.save(repository, tokens, true);
  store.save(other, tokens, false);
  store.forget(repository);
  assert.equal(store.get(repository), null);
  assert.equal(createCredentialStore(storage).get(repository), null);
  assert.equal(store.get(other).token, tokens.token);
  store.forget(other);
  assert.equal(store.get(other), null);
});

test('bad saved data is ignored and returned records cannot mutate saved tokens', () => {
  const storage = memoryStorage(), key = 'blackboard:alice/board:credentials';
  storage.setItem(key, '{invalid');
  assert.equal(createCredentialStore(storage).get(repository), null);
  storage.setItem(key, '{"token":123}');
  assert.equal(createCredentialStore(storage).get(repository), null);
  const store = createCredentialStore(storage);
  store.save(repository, tokens, false);
  store.get(repository).token = 'mutated';
  assert.equal(store.get(repository).token, tokens.token);
});

test('blocked browser storage allows in-memory authentication and reports persistence failure honestly', () => {
  const storage = { getItem() { throw new Error('Blocked'); }, setItem() { throw new Error('Blocked'); }, removeItem() { throw new Error('Blocked'); } };
  const store = createCredentialStore(storage);
  assert.equal(store.get(repository), null);
  assert.throws(() => store.save(repository, tokens, true), /Uncheck Remember/);
  assert.equal(store.get(repository), null);
  store.save(repository, tokens, false);
  assert.equal(store.get(repository).remember, false);
  store.forget(repository);
  assert.equal(store.get(repository), null);
});

test('storage quota failures preserve previously working credentials', () => {
  const storage = memoryStorage(), store = createCredentialStore(storage);
  store.save(repository, tokens, true);
  storage.setItem = () => { throw new Error('Quota'); };
  assert.throws(() => store.save(repository, { token: 'new' }, true), /Browser storage/);
  assert.equal(store.get(repository).token, tokens.token);
});

test('forget failure does not falsely clear the active remembered record', () => {
  const storage = memoryStorage(), store = createCredentialStore(storage);
  store.save(repository, tokens, true);
  storage.removeItem = () => { throw new Error('Blocked'); };
  assert.throws(() => store.forget(repository), /Could not remove/);
  assert.equal(store.get(repository).token, tokens.token);
});

test('only token values are retained; optional Projects credentials may be empty', () => {
  assert.deepEqual(normalizeCredentials({ token: ' primary ', extra: 'ignored' }), { token: 'primary', projectToken: '' });
  assert.equal(normalizeCredentials({ token: 'line\nbreak' }), null);
  assert.equal(normalizeCredentials({ token: 'primary', projectToken: 'two words' }), null);
});

test('API clients require explicit credentials instead of loading local configuration', async () => {
  const api = createGitHubClient({ fetch: () => assert.fail('Unexpected network call') });
  await assert.rejects(api.checkRepository(), /Permit this repository/);
});
