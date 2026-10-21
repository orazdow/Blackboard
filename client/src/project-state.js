export function boardColumns(board, search = '') {
  const columns = [{ id: null, name: 'No status', color: 'GRAY', items: [] }, ...(board.statusField?.options || []).map((option) => ({ ...option, items: [] }))];
  const query = search.trim().toLowerCase();
  for (const item of board.items) {
    if (query && !`${item.title} ${item.repository || ''} ${item.number || ''}`.toLowerCase().includes(query)) continue;
    // Retain cards whose status option was removed while the board was loading.
    const column = columns.find((column) => column.id === item.statusId) || columns[0];
    column.items.push(item);
  }
  return columns.filter((column) => column.id !== null || column.items.length > 0);
}

export function previewBoard(topics) {
  return {
    id: 'preview', name: 'Board preview', description: 'A preview using your topics. No project changes are saved.',
    url: null, closed: false, canUpdate: false,
    statusField: { id: 'preview-status', name: 'Status', options: [
      { id: 'todo', name: 'Todo', color: 'GRAY' },
      { id: 'in-progress', name: 'In progress', color: 'BLUE' },
      { id: 'done', name: 'Done', color: 'GREEN' },
    ] },
    items: topics.map((topic) => ({ id: `preview-${topic.id}`, title: topic.name, channelId: topic.id, type: 'Issue', number: topic.id, state: topic.state.toUpperCase(), statusId: topic.state === 'closed' ? 'done' : 'todo' })),
  };
}

export function createProjectTracker() {
  const changes = new Map();
  return {
    remember(item, added = false, fields = ['statusId']) {
      const pending = { ...item, syncState: 'confirming' };
      changes.set(item.id, { item: pending, added, fields });
      return pending;
    },
    remove(id) { changes.set(id, { item: null }); },
    reconcile(incoming) {
      const merged = new Map(incoming.map((item) => [item.id, item]));
      for (const [id, desired] of changes) {
        const actual = merged.get(id);
        if (desired.item === null) {
          if (!actual) changes.delete(id);
          merged.delete(id);
        } else if (actual && (desired.added || desired.fields.every((field) => actual[field] === desired.item[field]))) changes.delete(id);
        else merged.set(id, desired.item);
      }
      return [...merged.values()];
    },
  };
}

export function sameProjectColumns(a, b) {
  const signature = (field) => JSON.stringify((field?.options || []).map((option) => [option.id, option.name, option.color || 'GRAY', option.description || '']));
  return signature(a) === signature(b);
}
