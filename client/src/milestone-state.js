// Preserve acknowledged writes while GitHub's list catches up.
export const sortMilestones = (items) => [...items].sort((a, b) => (a.state === b.state ? 0 : a.state === 'open' ? -1 : 1)
  || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.id - b.id);

export function createMilestoneTracker() {
  const changes = new Map();
  return {
    remember(item) {
      const pending = { ...item, syncState: 'confirming' };
      changes.set(item.id, pending);
      return pending;
    },
    reconcile(incoming) {
      const merged = new Map(incoming.map((item) => [item.id, item]));
      for (const [id, desired] of changes) {
        const actual = merged.get(id);
        if (actual && ['name', 'description', 'dueDate', 'state'].every((field) => actual[field] === desired[field])) changes.delete(id);
        else merged.set(id, desired);
      }
      return sortMilestones([...merged.values()]);
    },
  };
}
