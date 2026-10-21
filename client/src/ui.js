import { batch, createEffect, createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { createGitHubClient, isConfigured, GITHUB_OWNER, GITHUB_REPO } from './api.js';

const formatTime = (date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const POLL_INTERVAL_MS = 10000;
const reactionSymbols = {
  '+1': ['👍', 'Thumbs up'], '-1': ['👎', 'Thumbs down'],
  laugh: ['😄', 'Laugh'], confused: ['😕', 'Confused'], heart: ['❤️', 'Heart'],
  hooray: ['🎉', 'Hooray'], rocket: ['🚀', 'Rocket'], eyes: ['👀', 'Eyes'],
};

export default function App() {
  const api = createGitHubClient();
  const [topics, setTopics] = createSignal([]);
  const [creatingTopic, setCreatingTopic] = createSignal(false);
  const [topicName, setTopicName] = createSignal('');
  const [activeId, setActiveId] = createSignal(null);
  const [messages, setMessages] = createSignal({});
  const [drafts, setDrafts] = createSignal({});
  const [creating, setCreating] = createSignal(false);
  const [createUncertain, setCreateUncertain] = createSignal(false);
  const [closing, setClosing] = createSignal({});
  const [statusChange, setStatusChange] = createSignal(null);
  const [statusError, setStatusError] = createSignal('');
  const [removeTarget, setRemoveTarget] = createSignal(null);
  const [removeError, setRemoveError] = createSignal('');
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [outbox, setOutbox] = createSignal({});
  const [error, setError] = createSignal('');
  const [syncing, setSyncing] = createSignal(false);
  const [lastSync, setLastSync] = createSignal(null);
  const topic = () => topics().find((item) => item.id === activeId());
  const statusLabel = (id) => {
    const change = closing()[id];
    if (!change) return '';
    return change.status === 'unconfirmed' ? 'Unconfirmed' : ({ closed: 'Closing…', open: 'Reopening…', archived: 'Archiving…', deleted: 'Deleting…' })[change.target];
  };
  const statusPending = () => closing()[statusChange()?.id]?.status === 'pending';
  const removalPending = () => closing()[removeTarget()?.id]?.status === 'pending';
  let backdropPointerDown = null;
  function outsideDialog(event) {
    const dialog = event.currentTarget;
    const bounds = dialog.getBoundingClientRect();
    return event.target === dialog && (
      event.clientX < bounds.left || event.clientX > bounds.right ||
      event.clientY < bounds.top || event.clientY > bounds.bottom
    );
  }
  function trackBackdrop(event) {
    backdropPointerDown = outsideDialog(event) ? event.currentTarget : null;
  }
  function dismissBackdrop(event, pending) {
    const startedOutside = backdropPointerDown === event.currentTarget;
    backdropPointerDown = null;
    if (startedOutside && outsideDialog(event) && !pending) event.currentTarget.close();
  }
  const currentMessages = () => messages()[activeId()] || [];
  const outgoing = () => outbox()[activeId()];
  const draft = () => drafts()[activeId()] || '';
  let messageList;
  let newTopicButton;
  let statusDialog;
  let removeDialog;
  let stopped = false;
  let syncingNow = false;
  let failures = 0;
  let nextAttempt = 0;
  let channelRevision = 0;

  onCleanup(() => { stopped = true; });

  // Never overlap refreshes. Errors back off, while GitHub rate-limit reset
  // times take precedence. Poll only while the tab is visible.
  async function refresh() {
    if (!isConfigured || stopped || syncingNow || Date.now() < nextAttempt) return;
    syncingNow = true;
    setSyncing(true);
    try {
      const revision = channelRevision;
      const allChannels = await api.listChannels({ includeClosed: true, includeArchived: true });
      const channels = allChannels.filter((item) => !item.archived);
      if (stopped) return;
      if (revision === channelRevision) {
        batch(() => {
          setTopics(channels);
          if (!channels.some((item) => item.id === activeId())) {
            setActiveId((channels.find((item) => item.state === 'open') || channels[0])?.id ?? null);
          }
          for (const [key, change] of Object.entries(closing())) {
            if (change?.status !== 'unconfirmed') continue;
            const id = Number(key);
            const item = allChannels.find((entry) => entry.id === id);
            const confirmed = change.target === 'deleted' ? !item
              : change.target === 'archived' ? item?.archived : item?.state === change.target;
            if (confirmed) {
              setClosing((previous) => ({ ...previous, [id]: null }));
              if (statusChange()?.id === id) statusDialog.close();
              if (removeTarget()?.id === id) removeDialog.close();
            }
          }
        });
      }
      await loadMessages(activeId());
      failures = 0;
      nextAttempt = 0;
      setLastSync(new Date());
    } catch (failure) {
      failures += 1;
      nextAttempt = Math.max(failure.retryAt || 0, Date.now() + Math.min(120000, POLL_INTERVAL_MS * 2 ** (failures - 1)));
      if (!stopped) setError(failure.message);
    } finally {
      syncingNow = false;
      if (!stopped) setSyncing(false);
    }
  }

  async function loadMessages(id) {
    if (id == null) return;
    const incoming = await api.readMessages(id);
    if (stopped) return;
    // Preserve a newly confirmed local send if this read started before it.
    setMessages((previous) => {
      const merged = new Map([...(previous[id] || []), ...incoming].map((item) => [item.id, item]));
      return { ...previous, [id]: [...merged.values()].sort((a, b) => a.id - b.id) };
    });
  }

  async function selectTopic(id) {
    setActiveId(id);
    try { await loadMessages(id); } catch (failure) { if (!stopped) setError(failure.message); }
  }

  onMount(() => {
    const refreshVisible = () => { if (!document.hidden) refresh(); };
    refreshVisible();
    const timer = setInterval(refreshVisible, POLL_INTERVAL_MS);
    document.addEventListener('visibilitychange', refreshVisible);
    onCleanup(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refreshVisible);
    });
  });

  function closeTopicForm() {
    if (creating()) return;
    setCreatingTopic(false);
    setTopicName('');
    newTopicButton.focus();
  }

  async function createTopic(event) {
    event.preventDefault();
    const name = topicName().trim();
    if (!name || creating() || createUncertain() || !isConfigured) return;
    setCreating(true);
    setError('');
    try {
      const created = await api.createChannel({ name });
      channelRevision += 1;
      setTopics((previous) => [...previous.filter((item) => item.id !== created.id), created]);
      setActiveId(created.id);
      setCreating(false);
      closeTopicForm();
    } catch (failure) {
      setCreateUncertain(failure.uncertain);
      setError(failure.message);
    } finally { setCreating(false); }
  }

  function requestStatusChange(item) {
    if (closing()[item.id] || !isConfigured) return;
    setStatusError('');
    setStatusChange({ id: item.id, name: item.name, target: item.state === 'open' ? 'closed' : 'open' });
    statusDialog.showModal();
  }

  function requestRemoval(item) {
    if (closing()[item.id] || !isConfigured) return;
    setRemoveError('');
    setConfirmDelete(false);
    setRemoveTarget({ id: item.id, name: item.name });
    removeDialog.showModal();
  }

  async function confirmRemoval(target) {
    const item = removeTarget();
    if (!item || closing()[item.id]) return;
    const id = item.id;
    setClosing((previous) => ({ ...previous, [id]: { target, status: 'pending' } }));
    setRemoveError('');
    try {
      if (target === 'deleted') await api.deleteChannel(id);
      else await api.archiveChannel(id);
      channelRevision += 1;
      batch(() => {
        const remaining = topics().filter((entry) => entry.id !== id);
        setTopics(remaining);
        if (activeId() === id) setActiveId((remaining.find((entry) => entry.state === 'open') || remaining[0])?.id ?? null);
        setClosing((previous) => ({ ...previous, [id]: null }));
      });
      removeDialog.close();
      newTopicButton.focus();
      try { await loadMessages(activeId()); } catch (failure) { setError(failure.message); }
    } catch (failure) {
      setClosing((previous) => ({ ...previous, [id]: failure.uncertain ? { target, status: 'unconfirmed' } : null }));
      setRemoveError(failure.uncertain ? 'Change unconfirmed. We’ll check during the next sync. Check GitHub before repeating this action.' : failure.message);
    }
  }

  async function confirmStatusChange(event) {
    event.preventDefault();
    const change = statusChange();
    if (!change || closing()[change.id]) return;
    const { id, target } = change;
    setClosing((previous) => ({ ...previous, [id]: { target, status: 'pending' } }));
    setStatusError('');
    try {
      const updated = await (target === 'closed' ? api.closeChannel(id) : api.reopenChannel(id));
      channelRevision += 1;
      batch(() => {
        setTopics((previous) => previous.map((item) => item.id === id ? updated : item));
        setClosing((previous) => ({ ...previous, [id]: null }));
      });
      statusDialog.close();
    } catch (failure) {
      setClosing((previous) => ({ ...previous, [id]: failure.uncertain ? { target, status: 'unconfirmed' } : null }));
      setStatusError(failure.uncertain
        ? 'Change unconfirmed. We’ll check GitHub during the next sync. You can dismiss this dialog; avoid repeating the action until confirmed.'
        : failure.message);
    }
  }

  createEffect(() => {
    currentMessages();
    requestAnimationFrame(() => {
      if (messageList?.isConnected) messageList.scrollTop = messageList.scrollHeight;
    });
  });

  async function sendMessage(event) {
    event.preventDefault();
    const text = draft().trim();
    if (!text || outgoing() || !isConfigured) return;
    const id = activeId();
    const pending = { text, time: new Date(), state: 'pending' };
    setOutbox((previous) => ({ ...previous, [id]: pending }));
    setDrafts((previous) => ({ ...previous, [id]: '' }));
    setError('');
    try {
      const sent = await api.sendMessage(id, text);
      setMessages((previous) => ({ ...previous, [id]: [...(previous[id] || []).filter((item) => item.id !== sent.id), sent].sort((a, b) => a.id - b.id) }));
      setOutbox((previous) => ({ ...previous, [id]: null }));
    } catch (failure) {
      if (failure.uncertain) {
        setOutbox((previous) => ({ ...previous, [id]: { ...pending, state: 'unconfirmed' } }));
      } else {
        setOutbox((previous) => ({ ...previous, [id]: null }));
        setDrafts((previous) => ({ ...previous, [id]: text + (previous[id] ? `\n${previous[id]}` : '') }));
      }
      setError(failure.message);
    }
  }

  return (
    <section class="app-shell">
      <aside class="sidebar" aria-label="Chat topics">
        <header class="workspace-header">
          <span class="workspace-icon" aria-hidden="true">ab</span>
          <div><h1>AbClient</h1><span class="muted">People &amp; agents</span></div>
        </header>
        <div class="sidebar-actions">
          <button
            ref={newTopicButton}
            type="button"
            class="new-topic-button"
            disabled={!isConfigured}
            aria-expanded={creatingTopic()}
            aria-controls="new-topic-form"
            onClick={() => creatingTopic() ? closeTopicForm() : setCreatingTopic(true)}
          >
            <span class="new-topic-plus" aria-hidden="true">+</span> New topic
          </button>
          <Show when={creatingTopic()}>
            <form id="new-topic-form" class="new-topic-form" onSubmit={createTopic}
              onKeyDown={(event) => { if (event.key === 'Escape') closeTopicForm(); }}>
              <label for="topic-name">Topic name</label>
              <input id="topic-name" name="topicName" type="text" required maxLength="80"
                value={topicName()} disabled={creating() || createUncertain()}
                ref={(element) => requestAnimationFrame(() => element.focus())}
                onInput={(event) => setTopicName(event.currentTarget.value)} />
              <div class="new-topic-form-actions">
                <button type="button" class="cancel-topic-button" disabled={creating()} onClick={closeTopicForm}>Cancel</button>
                <button type="submit" disabled={!topicName().trim() || creating() || createUncertain()}>{creating() ? 'Creating…' : createUncertain() ? 'Unconfirmed' : 'Create'}</button>
              </div>
            </form>
          </Show>
        </div>
        <div class="topic-list-heading">
          <div class="sidebar-label">Topics</div>
          <button type="button" class="topic-filter" aria-label="Filter topics (coming soon)" aria-disabled="true" title="Filter topics — coming soon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 6h4m4 0h10M3 12h10m4 0h4M3 18h2m4 0h12" />
              <circle cx="9" cy="6" r="2" />
              <circle cx="15" cy="12" r="2" />
              <circle cx="7" cy="18" r="2" />
            </svg>
          </button>
        </div>
        <nav class="channel-list" aria-label="Topics">
          <For each={topics()}>{(item) => (
            <div class="channel-row" classList={{ 'is-active': activeId() === item.id, 'is-pending': Boolean(closing()[item.id]) }} aria-busy={closing()[item.id]?.status === 'pending'}>
            <button
              type="button"
              class="channel-button"
              aria-current={activeId() === item.id ? 'page' : undefined}
              onClick={() => selectTopic(item.id)}
            >
              <span class="channel-hash" aria-hidden="true">#</span>{item.name}
              <Show when={closing()[item.id] || item.state === 'closed'}><small>{statusLabel(item.id) || 'Closed'}</small></Show>
            </button>
            <button type="button" class="remove-topic-button"
              disabled={Boolean(closing()[item.id])}
              aria-label={`Remove topic ${item.name}`} title={`Remove topic ${item.name}`}
              aria-haspopup="dialog" onClick={() => requestRemoval(item)}><span aria-hidden="true">−</span></button>
            </div>
          )}</For>
        </nav>
        <footer class="sidebar-footer">
          <span class="status-dot" classList={{ 'is-connected': Boolean(lastSync()) }} />
          <span title={lastSync()?.toLocaleString()}>{!isConfigured ? 'Not connected' : syncing() ? 'Syncing…' : lastSync() ? 'Connected to GitHub' : 'Connecting…'}</span>
        </footer>
      </aside>

      <Show when={topic()} fallback={
        <section class="chat-panel empty-chat">
          <h2>{!isConfigured ? 'Connect to GitHub' : syncing() ? 'Loading topics…' : 'No topics yet'}</h2>
          <p class="muted">{!isConfigured ? 'Fill in the token, owner, and repository in src/config.local.js.' : 'Create a topic to start a conversation.'}</p>
          <Show when={error()}><p class="api-error" role="alert">{error()}</p></Show>
          <button type="button" disabled={!isConfigured || syncing()} onClick={() => setCreatingTopic(true)}>New topic</button>
        </section>
      }>
      <section class="chat-panel" aria-label={`${topic().name} chat`}>
        <header class="chat-header">
          <h2><span class="channel-hash" aria-hidden="true">#</span> {topic().name}</h2>
          <p class="muted">{topic().description}</p>
          <div class="chat-header-actions">
            <a class="preview-badge" href={topic().url} target="_blank" rel="noreferrer">GitHub ↗</a>
          </div>
        </header>

        <Show when={error()}>
          <div class="api-error" role="alert">{error()} <button type="button" onClick={() => setError('')} aria-label="Dismiss error">×</button></div>
        </Show>

        <div class="chat-topic-controls">
          <button type="button" class="topic-status" classList={{ 'is-closed': topic().state === 'closed' }}
            disabled={Boolean(closing()[topic().id])} aria-haspopup="dialog"
            aria-label={`${topic().state === 'open' ? 'Open' : 'Closed'} topic: ${topic().state === 'open' ? 'close' : 'reopen'} ${topic().name}`}
            onClick={() => requestStatusChange(topic())}>
            <span class="topic-status-dot" aria-hidden="true" />{statusLabel(topic().id) || (topic().state === 'open' ? 'Open' : 'Closed')}
          </button>
        </div>
        <div ref={messageList} class="message-list" role="log" aria-label="Messages" aria-live="polite" aria-relevant="additions">
          <div class="conversation-start">
            <span class="conversation-icon" aria-hidden="true">#</span>
            <h3>Welcome to #{topic().name}</h3>
            <p class="muted">The beginning of this conversation.</p>
          </div>
          <For each={currentMessages()}>{(message) => (
            <article class="message">
              <span class="avatar" classList={{ 'avatar-you': message.author === 'You' }} aria-hidden="true">{(message.sender || message.author).slice(0, 1)}</span>
              <div class="message-content">
                <div class="message-meta">
                  <span class="message-author" title={message.sender ? `Declared sender: ${message.sender} · GitHub author: ${message.author}` : message.author}>{message.sender || message.author}</span>
                  <time dateTime={message.time.toISOString()}>{formatTime(message.time)}</time>
                </div>
                <p class="message-text">{message.text}</p>
                <Show when={message.reactions?.length}>
                  <div class="message-reactions" role="group" aria-label="Reactions">
                    <For each={message.reactions}>{(type) => (
                      <span role="img" aria-label={reactionSymbols[type][1]} title={reactionSymbols[type][1]}>{reactionSymbols[type][0]}</span>
                    )}</For>
                  </div>
                </Show>
              </div>
            </article>
          )}</For>
          <Show when={outgoing()}>{(entry) => (
            <article class="message is-pending" aria-busy={entry().state === 'pending'}>
              <span class="avatar avatar-you" aria-hidden="true">Y</span>
              <div class="message-content">
                <div class="message-meta"><span class="message-author">You</span><span class="delivery-state" role="status">{entry().state === 'pending' ? 'Sending…' : 'Delivery unconfirmed — check GitHub before resending'}</span></div>
                <p class="message-text">{entry().text}</p>
              </div>
            </article>
          )}</Show>
        </div>

        <form class="composer" onSubmit={sendMessage}>
          <div class="composer-box">
            <textarea
              aria-label={`Message #${topic().name}`}
              placeholder={`Message #${topic().name}`}
              rows="2"
              value={draft()}
              onInput={(event) => setDrafts((previous) => ({ ...previous, [activeId()]: event.currentTarget.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) sendMessage(event);
              }}
            />
            <button type="submit" disabled={!draft().trim() || Boolean(outgoing())}>Send <span aria-hidden="true">↗</span></button>
          </div>
          <p class="composer-hint">Enter to send · Shift + Enter for a new line <span>{GITHUB_OWNER}/{GITHUB_REPO} · Polling every {POLL_INTERVAL_MS / 1000}s</span></p>
        </form>
      </section>
      </Show>
      <dialog ref={statusDialog} class="topic-status-dialog" aria-labelledby="topic-status-title"
        onPointerDown={trackBackdrop} onClick={(event) => dismissBackdrop(event, statusPending())}
        onCancel={(event) => { if (statusPending()) event.preventDefault(); }}
        onClose={() => { setStatusChange(null); setStatusError(''); }}>
        <Show when={statusChange()}>{(change) => (
          <form onSubmit={confirmStatusChange} aria-busy={statusPending()}>
            <h2 id="topic-status-title">{change().target === 'closed' ? 'Close this topic?' : 'Reopen this topic?'}</h2>
            <Show when={statusError()}><p class="dialog-error" role="alert">{statusError()}</p></Show>
            <div class="dialog-actions">
              <button type="button" class="dialog-cancel" autofocus disabled={statusPending()} onClick={() => statusDialog.close()}>Cancel</button>
              <button type="submit" disabled={Boolean(closing()[change().id])}>{statusPending() ? statusLabel(change().id) : change().target === 'closed' ? 'Close topic' : 'Reopen topic'}</button>
            </div>
          </form>
        )}</Show>
      </dialog>
      <dialog ref={removeDialog} class="topic-status-dialog" aria-labelledby="remove-topic-title"
        onPointerDown={trackBackdrop} onClick={(event) => dismissBackdrop(event, removalPending())}
        onCancel={(event) => { if (removalPending()) event.preventDefault(); }}
        onClose={() => { setRemoveTarget(null); setRemoveError(''); setConfirmDelete(false); }}>
        <Show when={removeTarget()}>{(item) => (
          <div aria-busy={removalPending()}>
            <h2 id="remove-topic-title">{confirmDelete() ? 'Permanently Delete?' : `Remove ${item().name}`}</h2>
            <Show when={removeError()}><p class="dialog-error" role="alert">{removeError()}</p></Show>
            <Show when={removalPending()}><p role="status">{statusLabel(item().id)}</p></Show>
            <div class="dialog-actions">
              <Show when={confirmDelete()} fallback={<>
              <button type="button" disabled={Boolean(closing()[item().id])} onClick={() => confirmRemoval('archived')}>Archive</button>
              <button type="button" disabled={Boolean(closing()[item().id])} onClick={() => setConfirmDelete(true)}>Delete</button>
              <button type="button" autofocus disabled={removalPending()} onClick={() => removeDialog.close()}>Cancel</button>
              </>}>
                <button type="button" disabled={Boolean(closing()[item().id])} onClick={() => confirmRemoval('deleted')}>Yes</button>
                <button type="button" disabled={removalPending()} onClick={() => { setConfirmDelete(false); setRemoveError(''); }}>No</button>
              </Show>
            </div>
          </div>
        )}</Show>
      </dialog>
    </section>
  );
}
