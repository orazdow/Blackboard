import { createSignal, Show } from 'solid-js';

export default function NoteView(props) {
  function savedDraft() {
    try {
      const value = JSON.parse(sessionStorage.getItem(props.draftKey) || 'null');
      return typeof value?.base === 'string' && typeof value?.text === 'string' ? value : null;
    } catch { return null; }
  }
  const [hasDraft, setHasDraft] = createSignal(Boolean(savedDraft()));
  function rememberDraft(baseText, text) {
    try { sessionStorage.setItem(props.draftKey, JSON.stringify({ base: baseText, text })); } catch { /* Editing still works without storage. */ }
    setHasDraft(true);
  }
  function clearDraft() {
    try { sessionStorage.removeItem(props.draftKey); } catch { /* The in-memory editor still works. */ }
    setHasDraft(false);
  }
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [base, setBase] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [uncertain, setUncertain] = createSignal(false);
  const [error, setError] = createSignal('');

  async function edit() {
    setBusy(true); setError('');
    try {
      const latest = await props.api.readNote(props.topic.id);
      const saved = savedDraft();
      setBase(saved?.base ?? latest.description);
      setDraft(saved?.text ?? latest.description);
      setEditing(true);
      if (saved && saved.base !== latest.description) setError('This note changed since your draft was saved. Copy your draft before editing the latest version.');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function save(event) {
    event.preventDefault();
    if (busy() || uncertain()) return;
    setBusy(true); props.onBusyChange(true); setError('');
    try {
      const updated = await props.api.updateNote(props.topic.id, draft(), base());
      props.onUpdated(updated);
      clearDraft();
      setEditing(false);
    } catch (failure) {
      setUncertain(Boolean(failure.uncertain));
      setError(failure.message);
    } finally { setBusy(false); props.onBusyChange(false); }
  }

  async function checkSave() {
    setBusy(true); setError('');
    try {
      const latest = await props.api.readNote(props.topic.id);
      props.onUpdated(latest);
      if (latest.description === draft()) { clearDraft(); setEditing(false); setUncertain(false); }
      else if (latest.description === base()) { setUncertain(false); setError('The note is unchanged on GitHub. You can try saving again.'); }
      else { setUncertain(false); setError('The note changed on GitHub. Copy your draft before editing the latest version.'); }
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  return <section class="note-view" aria-label={`${props.topic.name} note`}>
    <div class="note-toolbar">
      <span class="note-type">Note</span>
      <Show when={!editing()}><button type="button" disabled={busy()} onClick={edit}>{hasDraft() ? 'Resume draft' : 'Edit note'}</button></Show>
    </div>
    <Show when={error()}><p class="note-error" role="alert">{error()}</p></Show>
    <Show when={editing()} fallback={
      <div class="note-content">{props.topic.description || <span class="muted">This note is empty.</span>}</div>
    }>
      <form class="note-editor" onSubmit={save}>
        <textarea aria-label="Note content" value={draft()} disabled={busy()}
          onInput={(event) => { const text = event.currentTarget.value; setDraft(text); rememberDraft(base(), text); }} />
        <div class="note-editor-actions">
          <Show when={uncertain()} fallback={<button type="submit" disabled={busy() || draft() === base()}>{busy() ? 'Saving…' : 'Save'}</button>}>
            <button type="button" disabled={busy()} onClick={checkSave}>Check GitHub</button>
          </Show>
          <button type="button" disabled={busy()} onClick={() => { clearDraft(); setEditing(false); setUncertain(false); setError(''); }}>Cancel</button>
        </div>
      </form>
    </Show>
  </section>;
}
