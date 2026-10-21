import { batch, createEffect, createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { createGitHubClient, isConfigured, GITHUB_OWNER, GITHUB_REPO } from './api.js';

const formatTime = (date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

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
  const [outbox, setOutbox] = createSignal({});
  const [error, setError] = createSignal('');
  const [syncing, setSyncing] = createSignal(false);
  const [lastSync, setLastSync] = createSignal(null);
  const topic = () => topics().find((item) => item.id === activeId());
  const currentMessages = () => messages()[activeId()] || [];
  const outgoing = () => outbox()[activeId()];
  const draft = () => drafts()[activeId()] || '';
  let messageList;
  let newTopicButton;
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
      const channels = await api.listChannels();
      if (stopped) return;
      if (revision === channelRevision) {
        batch(() => {
          setTopics(channels);
          if (!channels.some((item) => item.id === activeId())) setActiveId(channels[0]?.id ?? null);
        });
      }
      await loadMessages(activeId());
      failures = 0;
      nextAttempt = 0;
      setLastSync(new Date());
    } catch (failure) {
      failures += 1;
      nextAttempt = Math.max(failure.retryAt || 0, Date.now() + Math.min(120000, 15000 * 2 ** (failures - 1)));
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
    refresh();
    const timer = setInterval(() => { if (!document.hidden) refresh(); }, 15000);
    onCleanup(() => clearInterval(timer));
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

  async function removeTopic(id) {
    if (closing()[id] || !isConfigured) return;
    setClosing((previous) => ({ ...previous, [id]: 'pending' }));
    setError('');
    try {
      await api.closeChannel(id);
      channelRevision += 1;
      const remaining = topics().filter((item) => item.id !== id);
      batch(() => {
        setTopics(remaining);
        if (activeId() === id) setActiveId(remaining[0]?.id ?? null);
      });
      setClosing((previous) => ({ ...previous, [id]: null }));
      newTopicButton.focus();
    } catch (failure) {
      setClosing((previous) => ({ ...previous, [id]: failure.uncertain ? 'unconfirmed' : null }));
      setError(failure.message);
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
        <div class="sidebar-label">Topics</div>
        <nav class="channel-list" aria-label="Topics">
          <For each={topics()}>{(item) => (
            <div class="channel-row" classList={{ 'is-active': activeId() === item.id, 'is-pending': Boolean(closing()[item.id]) }} aria-busy={closing()[item.id] === 'pending'}>
            <button
              type="button"
              class="channel-button"
              aria-current={activeId() === item.id ? 'page' : undefined}
              onClick={() => selectTopic(item.id)}
            >
              <span class="channel-hash" aria-hidden="true">#</span>{item.name}
              <Show when={closing()[item.id]}><small>{closing()[item.id] === 'pending' ? 'Closing…' : 'Unconfirmed'}</small></Show>
            </button>
            <button type="button" class="remove-topic-button"
              disabled={Boolean(closing()[item.id])}
              aria-label={`Remove topic ${item.name}`} title={`Remove topic ${item.name}`}
              onClick={() => removeTopic(item.id)}><span aria-hidden="true">−</span></button>
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
          <a class="preview-badge" href={topic().url} target="_blank" rel="noreferrer">GitHub ↗</a>
        </header>

        <Show when={error()}>
          <div class="api-error" role="alert">{error()} <button type="button" onClick={() => setError('')} aria-label="Dismiss error">×</button></div>
        </Show>

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
          <p class="composer-hint">Enter to send · Shift + Enter for a new line <span>{GITHUB_OWNER}/{GITHUB_REPO} · Polling every 15s</span></p>
        </form>
      </section>
      </Show>
    </section>
  );
}
