// Preserve acknowledged writes while GitHub's list catches up.
import { checklist } from './list-state.js';

export function listCompletion(list) {
  const items = checklist(list.description).items;
  return {
    total: items.length,
    complete: items.filter((item) => item.checked).length,
  };
}

export function goalProgress(goal, lists = []) {
  let total = goal.open + goal.closed;
  let complete = goal.closed;
  for (const list of lists) {
    if (list.milestoneId !== goal.id || list.state === 'closed') continue;
    const progress = listCompletion(list);
    if (!progress.total) continue; // An empty list still counts as its GitHub issue.
    total += progress.total - 1;
    complete += progress.complete;
  }
  total = Math.max(0, total);
  complete = Math.max(0, Math.min(complete, total));
  return { complete, total, percent: total ? complete / total * 100 : 0 };
}

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
