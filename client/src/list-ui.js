import { createSignal, For, Show } from 'solid-js';
import { appendChecklistItem, changeChecklistItem, checklist } from './list-state.js';

export default function ListView(props) {
  const [newItem, setNewItem] = createSignal('');
  const [editingIndex, setEditingIndex] = createSignal(null);
  const [editingText, setEditingText] = createSignal('');
  const [sourceEditing, setSourceEditing] = createSignal(false);
  const [sourceDraft, setSourceDraft] = createSignal('');
  const [sourceBase, setSourceBase] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [uncertain, setUncertain] = createSignal(false);
  const [error, setError] = createSignal('');
  const [pendingBody, setPendingBody] = createSignal('');
  const [baseBody, setBaseBody] = createSignal('');
  let pendingSuccess = null;

  const parsed = () => checklist(props.topic.description);
  const completed = () => parsed().items.filter((item) => item.checked).length;
  function savedSource() {
    try {
      const value = JSON.parse(sessionStorage.getItem(props.draftKey) || 'null');
      return typeof value?.base === 'string' && typeof value?.text === 'string' ? value : null;
    } catch { return null; }
  }
  const [hasSourceDraft, setHasSourceDraft] = createSignal(Boolean(savedSource()));
  function clearSourceDraft() {
    try { sessionStorage.removeItem(props.draftKey); } catch { /* Editing still works without storage. */ }
    setHasSourceDraft(false);
  }
  function rememberSource(text) {
    try { sessionStorage.setItem(props.draftKey, JSON.stringify({ base: sourceBase(), text })); } catch { /* Editing still works without storage. */ }
    setHasSourceDraft(true);
  }

  function confirmed(updated) {
    props.onUpdated(updated);
    pendingSuccess?.();
    pendingSuccess = null;
    setUncertain(false);
    setError('');
  }
  async function write(nextBody, afterSuccess = () => {}, expectedBody = props.topic.description) {
    if (busy() || uncertain() || nextBody === expectedBody) return;
    setBusy(true); props.onBusyChange(true); setError('');
    setPendingBody(nextBody); setBaseBody(expectedBody); pendingSuccess = afterSuccess;
    try {
      confirmed(await props.api.updateList(props.topic.id, nextBody, expectedBody));
    } catch (failure) {
      setUncertain(Boolean(failure.uncertain));
      setError(failure.message);
      if (!failure.uncertain) pendingSuccess = null;
    } finally { setBusy(false); props.onBusyChange(false); }
  }
  async function checkSave() {
    setBusy(true); setError('');
    try {
      const latest = await props.api.readList(props.topic.id);
      if (latest.description === pendingBody()) confirmed(latest);
      else {
        props.onUpdated(latest);
        pendingSuccess = null;
        setUncertain(false);
        setError(latest.description === baseBody()
          ? 'The list is unchanged on GitHub. You can try again.'
          : 'The list changed on GitHub. Review it before trying again.');
      }
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  async function openSource() {
    setBusy(true); setError('');
    try {
      const latest = await props.api.readList(props.topic.id);
      const saved = savedSource();
      setSourceBase(saved?.base ?? latest.description);
      setSourceDraft(saved?.text ?? latest.description);
      setSourceEditing(true);
      if (saved && saved.base !== latest.description) setError('This list changed since your draft was saved. Copy your draft before editing the latest version.');
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }
  function editItem(item) { setEditingIndex(item.index); setEditingText(item.text); }

  return <section class="list-view" aria-label={`${props.topic.name} list`}>
    <div class="list-toolbar">
      <span class="list-progress">{completed()} of {parsed().items.length} complete</span>
      <Show when={!sourceEditing()}><button type="button" disabled={busy() || uncertain()} onClick={openSource}>{hasSourceDraft() ? 'Resume Markdown draft' : 'Edit Markdown'}</button></Show>
    </div>
    <Show when={error()}><p class="list-error" role="alert">{error()}</p></Show>
    <Show when={uncertain()}><button type="button" class="list-check-save" disabled={busy()} onClick={checkSave}>Check GitHub before trying again</button></Show>
    <Show when={sourceEditing()} fallback={<>
      <form class="list-add" onSubmit={(event) => { event.preventDefault(); if (newItem().trim()) write(appendChecklistItem(props.topic.description, newItem()), () => setNewItem('')); }}>
        <input type="text" aria-label="New list item" placeholder="Add an item" value={newItem()} maxLength="500" disabled={busy() || uncertain()}
          onInput={(event) => setNewItem(event.currentTarget.value)} />
        <button type="submit" disabled={busy() || uncertain() || !newItem().trim()}>Add</button>
      </form>
      <div class="list-items">
        <Show when={parsed().items.length} fallback={<p class="muted">No items yet.</p>}>
          <For each={parsed().items}>{(item) => <div class="list-item" classList={{ 'is-pending': busy() }}>
            <Show when={editingIndex() === item.index} fallback={<>
              <label><input type="checkbox" checked={item.checked} disabled={busy() || uncertain()}
                onChange={(event) => { event.currentTarget.checked = item.checked; write(changeChecklistItem(props.topic.description, item.index, 'toggle')); }} />
                <span classList={{ 'is-complete': item.checked }}>{item.text}</span></label>
              <button type="button" disabled={busy() || uncertain()} onClick={() => editItem(item)} aria-label={`Edit ${item.text}`}>Edit</button>
              <button type="button" disabled={busy() || uncertain()} onClick={() => write(changeChecklistItem(props.topic.description, item.index, 'remove'))} aria-label={`Remove ${item.text}`}>Remove</button>
            </>}>
              <form class="list-item-edit" onSubmit={(event) => { event.preventDefault(); if (editingText().trim()) write(changeChecklistItem(props.topic.description, item.index, editingText()), () => setEditingIndex(null)); }}>
                <input type="text" aria-label="Edit list item" value={editingText()} maxLength="500" disabled={busy() || uncertain()} onInput={(event) => setEditingText(event.currentTarget.value)} />
                <button type="submit" disabled={busy() || uncertain() || !editingText().trim()}>Save</button>
                <button type="button" disabled={busy()} onClick={() => setEditingIndex(null)}>Cancel</button>
              </form>
            </Show>
          </div>}</For>
        </Show>
        <Show when={parsed().lines.some((line) => line.trim() && !/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line))}>
          <p class="list-other-content">This list also contains other Markdown. Use Edit Markdown to view or change it.</p>
        </Show>
      </div>
    </>}>
      <form class="list-source-editor" onSubmit={(event) => { event.preventDefault(); write(sourceDraft(), () => { clearSourceDraft(); setSourceEditing(false); }, sourceBase()); }}>
        <textarea aria-label="List Markdown" value={sourceDraft()} disabled={busy() || uncertain()}
          onInput={(event) => { const text = event.currentTarget.value; setSourceDraft(text); rememberSource(text); }} />
        <div class="list-source-actions">
          <button type="submit" disabled={busy() || uncertain() || sourceDraft() === sourceBase()}>Save</button>
          <button type="button" disabled={busy()} onClick={() => { clearSourceDraft(); setSourceEditing(false); setError(''); }}>Cancel</button>
        </div>
      </form>
    </Show>
  </section>;
}
