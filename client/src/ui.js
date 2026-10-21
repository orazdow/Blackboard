import { batch, createEffect, createSignal, For, Show, onMount, onCleanup } from 'solid-js';
import { createGitHubClient, isDiscussionId } from './api.js';
import { createCredentialStore } from './credentials.js';
import ProjectBoard from './project-ui.js';
import RepositorySelector from './repository-ui.js';
import { parseRepository, repositoryKey, repositoryName } from './repository-state.js';
import { createTopicTracker, topicRows } from './topic-state.js';
import { messageBlocks, messageTokens, quoteReply } from './message-format.js';
import { createMilestoneTracker, sortMilestones } from './milestone-state.js';

const formatTime = (date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
const POLL_INTERVAL_MS = 10000;
const reactionSymbols = {
  '+1': ['👍', 'Thumbs up'], '-1': ['👎', 'Thumbs down'],
  laugh: ['😄', 'Laugh'], confused: ['😕', 'Confused'], heart: ['❤️', 'Heart'],
  hooray: ['🎉', 'Hooray'], rocket: ['🚀', 'Rocket'], eyes: ['👀', 'Eyes'],
};

export default function App(props = {}) {
  const defaults = parseRepository(props.defaultRepository || 'orazdow/Blackboard');
  let storage;
  try { storage = localStorage; } catch { /* In-memory credentials still work. */ }
  const credentials = createCredentialStore(storage);
  let initial = defaults;
  try {
    const requested = new URL(window.location.href).searchParams.get('repo');
    if (requested) initial = parseRepository(requested);
    else {
      const saved = sessionStorage.getItem('blackboard:active-repository');
      if (saved) initial = parseRepository(saved);
    }
  } catch { /* Invalid saved selections fall back to local configuration. */ }
  const [connection, setConnection] = createSignal({ repository: initial, credentials: credentials.get(initial) });
  const repository = () => connection().repository;
  const [permitted, setPermitted] = createSignal(false);
  const sessionState = new Map();
  function connect(next, tokens, remember) {
    const saved = credentials.save(next, tokens, remember);
    try {
      sessionStorage.setItem('blackboard:active-repository', repositoryName(next));
    } catch { /* Switching still works without browser storage. */ }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('repo', repositoryName(next));
      history.replaceState(null, '', url);
    } catch { /* URL updates are optional. */ }
    batch(() => { setPermitted(true); setConnection({ repository: next, credentials: saved }); });
  }
  function forget() {
    credentials.forget(repository());
    batch(() => { setPermitted(false); setConnection({ repository: repository(), credentials: null }); });
  }
  return <Show when={connection()} keyed>{(selected) => <Workspace repository={selected.repository} credentials={selected.credentials}
    permitted={permitted()} onConnect={connect} onForget={forget} getCredentials={(repo) => credentials.get(repo)}
    onAccessChange={(value) => { if (connection() === selected) setPermitted(value); }}
    sessionState={sessionState} discussionsEnabled={props.discussionsEnabled} />}</Show>;
}

function Workspace(props) {
  const GITHUB_OWNER = props.repository.owner;
  const GITHUB_REPO = props.repository.repo;
  const isConfigured = Boolean(props.credentials?.token && GITHUB_OWNER && GITHUB_REPO);
  const isProjectConfigured = Boolean(props.credentials?.projectToken);
  const topicSelectionKey = `blackboard:${GITHUB_OWNER}/${GITHUB_REPO}:topic`;
  const milestonesExpandedKey = `blackboard:${GITHUB_OWNER}/${GITHUB_REPO}:milestones-expanded`;
  const sidebarSectionKey = `blackboard:${GITHUB_OWNER}/${GITHUB_REPO}:sidebar-section`;
  const activeMilestoneKey = `blackboard:${GITHUB_OWNER}/${GITHUB_REPO}:milestone`;
  const activeProjectKey = `blackboard:${GITHUB_OWNER}/${GITHUB_REPO}:project`;
  const topicKindKey = `blackboard:${GITHUB_OWNER}/${GITHUB_REPO}:new-topic-kind`;
  const storedTopicId = (value) => isDiscussionId(value) ? value : Number(value);
  const compareMessages = (a, b) => a.time - b.time || String(a.id).localeCompare(String(b.id), undefined, { numeric: true });
  function savedTopicKind() {
    try { return localStorage.getItem(topicKindKey) === 'discussion' ? 'discussion' : 'task'; }
    catch { return 'task'; }
  }
  function savedProject() {
    try {
      const id = sessionStorage.getItem(activeProjectKey);
      return id && id !== 'preview' ? id : null;
    }
    catch { return null; }
  }
  function savedMilestone() {
    try {
      const id = Number(sessionStorage.getItem(activeMilestoneKey));
      return Number.isSafeInteger(id) && id > 0 ? id : null;
    } catch { return null; }
  }
  const formatDueDate = (date) => new Date(`${date}T00:00:00`).toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
  function savedSidebarSection() {
    try {
      const saved = localStorage.getItem(sidebarSectionKey);
      if (saved !== null) return ['projects', 'milestones'].includes(saved) ? saved : null;
      return localStorage.getItem(milestonesExpandedKey) === 'true' ? 'milestones' : null;
    } catch { return null; }
  }
  function savedTopic() {
    try {
      const id = storedTopicId(sessionStorage.getItem(topicSelectionKey));
      return isDiscussionId(id) || Number.isSafeInteger(id) && id > 0 ? id : null;
    } catch { return null; }
  }

  const discussionsEnabled = props.discussionsEnabled === true;
  const api = createGitHubClient({ owner: GITHUB_OWNER, repo: GITHUB_REPO, token: props.credentials?.token || '', projectToken: props.credentials?.projectToken || '' });
  const topicTracker = createTopicTracker();
  const milestoneTracker = createMilestoneTracker();
  const [topics, setTopics] = createSignal([]);
  const [projects, setProjects] = createSignal([]);
  const [projectsLoading, setProjectsLoading] = createSignal(false);
  const [projectsError, setProjectsError] = createSignal('');
  const [activeProjectId, setActiveProjectId] = createSignal(isConfigured && isProjectConfigured ? savedProject() : null);
  const [returnProjectId, setReturnProjectId] = createSignal(null);
  createEffect(() => {
    const id = activeProjectId();
    try {
      if (id) sessionStorage.setItem(activeProjectKey, id);
      else sessionStorage.removeItem(activeProjectKey);
    } catch { /* Navigation still works without storage. */ }
  });
  const [knownTags, setKnownTags] = createSignal([]);
  const [tagEditing, setTagEditing] = createSignal(null);
  const [tagDrafts, setTagDrafts] = createSignal({});
  const [tagOperations, setTagOperations] = createSignal({});
  const [milestones, setMilestones] = createSignal([]);
  const [milestonesLoaded, setMilestonesLoaded] = createSignal(false);
  const [activeMilestoneId, setActiveMilestoneId] = createSignal(isConfigured ? savedMilestone() : null);
  const selectedMilestone = () => milestones().find((item) => item.id === activeMilestoneId());
  const [milestoneEditing, setMilestoneEditing] = createSignal(null);
  const [milestoneName, setMilestoneName] = createSignal('');
  const [milestoneDescription, setMilestoneDescription] = createSignal('');
  const [milestoneDueDate, setMilestoneDueDate] = createSignal('');
  const [milestoneSaving, setMilestoneSaving] = createSignal(false);
  const [milestoneUncertain, setMilestoneUncertain] = createSignal(false);
  const [milestoneFormError, setMilestoneFormError] = createSignal('');
  const [milestoneStateBusy, setMilestoneStateBusy] = createSignal(false);
  const [assignmentBusy, setAssignmentBusy] = createSignal({});
  createEffect(() => {
    const id = activeMilestoneId();
    try {
      if (id === null) sessionStorage.removeItem(activeMilestoneKey);
      else sessionStorage.setItem(activeMilestoneKey, String(id));
    } catch { /* Navigation still works without storage. */ }
  });
  const [expandedSidebarSection, setExpandedSidebarSection] = createSignal(savedSidebarSection());
  const milestonesExpanded = () => expandedSidebarSection() === 'milestones';
  const projectsExpanded = () => expandedSidebarSection() === 'projects';
  const toggleSidebarSection = (section) => setExpandedSidebarSection((previous) => previous === section ? null : section);
  createEffect(() => {
    const expanded = expandedSidebarSection();
    try { localStorage.setItem(sidebarSectionKey, expanded || ''); }
    catch { /* The section still toggles when browser storage is unavailable. */ }
  });
  const [creatingTopic, setCreatingTopic] = createSignal(false);
  const [topicKind, setTopicKind] = createSignal(savedTopicKind());
  const creationKind = () => !discussionsEnabled || topicParent() ? 'task' : topicKind();
  function chooseTopicKind(kind) {
    setTopicKind(kind);
    try { localStorage.setItem(topicKindKey, kind); } catch { /* Storage is optional. */ }
  }
  const [topicParent, setTopicParent] = createSignal(null);
  const [collapsedTopics, setCollapsedTopics] = createSignal(new Set());
  const visibleTopics = () => topicRows(topics(), collapsedTopics());
  const [topicName, setTopicName] = createSignal('');
  const restoredTopic = savedTopic();
  const [activeId, setActiveId] = createSignal(!discussionsEnabled && isDiscussionId(restoredTopic) ? null : restoredTopic);
  createEffect(() => {
    const id = activeId();
    try {
      if (id === null) sessionStorage.removeItem(topicSelectionKey);
      else sessionStorage.setItem(topicSelectionKey, String(id));
    } catch { /* Selection still works when browser storage is unavailable. */ }
  });
  const [messages, setMessages] = createSignal({});
  const workspaceKey = repositoryKey(props.repository);
  const draftKey = `blackboard:${workspaceKey}:drafts`;
  let restoredDrafts = props.sessionState.get(workspaceKey)?.drafts || {};
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) restoredDrafts = Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === 'string'));
  } catch { /* Drafts still survive workspace switches in memory. */ }
  const [drafts, setDrafts] = createSignal(restoredDrafts);
  createEffect(() => { try { sessionStorage.setItem(draftKey, JSON.stringify(drafts())); } catch { /* Storage is optional. */ } });
  const [creating, setCreating] = createSignal(false);
  const [createUncertain, setCreateUncertain] = createSignal(false);
  const [pendingTopic, setPendingTopic] = createSignal(null);
  const [closing, setClosing] = createSignal({});
  const [statusChange, setStatusChange] = createSignal(null);
  const [statusError, setStatusError] = createSignal('');
  const [removeTarget, setRemoveTarget] = createSignal(null);
  const [removeError, setRemoveError] = createSignal('');
  const [confirmDelete, setConfirmDelete] = createSignal(false);
  const [reactionTarget, setReactionTarget] = createSignal(null);
  const [reactionRecords, setReactionRecords] = createSignal([]);
  const [reactionViewer, setReactionViewer] = createSignal(null);
  const [reactionLoading, setReactionLoading] = createSignal(false);
  const [reactionBusy, setReactionBusy] = createSignal(false);
  const [reactionError, setReactionError] = createSignal('');
  const ownReaction = (type) => reactionRecords().find((entry) => entry.type === type && entry.author === reactionViewer());
  const [outbox, setOutbox] = createSignal(props.sessionState.get(workspaceKey)?.outbox || {});
  const [projectWriting, setProjectWriting] = createSignal(false);
  const switchingDisabled = () => creating() || milestoneSaving() || milestoneStateBusy() || reactionBusy() || projectWriting()
    || Object.values(assignmentBusy()).some(Boolean)
    || Object.values(closing()).some((change) => change?.status === 'pending')
    || Object.values(tagOperations()).some((operation) => operation?.status === 'pending')
    || Object.values(outbox()).some((entry) => entry?.state === 'pending');
  onCleanup(() => props.sessionState.set(workspaceKey, { drafts: drafts(), outbox: outbox() }));
  const [error, setError] = createSignal('');
  const [syncing, setSyncing] = createSignal(false);
  const [syncFailed, setSyncFailed] = createSignal(false);
  const [lastSync, setLastSync] = createSignal(null);
  const syncDescription = () => !isConfigured ? 'GitHub is not configured'
    : syncing() ? 'Syncing with GitHub'
    : syncFailed() ? 'GitHub sync failed; waiting to retry'
    : lastSync() ? `Last synced ${lastSync().toLocaleString()}` : 'Waiting to sync with GitHub';
  const topic = () => topics().find((item) => item.id === activeId());
  const displayedTags = () => {
    const tags = topic()?.tags || [];
    const operation = tagOperations()[activeId()];
    return operation?.target === 'add' && !tags.some((tag) => tag.name.toLowerCase() === operation.name.toLowerCase())
      ? [...tags, { name: operation.name, color: '52769b', description: '' }] : tags;
  };
  const topicMilestoneLabel = () => {
    const id = topic()?.milestoneId;
    return id ? milestones().find((item) => item.id === id)?.name || `Milestone #${id}` : 'Milestones';
  };
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
  let composerInput;
  let newTopicButton;
  let statusDialog;
  let removeDialog;
  let reactionDialog;
  let milestoneDialog;
  let reactionLoadVersion = 0;
  const messageRevisions = new Map();
  let stopped = false;
  let syncingNow = false;
  let failures = 0;
  let nextAttempt = 0;
  let channelRevision = 0;
  let milestoneRevision = 0;
  let projectsNextAttempt = 0;
  let projectFailures = 0;
  let discussionsNextAttempt = 0;
  let discussionFailures = 0;
  let discussionFailure = null;
  let discussionSnapshot = [];

  async function loadDiscussions() {
    if (!discussionsEnabled) return { items: [], failure: null };
    if (Date.now() < discussionsNextAttempt) return { items: discussionSnapshot, failure: discussionFailure };
    try {
      discussionSnapshot = await api.listDiscussions({ includeClosed: true, includeArchived: true });
      discussionFailures = 0; discussionFailure = null; discussionsNextAttempt = 0;
    } catch (failure) {
      discussionFailure = failure;
      discussionsNextAttempt = Math.max(failure.retryAt || 0, Date.now() + Math.min(120000, POLL_INTERVAL_MS * 2 ** discussionFailures++));
    }
    return { items: discussionSnapshot, failure: discussionFailure };
  }

  onCleanup(() => { stopped = true; });

  // Never overlap refreshes. Errors back off, while GitHub rate-limit reset
  // times take precedence. Poll only while the tab is visible.
  async function refresh() {
    if (!isConfigured || stopped || syncingNow || Date.now() < nextAttempt) return;
    syncingNow = true;
    setSyncing(true);
    try {
      const revision = channelRevision;
      // These share the issue-list requests, including pagination and conditional reads.
      const [issueChannels, incomingTags, discussionRead] = await Promise.all([
        api.listChannels({ includeClosed: true, includeArchived: true, includeHierarchy: true }),
        api.listTags(),
        loadDiscussions(),
      ]);
      if (stopped) return;
      props.onAccessChange(true);
      // A discussion permission failure must not hide or prevent reading tasks.
      const discussions = discussionRead.items;
      const allChannels = [...issueChannels, ...discussions];
      if (discussionRead.failure) setError(`Discussions: ${discussionRead.failure.message}`);
      if (revision === channelRevision) {
        batch(() => {
          const channels = topicTracker.reconcile(allChannels).filter((item) => !item.archived);
          setTopics(channels);
          setKnownTags([...new Map([...incomingTags, ...channels.flatMap((item) => item.tags)].map((tag) => [tag.name.toLowerCase(), tag])).values()]);
          if (!channels.some((item) => item.id === activeId())) {
            setActiveId((channels.find((item) => item.state === 'open') || channels[0])?.id ?? null);
          }
          for (const [key, change] of Object.entries(closing())) {
            if (change?.status !== 'unconfirmed') continue;
            const id = storedTopicId(key);
            if (isDiscussionId(id) && discussionRead.failure) continue;
            const item = allChannels.find((entry) => entry.id === id);
            const confirmed = change.target === 'deleted' ? !item
              : change.target === 'archived' ? item?.archived : item?.state === change.target;
            if (confirmed) {
              setClosing((previous) => ({ ...previous, [id]: null }));
              if (statusChange()?.id === id) statusDialog.close();
              if (removeTarget()?.id === id) removeDialog.close();
            }
          }
          for (const [key, operation] of Object.entries(tagOperations())) {
            if (operation?.status !== 'unconfirmed') continue;
            const item = allChannels.find((entry) => entry.id === storedTopicId(key));
            if (!item) continue;
            const present = item.tags.some((tag) => tag.name.toLowerCase() === operation.name.toLowerCase());
            if (present === (operation.target === 'add')) setTagOperations((previous) => ({ ...previous, [key]: null }));
          }
        });
      }
      const milestoneReadRevision = milestoneRevision;
      const incomingMilestones = await api.listMilestones({ includeClosed: true });
      if (stopped) return;
      if (milestoneReadRevision === milestoneRevision) {
        setMilestones(milestoneTracker.reconcile(incomingMilestones));
        setMilestonesLoaded(true);
      }
      if (activeMilestoneId() === null && activeProjectId() === null) await loadMessages(activeId());
      if (projectsExpanded() || activeProjectId() || returnProjectId()) loadProjects();
      failures = 0;
      nextAttempt = 0;
      setLastSync(new Date());
      setSyncFailed(Boolean(discussionRead.failure));
    } catch (failure) {
      failures += 1;
      nextAttempt = Math.max(failure.retryAt || 0, Date.now() + Math.min(120000, POLL_INTERVAL_MS * 2 ** (failures - 1)));
      if (!stopped) {
        if ([401, 403, 404].includes(failure.status)) props.onAccessChange(false);
        setSyncFailed(true);
        setError(failure.message);
      }
    } finally {
      syncingNow = false;
      if (!stopped) setSyncing(false);
    }
  }

  async function loadMessages(id) {
    if (id == null) return;
    const revision = messageRevisions.get(id);
    const incoming = await api.readMessages(id);
    if (stopped || messageRevisions.get(id) !== revision) return;
    // Preserve a newly confirmed local send if this read started before it.
    setMessages((previous) => {
      const merged = new Map([...(previous[id] || []), ...incoming].map((item) => [item.id, item]));
      return { ...previous, [id]: [...merged.values()].sort(compareMessages) };
    });
  }

  async function selectTopic(id, fromProject = null) {
    setActiveProjectId(null);
    setReturnProjectId(fromProject);
    setTagEditing(null);
    setActiveMilestoneId(null);
    setCollapsedTopics((previous) => {
      const next = new Set(previous);
      const seen = new Set();
      let parent = topics().find((item) => item.id === id)?.parentId;
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        next.delete(parent);
        parent = topics().find((item) => item.id === parent)?.parentId;
      }
      return next;
    });
    setActiveId(id);
    try { await loadMessages(id); } catch (failure) { if (!stopped) setError(failure.message); }
  }

  function selectMilestone(id) {
    setActiveProjectId(null);
    setReturnProjectId(null);
    setTagEditing(null);
    setActiveMilestoneId(id);
  }

  async function loadProjects(force = false) {
    if (!isProjectConfigured || stopped || projectsLoading() || (!force && Date.now() < projectsNextAttempt)) return;
    setProjectsLoading(true);
    try {
      const incoming = await api.listProjects();
      if (!stopped) { setProjects(incoming); setProjectsError(''); }
      projectFailures = 0;
      projectsNextAttempt = Date.now() + 30000;
    } catch (failure) {
      if (!stopped) setProjectsError(failure.message);
      projectFailures++;
      projectsNextAttempt = Math.max(failure.retryAt || 0, Date.now() + Math.min(120000, 10000 * 2 ** (projectFailures - 1)));
    } finally { if (!stopped) setProjectsLoading(false); }
  }

  function selectProject(id) {
    setActiveMilestoneId(null);
    setReturnProjectId(null);
    setTagEditing(null);
    setExpandedSidebarSection('projects');
    setActiveProjectId(id);
  }

  createEffect(() => { if (projectsExpanded()) queueMicrotask(() => loadProjects()); });

  function startTag() {
    const id = activeId();
    if (tagOperations()[id]) return;
    setTagEditing(id);
  }

  async function changeTag(id, name, target) {
    name = name.trim();
    if (!name || tagOperations()[id]) return;
    if (target === 'add' && topics().find((item) => item.id === id)?.tags.some((tag) => tag.name.toLowerCase() === name.toLowerCase())) {
      setTagEditing(null);
      setTagDrafts((previous) => ({ ...previous, [id]: '' }));
      return;
    }
    setTagOperations((previous) => ({ ...previous, [id]: { name, target, status: 'pending' } }));
    if (target === 'add') {
      setTagEditing(null);
      setTagDrafts((previous) => ({ ...previous, [id]: '' }));
    }
    try {
      const tags = await (target === 'add' ? api.addChannelTag(id, name) : api.removeChannelTag(id, name));
      rememberChange({ id, tags });
      setKnownTags((previous) => [...new Map([...previous, ...tags].map((tag) => [tag.name.toLowerCase(), tag])).values()]);
      setTagOperations((previous) => ({ ...previous, [id]: null }));
      refresh();
    } catch (failure) {
      const unconfirmed = failure.uncertain && !failure.tagNotApplied;
      setTagOperations((previous) => ({ ...previous, [id]: unconfirmed ? { name, target, status: 'unconfirmed' } : null }));
      if (target === 'add' && !unconfirmed) {
        setTagDrafts((previous) => ({ ...previous, [id]: name }));
        if (activeId() === id && activeMilestoneId() === null) setTagEditing(id);
      }
      setError(failure.message);
    }
  }

  function rememberMilestone(item) {
    milestoneRevision++;
    const updated = milestoneTracker.remember(item);
    setMilestones((previous) => sortMilestones([...previous.filter((entry) => entry.id !== item.id), updated]));
  }

  function editMilestone(item = null) {
    setMilestoneEditing(item);
    setMilestoneName(item?.name || '');
    setMilestoneDescription(item?.description || '');
    setMilestoneDueDate(item?.dueDate || '');
    setMilestoneFormError('');
    setMilestoneUncertain(false);
    milestoneDialog.showModal();
  }

  async function saveMilestone(event) {
    event.preventDefault();
    if (milestoneSaving() || milestoneUncertain() || !milestoneName().trim()) return;
    const editing = milestoneEditing();
    setMilestoneSaving(true);
    setMilestoneFormError('');
    try {
      const details = { name: milestoneName(), description: milestoneDescription(), dueDate: milestoneDueDate() || null };
      const saved = await (editing ? api.updateMilestone(editing.id, details) : api.createMilestone(details));
      rememberMilestone(saved);
      setExpandedSidebarSection('milestones');
      selectMilestone(saved.id);
      milestoneDialog.close();
      refresh();
    } catch (failure) {
      setMilestoneUncertain(Boolean(failure.uncertain));
      setMilestoneFormError(failure.message);
    } finally { setMilestoneSaving(false); }
  }

  async function toggleMilestoneState() {
    const item = selectedMilestone();
    if (!item || milestoneStateBusy()) return;
    setMilestoneStateBusy(true);
    try {
      rememberMilestone(await api.updateMilestone(item.id, { state: item.state === 'open' ? 'closed' : 'open' }));
      refresh();
    } catch (failure) { setError(failure.message); }
    finally { setMilestoneStateBusy(false); }
  }

  async function assignMilestone(id, milestoneId) {
    if (assignmentBusy()[id]) return;
    setAssignmentBusy((previous) => ({ ...previous, [id]: true }));
    try {
      const updated = await api.setChannelMilestone(id, milestoneId);
      rememberChange({ ...updated, parentId: topics().find((item) => item.id === id)?.parentId ?? null });
      refresh();
    } catch (failure) { setError(failure.message); }
    finally { setAssignmentBusy((previous) => ({ ...previous, [id]: false })); }
  }

  function MilestoneOverview() {
    const linkedTopics = () => topics().filter((item) => item.milestoneId === activeMilestoneId());
    return <Show when={selectedMilestone()} fallback={
      <section class="chat-panel empty-chat">
        <h2>{milestonesLoaded() ? 'Milestone unavailable' : 'Loading milestone…'}</h2>
        <Show when={error()}><p class="api-error" role="alert">{error()}</p></Show>
        <button type="button" onClick={() => setActiveMilestoneId(null)}>Back to topics</button>
      </section>
    }>{(item) => <section class="chat-panel milestone-overview" aria-label={`${item().name} milestone`}>
      <header class="chat-header">
        <h2>{item().name}</h2><p class="muted">Milestone</p>
        <div class="chat-header-actions"><a class="preview-badge" href={item().url} target="_blank" rel="noopener noreferrer">GitHub ↗</a></div>
      </header>
      <Show when={error()}><div class="api-error" role="alert">{error()} <button type="button" onClick={() => setError('')} aria-label="Dismiss error">×</button></div></Show>
      <div class="milestone-detail">
        <div class="milestone-detail-actions">
          <button type="button" class="topic-status" classList={{ 'is-closed': item().state === 'closed', 'is-pending': milestoneStateBusy() }}
            disabled={milestoneStateBusy()} onClick={toggleMilestoneState} title={item().state === 'open' ? 'Close milestone' : 'Reopen milestone'}>
            <span class="topic-status-dot" aria-hidden="true" />{item().state === 'open' ? 'Open' : 'Closed'}
          </button>
          <button type="button" class="milestone-edit-button" disabled={milestoneStateBusy()} onClick={() => editMilestone(item())}>Edit</button>
        </div>
        <Show when={item().description}><MessageText text={item().description} /></Show>
        <Show when={item().dueDate}><p class="milestone-due">Due {formatDueDate(item().dueDate)}</p></Show>
        <div class="milestone-progress-label"><strong>{item().progress}% complete</strong><span>{item().closed} closed · {item().open} open</span></div>
        <progress class="milestone-progress" max="100" value={item().progress} aria-label={`${item().name} completion`} />
        <p class="milestone-progress-note">Progress includes all assigned repository issues and pull requests.</p>
        <div class="milestone-topics-heading"><h3>Topics</h3>
          <select aria-label="Add topic to milestone" value="" disabled={!isConfigured}
            onChange={(event) => { const id = Number(event.currentTarget.value); if (id) assignMilestone(id, item().id); event.currentTarget.value = ''; }}>
            <option value="">Add topic…</option>
            <For each={topics().filter((entry) => entry.kind !== 'discussion' && entry.milestoneId !== item().id)}>{(entry) => <option value={entry.id} disabled={assignmentBusy()[entry.id]}>#{entry.name}{entry.milestoneId ? ' (move here)' : ''}</option>}</For>
          </select>
        </div>
        <Show when={linkedTopics().length} fallback={<p class="muted">No active topics assigned yet.</p>}>
          <div class="milestone-topic-list"><For each={linkedTopics()}>{(entry) => <div class="milestone-topic-row" classList={{ 'is-pending': assignmentBusy()[entry.id] || entry.syncState === 'confirming' }}>
            <button type="button" class="milestone-topic-link" onClick={() => selectTopic(entry.id)}><span># {entry.name}</span><small>{entry.state === 'open' ? 'Open' : 'Closed'}</small></button>
            <button type="button" class="milestone-topic-remove" disabled={assignmentBusy()[entry.id]} onClick={() => assignMilestone(entry.id, null)} aria-label={`Remove ${entry.name} from milestone`} title="Remove from milestone">−</button>
          </div>}</For></div>
        </Show>
      </div>
    </section>}</Show>;
  }

  function replyTo(message) {
    const id = activeId();
    setDrafts((previous) => {
      const existing = previous[id] || '';
      return { ...previous, [id]: `${existing}${existing ? '\n\n' : ''}${quoteReply(message)}` };
    });
    composerInput.focus();
    composerInput.setSelectionRange(composerInput.value.length, composerInput.value.length);
  }

  function MessageText(props) {
    const isDeclaredSender = (name) => currentMessages().some((message) =>
      message.sender?.toLowerCase() === name.toLowerCase() && message.author.toLowerCase() !== name.toLowerCase());
    const Inline = (inlineProps) => <For each={messageTokens(inlineProps.text)}>{(token) => {
      if (token.type === 'code') return <code>{token.text}</code>;
      if (token.type === 'link') return <a href={token.url} target="_blank" rel="noopener noreferrer">{token.text}</a>;
      if (token.type === 'mention') return (
        <Show when={!isDeclaredSender(token.name)} fallback={<span class="message-mention" title="Declared Blackboard identity">{token.text}</span>}>
          <a class="message-mention" href={`https://github.com/${encodeURIComponent(token.name)}`} target="_blank" rel="noopener noreferrer">{token.text}</a>
        </Show>
      );
      return token.text;
    }}</For>;
    return <div class="message-text"><For each={messageBlocks(props.text)}>{(block) => (
      block.quote ? <blockquote><Inline text={block.text} /></blockquote> : <div><Inline text={block.text} /></div>
    )}</For></div>;
  }

  function TopicMarker(props) {
    return <span class="channel-hash" title={props.discussion ? 'Discussion' : 'Task'} aria-label={props.discussion ? 'Discussion' : 'Task'}>
      <Show when={props.discussion} fallback="#"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z" /></svg></Show>
    </span>;
  }

  async function openReactions(commentId) {
    const version = ++reactionLoadVersion;
    setReactionTarget({ commentId, channelId: activeId() });
    setReactionRecords([]);
    setReactionViewer(null);
    setReactionError('');
    setReactionLoading(true);
    reactionDialog.showModal();
    try {
      const viewer = await api.getViewer();
      const records = await api.listReactions(commentId);
      if (version !== reactionLoadVersion || stopped) return;
      setReactionViewer(viewer);
      setReactionRecords(records);
    } catch (failure) {
      if (version === reactionLoadVersion && !stopped) setReactionError(failure.message);
    } finally {
      if (version === reactionLoadVersion) setReactionLoading(false);
    }
  }

  async function toggleReaction(type) {
    const target = reactionTarget();
    if (!target || reactionLoading() || reactionBusy() || !reactionViewer()) return;
    const existing = ownReaction(type);
    setReactionBusy(true);
    setReactionError('');
    try {
      let records;
      if (existing) {
        await api.removeReaction(target.commentId, existing.id);
        records = reactionRecords().filter((entry) => entry.id !== existing.id);
      } else {
        const added = await api.addReaction(target.commentId, type);
        records = [...reactionRecords().filter((entry) => entry.id !== added.id), added];
      }
      const types = Object.keys(reactionSymbols).filter((key) => records.some((entry) => entry.type === key));
      messageRevisions.set(target.channelId, (messageRevisions.get(target.channelId) || 0) + 1);
      setMessages((previous) => ({ ...previous, [target.channelId]: (previous[target.channelId] || []).map((message) =>
        message.id === target.commentId ? { ...message, reactions: types } : message) }));
      reactionDialog.close();
    } catch (failure) {
      // Reaction create/delete is idempotent. Reload ownership before allowing
      // another action if delivery is uncertain, rather than guessing a toggle.
      setReactionError(failure.message);
      if (failure.uncertain) setReactionViewer(null);
    } finally { setReactionBusy(false); }
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
    setTopicParent(null);
    newTopicButton.focus();
  }

  function startTopic(parent = null) {
    if (creating() || createUncertain()) return;
    if (parent?.kind === 'discussion') return;
    setTopicParent(parent);
    setTopicName('');
    setCreatingTopic(true);
    requestAnimationFrame(() => document.getElementById('topic-name')?.focus());
  }

  function toggleTopic(id) {
    setCollapsedTopics((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function rememberChange(change) {
    const previous = topics().find((item) => item.id === change.id);
    const updated = topicTracker.remember({ ...previous, ...change, parentId: change.parentId === undefined ? previous?.parentId ?? null : change.parentId });
    channelRevision += 1;
    setTopics((items) => items.map((item) => item.id === updated.id ? updated : item).filter((item) => !item.archived));
  }

  async function createTopic(event) {
    event.preventDefault();
    const name = topicName().trim();
    if (!name || creating() || createUncertain() || !isConfigured) return;
    setCreating(true);
    const parentId = topicParent()?.id ?? null;
    const kind = creationKind();
    setPendingTopic({ name, parentId, kind, status: 'creating' });
    setError('');
    try {
      const created = topicTracker.remember(await (kind === 'discussion' ? api.createDiscussion({ name }) : api.createChannel({ name, parentId })));
      channelRevision += 1;
      batch(() => {
        setTopics((previous) => [...previous.filter((item) => item.id !== created.id), created]);
        setActiveId(created.id);
        setPendingTopic(null);
      });
      setCreating(false);
      closeTopicForm();
      await selectTopic(created.id);
    } catch (failure) {
      if (failure.createdChannel) {
        const created = failure.createdChannel;
        channelRevision += 1;
        setTopics((previous) => [...previous.filter((item) => item.id !== created.id), created]);
        setActiveId(created.id);
        setPendingTopic(null);
        setCreating(false);
        closeTopicForm();
        setError(failure.message);
        return;
      }
      setCreateUncertain(failure.uncertain);
      setPendingTopic(failure.uncertain ? { name, parentId, kind, status: 'unconfirmed' } : null);
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
      if (target === 'deleted') await api.deleteChannelPreservingChildren(id, rememberChange);
      else await api.archiveChannelTree(id, rememberChange);
      if (target === 'deleted') topicTracker.remove(id);
      channelRevision += 1;
      batch(() => {
        const remaining = topics().filter((entry) => entry.id !== id);
        setTopics(remaining);
        if (!remaining.some((entry) => entry.id === activeId())) setActiveId((remaining.find((entry) => entry.state === 'open') || remaining[0])?.id ?? null);
        setClosing((previous) => ({ ...previous, [id]: null }));
      });
      removeDialog.close();
      newTopicButton.focus();
      try { await loadMessages(activeId()); } catch (failure) { setError(failure.message); }
    } catch (failure) {
      if (!topics().some((entry) => entry.id === activeId())) setActiveId(topics()[0]?.id ?? null);
      const affectedId = failure.affectedChannelId ?? id;
      setClosing((previous) => ({ ...previous, [id]: null, [affectedId]: failure.uncertain && !failure.deletionNotAttempted ? { target, status: 'unconfirmed' } : null }));
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
      if (target === 'closed') await api.closeChannelTree(id, rememberChange);
      else rememberChange({ ...await api.reopenChannel(id), parentId: topics().find((item) => item.id === id)?.parentId ?? null });
      channelRevision += 1;
      batch(() => {
        setClosing((previous) => ({ ...previous, [id]: null }));
      });
      statusDialog.close();
    } catch (failure) {
      const affectedId = failure.affectedChannelId ?? id;
      setClosing((previous) => ({ ...previous, [id]: null, [affectedId]: failure.uncertain ? { target, status: 'unconfirmed' } : null }));
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
      setMessages((previous) => ({ ...previous, [id]: [...(previous[id] || []).filter((item) => item.id !== sent.id), sent].sort(compareMessages) }));
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
        <RepositorySelector repository={props.repository} credentials={props.credentials} permitted={props.permitted}
          getCredentials={props.getCredentials} onConnect={props.onConnect} onForget={props.onForget} switchDisabled={switchingDisabled()} />
        <div class="sidebar-actions">
          <button
            ref={newTopicButton}
            type="button"
            class="new-topic-button"
            disabled={!isConfigured}
            aria-expanded={creatingTopic()}
            aria-controls="new-topic-form"
            onClick={() => creatingTopic() ? closeTopicForm() : startTopic()}
          >
            <span class="new-topic-plus" aria-hidden="true">+</span> New topic
          </button>
          <Show when={creatingTopic()}>
            <form id="new-topic-form" class="new-topic-form" onSubmit={createTopic}
              onKeyDown={(event) => { if (event.key === 'Escape') closeTopicForm(); }}>
              <label for="topic-name">{topicParent() ? 'Sub-topic name' : 'Topic name'}</label>
              <Show when={topicParent()}>{(parent) => <small class="topic-parent-hint">Under: {parent().name}</small>}</Show>
              <input id="topic-name" name="topicName" type="text" required maxLength="80"
                value={topicName()} disabled={creating() || createUncertain()}
                ref={(element) => requestAnimationFrame(() => element.focus())}
                onInput={(event) => setTopicName(event.currentTarget.value)} />
              <div class="new-topic-form-actions">
              <Show when={discussionsEnabled}><fieldset class="topic-kind-options" disabled={creating() || createUncertain() || Boolean(topicParent())}>
                <legend class="sr-only">Topic type</legend>
                <label><input type="radio" name="topicKind" value="task" checked={creationKind() === 'task'} onChange={() => chooseTopicKind('task')} /><span>Task</span></label>
                <label><input type="radio" name="topicKind" value="discussion" checked={creationKind() === 'discussion'} onChange={() => chooseTopicKind('discussion')} /><span>Talk</span></label>
              </fieldset></Show>
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
          <For each={visibleTopics()}>{(item) => (
            <div class="channel-row" style={{ 'margin-left': `${Math.min(item.depth, 5) * 16}px` }} classList={{ 'is-active': activeProjectId() === null && activeMilestoneId() === null && activeId() === item.id, 'is-pending': Boolean(closing()[item.id]) || item.syncState === 'confirming' }} aria-busy={closing()[item.id]?.status === 'pending' || item.syncState === 'confirming'}>
            <Show when={item.hasChildren} fallback={<span class="topic-expand" aria-hidden="true" />}>
              <button type="button" class="topic-expand" aria-label={`${collapsedTopics().has(item.id) ? 'Expand' : 'Collapse'} ${item.name}`} aria-expanded={!collapsedTopics().has(item.id)} onClick={() => toggleTopic(item.id)}>{collapsedTopics().has(item.id) ? '›' : '⌄'}</button>
            </Show>
            <button
              type="button"
              class="channel-button"
              aria-current={activeProjectId() === null && activeMilestoneId() === null && activeId() === item.id ? 'page' : undefined}
              onClick={() => selectTopic(item.id)}
            >
              <TopicMarker discussion={item.kind === 'discussion'} />{item.name}
              <Show when={closing()[item.id] || item.state === 'closed'}><small role="status">{statusLabel(item.id) || 'Closed'}</small></Show>
            </button>
            <Show when={item.kind !== 'discussion'}><button type="button" class="add-subtopic-button" disabled={Boolean(closing()[item.id]) || creating() || createUncertain() || !isConfigured}
              aria-label={`Create subtopic under ${item.name}`} title="Create subtopic" onClick={() => startTopic(item)}><span aria-hidden="true">+</span></button></Show>
            <button type="button" class="remove-topic-button"
              disabled={Boolean(closing()[item.id])}
              aria-label={`Remove topic ${item.name}`} title={`Remove topic ${item.name}`}
              aria-haspopup="dialog" onClick={() => requestRemoval(item)}><span aria-hidden="true">−</span></button>
            </div>
          )}</For>
          <Show when={pendingTopic()}>{(pending) => (
            <div class="channel-row is-pending" style={{ 'margin-left': pending().parentId ? `${Math.min((visibleTopics().find((item) => item.id === pending().parentId)?.depth ?? 0) + 1, 5) * 16}px` : '0' }} aria-busy={pending().status === 'creating'}>
              <span class="topic-expand" aria-hidden="true" />
              <div class="channel-button">
                <TopicMarker discussion={pending().kind === 'discussion'} />{pending().name}
                <small role="status">{pending().status === 'creating' ? 'Creating…' : 'Unconfirmed'}</small>
              </div>
            </div>
          )}</Show>
        </nav>
        <section class="sidebar-section" classList={{ 'is-expanded': projectsExpanded() }} aria-label="Projects">
          <button type="button" class="sidebar-section-toggle" aria-expanded={projectsExpanded()} aria-controls="projects-panel"
            onClick={() => toggleSidebarSection('projects')}>
            <span class="sidebar-label">Projects</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d={projectsExpanded() ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'} />
            </svg>
          </button>
          <div id="projects-panel" class="sidebar-section-panel" hidden={!projectsExpanded()}>
            <Show when={projectsError()}><p class="project-sidebar-error" role="alert">{projectsError()}</p></Show>
            <nav class="project-list" aria-label="Projects"><For each={projects()}>{(item) => (
              <button type="button" class="project-list-item" classList={{ 'is-active': activeProjectId() === item.id }} aria-current={activeProjectId() === item.id ? 'page' : undefined} onClick={() => selectProject(item.id)}>
                <span>{item.name}</span><Show when={item.closed}><small>Closed</small></Show>
              </button>
            )}</For></nav>
          </div>
        </section>
        <section class="sidebar-section" classList={{ 'is-expanded': milestonesExpanded() }} aria-label="Milestones">
          <button type="button" class="sidebar-section-toggle" aria-expanded={milestonesExpanded()} aria-controls="milestones-panel"
            onClick={() => toggleSidebarSection('milestones')}>
            <span class="sidebar-label">Milestones</span>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d={milestonesExpanded() ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6'} />
            </svg>
          </button>
          <div id="milestones-panel" class="sidebar-section-panel" hidden={!milestonesExpanded()}>
            <div class="milestone-list-actions"><button type="button" class="new-milestone-button" disabled={!isConfigured} onClick={() => editMilestone()}><span aria-hidden="true">+</span> New milestone</button></div>
            <Show when={milestones().length} fallback={<p>{!isConfigured ? 'Connect to GitHub to load milestones.' : milestonesLoaded() ? 'No milestones yet.' : 'Loading milestones…'}</p>}>
              <nav class="milestone-list" aria-label="Milestones"><For each={milestones()}>{(item) => (
                <button type="button" class="milestone-list-item" classList={{ 'is-active': activeMilestoneId() === item.id, 'is-pending': item.syncState === 'confirming' }}
                  aria-current={activeMilestoneId() === item.id ? 'page' : undefined} onClick={() => selectMilestone(item.id)}>
                  <span class="milestone-list-title">{item.name}<Show when={item.state === 'closed'}><small>Closed</small></Show></span>
                  <progress class="milestone-progress" max="100" value={item.progress} aria-label={`${item.name}: ${item.progress}% complete`} />
                </button>
              )}</For></nav>
            </Show>
          </div>
        </section>
        <footer class="sidebar-footer">
          <span class="status-dot" classList={{ 'is-connected': Boolean(lastSync()) && !syncing() && !syncFailed(), 'is-syncing': syncing() || syncFailed() }}
            role="img" aria-label={syncDescription()} title={syncDescription()} />
        </footer>
      </aside>

      <Show when={activeProjectId()} keyed fallback={
      <Show when={activeMilestoneId() === null} fallback={<MilestoneOverview />}>
      <Show when={topic()} fallback={
        <section class="chat-panel empty-chat">
          <h2>{!isConfigured ? 'Connect to GitHub' : syncing() ? 'Loading topics…' : 'No topics yet'}</h2>
          <p class="muted">{!isConfigured ? 'Open the repository menu and choose Permit to connect.' : 'Create a topic to start a conversation.'}</p>
          <Show when={error()}><p class="api-error" role="alert">{error()}</p></Show>
          <button type="button" disabled={!isConfigured || syncing()} onClick={() => startTopic()}>New topic</button>
        </section>
      }>
      <section class="chat-panel" aria-label={`${topic().name} chat`}>
        <header class="chat-header">
          <h2><TopicMarker discussion={topic().kind === 'discussion'} /> {topic().name}</h2>
          <p class="muted">{topic().description}</p>
          <div class="chat-header-actions">
            <a class="preview-badge" href={topic().url} target="_blank" rel="noreferrer">GitHub ↗</a>
          </div>
        </header>

        <Show when={error()}>
          <div class="api-error" role="alert">{error()} <button type="button" onClick={() => setError('')} aria-label="Dismiss error">×</button></div>
        </Show>

        <div class="chat-topic-controls">
          <Show when={returnProjectId()}><button type="button" class="parent-topic-link" onClick={() => selectProject(returnProjectId())}>‹ Back to project</button></Show>
          <Show when={topics().find((item) => item.id === topic().parentId)}>{(parent) => (
            <button type="button" class="parent-topic-link" onClick={() => selectTopic(parent().id)}>‹ {parent().name}</button>
          )}</Show>
          <Show when={topic().kind !== 'discussion'}><label class="topic-milestone-select" classList={{ 'is-pending': assignmentBusy()[topic().id] }} title={topicMilestoneLabel()}>
            <span class="sr-only">Milestone</span>
            <span class="topic-milestone-value" aria-hidden="true">{topicMilestoneLabel()}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            <select aria-label="Topic milestone" value={topic().milestoneId ?? ''} disabled={assignmentBusy()[topic().id] || !milestonesLoaded()}
              onChange={(event) => {
                const id = topic().id;
                const next = event.currentTarget.value ? Number(event.currentTarget.value) : null;
                event.currentTarget.value = String(topic().milestoneId ?? '');
                assignMilestone(id, next);
              }}>
              <option value="">None</option>
              <Show when={topic().milestoneId && !milestones().some((item) => item.id === topic().milestoneId)}><option value={topic().milestoneId}>Milestone #{topic().milestoneId}</option></Show>
              <For each={milestones()}>{(item) => <option value={item.id}>{item.name}{item.state === 'closed' ? ' (closed)' : ''}</option>}</For>
            </select>
          </label></Show>
          <button type="button" class="topic-status" classList={{ 'is-closed': topic().state === 'closed' }}
            disabled={Boolean(closing()[topic().id])} aria-haspopup="dialog"
            aria-label={`${topic().state === 'open' ? 'Open' : 'Closed'} topic: ${topic().state === 'open' ? 'close' : 'reopen'} ${topic().name}`}
            onClick={() => requestStatusChange(topic())}>
            <span class="topic-status-dot" aria-hidden="true" />{statusLabel(topic().id) || (topic().state === 'open' ? 'Open' : 'Closed')}
          </button>
        </div>
        <div class="topic-tags" aria-label="Topic tags">
          <For each={displayedTags()}>{(tag) => (
            <span class="topic-tag" classList={{ 'is-pending': tagOperations()[topic().id]?.name.toLowerCase() === tag.name.toLowerCase() }}
              aria-busy={tagOperations()[topic().id]?.name.toLowerCase() === tag.name.toLowerCase()} title={tag.description || tag.name}>
              <span class="topic-tag-dot" style={{ background: `#${tag.color}` }} aria-hidden="true" />
              <span class="topic-tag-name">{tag.name}</span>
              <button type="button" disabled={Boolean(tagOperations()[topic().id])} onClick={() => changeTag(topic().id, tag.name, 'remove')}
                aria-label={`Remove tag ${tag.name}`} title={`Remove tag ${tag.name}`}>×</button>
            </span>
          )}</For>
          <Show when={tagEditing() === topic().id} fallback={
            <button type="button" class="add-tag-button" disabled={Boolean(tagOperations()[topic().id]) || !isConfigured} onClick={startTag}>+ Tag</button>
          }>
            <form class="topic-tag-form" aria-label="Add topic tag" onSubmit={(event) => { event.preventDefault(); changeTag(topic().id, tagDrafts()[topic().id] || '', 'add'); }}
              onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); setTagEditing(null); } }}>
              <input type="text" aria-label="Tag name" placeholder="Tag name" list="topic-tag-suggestions" maxLength="50" required
                ref={(element) => requestAnimationFrame(() => element.focus())} value={tagDrafts()[topic().id] || ''}
                onInput={(event) => setTagDrafts((previous) => ({ ...previous, [topic().id]: event.currentTarget.value }))} />
              <datalist id="topic-tag-suggestions"><For each={knownTags().filter((tag) => !topic().tags.some((entry) => entry.name.toLowerCase() === tag.name.toLowerCase()))}>{(tag) => <option value={tag.name} />}</For></datalist>
              <button type="submit" disabled={!(tagDrafts()[topic().id] || '').trim()}>Add</button>
              <button type="button" aria-label="Cancel tag" onClick={() => setTagEditing(null)}>×</button>
            </form>
          </Show>
        </div>
        <div ref={messageList} class="message-list" role="log" aria-label="Messages" aria-live="polite" aria-relevant="additions">
          <div class="conversation-start">
            <span class="conversation-icon" aria-hidden="true"><TopicMarker discussion={topic().kind === 'discussion'} /></span>
            <h3>Welcome to {topic().kind === 'discussion' ? '' : '#'}{topic().name}</h3>
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
                <Show when={message.replyTo}><a class="message-reply-reference" href={message.replyTo.url} target="_blank" rel="noopener noreferrer">↳ Replying to {message.replyTo.author}</a></Show>
                <MessageText text={message.text} />
                  <div class="message-reactions" role="group" aria-label="Reactions">
                    <For each={message.reactions}>{(type) => (
                      <span role="img" aria-label={reactionSymbols[type][1]} title={reactionSymbols[type][1]}>{reactionSymbols[type][0]}</span>
                    )}</For>
                    <button type="button" class="reaction-add" aria-label="Add or remove a reaction" aria-haspopup="dialog" title="React" onClick={() => openReactions(message.id)}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
                        <path d="M21 13a9 9 0 1 1-10-10M8 14c1.8 2 6.2 2 8 0M17 4h6m-3-3v6" />
                        <path d="M8 9h.01M14 9h.01" stroke-width="3" />
                      </svg>
                    </button>
                    <button type="button" class="message-reply" onClick={() => replyTo(message)} title="Quote reply">Reply</button>
                  </div>
              </div>
            </article>
          )}</For>
          <Show when={outgoing()}>{(entry) => (
            <article class="message is-pending" aria-busy={entry().state === 'pending'}>
              <span class="avatar avatar-you" aria-hidden="true">Y</span>
              <div class="message-content">
                <div class="message-meta"><span class="message-author">You</span><span class="delivery-state" role="status">{entry().state === 'pending' ? 'Sending…' : 'Delivery unconfirmed — check GitHub before resending'}</span></div>
                <MessageText text={entry().text} />
              </div>
            </article>
          )}</Show>
        </div>

        <form class="composer" onSubmit={sendMessage}>
          <div class="composer-box">
            <textarea
              ref={composerInput}
              aria-label={`Message ${topic().kind === 'discussion' ? '' : '#'}${topic().name}`}
              placeholder={`Message ${topic().kind === 'discussion' ? '' : '#'}${topic().name}`}
              rows="2"
              value={draft()}
              onInput={(event) => setDrafts((previous) => ({ ...previous, [activeId()]: event.currentTarget.value }))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) sendMessage(event);
              }}
            />
            <button type="submit" disabled={Boolean(outgoing())}>Send <span aria-hidden="true">↗</span></button>
          </div>
          <p class="composer-hint">Enter to send · Shift + Enter for a new line <span>{GITHUB_OWNER}/{GITHUB_REPO}</span></p>
        </form>
      </section>
      </Show>
      </Show>
      }>{(id) => <ProjectBoard onBusyChange={setProjectWriting} api={api} projectId={id} projectName={projects().find((item) => item.id === id)?.name} topics={topics().filter((item) => item.kind !== 'discussion')} onOpenTopic={(topicId) => selectTopic(topicId, id)}
        onTopicUpdated={(updated) => rememberChange({ ...updated, parentId: topics().find((topic) => topic.id === updated.id)?.parentId ?? null })} />}</Show>
      <dialog ref={milestoneDialog} class="topic-status-dialog milestone-dialog" aria-labelledby="milestone-form-title"
        onPointerDown={trackBackdrop} onClick={(event) => dismissBackdrop(event, milestoneSaving())}
        onCancel={(event) => { if (milestoneSaving()) event.preventDefault(); }}>
        <form onSubmit={saveMilestone} aria-busy={milestoneSaving()}>
          <h2 id="milestone-form-title">{milestoneEditing() ? 'Edit milestone' : 'New milestone'}</h2>
          <label for="milestone-name">Name</label>
          <input id="milestone-name" type="text" required maxLength="256" autofocus value={milestoneName()} disabled={milestoneSaving() || milestoneUncertain()} onInput={(event) => setMilestoneName(event.currentTarget.value)} />
          <label for="milestone-description">Description</label>
          <textarea id="milestone-description" rows="4" value={milestoneDescription()} disabled={milestoneSaving() || milestoneUncertain()} onInput={(event) => setMilestoneDescription(event.currentTarget.value)} />
          <label for="milestone-date">Due date <span class="muted">(optional)</span></label>
          <input id="milestone-date" type="date" value={milestoneDueDate()} disabled={milestoneSaving() || milestoneUncertain()} onInput={(event) => setMilestoneDueDate(event.currentTarget.value)} />
          <Show when={milestoneFormError()}><p class="dialog-error" role="alert">{milestoneFormError()}</p></Show>
          <div class="dialog-actions">
            <button type="button" class="dialog-cancel" disabled={milestoneSaving()} onClick={() => milestoneDialog.close()}>Cancel</button>
            <button type="submit" disabled={milestoneSaving() || milestoneUncertain() || !milestoneName().trim()}>{milestoneSaving() ? 'Saving…' : milestoneEditing() ? 'Save' : 'Create'}</button>
          </div>
        </form>
      </dialog>
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
      <dialog ref={reactionDialog} class="topic-status-dialog reaction-dialog" aria-labelledby="reaction-title"
        onPointerDown={trackBackdrop} onClick={(event) => dismissBackdrop(event, reactionBusy())}
        onCancel={(event) => { if (reactionBusy()) event.preventDefault(); }}
        onClose={() => { reactionLoadVersion++; setReactionTarget(null); setReactionLoading(false); }}>
        <h2 id="reaction-title">React</h2>
        <div class="reaction-choices" aria-busy={reactionLoading() || reactionBusy()}>
          <For each={Object.keys(reactionSymbols)}>{(type) => (
            <button type="button" class="reaction-choice" classList={{ 'is-selected': Boolean(ownReaction(type)) }}
              aria-pressed={Boolean(ownReaction(type))}
              aria-label={`${ownReaction(type) ? 'Remove' : 'Add'} ${reactionSymbols[type][1]}`}
              title={`${ownReaction(type) ? 'Remove' : 'Add'} ${reactionSymbols[type][1]}`}
              disabled={reactionLoading() || reactionBusy() || !reactionViewer()}
              onClick={() => toggleReaction(type)}>{reactionSymbols[type][0]}</button>
          )}</For>
        </div>
        <Show when={reactionLoading() || reactionBusy()}><p role="status">{reactionLoading() ? 'Loading…' : 'Saving…'}</p></Show>
        <Show when={reactionError()}><p class="dialog-error" role="alert">{reactionError()}</p></Show>
        <div class="dialog-actions"><button type="button" autofocus disabled={reactionBusy()} onClick={() => reactionDialog.close()}>Cancel</button></div>
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
