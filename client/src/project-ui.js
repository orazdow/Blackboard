import { createEffect, createSignal, For, Show, onCleanup, onMount, untrack } from 'solid-js';
import { boardColumns, createProjectTracker, previewBoard, sameProjectColumns } from './project-state.js';

/* Projects workspace, first pass.
 * TODO: custom visible fields, grouping/sorting configuration, and card ordering.
 * TODO: project creation, fields other than Status, and card ordering.
 * TODO: conversation side panel; currently cards open chat with Back to project.
 * Status is a project field. Moving cards never implicitly closes topics.
 */
export default function ProjectBoard(props) {
  const [board, setBoard] = createSignal(null);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal('');
  const [search, setSearch] = createSignal('');
  const [views, setViews] = createSignal([]);
  const [viewId, setViewId] = createSignal(null);
  const [filterIds, setFilterIds] = createSignal(null);
  const [viewBusy, setViewBusy] = createSignal(false);
  const [editLayout, setEditLayout] = createSignal('BOARD_LAYOUT');
  const [editFilter, setEditFilter] = createSignal('');
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
  const viewChanges = new Map();
  const activeView = () => views().find((view) => view.id === viewId());
  const tableLayout = () => activeView()?.layout === 'TABLE_LAYOUT';
  const supportedLayout = () => !activeView() || ['BOARD_LAYOUT', 'TABLE_LAYOUT'].includes(activeView().layout);
  const visibleItems = () => (board()?.items || []).filter((item) => filterIds() === null || filterIds().has(item.id));
  const tableItems = () => boardColumns({ ...board(), items: visibleItems() }, search()).flatMap((column) => column.items);
  const preview = () => props.projectId === 'preview';
  const columns = () => board() ? boardColumns({ ...board(), items: [...visibleItems(), ...(pendingDraft() ? [pendingDraft()] : [])] }, search()) : [];
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
    if (viewBusy() || draftColumn() !== undefined || editor() || removal() || workspace?.querySelector('.project-menu[open]')) return;
    const currentVersion = version;
    const currentRevision = revision;
    const id = props.projectId;
    setLoading(true);
    readPromise = Promise.all([props.api.readProject(id), props.api.listProjectViews(id)]);
    try {
      const [incoming, fetchedViews] = await readPromise;
      if (stopped || currentVersion !== version || currentRevision !== revision) return;
      const mergedViews = new Map(fetchedViews.map((view) => [view.id, view]));
      for (const [key, desired] of viewChanges) {
        const actual = mergedViews.get(key);
        if (desired === null) {
          mergedViews.delete(key);
          if (!actual) viewChanges.delete(key);
        } else if (actual && ['name', 'layout', 'filter'].every((field) => (actual[field] || '') === (desired[field] || ''))) viewChanges.delete(key);
        else mergedViews.set(key, desired);
      }
      const incomingViews = [...mergedViews.values()];
      const selected = incomingViews.find((view) => view.id === viewId()) || incomingViews[0];
      const matching = selected?.filter?.trim() ? new Set(await props.api.projectViewItemIds(id, selected.filter)) : null;
      if (stopped || currentVersion !== version || currentRevision !== revision) return;
      if (draftColumn() !== undefined || editor() || removal() || workspace?.querySelector('.project-menu[open]')) return;
      if (pendingField) {
        if (sameProjectColumns(incoming.statusField, pendingField)) pendingField = null;
        else incoming.statusField = pendingField;
      }
      setBoard({ ...incoming, items: tracker.reconcile(incoming.items) });
      setViews(incomingViews); setViewId(selected?.id || null); setFilterIds(matching);
      rememberView(selected?.id);
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
    viewChanges.clear(); setViews([]); setFilterIds(null);
    let saved = null;
    try { saved = sessionStorage.getItem(`blackboard:project:${id}:view`); } catch { /* Storage is optional. */ }
    setViewId(saved);
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

  function rememberView(id) {
    try {
      const key = `blackboard:project:${props.projectId}:view`;
      if (id) sessionStorage.setItem(key, id); else sessionStorage.removeItem(key);
    } catch { /* Storage is optional. */ }
  }

  async function selectView(view) {
    if (loading() || viewBusy() || Object.values(busy()).some(Boolean) || adding() || fieldBusy()) return;
    closeMenus(); setDraftColumn(undefined); setViewBusy(true); setError('');
    const currentVersion = version;
    revision++;
    try {
      const matching = view.filter?.trim() ? new Set(await props.api.projectViewItemIds(props.projectId, view.filter)) : null;
      if (stopped || currentVersion !== version) return;
      setViewId(view.id); setFilterIds(matching); setSearch(''); rememberView(view.id);
    } catch (failure) { if (!stopped && currentVersion === version) setError(failure.message); }
    finally { if (!stopped && currentVersion === version) setViewBusy(false); }
  }

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
    setEditLayout(kind === 'view' ? value?.layout || 'BOARD_LAYOUT' : 'BOARD_LAYOUT');
    setEditFilter(value?.filter || '');
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
      if (target.kind === 'view') {
        const changes = { name: editTitle(), layout: editLayout(), filter: editFilter() };
        const view = target.value?.id ? await props.api.updateProjectView(target.value.id, changes) : await props.api.createProjectView(props.projectId, changes);
        revision++; viewChanges.set(view.id, view);
        setViews((previous) => [...previous.filter((entry) => entry.id !== view.id), view].sort((a, b) => a.number - b.number));
        setViewId(view.id); rememberView(view.id);
        // Hide the old result until the saved filter has been evaluated.
        setFilterIds(view.filter?.trim() ? new Set() : null);
      } else if (target.kind === 'column') {
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
      if (failure.createdView) {
        const view = failure.createdView;
        revision++; viewChanges.set(view.id, view);
        setViews((previous) => [...previous.filter((entry) => entry.id !== view.id), view]);
        setEditor({ kind: 'view', value: view });
      }
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
      if (target.kind === 'view') {
        await props.api.deleteProjectView(target.value.id);
        revision++; viewChanges.set(target.value.id, null);
        setViews((previous) => previous.filter((view) => view.id !== target.value.id));
        if (viewId() === target.value.id) { setViewId(null); setFilterIds(null); rememberView(null); }
      } else if (target.kind === 'column') {
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
      <summary aria-label={menuProps.label} title={menuProps.label}><Show when={menuProps.label === 'New view'} fallback={<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" /></svg>}>+ New view</Show></summary>
      <div class="project-menu-options">{menuProps.children}</div>
    </details>;
  }

  function ItemTitle(itemProps) {
    const item = () => itemProps.item;
    return <Show when={item().channelId && props.topics.some((topic) => topic.id === item().channelId)} fallback={item().url
      ? <a class="project-card-title" href={item().url} target="_blank" rel="noopener noreferrer">{item().title} ↗</a>
      : item().type === 'DraftIssue' && !item().temporary && board().canUpdate
        ? <button type="button" class="project-card-title" onClick={() => openEditor('item', item())}>{item().title}</button>
        : <span class="project-card-title">{item().title}</span>}>
      <button type="button" class="project-card-title" onClick={() => props.onOpenTopic(item().channelId)}>{item().title}</button>
    </Show>;
  }

  function ItemStatus(itemProps) {
    return <Show when={canMove()} fallback={board().statusField?.options.find((option) => option.id === itemProps.item.statusId)?.name || 'No status'}>
      <select aria-label={`Status for ${itemProps.item.title}`} value={itemProps.item.statusId || ''}
        disabled={busy()[itemProps.item.id] || Boolean(uncertain()[itemProps.item.id]) || Boolean(itemProps.item.syncState)}
        onChange={(event) => { const target = event.currentTarget.value || null; event.currentTarget.value = itemProps.item.statusId || ''; move(itemProps.item, target); }}>
        <option value="">No status</option><For each={board().statusField.options}>{(option) => <option value={option.id}>{option.name}</option>}</For>
      </select>
    </Show>;
  }

  function ItemMenu(itemProps) {
    return <Show when={board().canUpdate && !preview()}><Menu label={`Actions for ${itemProps.item.title}`}>
      <Show when={itemProps.item.type === 'DraftIssue' || itemProps.item.channelId} fallback={itemProps.item.url ? <a href={itemProps.item.url} target="_blank" rel="noopener noreferrer">Open in GitHub ↗</a> : null}>
        <button type="button" disabled={busy()[itemProps.item.id] || Boolean(itemProps.item.syncState) || fieldBusy()} onClick={() => openEditor('item', itemProps.item)}>Edit details</button>
      </Show>
      <button type="button" disabled={busy()[itemProps.item.id] || Boolean(itemProps.item.syncState) || fieldBusy()} onClick={() => requestRemoval('item', itemProps.item)}>{itemProps.item.type === 'DraftIssue' ? 'Delete' : 'Remove from project'}</button>
    </Menu></Show>;
  }

  return <section ref={workspace} class="project-workspace" aria-label="Project workspace">
    <header class="chat-header project-header">
      <h2>{board()?.name || props.projectName || 'Project'}</h2>
      <p class="muted">{preview() ? 'Preview' : board()?.closed ? 'Closed project' : 'Project workspace'}</p>
      <div class="chat-header-actions"><Show when={board()?.url}><a class="preview-badge" href={board().url} target="_blank" rel="noopener noreferrer">GitHub ↗</a></Show></div>
    </header>
    <Show when={error()}><div class="api-error" role="alert">{error()} <button type="button" aria-label="Dismiss project error" onClick={() => setError('')}>×</button></div></Show>
    <Show when={board()} fallback={<div class="project-empty"><p>{loading() ? 'Loading board…' : 'The board could not be loaded.'}</p><button type="button" disabled={loading()} onClick={() => load(true)}>Retry</button></div>}>
      <nav class="project-views" aria-label="Project views" aria-busy={viewBusy()}>
        <For each={views()}>{(view) => <div class="project-view-tab" classList={{ 'is-active': viewId() === view.id }}>
          <button type="button" aria-current={viewId() === view.id ? 'page' : undefined} disabled={loading() || viewBusy() || adding() || fieldBusy() || Object.values(busy()).some(Boolean)} onClick={() => selectView(view)}>
            <span aria-hidden="true">{view.layout === 'TABLE_LAYOUT' ? '▤' : view.layout === 'BOARD_LAYOUT' ? '▥' : '◇'}</span> {view.name}
          </button>
          <Show when={board().canUpdate && !preview()}><Menu label={`View actions for ${view.name}`}>
            <button type="button" onClick={() => openEditor('view', view)}>Edit view</button>
            <button type="button" disabled={views().length <= 1} onClick={() => requestRemoval('view', view)}>Delete view</button>
          </Menu></Show>
        </div>}</For>
        <Show when={board().canUpdate && !preview()}><Menu label="New view">
          <button type="button" onClick={() => openEditor('view', { layout: 'TABLE_LAYOUT' })}>+ Table</button>
          <button type="button" onClick={() => openEditor('view', { layout: 'BOARD_LAYOUT' })}>+ Board</button>
        </Menu></Show>
      </nav>
      <div class="project-toolbar">
        <Show when={!views().length}><span class="project-view-label">Board</span></Show>
        <input type="search" aria-label="Filter project cards" placeholder="Filter cards" value={search()} onInput={(event) => setSearch(event.currentTarget.value)} />
        <Show when={!preview() && board().canUpdate}><select aria-label="Add topic to project" value="" disabled={adding() || Boolean(addUncertain())}
          onChange={(event) => { const id = Number(event.currentTarget.value); event.currentTarget.value = ''; addTopic(id); }}>
          <option value="">{adding() ? 'Adding…' : 'Add topic…'}</option>
          <For each={props.topics.filter((topic) => !board().items.some((item) => item.channelId === topic.id))}>{(topic) => <option value={topic.id}># {topic.name}</option>}</For>
        </select></Show>
        <Show when={canMove() && !tableLayout()}><button type="button" class="project-add-column" disabled={!canChangeColumns()} onClick={() => openEditor('column')}>+ Column</button></Show>
        <button type="button" class="project-refresh" disabled={loading() || preview()} onClick={() => load(true)} title="Refresh board">↻</button>
      </div>
      <Show when={activeView()?.filter}><p class="project-description project-saved-filter">Filter: <code>{activeView().filter}</code></p></Show>
      <Show when={board().description}><p class="project-description">{board().description}</p></Show>
      <Show when={!preview() && !board().canUpdate}><p class="project-description">Read-only project access.</p></Show>
      <Show when={!preview() && !board().statusField}><p class="project-description">Add a Status field in GitHub to organize this board into columns.</p></Show>
      <Show when={supportedLayout()} fallback={<p class="project-empty">Roadmap views can be opened on GitHub.</p>}>
      <Show when={!tableLayout()} fallback={<div class="project-table-wrap" aria-busy={loading() || viewBusy()}>
        <table class="project-table"><thead><tr><th scope="col">Title</th><th scope="col">Status</th><th scope="col">Repository</th><th scope="col">Type</th><th scope="col"><span class="sr-only">Actions</span></th></tr></thead>
          <tbody><For each={tableItems()}>{(item) => <tr classList={{ 'is-pending': busy()[item.id] || Boolean(uncertain()[item.id]) || Boolean(item.syncState) }}>
            <td><ItemTitle item={item} /></td><td><ItemStatus item={item} /></td><td>{item.repository || '—'}</td><td>{item.type === 'DraftIssue' ? 'Draft' : item.type === 'PullRequest' ? 'Pull request' : item.type}</td><td><ItemMenu item={item} /></td>
          </tr>}</For><Show when={!tableItems().length}><tr><td colSpan="5" class="project-column-empty">No items</td></tr></Show></tbody>
        </table>
        <Show when={board().canUpdate && !preview()}>
          <Show when={draftColumn() !== undefined} fallback={<button type="button" class="project-add-item" disabled={adding() || Boolean(addUncertain())} onClick={() => openDraft(null)}>+ Add item</button>}>
            <form class="project-draft-form" onSubmit={createDraft}>
              <input type="text" required maxLength="256" aria-label="New project item" placeholder="Start typing to create an item" value={draftTitle()} ref={(element) => requestAnimationFrame(() => element.focus())} onInput={(event) => setDraftTitle(event.currentTarget.value)} onKeyDown={(event) => { if (event.key === 'Escape') setDraftColumn(undefined); }} />
              <div><button type="submit" disabled={!draftTitle().trim()}>Add</button><button type="button" onClick={() => { setDraftColumn(undefined); load(); }}>Cancel</button></div>
            </form>
          </Show>
          <Show when={pendingDraft()}><p class="project-description is-pending">{pendingDraft().title}</p></Show>
        </Show>
      </div>}>
      <div class="project-board" aria-busy={loading() || viewBusy()}>
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
      </Show>
    </Show>
    <dialog ref={editorDialog} class="topic-status-dialog project-editor-dialog" aria-labelledby="project-editor-title"
      onPointerDown={trackBackdrop} onClick={(event) => dismissBackdrop(event, editorBusy())}
      onCancel={(event) => { if (editorBusy()) event.preventDefault(); }} onClose={() => { setEditor(null); load(); }}>
      <form onSubmit={saveEditor} aria-busy={editorBusy()}>
        <h2 id="project-editor-title">{editor()?.kind === 'view' ? editor()?.value?.id ? 'Edit view' : 'New view' : editor()?.kind === 'column' && !editor()?.value ? 'New column' : 'Edit details'}</h2>
        <label for="project-edit-title">{editor()?.kind === 'item' ? 'Title' : 'Name'}</label>
        <input id="project-edit-title" type="text" required maxLength="256" autofocus value={editTitle()} disabled={editorBusy() || editorUncertain()} onInput={(event) => setEditTitle(event.currentTarget.value)} />
        <Show when={editor()?.kind === 'view'} fallback={<>
        <label for="project-edit-body">Description</label>
        <textarea id="project-edit-body" rows="4" value={editBody()} disabled={editorBusy() || editorUncertain()} onInput={(event) => setEditBody(event.currentTarget.value)} />
        </>}>
          <label for="project-view-layout">Layout</label>
          <select id="project-view-layout" value={editLayout()} disabled={editorBusy() || editorUncertain()} onChange={(event) => setEditLayout(event.currentTarget.value)}>
            <option value="BOARD_LAYOUT">Board</option><option value="TABLE_LAYOUT">Table</option>
          </select>
          <label for="project-view-filter">Filter</label>
          <input id="project-view-filter" type="text" placeholder={'status:"In progress"'} value={editFilter()} disabled={editorBusy() || editorUncertain()} onInput={(event) => setEditFilter(event.currentTarget.value)} />
          <p class="muted project-filter-help">Optional GitHub filter, such as is:open or status:Done. Empty shows all items.</p>
        </Show>
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
        <h2 id="project-remove-title">{removal()?.kind === 'view' ? `Delete view ${removal().value.name}?` : removal()?.kind === 'column' ? `Delete column ${removal().value.name}?` : removal()?.value.type === 'DraftIssue' ? 'Delete draft?' : 'Remove card?'}</h2>
        <Show when={removal()?.kind === 'view'}><p>Project items are preserved.</p></Show>
        <Show when={removal()?.kind === 'column'}><p>Cards will move to No status.</p></Show>
        <Show when={removal()?.kind === 'item' && removal()?.value.type !== 'DraftIssue'}><p>The underlying issue and its messages are preserved.</p></Show>
        <Show when={removeError()}><p class="dialog-error" role="alert">{removeError()}</p></Show>
        <div class="dialog-actions"><button type="button" class="dialog-cancel" disabled={removing()} onClick={() => removeDialog.close()}>Cancel</button><button type="submit" disabled={removing() || removeUncertain()}>{removing() ? 'Removing…' : removal()?.kind === 'view' || removal()?.kind === 'column' || removal()?.value.type === 'DraftIssue' ? 'Delete' : 'Remove'}</button></div>
      </form>
    </dialog>
  </section>;
}
