import { createSignal, Show } from 'solid-js';
import { listDescription, replaceListDescription } from './list-state.js';

export default function TalkDescription(props) {
  const isList = () => props.topic.kind === 'list';
  const description = (body) => isList() ? listDescription(body) : body;
  const read = () => isList() ? props.api.readList(props.topic.id) : props.api.readTalk(props.topic.id);
  const update = (body, expectedBody) => isList()
    ? props.api.updateList(props.topic.id, body, expectedBody)
    : props.api.updateTalkDescription(props.topic.id, body, expectedBody);
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [base, setBase] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [uncertain, setUncertain] = createSignal(false);
  const [error, setError] = createSignal('');
  const [pendingBody, setPendingBody] = createSignal('');

  async function edit() {
    if (busy() || props.writing) return;
    setBusy(true); setError('');
    try {
      const latest = await read();
      setBase(latest.description);
      setDraft(description(latest.description));
      setEditing(true);
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function write(nextText) {
    const nextBody = isList() ? replaceListDescription(base(), nextText) : nextText;
    if (busy() || props.writing || uncertain() || nextBody === base()) return;
    setPendingBody(nextBody);
    setBusy(true); props.onBusyChange(true); setError('');
    try {
      const updated = await update(nextBody, base());
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
      const latest = await read();
      props.onUpdated(latest);
      if (latest.description === pendingBody()) { setEditing(false); setUncertain(false); }
      else if (latest.description === base()) { setUncertain(false); setError('The description is unchanged on GitHub. You can try saving again.'); }
      else { setUncertain(false); setError('The description changed on GitHub. Copy your draft before editing the latest version.'); }
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <div class="talk-description" classList={{ 'is-editing': editing() }}>
    <Show when={error()}><p class="talk-description-error" role="alert">{error()}</p></Show>
    <Show when={editing()} fallback={<div class="talk-description-display" classList={{ 'has-description': Boolean(description(props.topic.description)) }}>
      <Show when={description(props.topic.description)}><p class="talk-description-text">{description(props.topic.description)}</p></Show>
      <button type="button" class="talk-description-edit" disabled={busy() || props.writing} onClick={edit}>
        {busy() ? 'Loading…' : description(props.topic.description) ? 'Edit' : '+ add topic body'}
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
          <Show when={description(base())}><button type="button" class="talk-description-delete" disabled={busy() || uncertain()} onClick={() => write('')}>Delete</button></Show>
        </div>
      </form>
    </Show>
  </div>;
}
