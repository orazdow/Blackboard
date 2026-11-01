import { createSignal, Show } from 'solid-js';

export default function TalkDescription(props) {
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [base, setBase] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [uncertain, setUncertain] = createSignal(false);
  const [error, setError] = createSignal('');
  const [pendingBody, setPendingBody] = createSignal('');

  async function edit() {
    setBusy(true); setError('');
    try {
      const latest = await props.api.readTalk(props.topic.id);
      setBase(latest.description);
      setDraft(latest.description);
      setEditing(true);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function write(nextBody) {
    if (busy() || uncertain() || nextBody === base()) return;
    setPendingBody(nextBody);
    setBusy(true); props.onBusyChange(true); setError('');
    try {
      const updated = await props.api.updateTalkDescription(props.topic.id, nextBody, base());
      props.onUpdated(updated);
      setEditing(false);
    } catch (failure) {
      setUncertain(Boolean(failure.uncertain));
      setError(failure.message);
    } finally { setBusy(false); props.onBusyChange(false); }
  }

  function save(event) {
    event.preventDefault();
    write(draft());
  }

  async function checkSave() {
    setBusy(true); setError('');
    try {
      const latest = await props.api.readTalk(props.topic.id);
      props.onUpdated(latest);
      if (latest.description === pendingBody()) { setEditing(false); setUncertain(false); }
      else if (latest.description === base()) { setUncertain(false); setError('The description is unchanged on GitHub. You can try saving again.'); }
      else { setUncertain(false); setError('The description changed on GitHub. Copy your draft before editing the latest version.'); }
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <div class="talk-description" classList={{ 'is-editing': editing() }}>
    <Show when={error()}><p class="talk-description-error" role="alert">{error()}</p></Show>
    <Show when={editing()} fallback={<div class="talk-description-display" classList={{ 'has-description': Boolean(props.topic.description) }}>
      <Show when={props.topic.description}><p class="muted talk-description-text">{props.topic.description}</p></Show>
      <button type="button" class="talk-description-edit" disabled={busy()} onClick={edit}>
        {busy() ? 'Loading…' : props.topic.description ? 'Edit' : '+ add topic body'}
      </button>
    </div>}>
      <form class="talk-description-form" onSubmit={save}>
        <textarea aria-label="Topic description" rows="5" value={draft()} disabled={busy()}
          onInput={(event) => setDraft(event.currentTarget.value)} />
        <div class="talk-description-actions">
          <Show when={uncertain()} fallback={<button type="submit" disabled={busy()}>{busy() ? 'Saving…' : 'Save'}</button>}>
            <button type="button" disabled={busy()} onClick={checkSave}>Check GitHub</button>
          </Show>
          <button type="button" class="talk-description-cancel" disabled={busy()} onClick={() => { setEditing(false); setUncertain(false); setError(''); }}>Cancel</button>
          <Show when={base()}><button type="button" class="talk-description-delete" disabled={busy() || uncertain()} onClick={() => write('')}>Delete</button></Show>
        </div>
      </form>
    </Show>
  </div>;
}
