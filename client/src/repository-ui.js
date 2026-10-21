import { createSignal, For, Show, onCleanup } from 'solid-js';
import { createGitHubClient } from './api.js';
import { parseRepository, repositoryKey, repositoryName } from './repository-state.js';

export default function RepositorySelector(props) {
  const [open, setOpen] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  const [value, setValue] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  let element, trigger;
  let stopped = false;
  const close = () => { if (!busy()) { setOpen(false); setEditing(false); setError(''); } };
  const outside = (event) => { if (!element?.contains(event.target)) close(); };
  const escape = (event) => { if (event.key === 'Escape' && open() && !busy()) { close(); trigger?.focus(); } };
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', escape);
  onCleanup(() => { stopped = true; document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); });

  async function connect(target) {
    if (busy() || props.switchDisabled) return;
    setError('');
    let requested;
    try { requested = parseRepository(target); }
    catch (failure) { setError(failure.message); return; }
    if (repositoryKey(requested) === repositoryKey(props.repository)) { close(); return; }
    setBusy(true);
    try {
      const repository = await createGitHubClient(requested).checkRepository();
      if (!stopped && !props.switchDisabled) props.onConnect(repository);
      else if (!stopped) setError('Wait for the current change to finish, then connect again.');
    } catch (failure) {
      if (!stopped) setError(failure.status === 404 || failure.status === 403
        ? `Cannot access ${repositoryName(requested)} with the current token. Check the repository name and token permissions.`
        : failure.message);
    } finally { if (!stopped) setBusy(false); }
  }

  return <header ref={element} class="workspace-header repository-header">
    <button ref={trigger} type="button" class="repository-trigger" title={repositoryName(props.repository)} aria-label={`Repository ${repositoryName(props.repository)}`} aria-expanded={open()} aria-controls="repository-menu"
      onClick={() => { if (open()) close(); else setOpen(true); }}>
      <img class="workspace-icon" src="./lyra.jpg" alt="" />
      <span class="repository-heading"><span class="repository-title">{props.repository.repo || 'Connect repository'}</span><span class="muted">{props.repository.owner || 'Blackboard'}</span></span>
      <svg class="repository-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <Show when={open()}><div id="repository-menu" class="repository-menu" aria-label="Repository selection" aria-busy={busy()}>
      <div class="repository-current" title={repositoryName(props.repository)}>{repositoryName(props.repository)}</div>
      <For each={props.recent.filter((entry) => repositoryKey(entry) !== repositoryKey(props.repository))}>{(entry) =>
        <button type="button" class="repository-recent" disabled={busy() || props.switchDisabled} onClick={() => connect(repositoryName(entry))}>{repositoryName(entry)}</button>
      }</For>
      <Show when={editing()} fallback={<button type="button" class="repository-connect" disabled={busy() || props.switchDisabled} onClick={() => { setEditing(true); setValue(''); }}>Connect repository…</button>}>
        <form onSubmit={(event) => { event.preventDefault(); connect(value()); }}>
          <label for="repository-address">Repository</label>
          <input id="repository-address" type="text" autocomplete="off" placeholder="owner/repo or GitHub URL" required value={value()} disabled={busy() || props.switchDisabled}
            ref={(input) => requestAnimationFrame(() => input.isConnected && input.focus())} onInput={(event) => setValue(event.currentTarget.value)} />
          <div class="repository-form-actions"><button type="button" disabled={busy()} onClick={close}>Cancel</button><button type="submit" disabled={busy() || props.switchDisabled || !value().trim()}>{busy() ? 'Connecting…' : 'Connect'}</button></div>
        </form>
      </Show>
      <Show when={props.switchDisabled}><p class="muted">Waiting for the current change to finish.</p></Show>
      <Show when={error()}><p class="dialog-error" role="alert">{error()}</p></Show>
    </div></Show>
  </header>;
}
