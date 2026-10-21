import { createSignal, Show, onCleanup } from 'solid-js';
import { createGitHubClient } from './api.js';
import { normalizeCredentials } from './credentials.js';
import { parseRepository, repositoryName } from './repository-state.js';

export default function RepositorySelector(props) {
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [address, setAddress] = createSignal('');
  const [token, setToken] = createSignal('');
  const [projectToken, setProjectToken] = createSignal('');
  const [remember, setRemember] = createSignal(true);
  const [mode, setMode] = createSignal('permit');
  const [validated, setValidated] = createSignal(null);
  let element, trigger, dialog;
  let stopped = false, attempt = 0, backdropStart = false, tokensEdited = false;
  const closeMenu = () => { if (!dialog?.open) { attempt++; setBusy(false); setOpen(false); setError(''); } };
  const outside = (event) => { if (!element?.contains(event.target)) closeMenu(); };
  const escape = (event) => { if (event.key === 'Escape' && open() && !dialog?.open) { closeMenu(); trigger?.focus(); } };
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', escape);
  onCleanup(() => { stopped = true; attempt++; document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); });

  function openPermit(repository = props.repository, connecting = false) {
    if (props.switchDisabled) return;
    attempt++; setOpen(false); setBusy(false); setError(''); setValidated(null); tokensEdited = false;
    const saved = props.getCredentials(repository);
    setAddress(connecting ? '' : repositoryName(repository));
    setToken(saved?.token || (connecting ? props.credentials?.token : '') || '');
    setProjectToken(saved?.projectToken || (connecting ? props.credentials?.projectToken : '') || '');
    setRemember(saved?.remember ?? true);
    setMode(connecting ? 'connect' : 'permit');
    dialog.showModal();
    requestAnimationFrame(() => dialog.querySelector(connecting ? '#permit-repository' : '#permit-token')?.focus());
  }

  function finish(repository, credentials) {
    if (props.switchDisabled) throw new Error('Wait for the current change to finish, then connect again.');
    props.onConnect(repository, credentials, remember());
  }

  async function permit(event) {
    event.preventDefault();
    if (busy() || props.switchDisabled) return;
    setError(''); setValidated(null);
    let repository, credentials;
    try {
      repository = parseRepository(address());
      credentials = normalizeCredentials({ token: token(), projectToken: projectToken() });
      if (!credentials) throw new Error('Enter a repository token without spaces or line breaks.');
    } catch (failure) { setError(failure.message); return; }
    const version = ++attempt;
    setBusy(true);
    try {
      const api = createGitHubClient({ ...repository, ...credentials });
      const canonical = await api.checkRepository();
      if (stopped || version !== attempt) return;
      if (credentials.projectToken) {
        try { await createGitHubClient({ ...canonical, ...credentials }).listProjects(); }
        catch (failure) {
          if (!stopped && version === attempt) {
            setValidated({ repository: canonical, credentials: { ...credentials, projectToken: '' } });
            setError(`Repository access verified. Projects: ${failure.message}`);
          }
          return;
        }
      }
      if (!stopped && version === attempt) finish(canonical, credentials);
    } catch (failure) {
      if (!stopped && version === attempt) {
        setError(failure.status === 401 || failure.status === 403 || failure.status === 404
          ? 'Could not authenticate for this repository. Check the repository address and token.' : failure.message);
      }
    } finally { if (!stopped && version === attempt) setBusy(false); }
  }

  function withoutProjects() {
    const checked = validated();
    if (!checked || busy()) return;
    try { finish(checked.repository, checked.credentials); }
    catch (failure) { setError(failure.message); }
  }
  function forget() {
    if (busy() || props.switchDisabled) return;
    try { props.onForget(); }
    catch (failure) { setError(failure.message); }
  }
  function outsideDialog(event) {
    const bounds = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  }
  function changed() { setValidated(null); setError(''); }
  function restoreSavedCredentials() {
    if (tokensEdited || mode() !== 'connect') return;
    try {
      const saved = props.getCredentials(parseRepository(address()));
      if (saved) { setToken(saved.token); setProjectToken(saved.projectToken); setRemember(saved.remember); changed(); }
    } catch { /* Address validation runs on Connect. */ }
  }

  return <header ref={element} class="workspace-header repository-header">
    <button ref={trigger} type="button" class="repository-trigger" title={repositoryName(props.repository)} aria-label={`Repository ${repositoryName(props.repository)}`} aria-expanded={open()} aria-controls="repository-menu"
      onClick={() => { if (open()) closeMenu(); else setOpen(true); }}>
      <img class="workspace-icon" src="./lyra.jpg" alt="" />
      <span class="repository-heading"><span class="repository-title">{props.repository.repo || 'Connect repository'}</span><span class="muted">{props.repository.owner || 'Blackboard'}</span></span>
      <svg class="repository-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
    </button>
    <Show when={open()}><div id="repository-menu" class="repository-menu" aria-label="Repository selection" aria-busy={busy()}>
      <div class="repository-current">
        <span title={repositoryName(props.repository)}>{repositoryName(props.repository)}</span>
        <button type="button" class="repository-permit" disabled={busy() || props.switchDisabled} aria-haspopup="dialog" onClick={() => openPermit()}>{props.permitted ? 'Permitted' : 'Permit'}</button>
      </div>
      <button type="button" class="repository-connect" disabled={busy() || props.switchDisabled} aria-haspopup="dialog" onClick={() => openPermit(props.repository, true)}>Connect repository</button>
      <Show when={busy()}><p class="muted">Connecting...</p></Show>
      <Show when={props.switchDisabled}><p class="muted">Waiting for the current change to finish.</p></Show>
      <Show when={error()}><p class="dialog-error" role="alert">{error()}</p></Show>
    </div></Show>
    <dialog ref={dialog} class="topic-status-dialog permit-dialog" aria-labelledby="permit-title"
      onPointerDown={(event) => { backdropStart = outsideDialog(event); }}
      onClick={(event) => { if (backdropStart && outsideDialog(event)) dialog.close(); backdropStart = false; }}
      onClose={() => { attempt++; setBusy(false); setToken(''); setProjectToken(''); setValidated(null); setError(''); trigger?.focus(); }}>
      <form onSubmit={permit} aria-busy={busy()}>
        <h2 id="permit-title">{mode() === 'connect' ? 'Connect repository' : 'Permit repository'}</h2>
        <label for="permit-repository">Repository</label>
        <input id="permit-repository" type="text" required autocomplete="off" placeholder="owner/repo or GitHub URL" value={address()} readOnly={mode() !== 'connect'} disabled={busy()} onBlur={restoreSavedCredentials}
          onInput={(event) => { setAddress(event.currentTarget.value); changed(); }} />
        <label for="permit-token">Repository token</label>
        <input id="permit-token" type="password" required autocomplete="off" spellcheck="false" value={token()} disabled={busy()}
          onInput={(event) => { tokensEdited = true; setToken(event.currentTarget.value); changed(); }} />
        <label for="permit-project-token">Projects token <span class="muted">(optional)</span></label>
        <input id="permit-project-token" type="password" autocomplete="off" spellcheck="false" value={projectToken()} disabled={busy()}
          onInput={(event) => { tokensEdited = true; setProjectToken(event.currentTarget.value); changed(); }} />
        <label class="permit-remember"><input type="checkbox" checked={remember()} disabled={busy()} onChange={(event) => setRemember(event.currentTarget.checked)} /> Remember on this browser</label>
        <Show when={error()}><p class="dialog-error" role="alert">{error()}</p></Show>
        <Show when={mode() === 'permit' && props.credentials?.token}><button type="button" class="permit-forget" disabled={busy() || props.switchDisabled} onClick={forget}>Forget credentials</button></Show>
        <div class="dialog-actions"><button type="button" class="dialog-cancel" onClick={() => dialog.close()}>Cancel</button>
          <Show when={validated()}><button type="button" disabled={busy() || props.switchDisabled} onClick={withoutProjects}>Continue without Projects</button></Show>
          <button type="submit" disabled={busy() || props.switchDisabled || !token().trim() || !address().trim()}>{busy() ? 'Checking...' : 'Connect'}</button>
        </div>
      </form>
    </dialog>
  </header>;
}
