import { createEffect, createSignal, For, Show, onCleanup, onMount, untrack } from 'solid-js';
import { boardColumns, createProjectTracker, previewBoard, sameProjectColumns } from './project-state.js';

/* Projects workspace, first pass.
 * TODO: table/roadmap views and saved GitHub view filters.
 * TODO: project creation, fields other than Status, and card ordering.
 * TODO: conversation side panel; currently cards open chat with Back to project.
 * Status is a project field. Moving cards never implicitly closes topics.
 */
export default function ProjectBoard(props) {
  const [board, setBoard] = createSignal(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [search, setSearch] = createSignal('');
  const [busy, setBusy] = createSignal({});
  const [uncertain, setUncertain] = createSignal({});
  const [adding, setAdding] = createSignal(false);
  const [addUncertain, setAddUncertain] = createSignal(false);
  const [draftColumn, setDraftColumn] = createSignal();
  const [draftTitle, setDraftTitle] = createSignal('');
  const [pendingDraft, setPendingDraft] = createSignal(null);
  const [editor, setEditor] = createSignal(null);
  const [editTitle, setEditTitle] = createSignal('');
  const [editBody, setEditBody] = createSignal('');
  const [editColor, setEditColor] = createSignal('GRAY');
  const [editorBusy, setEditorBusy] = createSignal(false);
  const [editorError, setEditorError] = createSignal('');
  const [editorUncertain, setEditorUncertain] = createSignal(false);
  const [fieldBusy, setFieldBusy] = createSignal(false);
  const [fieldUncertain, setFieldUncertain] = createSignal(false);
  const [removal, setRemoval] = createSignal(null);
  const [removing, setRemoving] = createSignal(false);
  const [removeError, setRemoveError] = createSignal('');
  const [removeUncertain, setRemoveUncertain] = createSignal(false);
  let workspace;
  let editorDialog;
  let removeDialog;
  let pendingField = null;
  let backdropStart = null;
  let tracker = createProjectTracker();
  let version = 0;
  let revision = 0;
  let nextRead = 0;
  let failures = 0;
  let stopped = false;
  let readPromise = null;
  let dragging = null;
  const preview = () => props.projectId === 'preview';
  const columns = () => board() ? boardColumns({ ...board(), items: [...board().items, ...(pendingDraft() ? [pendingDraft()] : [])] }, search()) : [];
  const canMove = () => board()?.canUpdate && board()?.statusField && !preview() && !fieldBusy();
  const canChangeColumns = () => canMove() && !fieldUncertain() && !adding() && !Object.values(busy()).some(Boolean);
  const closeMenus = () => workspace?.querySelectorAll('.project-menu[open]').forEach((menu) => { menu.open = false; });
  function outsideDialog(event) {
    const dialog = event.currentTarget;
    const bounds = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  }
  function trackBackdrop(event) { backdropStart = outsideDialog(event) ? event.currentTarget : null; }
  function dismissBackdrop(event, busy) {
    const cancel = backdropStart === event.currentTarget && outsideDialog(event);
    backdropStart = null;
    if (cancel && !busy) event.currentTarget.close();
  }

  async function load(force = false) {
    if (preview() || stopped || readPromise || (!force && Date.now() < nextRead)) return;
    if (draftColumn() !== undefined || editor() || removal() || workspace?.querySelector('.project-menu[open]')) return;
    const currentVersion = version;
    const currentRevision = revision;
    const id = props.projectId;
    setLoading(true);
    readPromise = props.api.readProject(id);
    try {
      const incoming = await readPromise;
      if (stopped || currentVersion !== version || currentRevision !== revision) return;
      if (draftColumn() !== undefined || editor() || removal() || workspace?.querySelector('.project-menu[open]')) return;
      if (pendingField) {
        if (sameProjectColumns(incoming.statusField, pendingField)) pendingField = null;
        else incoming.statusField = pendingField;
      }
      setBoard({ ...incoming, items: tracker.reconcile(incoming.items) });
      // A successful fresh read resolves uncertainty without repeating a write.
      // It may show either the requested value or the original value.
      setUncertain({});
      setAddUncertain(false);
      setFieldUncertain(false);
      failures = 0;
      nextRead = 0;
    } catch (failure) {
      if (stopped || currentVersion !== version) return;
      setError(failure.message);
      failures++;
      nextRead = Math.max(failure.retryAt || 0, Date.now() + Math.min(120000, 10000 * 2 ** (failures - 1)));
    } finally {
      readPromise = null;
      if (!stopped && currentVersion === version) setLoading(false);
    }
  }

  createEffect(() => {
    const id = props.projectId;
    version++;
    revision++;
    tracker = createProjectTracker();
    nextRead = 0;
    failures = 0;
    setError(''); setSearch(''); setBusy({}); setUncertain({}); setAddUncertain(false);
    setBoard(id === 'preview' ? previewBoard(untrack(() => props.topics)) : null);
    // Start after the effect so board reads do not become reactive dependencies.
    queueMicrotask(() => load(true));
  });
  createEffect(() => { if (props.projectId === 'preview') setBoard(previewBoard(props.topics)); });
  onMount(() => {
    const poll = () => { if (!document.hidden) load(); };
    const dismissMenus = (event) => { if (!event.target.closest?.('.project-menu')) closeMenus(); };
    const escapeMenus = (event) => { if (event.key === 'Escape') closeMenus(); };
    const timer = setInterval(poll, 10000);
    document.addEventListener('visibilitychange', poll);
    document.addEventListener('pointerdown', dismissMenus);
    document.addEventListener('keydown', escapeMenus);
    document.addEventListener('scroll', closeMenus, true);
    window.addEventListener('resize', closeMenus);
    onCleanup(() => { clearInterval(timer); document.removeEventListener('visibilitychange', poll); document.removeEventListener('pointerdown', dismissMenus); document.removeEventListener('keydown', escapeMenus); document.removeEventListener('scroll', closeMenus, true); window.removeEventListener('resize', closeMenus); });
  });
  onCleanup(() => { stopped = true; version++; });

  async function move(item, statusId) {
    if (!canMove() || busy()[item.id] || uncertain()[item.id] || item.syncState || item.statusId === statusId) return;
    const id = props.projectId;
    const currentVersion = version;
    setBusy((previous) => ({ ...previous, [item.id]: true }));
    setError('');
    try {
      await props.api.setProjectItemStatus(id, item.id, board().statusField.id, statusId);
      if (stopped || currentVersion !== version) return;
      revision++;
      const updated = tracker.remember({ ...item, statusId });
      setBoard((previous) => ({ ...previous, items: previous.items.map((entry) => entry.id === item.id ? updated : entry) }));
    } catch (failure) {
      if (stopped || currentVersion !== version) return;
      setError(failure.message);
      if (failure.uncertain) setUncertain((previous) => ({ ...previous, [item.id]: { statusId } }));
    } finally {
      if (!stopped && currentVersion === version) { setBusy((previous) => ({ ...previous, [item.id]: false })); load(); }
    }
  }

  async function addTopic(channelId) {
    if (!channelId || adding() || addUncertain() || !board()?.canUpdate || preview()) return;
    const currentVersion = version;
    setAdding(true); setError('');
    try {
      const item = await props.api.addTopicToProject(props.projectId, channelId);
      if (stopped || currentVersion !== version) return;
      revision++;
      const added = tracker.remember(item, true);
      setBoard((previous) => ({ ...previous, items: [...previous.items.filter((entry) => entry.id !== item.id), added] }));
    } catch (failure) {
      if (stopped || currentVersion !== version) return;
      setError(failure.message);
      if (failure.uncertain) setAddUncertain(channelId);
    } finally {
      if (!stopped && currentVersion === version) { setAdding(false); load(); }
    }
  }

  function openDraft(columnId) {
    if (adding() || addUncertain() || fieldBusy()) return;
    closeMenus(); setDraftColumn(columnId); setDraftTitle('');
  }

  async function createDraft(event) {
    event.preventDefault();
    if (!draftTitle().trim() || adding() || addUncertain()) return;
    const title = draftTitle().trim();
    const statusId = draftColumn();
    const currentVersion = version;
    setAdding(true); setError(''); setDraftColumn(undefined); setDraftTitle('');
    setPendingDraft({ id: 'pending-draft', type: 'DraftIssue', title, statusId, temporary: true, syncState: 'confirming' });
    try {
      const item = await props.api.createProjectDraft(props.projectId, { title, statusId, fieldId: board().statusField?.id });
      if (stopped || currentVersion !== version) return;
      revision++;
      const added = tracker.remember(item, true);
      setBoard((previous) => ({ ...previous, items: [...previous.items, added] }));
    } catch (failure) {
      if (stopped || currentVersion !== version) return;
      if (failure.createdItem) {
        revision++;
        const added = tracker.remember(failure.createdItem, true);
        setBoard((previous) => ({ ...previous, items: [...previous.items, added] }));
      } else if (failure.uncertain) setAddUncertain(true);
      else { setDraftColumn(statusId); setDraftTitle(title); }
      setError(failure.message);
    } finally {
      if (!stopped && currentVersion === version) { setAdding(false); setPendingDraft(null); load(); }
    }
  }

  function openEditor(kind, value = null) {
    closeMenus();
    setEditor({ kind, value });
    setEditTitle(value?.name || value?.title || '');
    setEditBody(value?.description || value?.body || '');
    setEditColor(value?.color || 'GRAY');
    setEditorError(''); setEditorUncertain(false);
    editorDialog.showModal();
  }

  function applyField(field, removedId = null) {
    revision++;
    pendingField = field;
    setBoard((previous) => ({ ...previous, statusField: field, items: previous.items.map((item) => removedId !== null && item.statusId === removedId ? tracker.remember({ ...item, statusId: null }) : item) }));
  }

  async function saveEditor(event) {
    event.preventDefault();
    const target = editor();
    if (!target || editorBusy() || editorUncertain() || !editTitle().trim()) return;
    setEditorBusy(true); setEditorError('');
    if (target.kind === 'column') setFieldBusy(true);
    try {
      if (target.kind === 'column') {
        applyField(await props.api.changeProjectColumn(props.projectId, { id: target.value?.id ?? null, name: editTitle(), description: editBody(), color: editColor() }));
      } else {
        let changes;
        if (target.value.type === 'DraftIssue') changes = await props.api.updateProjectDraft(target.value.contentId, { title: editTitle(), body: editBody() });
        else {
          const updated = await props.api.updateChannelDetails(target.value.channelId, { name: editTitle(), description: editBody() });
          props.onTopicUpdated?.(updated);
          changes = { title: updated.name, body: updated.description };
        }
        revision++;
        const updated = tracker.remember({ ...target.value, ...changes }, false, ['title', 'body']);
        setBoard((previous) => ({ ...previous, items: previous.items.map((item) => item.id === updated.id ? updated : item) }));
      }
      editorDialog.close(); setEditor(null);
    } catch (failure) {
      setEditorError(failure.message); setEditorUncertain(Boolean(failure.uncertain));
    } finally { setEditorBusy(false); setFieldBusy(false); load(); }
  }

  async function shiftColumn(column, direction) {
    if (!canChangeColumns()) return;
    closeMenus(); setFieldBusy(true); setError('');
    try { applyField(await props.api.changeProjectColumn(props.projectId, { id: column.id, direction })); }
    catch (failure) { setError(failure.message); setFieldUncertain(Boolean(failure.uncertain)); }
    finally { setFieldBusy(false); load(); }
  }

  function requestRemoval(kind, value) {
    closeMenus(); setRemoval({ kind, value }); setRemoveError(''); setRemoveUncertain(false); removeDialog.showModal();
  }

  async function confirmRemoval(event) {
    event.preventDefault();
    const target = removal();
    if (!target || removing() || removeUncertain()) return;
    setRemoving(true); setRemoveError('');
    try {
      if (target.kind === 'column') {
        setFieldBusy(true);
        applyField(await props.api.changeProjectColumn(props.projectId, { id: target.value.id, remove: true }), target.value.id);
      } else {
        setBusy((previous) => ({ ...previous, [target.value.id]: true }));
        await props.api.removeProjectItem(props.projectId, target.value.id);
        revision++; tracker.remove(target.value.id);
        setBoard((previous) => ({ ...previous, items: previous.items.filter((item) => item.id !== target.value.id) }));
      }
      removeDialog.close(); setRemoval(null);
    } catch (failure) { setRemoveError(failure.message); setRemoveUncertain(Boolean(failure.uncertain)); }
    finally {
      setRemoving(false); setFieldBusy(false);
      if (target.kind === 'item') setBusy((previous) => ({ ...previous, [target.value.id]: false }));
      load();
    }
  }

  function Menu(menuProps) {
    return <details class="project-menu" onToggle={(event) => {
      const current = event.currentTarget;
      if (current.open) {
        workspace.querySelectorAll('.project-menu[open]').forEach((menu) => { if (menu !== current) menu.open = false; });
        const anchor = current.querySelector('summary').getBoundingClientRect();
        const options = current.querySelector('.project-menu-options');
        options.style.left = `${Math.max(8, Math.min(anchor.right - options.offsetWidth, window.innerWidth - options.offsetWidth - 8))}px`;
        options.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - options.offsetHeight - 8))}px`;
      }
    }}>
      <summary aria-label={menuProps.label} title={menuProps.label}><svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg></summary>
      <div class="project-menu-options">{menuProps.children}</div>
    </details>;
  }

  return <section ref={workspace} class="project-workspace" aria-label="Project board">
    <header class="chat-header project-header">
      <h2>{board()?.name || props.projectName || 'Project'}</h2>
      <p class="muted">{preview() ? 'Preview' : board()?.closed ? 'Closed project' : 'Project workspace'}</p>
      <div class="chat-header-actions"><Show when={board()?.url}><a class="preview-badge" href={board().url} target="_blank" rel="noopener noreferrer">GitHub ↗</a></Show></div>
    </header>
    <Show when={error()}><div class="api-error" role="alert">{error()} <button type="button" aria-label="Dismiss project error" onClick={() => setError('')}>×</button></div></Show>
    <Show when={board()} fallback={<div class="project-empty"><p>{loading() ? 'Loading board…' : 'The board could not be loaded.'}</p><button type="button" disabled={loading()} onClick={() => load(true)}>Retry</button></div>}>
      <div class="project-toolbar">
        <span class="project-view-label">Board</span>
        <input type="search" aria-label="Filter project cards" placeholder="Filter cards" value={search()} onInput={(event) => setSearch(event.currentTarget.value)} />
        <Show when={!preview() && board().canUpdate}><select aria-label="Add topic to project" value="" disabled={adding() || Boolean(addUncertain())}
          onChange={(event) => { const id = Number(event.currentTarget.value); event.currentTarget.value = ''; addTopic(id); }}>
          <option value="">{adding() ? 'Adding…' : 'Add topic…'}</option>
          <For each={props.topics.filter((topic) => !board().items.some((item) => item.channelId === topic.id))}>{(topic) => <option value={topic.id}># {topic.name}</option>}</For>
        </select></Show>
        <Show when={canMove()}><button type="button" class="project-add-column" disabled={!canChangeColumns()} onClick={() => openEditor('column')}>+ Column</button></Show>
        <button type="button" class="project-refresh" disabled={loading() || preview()} onClick={() => load(true)} title="Refresh board">↻</button>
      </div>
      <Show when={board().description}><p class="project-description">{board().description}</p></Show>
      <Show when={!preview() && !board().canUpdate}><p class="project-description">Read-only project access.</p></Show>
      <Show when={!preview() && !board().statusField}><p class="project-description">Add a Status field in GitHub to organize this board into columns.</p></Show>
      <div class="project-board" aria-busy={loading()}>
        <For each={columns()}>{(column) => <section class="project-column" classList={{ 'is-pending': fieldBusy() }} aria-label={column.name}
          onDragOver={(event) => { if (dragging && canMove()) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
          onDrop={(event) => { event.preventDefault(); const item = board().items.find((entry) => entry.id === dragging); dragging = null; if (item) move(item, column.id); }}>
          <header class="project-column-header"><span class={`project-column-dot color-${column.color?.toLowerCase() || 'gray'}`} /><h3 title={column.description}>{column.name}</h3><small>{column.items.length}</small>
            <Show when={board().canUpdate && !preview()}>
              <Show when={column.id !== null}><Menu label={`Column actions for ${column.name}`}>
                <button type="button" disabled={!canChangeColumns()} onClick={() => openEditor('column', column)}>Edit details</button>
                <button type="button" disabled={!canChangeColumns() || board().statusField.options.length <= 1} onClick={() => requestRemoval('column', column)}>Delete column</button>
                <button type="button" disabled={!canChangeColumns() || board().statusField.options.findIndex((option) => option.id === column.id) === 0} onClick={() => shiftColumn(column, -1)}>Move left</button>
                <button type="button" disabled={!canChangeColumns() || board().statusField.options.at(-1)?.id === column.id} onClick={() => shiftColumn(column, 1)}>Move right</button>
              </Menu></Show>
              <button type="button" class="project-column-plus" aria-label={`Add item to ${column.name}`} title="Add item" disabled={adding() || Boolean(addUncertain()) || fieldBusy()} onClick={() => openDraft(column.id)}>+</button>
            </Show>
          </header>
          <div class="project-column-cards"><For each={column.items}>{(item) => <article class="project-card" classList={{ 'is-pending': busy()[item.id] || Boolean(uncertain()[item.id]) || item.syncState === 'confirming' }}
            draggable={Boolean(canMove() && !busy()[item.id] && !uncertain()[item.id] && !item.syncState && !item.temporary)}
            onDragStart={(event) => { dragging = item.id; event.dataTransfer.setData('text/plain', item.id); event.dataTransfer.effectAllowed = 'move'; }} onDragEnd={() => { dragging = null; }}>
            <div class="project-card-meta"><span>{item.type === 'DraftIssue' ? 'Draft' : item.number ? `#${item.number}` : item.type}</span><span>{item.state === 'CLOSED' || item.state === 'MERGED' ? 'Closed' : ''}</span>
              <Show when={board().canUpdate && !preview() && !item.temporary}><Menu label={`Actions for ${item.title}`}>
                <Show when={item.type === 'DraftIssue' || item.channelId} fallback={item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">Open in GitHub ↗</a> : null}>
                  <button type="button" disabled={busy()[item.id] || Boolean(item.syncState) || fieldBusy()} onClick={() => openEditor('item', item)}>Edit details</button>
                </Show>
                <button type="button" disabled={busy()[item.id] || Boolean(item.syncState) || fieldBusy()} onClick={() => requestRemoval('item', item)}>{item.type === 'DraftIssue' ? 'Delete' : 'Remove from project'}</button>
              </Menu></Show>
            </div>
            <Show when={item.channelId && props.topics.some((topic) => topic.id === item.channelId)} fallback={item.url ? <a class="project-card-title" href={item.url} target="_blank" rel="noopener noreferrer">{item.title} ↗</a> : item.type === 'DraftIssue' && !item.temporary && board().canUpdate ? <button type="button" class="project-card-title" onClick={() => openEditor('item', item)}>{item.title}</button> : <span class="project-card-title">{item.title}</span>}>
              <button type="button" class="project-card-title" onClick={() => props.onOpenTopic(item.channelId)}>{item.title}</button>
            </Show>
            <Show when={item.type === 'DraftIssue' && item.body}><p class="project-card-body">{item.body}</p></Show>
            <Show when={item.repository}><small class="project-card-repository">{item.repository}</small></Show>
            <Show when={canMove() && !item.temporary}><select aria-label={`Status for ${item.title}`} value={item.statusId || ''} disabled={busy()[item.id] || Boolean(uncertain()[item.id]) || Boolean(item.syncState)}
              onChange={(event) => { const target = event.currentTarget.value || null; event.currentTarget.value = item.statusId || ''; move(item, target); }}>
              <option value="">No status</option><For each={board().statusField.options}>{(option) => <option value={option.id}>{option.name}</option>}</For>
            </select></Show>
          </article>}</For><Show when={!column.items.length}><p class="project-column-empty">No items</p></Show></div>
          <Show when={board().canUpdate && !preview()}>
            <Show when={draftColumn() === column.id} fallback={<button type="button" class="project-add-item" disabled={adding() || Boolean(addUncertain()) || fieldBusy()} onClick={() => openDraft(column.id)}>+ Add item</button>}>
              <form class="project-draft-form" onSubmit={createDraft} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setDraftColumn(undefined); load(); } }}>
                <input type="text" required maxLength="256" aria-label={`New item in ${column.name}`} placeholder="Start typing to create an item" value={draftTitle()} ref={(element) => requestAnimationFrame(() => element.focus())} onInput={(event) => setDraftTitle(event.currentTarget.value)} />
                <div><button type="submit" disabled={!draftTitle().trim()}>Add</button><button type="button" onClick={() => { setDraftColumn(undefined); load(); }}>Cancel</button></div>
              </form>
            </Show>
          </Show>
        </section>}</For>
      </div>
    </Show>
    <dialog ref={editorDialog} class="topic-status-dialog project-editor-dialog" aria-labelledby="project-editor-title"
      onPointerDown={trackBackdrop} onClick={(event) => dismissBackdrop(event, editorBusy())}
      onCancel={(event) => { if (editorBusy()) event.preventDefault(); }} onClose={() => { setEditor(null); load(); }}>
      <form onSubmit={saveEditor} aria-busy={editorBusy()}>
        <h2 id="project-editor-title">{editor()?.kind === 'column' && !editor()?.value ? 'New column' : 'Edit details'}</h2>
        <label for="project-edit-title">{editor()?.kind === 'column' ? 'Name' : 'Title'}</label>
        <input id="project-edit-title" type="text" required maxLength="256" autofocus value={editTitle()} disabled={editorBusy() || editorUncertain()} onInput={(event) => setEditTitle(event.currentTarget.value)} />
        <label for="project-edit-body">Description</label>
        <textarea id="project-edit-body" rows="4" value={editBody()} disabled={editorBusy() || editorUncertain()} onInput={(event) => setEditBody(event.currentTarget.value)} />
        <Show when={editor()?.kind === 'column'}><label for="project-edit-color">Color</label>
          <select id="project-edit-color" value={editColor()} disabled={editorBusy() || editorUncertain()} onChange={(event) => setEditColor(event.currentTarget.value)}>
            <For each={['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE']}>{(color) => <option value={color}>{color[0] + color.slice(1).toLowerCase()}</option>}</For>
          </select>
        </Show>
        <Show when={editorError()}><p class="dialog-error" role="alert">{editorError()}</p></Show>
        <div class="dialog-actions"><button type="button" class="dialog-cancel" disabled={editorBusy()} onClick={() => editorDialog.close()}>Cancel</button><button type="submit" disabled={editorBusy() || editorUncertain() || !editTitle().trim()}>{editorBusy() ? 'Saving…' : 'Save'}</button></div>
      </form>
    </dialog>
    <dialog ref={removeDialog} class="topic-status-dialog" aria-labelledby="project-remove-title"
      onPointerDown={trackBackdrop} onClick={(event) => dismissBackdrop(event, removing())}
      onCancel={(event) => { if (removing()) event.preventDefault(); }} onClose={() => { setRemoval(null); load(); }}>
      <form onSubmit={confirmRemoval} aria-busy={removing()}>
        <h2 id="project-remove-title">{removal()?.kind === 'column' ? `Delete column ${removal().value.name}?` : removal()?.value.type === 'DraftIssue' ? 'Delete draft?' : 'Remove card?'}</h2>
        <Show when={removal()?.kind === 'column'}><p>Cards will move to No status.</p></Show>
        <Show when={removal()?.kind === 'item' && removal()?.value.type !== 'DraftIssue'}><p>The underlying issue and its messages are preserved.</p></Show>
        <Show when={removeError()}><p class="dialog-error" role="alert">{removeError()}</p></Show>
        <div class="dialog-actions"><button type="button" class="dialog-cancel" disabled={removing()} onClick={() => removeDialog.close()}>Cancel</button><button type="submit" disabled={removing() || removeUncertain()}>{removing() ? 'Removing…' : removal()?.kind === 'column' || removal()?.value.type === 'DraftIssue' ? 'Delete' : 'Remove'}</button></div>
      </form>
    </dialog>
  </section>;
}
