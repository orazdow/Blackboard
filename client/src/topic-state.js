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
        } else if (actual && actual.name === desired.name && actual.state === desired.state && actual.archived === desired.archived) {
          changes.delete(id);
        } else {
          merged.set(id, desired);
        }
      }
      return [...merged.values()].sort((a, b) => a.id - b.id);
    },
  };
}
