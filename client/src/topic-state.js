// Keep acknowledged local changes visible until GitHub's list catches up.
export function createTopicTracker() {
  const changes = new Map();
  return {
    remember(topic) {
      const pending = { ...topic, syncState: 'confirming' };
      changes.set(topic.id, pending);
      return pending;
    },
    remove(id) {
      changes.set(id, null);
    },
    reconcile(incoming) {
      const merged = new Map(incoming.map((topic) => [topic.id, topic]));
      for (const [id, desired] of changes) {
        const actual = merged.get(id);
        if (desired === null) {
          if (!actual) changes.delete(id);
          merged.delete(id);
        } else if (actual && actual.name === desired.name && actual.state === desired.state && actual.archived === desired.archived && (actual.parentId ?? null) === (desired.parentId ?? null)) {
          changes.delete(id);
        } else {
          merged.set(id, desired);
        }
      }
      return [...merged.values()].sort((a, b) => a.id - b.id);
    },
  };
}

// Missing parents become roots. Guard cycles so malformed remote data stays usable.
export function topicRows(topics, collapsed = new Set()) {
  const ids = new Set(topics.map((topic) => topic.id));
  const children = new Map();
  for (const topic of topics) {
    const parent = ids.has(topic.parentId) && topic.parentId !== topic.id ? topic.parentId : null;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(topic);
  }
  const rows = [];
  const seen = new Set();
  function visit(topic, depth) {
    if (seen.has(topic.id)) return;
    seen.add(topic.id);
    rows.push({ ...topic, depth, hasChildren: Boolean(children.get(topic.id)?.length) });
    for (const child of children.get(topic.id) || []) {
      if (collapsed.has(topic.id)) hide(child);
      else visit(child, depth + 1);
    }
  }
  function hide(topic) {
    if (seen.has(topic.id)) return;
    seen.add(topic.id);
    for (const child of children.get(topic.id) || []) hide(child);
  }
  for (const root of children.get(null) || []) visit(root, 0);
  for (const topic of topics) if (!seen.has(topic.id)) visit(topic, 0);
  return rows;
}
