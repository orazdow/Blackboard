const IS_DEV = false;
const equalFn = (a, b) => a === b;
const $TRACK = Symbol("solid-track");
const signalOptions = {
  equals: equalFn
};
let runEffects = runQueue;
const STALE = 1;
const PENDING = 2;
const UNOWNED = {
  owned: null,
  cleanups: null,
  context: null,
  owner: null
};
var Owner = null;
let Transition = null;
let ExternalSourceConfig = null;
let Listener = null;
let Updates = null;
let Effects = null;
let ExecCount = 0;
function createRoot(fn, detachedOwner) {
  const listener = Listener,
    owner = Owner,
    unowned = fn.length === 0,
    current = detachedOwner === undefined ? owner : detachedOwner,
    root = unowned ? UNOWNED : {
      owned: null,
      cleanups: null,
      context: current ? current.context : null,
      owner: current
    },
    updateFn = unowned ? fn : () => fn(() => untrack(() => cleanNode(root)));
  Owner = root;
  Listener = null;
  try {
    return runUpdates(updateFn, true);
  } finally {
    Listener = listener;
    Owner = owner;
  }
}
function createSignal(value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const s = {
    value,
    observers: null,
    observerSlots: null,
    comparator: options.equals || undefined
  };
  const setter = value => {
    if (typeof value === "function") {
      value = value(s.value);
    }
    return writeSignal(s, value);
  };
  return [readSignal.bind(s), setter];
}
function createRenderEffect(fn, value, options) {
  const c = createComputation(fn, value, false, STALE);
  updateComputation(c);
}
function createEffect(fn, value, options) {
  runEffects = runUserEffects;
  const c = createComputation(fn, value, false, STALE);
  c.user = true;
  Effects ? Effects.push(c) : updateComputation(c);
}
function createMemo(fn, value, options) {
  options = options ? Object.assign({}, signalOptions, options) : signalOptions;
  const c = createComputation(fn, value, true, 0);
  c.observers = null;
  c.observerSlots = null;
  c.comparator = options.equals || undefined;
  updateComputation(c);
  return readSignal.bind(c);
}
function batch(fn) {
  return runUpdates(fn, false);
}
function untrack(fn) {
  if (Listener === null) return fn();
  const listener = Listener;
  Listener = null;
  try {
    if (ExternalSourceConfig) ;
    return fn();
  } finally {
    Listener = listener;
  }
}
function onMount(fn) {
  createEffect(() => untrack(fn));
}
function onCleanup(fn) {
  if (Owner === null) ;else if (Owner.cleanups === null) Owner.cleanups = [fn];else Owner.cleanups.push(fn);
  return fn;
}
function readSignal() {
  if (this.sources && (this.state)) {
    if ((this.state) === STALE) updateComputation(this);else {
      const updates = Updates;
      Updates = null;
      runUpdates(() => lookUpstream(this), false);
      Updates = updates;
    }
  }
  if (Listener) {
    const observers = this.observers;
    if (!observers || observers[observers.length - 1] !== Listener) {
      const sSlot = observers ? observers.length : 0;
      if (!Listener.sources) {
        Listener.sources = [this];
        Listener.sourceSlots = [sSlot];
      } else {
        Listener.sources.push(this);
        Listener.sourceSlots.push(sSlot);
      }
      if (!observers) {
        this.observers = [Listener];
        this.observerSlots = [Listener.sources.length - 1];
      } else {
        observers.push(Listener);
        this.observerSlots.push(Listener.sources.length - 1);
      }
    }
  }
  return this.value;
}
function writeSignal(node, value, isComp) {
  let current = node.value;
  if (!node.comparator || !node.comparator(current, value)) {
    node.value = value;
    if (node.observers && node.observers.length) {
      runUpdates(() => {
        for (let i = 0; i < node.observers.length; i += 1) {
          const o = node.observers[i];
          const TransitionRunning = Transition && Transition.running;
          if (TransitionRunning && Transition.disposed.has(o)) ;
          if (TransitionRunning ? !o.tState : !o.state) {
            if (o.pure) Updates.push(o);else Effects.push(o);
            if (o.observers) markDownstream(o);
          }
          if (!TransitionRunning) o.state = STALE;
        }
        if (Updates.length > 10e5) {
          Updates = [];
          if (IS_DEV) ;
          throw new Error();
        }
      }, false);
    }
  }
  return value;
}
function updateComputation(node) {
  if (!node.fn) return;
  cleanNode(node);
  const time = ExecCount;
  runComputation(node, node.value, time);
}
function runComputation(node, value, time) {
  let nextValue;
  const owner = Owner,
    listener = Listener;
  Listener = Owner = node;
  try {
    nextValue = node.fn(value);
  } catch (err) {
    if (node.pure) {
      {
        node.state = STALE;
        node.owned && node.owned.forEach(cleanNode);
        node.owned = null;
      }
    }
    node.updatedAt = time + 1;
    return handleError(err);
  } finally {
    Listener = listener;
    Owner = owner;
  }
  if (!node.updatedAt || node.updatedAt <= time) {
    if (node.updatedAt != null && "observers" in node) {
      writeSignal(node, nextValue);
    } else node.value = nextValue;
    node.updatedAt = time;
  }
}
function createComputation(fn, init, pure, state = STALE, options) {
  const c = {
    fn,
    state: state,
    updatedAt: null,
    owned: null,
    sources: null,
    sourceSlots: null,
    cleanups: null,
    value: init,
    owner: Owner,
    context: Owner ? Owner.context : null,
    pure
  };
  if (Owner === null) ;else if (Owner !== UNOWNED) {
    {
      if (!Owner.owned) Owner.owned = [c];else Owner.owned.push(c);
    }
  }
  return c;
}
function runTop(node) {
  if ((node.state) === 0) return;
  if ((node.state) === PENDING) return lookUpstream(node);
  if (node.suspense && untrack(node.suspense.inFallback)) return node.suspense.effects.push(node);
  const ancestors = [node];
  while ((node = node.owner) && (!node.updatedAt || node.updatedAt < ExecCount)) {
    if (node.state) ancestors.push(node);
  }
  for (let i = ancestors.length - 1; i >= 0; i--) {
    node = ancestors[i];
    if ((node.state) === STALE) {
      updateComputation(node);
    } else if ((node.state) === PENDING) {
      const updates = Updates;
      Updates = null;
      runUpdates(() => lookUpstream(node, ancestors[0]), false);
      Updates = updates;
    }
  }
}
function runUpdates(fn, init) {
  if (Updates) return fn();
  let wait = false;
  if (!init) Updates = [];
  if (Effects) wait = true;else Effects = [];
  ExecCount++;
  try {
    const res = fn();
    completeUpdates(wait);
    return res;
  } catch (err) {
    if (!wait) Effects = null;
    Updates = null;
    handleError(err);
  }
}
function completeUpdates(wait) {
  if (Updates) {
    runQueue(Updates);
    Updates = null;
  }
  if (wait) return;
  const e = Effects;
  Effects = null;
  if (e.length) runUpdates(() => runEffects(e), false);
}
function runQueue(queue) {
  for (let i = 0; i < queue.length; i++) runTop(queue[i]);
}
function runUserEffects(queue) {
  let i,
    userLength = 0;
  for (i = 0; i < queue.length; i++) {
    const e = queue[i];
    if (!e.user) runTop(e);else queue[userLength++] = e;
  }
  for (i = 0; i < userLength; i++) runTop(queue[i]);
}
function lookUpstream(node, ignore) {
  node.state = 0;
  for (let i = 0; i < node.sources.length; i += 1) {
    const source = node.sources[i];
    if (source.sources) {
      const state = source.state;
      if (state === STALE) {
        if (source !== ignore && (!source.updatedAt || source.updatedAt < ExecCount)) runTop(source);
      } else if (state === PENDING) lookUpstream(source, ignore);
    }
  }
}
function markDownstream(node) {
  for (let i = 0; i < node.observers.length; i += 1) {
    const o = node.observers[i];
    if (!o.state) {
      o.state = PENDING;
      if (o.pure) Updates.push(o);else Effects.push(o);
      o.observers && markDownstream(o);
    }
  }
}
function cleanNode(node) {
  let i;
  if (node.sources) {
    while (node.sources.length) {
      const source = node.sources.pop(),
        index = node.sourceSlots.pop(),
        obs = source.observers;
      if (obs && obs.length) {
        const n = obs.pop(),
          s = source.observerSlots.pop();
        if (index < obs.length) {
          n.sourceSlots[s] = index;
          obs[index] = n;
          source.observerSlots[index] = s;
        }
      }
    }
  }
  if (node.tOwned) {
    for (i = node.tOwned.length - 1; i >= 0; i--) cleanNode(node.tOwned[i]);
    delete node.tOwned;
  }
  if (node.owned) {
    for (i = node.owned.length - 1; i >= 0; i--) cleanNode(node.owned[i]);
    node.owned = null;
  }
  if (node.cleanups) {
    for (i = node.cleanups.length - 1; i >= 0; i--) node.cleanups[i]();
    node.cleanups = null;
  }
  node.state = 0;
}
function castError(err) {
  if (err instanceof Error) return err;
  return new Error(typeof err === "string" ? err : "Unknown error", {
    cause: err
  });
}
function handleError(err, owner = Owner) {
  const error = castError(err);
  throw error;
}

const FALLBACK = Symbol("fallback");
function dispose(d) {
  for (let i = 0; i < d.length; i++) d[i]();
}
function mapArray(list, mapFn, options = {}) {
  let items = [],
    mapped = [],
    disposers = [],
    len = 0,
    indexes = mapFn.length > 1 ? [] : null;
  onCleanup(() => dispose(disposers));
  return () => {
    let newItems = list() || [],
      newLen = newItems.length,
      i,
      j;
    newItems[$TRACK];
    return untrack(() => {
      let newIndices, newIndicesNext, temp, tempdisposers, tempIndexes, start, end, newEnd, item;
      if (newLen === 0) {
        if (len !== 0) {
          dispose(disposers);
          disposers = [];
          items = [];
          mapped = [];
          len = 0;
          indexes && (indexes = []);
        }
        if (options.fallback) {
          items = [FALLBACK];
          mapped[0] = createRoot(disposer => {
            disposers[0] = disposer;
            return options.fallback();
          });
          len = 1;
        }
      }
      else if (len === 0) {
        mapped = new Array(newLen);
        for (j = 0; j < newLen; j++) {
          items[j] = newItems[j];
          mapped[j] = createRoot(mapper);
        }
        len = newLen;
      } else {
        temp = new Array(newLen);
        tempdisposers = new Array(newLen);
        indexes && (tempIndexes = new Array(newLen));
        for (start = 0, end = Math.min(len, newLen); start < end && items[start] === newItems[start]; start++);
        for (end = len - 1, newEnd = newLen - 1; end >= start && newEnd >= start && items[end] === newItems[newEnd]; end--, newEnd--) {
          temp[newEnd] = mapped[end];
          tempdisposers[newEnd] = disposers[end];
          indexes && (tempIndexes[newEnd] = indexes[end]);
        }
        newIndices = new Map();
        newIndicesNext = new Array(newEnd + 1);
        for (j = newEnd; j >= start; j--) {
          item = newItems[j];
          i = newIndices.get(item);
          newIndicesNext[j] = i === undefined ? -1 : i;
          newIndices.set(item, j);
        }
        for (i = start; i <= end; i++) {
          item = items[i];
          j = newIndices.get(item);
          if (j !== undefined && j !== -1) {
            temp[j] = mapped[i];
            tempdisposers[j] = disposers[i];
            indexes && (tempIndexes[j] = indexes[i]);
            j = newIndicesNext[j];
            newIndices.set(item, j);
          } else disposers[i]();
        }
        for (j = start; j < newLen; j++) {
          if (j in temp) {
            mapped[j] = temp[j];
            disposers[j] = tempdisposers[j];
            if (indexes) {
              indexes[j] = tempIndexes[j];
              indexes[j](j);
            }
          } else mapped[j] = createRoot(mapper);
        }
        mapped = mapped.slice(0, len = newLen);
        items = newItems.slice(0);
      }
      return mapped;
    });
    function mapper(disposer) {
      disposers[j] = disposer;
      if (indexes) {
        const [s, set] = createSignal(j);
        indexes[j] = set;
        return mapFn(newItems[j], s);
      }
      return mapFn(newItems[j]);
    }
  };
}
function createComponent(Comp, props) {
  return untrack(() => Comp(props || {}));
}

const narrowedError = name => `Stale read from <${name}>.`;
function For(props) {
  const fallback = "fallback" in props && {
    fallback: () => props.fallback
  };
  return createMemo(mapArray(() => props.each, props.children, fallback || undefined));
}
function Show(props) {
  const keyed = props.keyed;
  const conditionValue = createMemo(() => props.when, undefined, undefined);
  const condition = keyed ? conditionValue : createMemo(conditionValue, undefined, {
    equals: (a, b) => !a === !b
  });
  return createMemo(() => {
    const c = condition();
    if (c) {
      const child = props.children;
      const fn = typeof child === "function" && child.length > 0;
      return fn ? untrack(() => child(keyed ? c : () => {
        if (!untrack(condition)) throw narrowedError("Show");
        return conditionValue();
      })) : child;
    }
    return props.fallback;
  }, undefined, undefined);
}

const memo = fn => createMemo(() => fn());

function reconcileArrays(parentNode, a, b) {
  let bLength = b.length,
    aEnd = a.length,
    bEnd = bLength,
    aStart = 0,
    bStart = 0,
    after = a[aEnd - 1].nextSibling,
    map = null;
  while (aStart < aEnd || bStart < bEnd) {
    if (a[aStart] === b[bStart]) {
      aStart++;
      bStart++;
      continue;
    }
    while (a[aEnd - 1] === b[bEnd - 1]) {
      aEnd--;
      bEnd--;
    }
    if (aEnd === aStart) {
      const node = bEnd < bLength ? bStart ? b[bStart - 1].nextSibling : b[bEnd - bStart] : after;
      while (bStart < bEnd) parentNode.insertBefore(b[bStart++], node);
    } else if (bEnd === bStart) {
      while (aStart < aEnd) {
        if (!map || !map.has(a[aStart])) a[aStart].remove();
        aStart++;
      }
    } else if (a[aStart] === b[bEnd - 1] && b[bStart] === a[aEnd - 1]) {
      const node = a[--aEnd].nextSibling;
      parentNode.insertBefore(b[bStart++], a[aStart++].nextSibling);
      parentNode.insertBefore(b[--bEnd], node);
      a[aEnd] = b[bEnd];
    } else {
      if (!map) {
        map = new Map();
        let i = bStart;
        while (i < bEnd) map.set(b[i], i++);
      }
      const index = map.get(a[aStart]);
      if (index != null) {
        if (bStart < index && index < bEnd) {
          let i = aStart,
            sequence = 1,
            t;
          while (++i < aEnd && i < bEnd) {
            if ((t = map.get(a[i])) == null || t !== index + sequence) break;
            sequence++;
          }
          if (sequence > index - bStart) {
            const node = a[aStart];
            while (bStart < index) parentNode.insertBefore(b[bStart++], node);
          } else parentNode.replaceChild(b[bStart++], a[aStart++]);
        } else aStart++;
      } else a[aStart++].remove();
    }
  }
}

const $$EVENTS = "_$DX_DELEGATE";
function render(code, element, init, options = {}) {
  let disposer;
  createRoot(dispose => {
    disposer = dispose;
    element === document ? code() : insert(element, code(), element.firstChild ? null : undefined, init);
  }, options.owner);
  return () => {
    disposer();
    element.textContent = "";
  };
}
function template(html, isImportNode, isSVG, isMathML) {
  let node;
  const create = () => {
    const t = document.createElement("template");
    t.innerHTML = html;
    return t.content.firstChild;
  };
  const fn = () => (node || (node = create())).cloneNode(true);
  fn.cloneNode = fn;
  return fn;
}
function delegateEvents(eventNames, document = window.document) {
  const e = document[$$EVENTS] || (document[$$EVENTS] = new Set());
  for (let i = 0, l = eventNames.length; i < l; i++) {
    const name = eventNames[i];
    if (!e.has(name)) {
      e.add(name);
      document.addEventListener(name, eventHandler);
    }
  }
}
function setAttribute(node, name, value) {
  if (value == null) node.removeAttribute(name);else node.setAttribute(name, value);
}
function className(node, value) {
  if (value == null) node.removeAttribute("class");else node.className = value;
}
function setStyleProperty(node, name, value) {
  value != null ? node.style.setProperty(name, value) : node.style.removeProperty(name);
}
function use(fn, element, arg) {
  return untrack(() => fn(element, arg));
}
function insert(parent, accessor, marker, initial) {
  if (marker !== undefined && !initial) initial = [];
  if (typeof accessor !== "function") return insertExpression(parent, accessor, initial, marker);
  createRenderEffect(current => insertExpression(parent, accessor(), current, marker), initial);
}
function eventHandler(e) {
  let node = e.target;
  const key = `$$${e.type}`;
  const oriTarget = e.target;
  const oriCurrentTarget = e.currentTarget;
  const retarget = value => Object.defineProperty(e, "target", {
    configurable: true,
    value
  });
  const handleNode = () => {
    const handler = node[key];
    if (handler && !node.disabled) {
      const data = node[`${key}Data`];
      data !== undefined ? handler.call(node, data, e) : handler.call(node, e);
      if (e.cancelBubble) return;
    }
    node.host && typeof node.host !== "string" && !node.host._$host && node.contains(e.target) && retarget(node.host);
    return true;
  };
  const walkUpTree = () => {
    while (handleNode() && (node = node._$host || node.parentNode || node.host));
  };
  Object.defineProperty(e, "currentTarget", {
    configurable: true,
    get() {
      return node || document;
    }
  });
  try {
    if (e.composedPath) {
      const path = e.composedPath();
      retarget(path[0]);
      for (let i = 0; i < path.length - 2; i++) {
        node = path[i];
        if (!handleNode()) break;
        if (node._$host) {
          node = node._$host;
          walkUpTree();
          break;
        }
        if (node.parentNode === oriCurrentTarget) {
          break;
        }
      }
    }
    else walkUpTree();
    retarget(oriTarget);
  } finally {
    e = node = null;
  }
}
function insertExpression(parent, value, current, marker, unwrapArray) {
  while (typeof current === "function") current = current();
  if (value === current) return current;
  const t = typeof value,
    multi = marker !== undefined;
  parent = multi && current[0] && current[0].parentNode || parent;
  if (t === "string" || t === "number") {
    if (t === "number") {
      value = value.toString();
      if (value === current) return current;
    }
    if (multi) {
      let node = current[0];
      if (node && node.nodeType === 3) {
        node.data !== value && (node.data = value);
      } else node = document.createTextNode(value);
      current = cleanChildren(parent, current, marker, node);
    } else {
      if (current !== "" && typeof current === "string") {
        current = parent.firstChild.data = value;
      } else current = parent.textContent = value;
    }
  } else if (value == null || t === "boolean") {
    current = cleanChildren(parent, current, marker);
  } else if (t === "function") {
    createRenderEffect(() => {
      let v = value();
      while (typeof v === "function") v = v();
      current = insertExpression(parent, v, current, marker);
    });
    return () => current;
  } else if (Array.isArray(value)) {
    const array = [];
    const currentArray = current && Array.isArray(current);
    if (normalizeIncomingArray(array, value, current, unwrapArray)) {
      createRenderEffect(() => current = insertExpression(parent, array, current, marker, true));
      return () => current;
    }
    if (array.length === 0) {
      current = cleanChildren(parent, current, marker);
      if (multi) return current;
    } else if (currentArray) {
      if (current.length === 0) {
        appendNodes(parent, array, marker);
      } else reconcileArrays(parent, current, array);
    } else {
      current && cleanChildren(parent);
      appendNodes(parent, array);
    }
    current = array;
  } else if (value.nodeType) {
    if (Array.isArray(current)) {
      if (multi) return current = cleanChildren(parent, current, marker, value);
      cleanChildren(parent, current, null, value);
    } else if (current == null || current === "" || !parent.firstChild) {
      parent.appendChild(value);
    } else parent.replaceChild(value, parent.firstChild);
    current = value;
  } else ;
  return current;
}
function normalizeIncomingArray(normalized, array, current, unwrap) {
  let dynamic = false;
  for (let i = 0, len = array.length; i < len; i++) {
    let item = array[i],
      prev = current && current[normalized.length],
      t;
    if (item == null || item === true || item === false) ; else if ((t = typeof item) === "object" && item.nodeType) {
      normalized.push(item);
    } else if (Array.isArray(item)) {
      dynamic = normalizeIncomingArray(normalized, item, prev) || dynamic;
    } else if (t === "function") {
      if (unwrap) {
        while (typeof item === "function") item = item();
        dynamic = normalizeIncomingArray(normalized, Array.isArray(item) ? item : [item], Array.isArray(prev) ? prev : [prev]) || dynamic;
      } else {
        normalized.push(item);
        dynamic = true;
      }
    } else {
      const value = String(item);
      if (prev && prev.nodeType === 3 && prev.data === value) normalized.push(prev);else normalized.push(document.createTextNode(value));
    }
  }
  return dynamic;
}
function appendNodes(parent, array, marker = null) {
  for (let i = 0, len = array.length; i < len; i++) parent.insertBefore(array[i], marker);
}
function cleanChildren(parent, current, marker, replacement) {
  if (marker === undefined) return parent.textContent = "";
  const node = replacement || document.createTextNode("");
  if (current.length) {
    let inserted = false;
    for (let i = current.length - 1; i >= 0; i--) {
      const el = current[i];
      if (node !== el) {
        const isParent = el.parentNode === parent;
        if (!inserted && !i) isParent ? parent.replaceChild(node, el) : parent.insertBefore(node, marker);else isParent && el.remove();
      } else inserted = true;
    }
  } else parent.insertBefore(node, marker);
  return [node];
}

const CHANNEL_PREFIX = '💬 ';
const ARCHIVED_LABEL = 'blackboard:archived';
const TALK_LABEL = 'blackboard:type:talk';
const NOTE_LABEL = 'blackboard:type:note';
const LIST_LABEL = 'blackboard:type:list';
const REACTION_TYPES = ['+1', '-1', 'laugh', 'confused', 'heart', 'hooray', 'rocket', 'eyes'];
const REACTION_ENUMS = ['THUMBS_UP', 'THUMBS_DOWN', 'LAUGH', 'CONFUSED', 'HEART', 'HOORAY', 'ROCKET', 'EYES'];
const isDiscussionId = id => typeof id === 'string' && /^discussion:[A-Za-z0-9_=-]{1,256}$/.test(id);
const validSender = sender => typeof sender === 'string' && sender.length <= 64 && /^[a-z]/.test(sender) && !/[^a-z0-9_-]/.test(sender);
function encodeMessage(text, sender) {
  if (sender == null) return text;
  if (!validSender(sender)) throw new GitHubError('Sender must be 1–64 lowercase letters, digits, underscores or hyphens, starting with a letter.');
  return `_@${sender}\n${text}`;
}
function decodeMessage(body) {
  const marker = /^_@([^\r\n]*)(?:\r?\n|$)/.exec(body);
  if (marker && validSender(marker[1])) {
    return {
      sender: marker[1],
      text: body.slice(marker[0].length)
    };
  }
  // Read older messages using hidden metadata for compatibility.
  const header = /^<!-- blackboard: (\{[^\r\n]*\}) -->\r?\n/.exec(body);
  const footer = /\r?\n<!-- blackboard: (\{[^\r\n]*\}) -->(?:\r?\n)?$/.exec(body);
  for (const match of [header, footer]) {
    if (!match) continue;
    try {
      const metadata = JSON.parse(match[1]);
      if (validSender(metadata.sender)) return {
        sender: metadata.sender,
        text: match === header ? body.slice(match[0].length) : body.slice(0, match.index).trimEnd()
      };
    } catch {/* Preserve malformed headers as ordinary message text. */}
  }
  return {
    sender: null,
    text: body
  };
}
class GitHubError extends Error {
  constructor(message, {
    status = 0,
    uncertain = false,
    retryAt = 0
  } = {}) {
    super(message);
    this.name = 'GitHubError';
    this.status = status;
    this.uncertain = uncertain;
    this.retryAt = retryAt;
  }
}

// No browser/UI dependencies; fetch can be supplied by scripts or tests.
function createGitHubClient({
  token = '',
  owner = '',
  repo = '',
  projectToken = token,
  fetch: fetchImpl = globalThis.fetch,
  timeout = 20000,
  minWriteInterval = 1000
} = {}) {
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  let retryAt = 0;
  const cache = new Map();
  const inFlight = new Map();
  let queue = Promise.resolve();
  let lastWriteAt = 0;
  let viewerPromise;
  function request(path, options = {}) {
    const reading = options.graphqlRead || !options.method || options.method === 'GET';
    const key = options.graphqlRead ? `graphql:${JSON.stringify(options.body)}` : path;
    if (reading && !options.fresh && inFlight.has(key)) return inFlight.get(key);
    const result = queue.then(() => performRequest(path, {
      ...options,
      cacheKey: key
    }));
    queue = result.catch(() => {});
    if (reading && !options.fresh) {
      inFlight.set(key, result);
      result.finally(() => inFlight.delete(key)).catch(() => {});
    }
    return result;
  }
  function nextPage(link, path) {
    const next = /<([^>]+)>;\s*rel="next"/.exec(link || '');
    if (!next) return null;
    const url = new URL(next[1]);
    const repositoryPath = new URL(base).pathname;
    const namedRepository = url.pathname.toLowerCase().startsWith(repositoryPath.toLowerCase() + '/');
    const numericRepository = /^\/repositories\/\d+(\/.*)$/.exec(url.pathname);
    const resourcePath = namedRepository ? url.pathname.slice(repositoryPath.length) : numericRepository?.[1];
    if (url.origin !== 'https://api.github.com' || url.username || url.password || !resourcePath || resourcePath !== path.split('?')[0]) {
      throw new GitHubError('GitHub returned an unexpected pagination URL.');
    }
    // GitHub can use /repositories/<database ID>/... in Link headers. Keep
    // only the same endpoint and its query, so every page still goes through
    // our configured owner/repo rather than following an arbitrary repo URL.
    return `${resourcePath}${url.search}`;
  }
  async function performRequest(path, {
    method = 'GET',
    body,
    graphql = false,
    graphqlRead = false,
    apiRoot = false,
    cacheKey = path,
    authToken = token,
    fresh = false
  } = {}) {
    if (!authToken || !owner || !repo) throw new GitHubError('Permit this repository with a GitHub token before connecting.');
    if (Date.now() < retryAt) throw new GitHubError('GitHub rate limit reached. Waiting before another request.', {
      retryAt
    });
    const writing = method !== 'GET' && !graphqlRead;
    const cached = writing ? null : cache.get(cacheKey);
    if (cached && !fresh && Date.now() < cached.pollAfter) return cached.data;
    if (writing) {
      const wait = Math.max(0, lastWriteAt + minWriteInterval - Date.now());
      if (wait) await new Promise(resolve => setTimeout(resolve, wait));
      lastWriteAt = Date.now();
      cache.clear();
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetchImpl(graphql ? 'https://api.github.com/graphql' : apiRoot ? `https://api.github.com${path}` : `${base}${path}`, {
        method,
        signal: controller.signal,
        cache: 'no-store',
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${authToken}`,
          'X-GitHub-Api-Version': '2026-03-10',
          ...(cached?.etag ? {
            'If-None-Match': cached.etag
          } : cached?.lastModified ? {
            'If-Modified-Since': cached.lastModified
          } : {}),
          ...(body ? {
            'Content-Type': 'application/json'
          } : {})
        },
        ...(body ? {
          body: JSON.stringify(body)
        } : {})
      });
      const pollInterval = response.headers.has('x-poll-interval') ? Number(response.headers.get('x-poll-interval') || 0) * 1000 : cached?.pollInterval || 0;
      const pollAfter = Date.now() + Math.max(0, pollInterval);
      if (response.status === 304 && cached) {
        cache.set(cacheKey, {
          ...cached,
          pollAfter,
          pollInterval
        });
        return cached.data;
      }
      if (!response.ok) {
        const details = await response.json().catch(() => ({}));
        if (response.status === 429 || response.status === 403 && (response.headers.get('x-ratelimit-remaining') === '0' || response.headers.has('retry-after') || /rate limit/i.test(details.message || ''))) {
          const retryAfter = response.headers.get('retry-after');
          const retryDeadline = Number.isFinite(Number(retryAfter)) ? Date.now() + Number(retryAfter) * 1000 : Date.parse(retryAfter) || 0;
          retryAt = Math.max(Date.now() + 60000, Number(response.headers.get('x-ratelimit-reset') || 0) * 1000, retryDeadline);
        }
        throw new GitHubError(`GitHub ${response.status}: ${details.message || response.statusText}`, {
          status: response.status,
          uncertain: writing && response.status >= 500,
          retryAt
        });
      }
      const result = response.status === 204 ? null : await response.json();
      if (graphql && result.errors?.length) {
        if (result.errors.some(entry => entry.type === 'RATE_LIMITED' || /rate limit/i.test(entry.message))) retryAt = Date.now() + 60000;
        throw new GitHubError(result.errors.map(entry => entry.message).join('; '), {
          status: result.errors.some(entry => entry.type === 'FORBIDDEN') ? 403 : 0,
          retryAt,
          uncertain: writing && result.errors.some(entry => entry.type === 'INTERNAL')
        });
      }
      if (!writing) cache.set(cacheKey, {
        data: result,
        etag: response.headers.get('etag'),
        lastModified: response.headers.get('last-modified'),
        next: nextPage(response.headers.get('link'), path),
        pollAfter,
        pollInterval
      });
      return result;
    } catch (error) {
      if (error instanceof GitHubError) throw error;
      throw new GitHubError(writing ? 'Delivery unconfirmed. Check GitHub before trying again; the request may have succeeded.' : 'Could not reach GitHub. Check your connection.', {
        uncertain: writing
      });
    } finally {
      clearTimeout(timer);
    }
  }
  async function listAll(path) {
    const results = [];
    const visited = new Set();
    let next = `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=1`;
    while (next) {
      const current = next;
      if (visited.has(current)) throw new GitHubError('GitHub returned a repeated pagination link.');
      visited.add(current);
      const items = await request(current);
      results.push(...items);
      next = cache.get(current)?.next || null;
    }
    return results;
  }
  async function projectQuery(query, variables, mutation = false) {
    return request('', {
      method: 'POST',
      graphql: true,
      graphqlRead: !mutation,
      authToken: projectToken,
      body: {
        query,
        variables
      }
    });
  }
  const discussionQuery = (query, variables, mutation = false) => request('', {
    method: 'POST',
    graphql: true,
    graphqlRead: !mutation,
    body: {
      query,
      variables
    }
  });
  const discussionNode = id => {
    if (!isDiscussionId(id)) throw new GitHubError('Invalid discussion identifier.');
    return id.slice('discussion:'.length);
  };
  const discussionFields = 'id number title body closed url category { id name } labels(first:100) { nodes { name color description } pageInfo { hasNextPage endCursor } }';
  const commentFields = 'id body createdAt url author { login } reactionGroups { content users { totalCount } }';
  const discussionMessage = (entry, replyTo = null) => ({
    id: `dc:${entry.id}`,
    author: entry.author?.login || 'Deleted user',
    ...decodeMessage(entry.body || ''),
    time: new Date(entry.createdAt),
    url: entry.url,
    replyTo,
    reactions: (entry.reactionGroups || []).filter(group => group.users.totalCount > 0).map(group => REACTION_TYPES[REACTION_ENUMS.indexOf(group.content)]).filter(Boolean)
  });
  const chronological = (a, b) => a.time - b.time || String(a.id).localeCompare(String(b.id));
  async function discussionLabels(entry) {
    const labels = [...(entry.labels?.nodes || [])];
    let after = null;
    let connection = entry.labels;
    const visited = new Set();
    while (connection && (after = nextCursor(connection, visited))) {
      const result = await discussionQuery(`query BlackboardDiscussionLabels($id:ID!,$after:String!) {
        node(id:$id) { ... on Discussion { labels(first:100,after:$after) { nodes { name color description } pageInfo { hasNextPage endCursor } } } }
      }`, {
        id: entry.id,
        after
      });
      connection = result.data?.node?.labels;
      if (!connection) throw new GitHubError('Could not read discussion tags.');
      labels.push(...connection.nodes);
    }
    return labels;
  }
  async function discussion(entry) {
    if (!entry?.id) throw new GitHubError('Discussion is unavailable.');
    const labels = await discussionLabels(entry);
    return {
      id: `discussion:${entry.id}`,
      number: entry.number,
      kind: 'discussion',
      name: entry.title.startsWith(CHANNEL_PREFIX) ? entry.title.slice(CHANNEL_PREFIX.length) : entry.title,
      description: entry.body || '',
      state: entry.closed ? 'closed' : 'open',
      url: entry.url,
      parentId: null,
      milestoneId: null,
      tags: topicTags(labels),
      category: entry.category,
      archived: labels.some(label => label.name === ARCHIVED_LABEL)
    };
  }
  async function ensureLabel(name) {
    const path = `/labels/${encodeURIComponent(name)}`;
    try {
      return await request(path);
    } catch (failure) {
      if (failure.status !== 404) throw failure;
      try {
        return await request('/labels', {
          method: 'POST',
          body: {
            name,
            color: '52769b'
          }
        });
      } catch (creationFailure) {
        if (creationFailure.status !== 422) throw creationFailure;
        return request(path);
      }
    }
  }
  async function changeDiscussionLabel(id, name, add) {
    let label;
    try {
      label = add ? await ensureLabel(name) : await request(`/labels/${encodeURIComponent(name)}`);
    } catch (failure) {
      failure.tagNotApplied = true;
      throw failure;
    }
    if (!label.node_id) throw new GitHubError('Could not identify the tag.');
    const operation = add ? 'addLabelsToLabelable' : 'removeLabelsFromLabelable';
    const result = await discussionQuery(`mutation BlackboardDiscussionTag($id:ID!,$labels:[ID!]!) {
      ${operation}(input:{labelableId:$id,labelIds:$labels}) { labelable { id } }
    }`, {
      id: discussionNode(id),
      labels: [label.node_id]
    }, true);
    if (result.data?.[operation]?.labelable?.id !== discussionNode(id)) throw new GitHubError('Tag change unconfirmed. Refresh before trying again.', {
      uncertain: true
    });
    // Do not repeat a confirmed write if the following read fails.
    try {
      return (await api.readDiscussion(id)).tags;
    } catch (failure) {
      failure.uncertain = true;
      throw failure;
    }
  }
  async function discussionState(id, closed) {
    const operation = closed ? 'closeDiscussion' : 'reopenDiscussion';
    const result = await discussionQuery(`mutation BlackboardDiscussionState($id:ID!) {
      ${operation}(input:{discussionId:$id${closed ? ',reason:RESOLVED' : ''}}) { discussion { ${discussionFields} } }
    }`, {
      id: discussionNode(id)
    }, true);
    const entry = result.data?.[operation]?.discussion;
    if (entry?.id !== discussionNode(id)) throw new GitHubError('Discussion change unconfirmed. Refresh before trying again.', {
      uncertain: true
    });
    return discussion(entry);
  }
  function nodeId(id) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_=-]{1,256}$/.test(id)) throw new GitHubError('Invalid project identifier.');
    return id;
  }
  function nextCursor(connection, visited) {
    if (!connection.pageInfo?.hasNextPage) return null;
    const cursor = connection.pageInfo.endCursor;
    if (!cursor || visited.has(cursor)) throw new GitHubError('GitHub returned a repeated project pagination cursor.');
    visited.add(cursor);
    return cursor;
  }
  const tag = label => ({
    name: typeof label === 'string' ? label : label.name,
    color: typeof label !== 'string' && /^[0-9a-f]{6}$/i.test(label.color) ? label.color : '52769b',
    description: typeof label === 'string' ? '' : label.description || ''
  });
  const topicTags = labels => labels.map(tag).filter(item => ![ARCHIVED_LABEL, TALK_LABEL, NOTE_LABEL, LIST_LABEL].includes(item.name.toLowerCase()));
  const tagName = name => {
    if (typeof name !== 'string' || !name.trim() || name.trim().length > 50 || /[\x00-\x1f\x7f]/.test(name)) throw new GitHubError('Tag names must contain 1–50 characters.');
    const trimmed = name.trim();
    if (trimmed.toLowerCase() === ARCHIVED_LABEL.toLowerCase() || trimmed.toLowerCase().startsWith('blackboard:type:')) throw new GitHubError('That label is reserved for Blackboard.');
    return trimmed;
  };
  const hasLabel = (issue, name) => (issue.labels || []).some(label => (typeof label === 'string' ? label : label.name).toLowerCase() === name);
  const isNote = issue => hasLabel(issue, NOTE_LABEL);
  const isList = issue => hasLabel(issue, LIST_LABEL);
  const channel = issue => ({
    id: issue.number,
    kind: isList(issue) ? 'list' : isNote(issue) ? 'note' : 'talk',
    name: issue.title.startsWith(CHANNEL_PREFIX) ? issue.title.slice(CHANNEL_PREFIX.length) : issue.title,
    description: issue.body || '',
    state: issue.state,
    url: issue.html_url,
    parentId: null,
    milestoneId: issue.milestone?.number ?? null,
    tags: topicTags(issue.labels || []),
    archived: (issue.labels || []).some(label => (typeof label === 'string' ? label : label.name) === ARCHIVED_LABEL)
  });
  const message = comment => ({
    id: comment.id,
    author: comment.user.login,
    ...decodeMessage(comment.body || ''),
    time: new Date(comment.created_at),
    url: comment.html_url,
    reactions: REACTION_TYPES.filter(type => comment.reactions?.[type] > 0)
  });
  const issuePath = id => {
    if (!Number.isSafeInteger(id) || id < 1) throw new GitHubError('Invalid channel ID.');
    return `/issues/${id}`;
  };
  const reactionPath = commentId => {
    if (!Number.isSafeInteger(commentId) || commentId < 1) throw new GitHubError('Invalid comment ID.');
    return `/issues/comments/${commentId}/reactions`;
  };
  const reaction = entry => ({
    id: entry.id,
    type: entry.content,
    author: entry.user.login
  });
  const isTopic = issue => !issue.pull_request && (issue.title.startsWith(CHANNEL_PREFIX) || [TALK_LABEL, NOTE_LABEL, LIST_LABEL].some(name => hasLabel(issue, name)));
  async function readDocument(id, kind) {
    const issue = await request(issuePath(id), {
      fresh: true
    });
    if (issue.pull_request || channel(issue).kind !== kind) throw new GitHubError(`This issue is not a Blackboard ${kind}.`);
    return channel(issue);
  }
  async function updateDocument(id, kind, body, expectedBody) {
    if (typeof body !== 'string') throw new GitHubError('Content must be text.');
    const current = await readDocument(id, kind);
    if (current.description !== expectedBody) throw new GitHubError(`This ${kind} changed on GitHub. Review the latest version before saving.`);
    return channel(await request(issuePath(id), {
      method: 'PATCH',
      body: {
        body
      }
    }));
  }
  const isLocal = issue => !issue.repository_url || issue.repository_url.toLowerCase() === base.toLowerCase();
  const subIssues = id => listAll(`${issuePath(id)}/sub_issues`);
  const milestonePath = id => {
    if (!Number.isSafeInteger(id) || id < 1) throw new GitHubError('Invalid milestone ID.');
    return `/milestones/${id}`;
  };
  const milestoneDate = date => {
    if (date === null || date === '') return null;
    if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new GitHubError('Invalid milestone due date.');
    const parsed = new Date(`${date}T00:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new GitHubError('Invalid milestone due date.');
    return parsed.toISOString();
  };
  const milestone = item => {
    const open = item.open_issues || 0;
    const closed = item.closed_issues || 0;
    return {
      id: item.number,
      name: item.title,
      description: item.description || '',
      state: item.state,
      dueDate: item.due_on?.slice(0, 10) ?? null,
      url: item.html_url,
      open,
      closed,
      progress: open + closed ? Math.round(closed / (open + closed) * 100) : 0
    };
  };
  async function topicTree(id) {
    const root = await request(issuePath(id));
    if (!isTopic(root)) throw new GitHubError('Only Blackboard topics can be changed.');
    const ordered = [];
    const visited = new Set();
    async function visit(issue, parentId) {
      if (visited.has(issue.id ?? issue.number)) return;
      visited.add(issue.id ?? issue.number);
      if (issue.sub_issues_summary?.total !== 0) {
        for (const child of await subIssues(issue.number)) {
          if (isLocal(child) && isTopic(child)) await visit(child, issue.number);
        }
      }
      ordered.push({
        ...channel(issue),
        parentId
      });
    }
    await visit(root, undefined);
    return ordered;
  }
  const api = {
    async checkRepository() {
      const repository = await request('');
      if (!repository?.owner?.login || !repository.name) throw new GitHubError('Could not identify this repository.');
      if (repository.has_issues === false) throw new GitHubError('Enable Issues in this repository’s GitHub settings before connecting Blackboard.');
      // Repository visibility alone does not establish access to its Issues API.
      await request('/issues?state=open&per_page=1');
      return {
        owner: repository.owner.login,
        repo: repository.name
      };
    },
    async listDiscussions({
      includeClosed = false,
      includeArchived = false
    } = {}) {
      const entries = [],
        visited = new Set();
      let after = null;
      do {
        const result = await discussionQuery(`query BlackboardDiscussions($owner:String!,$repo:String!,$after:String) {
          repository(owner:$owner,name:$repo) { hasDiscussionsEnabled discussions(first:100,after:$after,orderBy:{field:CREATED_AT,direction:ASC}) {
            nodes { ${discussionFields} } pageInfo { hasNextPage endCursor }
          } }
        }`, {
          owner,
          repo,
          after
        });
        const repository = result.data?.repository;
        if (repository?.hasDiscussionsEnabled === false) return [];
        if (!repository?.discussions) throw new GitHubError('Could not read discussions. Check the token’s Discussions permission.');
        for (const entry of repository.discussions.nodes.filter(Boolean)) entries.push(await discussion(entry));
        after = nextCursor(repository.discussions, visited);
      } while (after);
      return entries.filter(item => (includeClosed || item.state === 'open') && (includeArchived || !item.archived));
    },
    async readDiscussion(id) {
      const result = await discussionQuery(`query BlackboardDiscussion($id:ID!) { node(id:$id) { ... on Discussion { ${discussionFields} } } }`, {
        id: discussionNode(id)
      });
      return discussion(result.data?.node);
    },
    async createDiscussion({
      name,
      topic = ''
    }) {
      if (!name.trim()) throw new GitHubError('A topic name is required.');
      let repositoryId,
        categoryId,
        after = null;
      const visited = new Set();
      do {
        const result = await discussionQuery(`query BlackboardDiscussionCategory($owner:String!,$repo:String!,$after:String) {
          repository(owner:$owner,name:$repo) { id discussionCategories(first:100,after:$after) { nodes { id name } pageInfo { hasNextPage endCursor } } }
        }`, {
          owner,
          repo,
          after
        });
        const repository = result.data?.repository;
        if (!repository?.discussionCategories) throw new GitHubError('Enable Discussions on GitHub and check the token’s Discussions permission.');
        repositoryId = repository.id;
        categoryId = repository.discussionCategories.nodes.find(category => category?.name.toLowerCase() === 'general')?.id;
        after = categoryId ? null : nextCursor(repository.discussionCategories, visited);
      } while (after);
      if (!categoryId) throw new GitHubError('Create a General discussion category on GitHub first.');
      const result = await discussionQuery(`mutation BlackboardCreateDiscussion($repository:ID!,$category:ID!,$title:String!,$body:String!) {
        createDiscussion(input:{repositoryId:$repository,categoryId:$category,title:$title,body:$body}) { discussion { ${discussionFields} } }
      }`, {
        repository: repositoryId,
        category: categoryId,
        title: name.trim(),
        body: topic.trim() ? topic : 'Start the conversation here.'
      }, true);
      if (!result.data?.createDiscussion?.discussion?.id) throw new GitHubError('Discussion creation unconfirmed. Check GitHub before trying again.', {
        uncertain: true
      });
      return discussion(result.data.createDiscussion.discussion);
    },
    async readDiscussionMessages(id) {
      const entries = [],
        visited = new Set();
      let after = null;
      do {
        const result = await discussionQuery(`query BlackboardDiscussionComments($id:ID!,$after:String) {
          node(id:$id) { ... on Discussion { comments(first:100,after:$after) {
            nodes { ${commentFields} replies(first:100) { nodes { ${commentFields} } pageInfo { hasNextPage endCursor } } }
            pageInfo { hasNextPage endCursor }
          } } }
        }`, {
          id: discussionNode(id),
          after
        });
        const connection = result.data?.node?.comments;
        if (!connection) throw new GitHubError('Could not read discussion messages.');
        for (const entry of connection.nodes.filter(Boolean)) {
          entries.push(discussionMessage(entry));
          const reference = {
            id: `dc:${entry.id}`,
            author: decodeMessage(entry.body || '').sender || entry.author?.login || 'Deleted user',
            url: entry.url
          };
          let replies = entry.replies;
          const replyCursors = new Set();
          while (replies) {
            entries.push(...replies.nodes.filter(Boolean).map(reply => discussionMessage(reply, reference)));
            const cursor = nextCursor(replies, replyCursors);
            if (!cursor) break;
            const more = await discussionQuery(`query BlackboardDiscussionReplies($id:ID!,$after:String!) {
              node(id:$id) { ... on DiscussionComment { replies(first:100,after:$after) { nodes { ${commentFields} } pageInfo { hasNextPage endCursor } } } }
            }`, {
              id: entry.id,
              after: cursor
            });
            replies = more.data?.node?.replies;
            if (!replies) throw new GitHubError('Could not read discussion replies.');
          }
        }
        after = nextCursor(connection, visited);
      } while (after);
      return [...new Map(entries.map(entry => [entry.id, entry])).values()].sort(chronological);
    },
    async listProjectViews(projectId) {
      nodeId(projectId);
      const views = [],
        visited = new Set();
      let after = null;
      do {
        const result = await projectQuery(`query BlackboardProjectViews($id:ID!,$after:String) {
          node(id:$id) { ... on ProjectV2 { views(first:100,after:$after) {
            nodes { id number name layout filter } pageInfo { hasNextPage endCursor }
          } } }
        }`, {
          id: projectId,
          after
        });
        const connection = result.data?.node?.views;
        if (!connection) throw new GitHubError('Could not read project views.');
        views.push(...connection.nodes.filter(Boolean));
        after = nextCursor(connection, visited);
      } while (after);
      return views;
    },
    async projectViewItemIds(projectId, filter) {
      nodeId(projectId);
      const ids = [],
        visited = new Set();
      let after = null;
      do {
        const result = await projectQuery(`query BlackboardViewItems($id:ID!,$filter:String!,$after:String) {
          node(id:$id) { ... on ProjectV2 { items(first:100,after:$after,query:$filter) {
            nodes { id isArchived } pageInfo { hasNextPage endCursor }
          } } }
        }`, {
          id: projectId,
          filter,
          after
        });
        const connection = result.data?.node?.items;
        if (!connection) throw new GitHubError('Could not apply the view filter.');
        ids.push(...connection.nodes.filter(item => item && !item.isArchived).map(item => item.id));
        after = nextCursor(connection, visited);
      } while (after);
      return ids;
    },
    async createProjectView(projectId, {
      name,
      layout = 'BOARD_LAYOUT',
      filter = ''
    }) {
      nodeId(projectId);
      if (!['BOARD_LAYOUT', 'TABLE_LAYOUT'].includes(layout) || typeof name !== 'string' || !name.trim()) throw new GitHubError('Choose a view name and a Board or Table layout.');
      const result = await projectQuery(`mutation BlackboardCreateView($project:ID!,$name:String!,$layout:ProjectV2ViewLayout!) {
        createProjectV2View(input:{projectId:$project,name:$name,layout:$layout}) { projectV2View { id number name layout filter } }
      }`, {
        project: projectId,
        name: name.trim(),
        layout
      }, true);
      const view = result.data?.createProjectV2View?.projectV2View;
      if (!view?.id) throw new GitHubError('GitHub did not confirm view creation. Refresh before trying again.', {
        uncertain: true
      });
      if (filter.trim()) {
        try {
          return await api.updateProjectView(view.id, {
            filter
          });
        } catch (failure) {
          failure.createdView = view;
          throw failure;
        }
      }
      return view;
    },
    async updateProjectView(viewId, changes) {
      nodeId(viewId);
      const input = {
        viewId
      };
      if (changes.name !== undefined) {
        if (typeof changes.name !== 'string' || !changes.name.trim()) throw new GitHubError('A view name is required.');
        input.name = changes.name.trim();
      }
      if (changes.layout !== undefined) {
        if (!['BOARD_LAYOUT', 'TABLE_LAYOUT'].includes(changes.layout)) throw new GitHubError('Choose Board or Table.');
        input.layout = changes.layout;
      }
      if (changes.filter !== undefined) input.filter = changes.filter.trim();
      const result = await projectQuery(`mutation BlackboardUpdateView($input:UpdateProjectV2ViewInput!) {
        updateProjectV2View(input:$input) { projectV2View { id number name layout filter } }
      }`, {
        input
      }, true);
      const view = result.data?.updateProjectV2View?.projectV2View;
      if (view?.id !== viewId) throw new GitHubError('GitHub did not confirm the view update. Refresh before trying again.', {
        uncertain: true
      });
      return view;
    },
    async deleteProjectView(viewId) {
      nodeId(viewId);
      const result = await projectQuery(`mutation BlackboardDeleteView($id:ID!) {
        deleteProjectV2View(input:{viewId:$id}) { projectV2View { id } }
      }`, {
        id: viewId
      }, true);
      if (result.data?.deleteProjectV2View?.projectV2View?.id !== viewId) throw new GitHubError('GitHub did not confirm view deletion. Refresh before trying again.', {
        uncertain: true
      });
    },
    async listProjects() {
      const projects = [];
      const visited = new Set();
      let after = null;
      do {
        const result = await projectQuery(`query BlackboardProjects($owner:String!,$repo:String!,$after:String) {
          repository(owner:$owner,name:$repo) { projectsV2(first:100,after:$after) {
            nodes { id number title url closed shortDescription viewerCanUpdate }
            pageInfo { hasNextPage endCursor }
          } }
        }`, {
          owner,
          repo,
          after
        });
        const connection = result.data?.repository?.projectsV2;
        if (!connection) throw new GitHubError('Could not read projects linked to this repository.');
        projects.push(...connection.nodes.filter(Boolean).map(item => ({
          id: item.id,
          number: item.number,
          name: item.title,
          url: item.url,
          closed: item.closed,
          description: item.shortDescription || '',
          canUpdate: item.viewerCanUpdate
        })));
        after = nextCursor(connection, visited);
      } while (after);
      return projects.sort((a, b) => Number(a.closed) - Number(b.closed) || a.number - b.number);
    },
    async readProject(id) {
      nodeId(id);
      const fields = [];
      let project;
      let after = null;
      const fieldCursors = new Set();
      do {
        const result = await projectQuery(`query BlackboardProjectFields($id:ID!,$after:String) {
          node(id:$id) { ... on ProjectV2 {
            id number title url closed shortDescription viewerCanUpdate
            fields(first:100,after:$after) {
              nodes { __typename ... on ProjectV2SingleSelectField { id name options { id name color description } } }
              pageInfo { hasNextPage endCursor }
            }
          } }
        }`, {
          id,
          after
        });
        project = result.data?.node;
        if (!project?.fields) throw new GitHubError('Project is unavailable or the token cannot access it.');
        fields.push(...project.fields.nodes.filter(field => field?.__typename === 'ProjectV2SingleSelectField'));
        after = nextCursor(project.fields, fieldCursors);
      } while (after);
      const statusField = fields.find(field => field.name.toLowerCase() === 'status') || null;
      const items = [];
      const itemCursors = new Set();
      do {
        const result = await projectQuery(`query BlackboardProjectItems($id:ID!,$after:String,$statusName:String!) {
          node(id:$id) { ... on ProjectV2 { items(first:100,after:$after) {
            nodes { id isArchived
              fieldValueByName(name:$statusName) { ... on ProjectV2ItemFieldSingleSelectValue { optionId name } }
              content { __typename
                ... on Issue { id number title body url state labels(first:100) { nodes { name } } repository { nameWithOwner } }
                ... on PullRequest { id number title url state repository { nameWithOwner } }
                ... on DraftIssue { id title body }
              }
            }
            pageInfo { hasNextPage endCursor }
          } } }
        }`, {
          id,
          after,
          statusName: statusField?.name || 'Status'
        });
        const connection = result.data?.node?.items;
        if (!connection) throw new GitHubError('Could not read project items.');
        for (const item of connection.nodes.filter(item => item && !item.isArchived)) {
          const content = item.content;
          const localTopic = content?.__typename === 'Issue' && content.repository?.nameWithOwner.toLowerCase() === `${owner}/${repo}`.toLowerCase() && (content.title.startsWith(CHANNEL_PREFIX) || (content.labels?.nodes || []).some(label => [TALK_LABEL, NOTE_LABEL, LIST_LABEL].includes(label.name.toLowerCase())));
          items.push({
            id: item.id,
            contentId: content?.id,
            title: localTopic && content.title.startsWith(CHANNEL_PREFIX) ? content.title.slice(CHANNEL_PREFIX.length) : content?.title || 'Unavailable item',
            type: content?.__typename || 'Unavailable',
            url: content?.url || null,
            body: content?.body || '',
            number: content?.number ?? null,
            repository: content?.repository?.nameWithOwner || null,
            state: content?.state || null,
            channelId: localTopic ? content.number : null,
            statusId: item.fieldValueByName?.optionId ?? null
          });
        }
        after = nextCursor(connection, itemCursors);
      } while (after);
      return {
        id: project.id,
        number: project.number,
        name: project.title,
        url: project.url,
        closed: project.closed,
        description: project.shortDescription || '',
        canUpdate: project.viewerCanUpdate,
        statusField,
        items
      };
    },
    async setProjectItemStatus(projectId, itemId, fieldId, optionId) {
      [projectId, itemId, fieldId].forEach(nodeId);
      if (optionId !== null) nodeId(optionId);
      const clearing = optionId === null;
      const mutation = clearing ? 'clearProjectV2ItemFieldValue' : 'updateProjectV2ItemFieldValue';
      const result = await projectQuery(clearing ? `mutation BlackboardClearStatus($project:ID!,$item:ID!,$field:ID!) { clearProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field}) { projectV2Item { id } } }` : `mutation BlackboardSetStatus($project:ID!,$item:ID!,$field:ID!,$option:String!) { updateProjectV2ItemFieldValue(input:{projectId:$project,itemId:$item,fieldId:$field,value:{singleSelectOptionId:$option}}) { projectV2Item { id } } }`, {
        project: projectId,
        item: itemId,
        field: fieldId,
        ...(clearing ? {} : {
          option: optionId
        })
      }, true);
      if (!result.data?.[mutation]?.projectV2Item?.id) throw new GitHubError('Project update unconfirmed. Refresh the board before trying again.', {
        uncertain: true
      });
      return {
        id: itemId,
        statusId: optionId
      };
    },
    async addTopicToProject(projectId, channelId) {
      nodeId(projectId);
      const issue = await request(issuePath(channelId));
      if (!isTopic(issue) || !issue.node_id) throw new GitHubError('Only Blackboard topics can be added from this client.');
      const result = await projectQuery(`mutation BlackboardAddTopic($project:ID!,$content:ID!) { addProjectV2ItemById(input:{projectId:$project,contentId:$content}) { item { id } } }`, {
        project: projectId,
        content: issue.node_id
      }, true);
      const id = result.data?.addProjectV2ItemById?.item?.id;
      if (!id) throw new GitHubError('Project addition unconfirmed. Refresh the board before trying again.', {
        uncertain: true
      });
      return {
        id,
        channelId,
        contentId: issue.node_id,
        title: channel(issue).name,
        type: 'Issue',
        number: channelId,
        url: issue.html_url,
        repository: `${owner}/${repo}`,
        state: issue.state.toUpperCase(),
        statusId: null
      };
    },
    async createProjectDraft(projectId, {
      title,
      body = '',
      fieldId = null,
      statusId = null
    }) {
      nodeId(projectId);
      if (typeof title !== 'string' || !title.trim()) throw new GitHubError('An item title is required.');
      if (statusId !== null) {
        nodeId(fieldId);
        nodeId(statusId);
      }
      const result = await projectQuery(`mutation BlackboardCreateDraft($project:ID!,$title:String!,$body:String!) {
        addProjectV2DraftIssue(input:{projectId:$project,title:$title,body:$body}) {
          projectItem { id content { ... on DraftIssue { id title body } } }
        }
      }`, {
        project: projectId,
        title: title.trim(),
        body
      }, true);
      const created = result.data?.addProjectV2DraftIssue?.projectItem;
      if (!created?.id || !created.content?.id) throw new GitHubError('Draft creation unconfirmed. Refresh the board before trying again.', {
        uncertain: true
      });
      const item = {
        id: created.id,
        contentId: created.content.id,
        title: created.content.title,
        body: created.content.body || '',
        type: 'DraftIssue',
        channelId: null,
        statusId: null,
        url: null,
        repository: null,
        state: null,
        number: null
      };
      if (statusId !== null) {
        try {
          await api.setProjectItemStatus(projectId, item.id, fieldId, statusId);
        } catch (failure) {
          const error = new GitHubError(`The draft was created, but its column could not be confirmed. ${failure.message}`, {
            uncertain: failure.uncertain,
            retryAt: failure.retryAt
          });
          error.createdItem = item;
          throw error;
        }
      }
      return {
        ...item,
        statusId
      };
    },
    async updateProjectDraft(draftId, {
      title,
      body = ''
    }) {
      nodeId(draftId);
      if (typeof title !== 'string' || !title.trim()) throw new GitHubError('An item title is required.');
      const result = await projectQuery(`mutation BlackboardEditDraft($id:ID!,$title:String!,$body:String!) {
        updateProjectV2DraftIssue(input:{draftIssueId:$id,title:$title,body:$body}) { draftIssue { id title body } }
      }`, {
        id: draftId,
        title: title.trim(),
        body
      }, true);
      const draft = result.data?.updateProjectV2DraftIssue?.draftIssue;
      if (!draft?.id) throw new GitHubError('Draft update unconfirmed. Refresh the board before trying again.', {
        uncertain: true
      });
      return {
        contentId: draft.id,
        title: draft.title,
        body: draft.body || ''
      };
    },
    async removeProjectItem(projectId, itemId) {
      [projectId, itemId].forEach(nodeId);
      const result = await projectQuery(`mutation BlackboardRemoveCard($project:ID!,$item:ID!) {
        deleteProjectV2Item(input:{projectId:$project,itemId:$item}) { deletedItemId }
      }`, {
        project: projectId,
        item: itemId
      }, true);
      if (result.data?.deleteProjectV2Item?.deletedItemId !== itemId) throw new GitHubError('Card removal unconfirmed. Refresh the board before trying again.', {
        uncertain: true
      });
      return {
        id: itemId
      };
    },
    async updateChannelDetails(id, {
      name,
      description = ''
    }) {
      const path = issuePath(id);
      if (typeof name !== 'string' || !name.trim()) throw new GitHubError('A topic name is required.');
      const current = await request(path);
      if (!isTopic(current)) throw new GitHubError('Only Blackboard topics can be edited.');
      return channel(await request(path, {
        method: 'PATCH',
        body: {
          title: [TALK_LABEL, NOTE_LABEL, LIST_LABEL].some(label => hasLabel(current, label)) ? name.trim() : CHANNEL_PREFIX + name.trim(),
          body: description
        }
      }));
    },
    async changeProjectColumn(projectId, {
      id = null,
      name,
      color = 'GRAY',
      description = '',
      direction = null,
      remove = false
    }) {
      nodeId(projectId);
      if (id !== null) nodeId(id);
      if ((remove || direction !== null) && id === null) throw new GitHubError('Choose a status column.');
      if (direction !== null && ![-1, 1].includes(direction)) throw new GitHubError('Invalid column direction.');
      if (!remove && direction === null && (typeof name !== 'string' || !name.trim())) throw new GitHubError('A column name is required.');
      if (!['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE'].includes(color)) throw new GitHubError('Invalid column color.');
      // Fetch current options before replacing the field configuration. Retain every
      // existing option ID: omitting IDs would clear cards' status assignments.
      const snapshot = await api.readProject(projectId);
      const field = snapshot.statusField;
      if (!field) throw new GitHubError('This project has no Status field.');
      let options = field.options.map(option => ({
        id: option.id,
        name: option.name,
        color: option.color || 'GRAY',
        description: option.description || ''
      }));
      const index = options.findIndex(option => option.id === id);
      if (id !== null && index < 0) throw new GitHubError('That column no longer exists. Refresh the board.');
      if (remove) {
        if (options.length <= 1) throw new GitHubError('Keep at least one status column.');
        options.splice(index, 1);
      } else if (direction !== null) {
        const destination = index + direction;
        if (destination < 0 || destination >= options.length) return field;
        [options[index], options[destination]] = [options[destination], options[index]];
      } else if (id === null) options.push({
        name: name.trim(),
        color,
        description
      });else options[index] = {
        id,
        name: name.trim(),
        color,
        description
      };
      const result = await projectQuery(`mutation BlackboardChangeColumn($field:ID!,$options:[ProjectV2SingleSelectFieldOptionInput!]!) {
        updateProjectV2Field(input:{fieldId:$field,singleSelectOptions:$options}) {
          projectV2Field { ... on ProjectV2SingleSelectField { id name options { id name color description } } }
        }
      }`, {
        field: field.id,
        options
      }, true);
      const updated = result.data?.updateProjectV2Field?.projectV2Field;
      if (!updated?.options) throw new GitHubError('Column update unconfirmed. Refresh the board before trying again.', {
        uncertain: true
      });
      return updated;
    },
    async listTags() {
      // Suggest only names in use, rather than GitHub's unused default labels.
      const issues = await listAll('/issues?state=all&sort=created&direction=asc');
      const tags = topicTags(issues.flatMap(issue => issue.labels || []).filter(item => !item.archived_at));
      return [...new Map(tags.map(tag => [tag.name.toLowerCase(), tag])).values()].sort((a, b) => a.name.localeCompare(b.name));
    },
    async addChannelTag(id, name) {
      if (isDiscussionId(id)) return changeDiscussionLabel(id, tagName(name), true);
      const path = issuePath(id);
      name = tagName(name);
      const current = await request(path);
      if (!isTopic(current)) throw new GitHubError('Only Blackboard topics can be tagged.');
      let label;
      try {
        const labelPath = `/labels/${encodeURIComponent(name)}`;
        try {
          label = await request(labelPath);
        } catch (failure) {
          if (failure.status !== 404) throw failure;
          try {
            label = await request('/labels', {
              method: 'POST',
              body: {
                name,
                color: '52769b'
              }
            });
          } catch (creationFailure) {
            if (creationFailure.status !== 422) throw creationFailure;
            label = await request(labelPath); // Another client may have created it.
          }
        }
      } catch (failure) {
        failure.tagNotApplied = true;
        throw failure;
      }
      return topicTags(await request(`${path}/labels`, {
        method: 'POST',
        body: {
          labels: [label.name]
        }
      }));
    },
    async removeChannelTag(id, name) {
      if (isDiscussionId(id)) return changeDiscussionLabel(id, tagName(name), false);
      const path = issuePath(id);
      name = tagName(name);
      const current = await request(path);
      if (!isTopic(current)) throw new GitHubError('Only Blackboard topics can be tagged.');
      return topicTags(await request(`${path}/labels/${encodeURIComponent(name)}`, {
        method: 'DELETE'
      }));
    },
    async listMilestones({
      includeClosed = false
    } = {}) {
      return (await listAll(`/milestones?state=${includeClosed ? 'all' : 'open'}&sort=due_on&direction=asc`)).map(milestone);
    },
    async createMilestone({
      name,
      description = '',
      dueDate = null
    }) {
      if (!name.trim()) throw new GitHubError('A milestone name is required.');
      const dueOn = milestoneDate(dueDate);
      return milestone(await request('/milestones', {
        method: 'POST',
        body: {
          title: name.trim(),
          description,
          ...(dueOn ? {
            due_on: dueOn
          } : {})
        }
      }));
    },
    async updateMilestone(id, {
      name,
      description,
      dueDate,
      state
    } = {}) {
      const path = milestonePath(id);
      const body = {};
      if (name !== undefined) {
        if (!name.trim()) throw new GitHubError('A milestone name is required.');
        body.title = name.trim();
      }
      if (description !== undefined) body.description = description;
      if (dueDate !== undefined) body.due_on = milestoneDate(dueDate);
      if (state !== undefined) {
        if (!['open', 'closed'].includes(state)) throw new GitHubError('Invalid milestone state.');
        body.state = state;
      }
      return milestone(await request(path, {
        method: 'PATCH',
        body
      }));
    },
    async setChannelMilestone(id, milestoneId) {
      const path = issuePath(id);
      if (milestoneId !== null) milestonePath(milestoneId);
      const current = await request(path);
      if (!isTopic(current)) throw new GitHubError('Only Blackboard topics can be assigned.');
      return channel(await request(path, {
        method: 'PATCH',
        body: {
          milestone: milestoneId
        }
      }));
    },
    async getViewer() {
      if (!viewerPromise) {
        viewerPromise = request('/user', {
          apiRoot: true
        }).then(user => user.login).catch(failure => {
          viewerPromise = null;
          throw failure;
        });
      }
      return viewerPromise;
    },
    async listReactions(commentId) {
      if (typeof commentId === 'string' && commentId.startsWith('dc:')) {
        const entries = [],
          visited = new Set();
        let after = null;
        do {
          const result = await discussionQuery(`query BlackboardDiscussionReactions($id:ID!,$after:String) {
            node(id:$id) { ... on DiscussionComment { reactions(first:100,after:$after) { nodes { id content user { login } } pageInfo { hasNextPage endCursor } } } }
          }`, {
            id: nodeId(commentId.slice(3)),
            after
          });
          const connection = result.data?.node?.reactions;
          if (!connection) throw new GitHubError('Could not read reactions.');
          entries.push(...connection.nodes.filter(Boolean).map(entry => ({
            id: entry.id,
            type: REACTION_TYPES[REACTION_ENUMS.indexOf(entry.content)],
            author: entry.user?.login || 'Deleted user'
          })));
          after = nextCursor(connection, visited);
        } while (after);
        return entries;
      }
      return (await listAll(reactionPath(commentId))).map(reaction);
    },
    async addReaction(commentId, type) {
      if (!REACTION_TYPES.includes(type)) throw new GitHubError('Unsupported reaction.');
      if (typeof commentId === 'string' && commentId.startsWith('dc:')) {
        const result = await discussionQuery(`mutation BlackboardDiscussionReact($id:ID!,$content:ReactionContent!) {
          addReaction(input:{subjectId:$id,content:$content}) { reaction { id content user { login } } }
        }`, {
          id: nodeId(commentId.slice(3)),
          content: REACTION_ENUMS[REACTION_TYPES.indexOf(type)]
        }, true);
        const entry = result.data?.addReaction?.reaction;
        if (!entry?.id) throw new GitHubError('Reaction unconfirmed. Refresh before trying again.', {
          uncertain: true
        });
        return {
          id: entry.id,
          type,
          author: entry.user?.login || 'Deleted user'
        };
      }
      return reaction(await request(reactionPath(commentId), {
        method: 'POST',
        body: {
          content: type
        }
      }));
    },
    async removeReaction(commentId, reactionId) {
      if (typeof commentId === 'string' && commentId.startsWith('dc:')) {
        const entries = await api.listReactions(commentId);
        // The UI passes an owned reaction ID; resolve its type again before removal.
        const viewer = await api.getViewer();
        const own = entries.find(entry => entry.id === reactionId && entry.author === viewer);
        if (!own) throw new GitHubError('Your reaction is no longer present. Refresh before trying again.');
        const id = nodeId(commentId.slice(3));
        const result = await discussionQuery(`mutation BlackboardDiscussionUnreact($id:ID!,$content:ReactionContent!) {
          removeReaction(input:{subjectId:$id,content:$content}) { subject { id } }
        }`, {
          id,
          content: REACTION_ENUMS[REACTION_TYPES.indexOf(own.type)]
        }, true);
        if (result.data?.removeReaction?.subject?.id !== id) throw new GitHubError('Reaction removal unconfirmed. Refresh before trying again.', {
          uncertain: true
        });
        return;
      }
      const path = reactionPath(commentId);
      if (!Number.isSafeInteger(reactionId) || reactionId < 1) throw new GitHubError('Invalid reaction ID.');
      await request(`${path}/${reactionId}`, {
        method: 'DELETE'
      });
    },
    async listChannels({
      includeClosed = false,
      includeArchived = false,
      includeHierarchy = false
    } = {}) {
      const issues = await listAll(`/issues?state=${includeClosed ? 'all' : 'open'}&sort=created&direction=asc`);
      const topicIssues = issues.filter(isTopic);
      const channels = new Map(topicIssues.map(issue => [issue.number, channel(issue)]));
      if (includeHierarchy) {
        for (const parent of topicIssues) {
          if (parent.sub_issues_summary?.total === 0) continue;
          for (const child of await subIssues(parent.number)) {
            if (isLocal(child) && channels.has(child.number)) channels.get(child.number).parentId = parent.number;
          }
        }
      }
      return [...channels.values()].filter(item => includeArchived || !item.archived);
    },
    async createChannel({
      name,
      topic = '',
      parentId = null,
      kind = 'talk'
    }) {
      if (!name.trim()) throw new GitHubError('A topic name is required.');
      if (!['talk', 'task', 'note', 'list'].includes(kind)) throw new GitHubError('Invalid topic type.');
      if (parentId !== null) {
        const parent = await request(issuePath(parentId));
        if (!isTopic(parent)) throw new GitHubError('The parent must be a Blackboard topic.');
      }
      const typeLabel = kind === 'note' ? NOTE_LABEL : kind === 'list' ? LIST_LABEL : TALK_LABEL;
      await ensureLabel(typeLabel);
      const created = await request('/issues', {
        method: 'POST',
        body: {
          title: name.trim(),
          body: topic,
          labels: [typeLabel]
        }
      });
      if (parentId !== null) {
        try {
          await request(`${issuePath(parentId)}/sub_issues`, {
            method: 'POST',
            body: {
              sub_issue_id: created.id
            }
          });
        } catch (failure) {
          const error = new GitHubError(`Topic #${created.number} was created, but its parent link could not be confirmed. ${failure.message}`, {
            uncertain: failure.uncertain,
            retryAt: failure.retryAt
          });
          error.createdChannel = channel(created);
          throw error;
        }
      }
      return {
        ...channel(created),
        parentId
      };
    },
    async readNote(id) {
      return readDocument(id, 'note');
    },
    async updateNote(id, body, expectedBody) {
      return updateDocument(id, 'note', body, expectedBody);
    },
    async readList(id) {
      return readDocument(id, 'list');
    },
    async updateList(id, body, expectedBody) {
      return updateDocument(id, 'list', body, expectedBody);
    },
    async closeChannel(id) {
      if (isDiscussionId(id)) return discussionState(id, true);
      return channel(await request(issuePath(id), {
        method: 'PATCH',
        body: {
          state: 'closed',
          state_reason: 'not_planned'
        }
      }));
    },
    async reopenChannel(id) {
      if (isDiscussionId(id)) return discussionState(id, false);
      return channel(await request(issuePath(id), {
        method: 'PATCH',
        body: {
          state: 'open'
        }
      }));
    },
    async closeChannelTree(id, onChange = () => {}) {
      if (isDiscussionId(id)) {
        onChange(await api.closeChannel(id));
        return;
      }
      const tree = await topicTree(id);
      for (const item of tree) {
        try {
          if (item.state !== 'closed') await api.closeChannel(item.id);
        } catch (failure) {
          failure.affectedChannelId = item.id;
          throw failure;
        }
        onChange({
          ...item,
          state: 'closed'
        });
      }
    },
    async archiveChannelTree(id, onChange = () => {}) {
      if (isDiscussionId(id)) {
        await api.archiveChannel(id);
        onChange({
          id,
          archived: true
        });
        return;
      }
      const tree = await topicTree(id);
      for (const item of tree) {
        try {
          if (!item.archived) await api.archiveChannel(item.id);
        } catch (failure) {
          failure.affectedChannelId = item.id;
          throw failure;
        }
        onChange({
          ...item,
          archived: true
        });
      }
    },
    async archiveChannel(id) {
      if (isDiscussionId(id)) {
        await changeDiscussionLabel(id, ARCHIVED_LABEL, true);
        return {
          id,
          archived: true
        };
      }
      const path = issuePath(id);
      const labelPath = `/labels/${encodeURIComponent(ARCHIVED_LABEL)}`;
      try {
        await request(labelPath);
      } catch (failure) {
        if (failure.status !== 404) throw failure;
        try {
          await request('/labels', {
            method: 'POST',
            body: {
              name: ARCHIVED_LABEL,
              color: '52657d',
              description: 'Archived Blackboard topic'
            }
          });
        } catch (creationFailure) {
          if (creationFailure.status !== 422) throw creationFailure;
          await request(labelPath); // Another client may have created it first.
        }
      }
      await request(`${path}/labels`, {
        method: 'POST',
        body: {
          labels: [ARCHIVED_LABEL]
        }
      });
      return {
        id,
        archived: true
      };
    },
    async deleteChannel(id) {
      if (isDiscussionId(id)) {
        const result = await discussionQuery(`mutation BlackboardDeleteDiscussion($id:ID!) {
          deleteDiscussion(input:{id:$id}) { discussion { id } }
        }`, {
          id: discussionNode(id)
        }, true);
        if (result.data?.deleteDiscussion?.discussion?.id !== discussionNode(id)) throw new GitHubError('Deletion unconfirmed. Check GitHub before trying again.', {
          uncertain: true
        });
        return {
          id,
          deleted: true
        };
      }
      const issue = await request(issuePath(id));
      if (!isTopic(issue) || !issue.node_id) {
        throw new GitHubError('Only Blackboard topic issues can be deleted.');
      }
      const result = await request('', {
        graphql: true,
        method: 'POST',
        body: {
          query: 'mutation DeleteTopic($id: ID!) { deleteIssue(input: {issueId: $id}) { repository { id } } }',
          variables: {
            id: issue.node_id
          }
        }
      });
      if (!result.data?.deleteIssue?.repository) {
        throw new GitHubError('Deletion unconfirmed. Check GitHub before trying again.', {
          uncertain: true
        });
      }
      return {
        id,
        deleted: true
      };
    },
    async deleteChannelPreservingChildren(id, onChange = () => {}) {
      if (isDiscussionId(id)) return api.deleteChannel(id);
      const parent = await request(issuePath(id));
      if (!isTopic(parent)) throw new GitHubError('Only Blackboard topics can be deleted.');
      const children = await subIssues(id);
      for (const child of children) {
        try {
          await request(`${issuePath(id)}/sub_issue`, {
            method: 'DELETE',
            body: {
              sub_issue_id: child.id
            }
          });
        } catch (failure) {
          failure.deletionNotAttempted = true;
          throw failure;
        }
        if (isLocal(child) && isTopic(child)) onChange({
          ...channel(child),
          parentId: null
        });
      }
      return api.deleteChannel(id);
    },
    // Initial implementation returns a complete paginated snapshot. Polling
    // replaces the snapshot; comment IDs prevent duplicates. Cursor reads follow.
    async readMessages(id) {
      if (isDiscussionId(id)) return api.readDiscussionMessages(id);
      return (await listAll(`${issuePath(id)}/comments`)).map(message);
    },
    async sendMessage(id, text, {
      sender = null
    } = {}) {
      if (!text.trim()) throw new GitHubError('A message is required.');
      if (isDiscussionId(id)) {
        const result = await discussionQuery(`mutation BlackboardDiscussionSend($id:ID!,$body:String!) {
          addDiscussionComment(input:{discussionId:$id,body:$body}) { comment { ${commentFields} } }
        }`, {
          id: discussionNode(id),
          body: encodeMessage(text, sender)
        }, true);
        const entry = result.data?.addDiscussionComment?.comment;
        if (!entry?.id) throw new GitHubError('Message delivery unconfirmed. Check GitHub before resending.', {
          uncertain: true
        });
        return discussionMessage(entry);
      }
      return message(await request(`${issuePath(id)}/comments`, {
        method: 'POST',
        body: {
          body: encodeMessage(text, sender)
        }
      }));
    }
  };
  return api;
}

// Repository selection is public configuration; never put credentials in URLs.
function parseRepository(value) {
  let path = String(value || '').trim();
  if (/^https?:\/\//i.test(path)) {
    const url = new URL(path);
    if (url.hostname.toLowerCase() !== 'github.com' || url.username || url.password || url.port || url.search || url.hash) throw new Error('Use a GitHub repository URL or owner/repo.');
    path = url.pathname;
  }
  path = path.replace(/^\/+|\/+$/g, '').replace(/\.git$/i, '');
  const parts = path.split('/');
  if (parts.length !== 2 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(parts[0]) || !/^[a-z0-9_.-]+$/i.test(parts[1]) || ['.', '..'].includes(parts[1])) throw new Error('Use a GitHub repository URL or owner/repo.');
  return {
    owner: parts[0],
    repo: parts[1]
  };
}
const repositoryName = ({
  owner,
  repo
}) => `${owner}/${repo}`;
const repositoryKey = repository => repositoryName(repository).toLowerCase();
const RECENT_REPOSITORY_LIMIT = 4;
function normalizeRecentRepositories(value, activeRepository = null) {
  if (!Array.isArray(value)) return [];
  const seen = new Set(activeRepository ? [repositoryKey(activeRepository)] : []);
  const repositories = [];
  for (const entry of value) {
    try {
      const repository = entry && typeof entry === 'object' ? parseRepository(`${entry.owner}/${entry.repo}`) : parseRepository(entry);
      const key = repositoryKey(repository);
      if (seen.has(key)) continue;
      seen.add(key);
      repositories.push(repository);
      if (repositories.length === RECENT_REPOSITORY_LIMIT) break;
    } catch {/* Ignore invalid saved names. */}
  }
  return repositories;
}
function recentRepositoriesAfterConnect(recent, previous, next) {
  const history = previous && repositoryKey(previous) !== repositoryKey(next) ? [previous, ...recent] : recent;
  return normalizeRecentRepositories(history, next);
}

// A template ships the same prebuilt client to every owner. Standard Pages URLs
// identify the new home repository without requiring a rebuild or private config.
function repositoryFromPagesUrl(value) {
  try {
    const url = new URL(value);
    const owner = /^([a-z0-9-]+)\.github\.io$/i.exec(url.hostname)?.[1];
    if (!owner) return null;
    const first = url.pathname.split('/').filter(Boolean)[0];
    const repo = first && first !== 'index.html' ? decodeURIComponent(first) : `${owner}.github.io`;
    return repositoryName(parseRepository(`${owner}/${repo}`));
  } catch {
    return null;
  }
}

const keyFor = repository => `blackboard:${repositoryKey(repository)}:credentials`;
function normalizeCredentials(value) {
  if (!value || typeof value.token !== 'string' || typeof (value.projectToken ?? '') !== 'string') return null;
  const token = value.token.trim(),
    projectToken = (value.projectToken || '').trim();
  if (!token || /\s/.test(token) || /\s/.test(projectToken)) return null;
  return {
    token,
    projectToken
  };
}

// Tokens never enter public repository records or URLs. Unremembered tokens live
// only in this app instance; persistence failures are reported before activation.
function createCredentialStore(storage) {
  const temporary = new Map();
  return {
    get(repository) {
      const key = keyFor(repository);
      if (temporary.has(key)) return {
        ...temporary.get(key),
        remember: false
      };
      try {
        const credentials = normalizeCredentials(JSON.parse(storage?.getItem(key) || 'null'));
        return credentials ? {
          ...credentials,
          remember: true
        } : null;
      } catch {
        return null;
      }
    },
    save(repository, value, remember) {
      const credentials = normalizeCredentials(value);
      if (!credentials) throw new Error('Enter a repository token without spaces or line breaks.');
      const key = keyFor(repository);
      try {
        if (remember) {
          if (!storage) throw new Error('Storage unavailable');
          storage.setItem(key, JSON.stringify(credentials));
          temporary.delete(key);
        } else {
          let hasSaved = false;
          try {
            hasSaved = Boolean(storage?.getItem(key));
          } catch {/* Storage may be blocked entirely. */}
          try {
            storage?.removeItem(key);
          } catch (failure) {
            if (hasSaved) throw failure;
          }
          temporary.set(key, credentials);
        }
      } catch {
        throw new Error('Browser storage is unavailable. Uncheck Remember on this browser to continue, or allow storage for this site.');
      }
      return {
        ...credentials
      };
    },
    forget(repository) {
      const key = keyFor(repository);
      try {
        if (temporary.has(key)) {
          let hasSaved = false;
          try {
            hasSaved = Boolean(storage?.getItem(key));
          } catch {/* Memory-only authentication. */}
          try {
            storage?.removeItem(key);
          } catch (failure) {
            if (hasSaved) throw failure;
          }
        } else storage?.removeItem(key);
      } catch {
        throw new Error('Could not remove saved credentials. Allow browser storage or clear this site’s saved data.');
      }
      temporary.delete(key);
    }
  };
}

function boardColumns(board, search = '') {
  const columns = [{
    id: null,
    name: 'No status',
    color: 'GRAY',
    items: []
  }, ...(board.statusField?.options || []).map(option => ({
    ...option,
    items: []
  }))];
  const query = search.trim().toLowerCase();
  for (const item of board.items) {
    if (query && !`${item.title} ${item.repository || ''} ${item.number || ''}`.toLowerCase().includes(query)) continue;
    // Retain cards whose status option was removed while the board was loading.
    const column = columns.find(column => column.id === item.statusId) || columns[0];
    column.items.push(item);
  }
  return columns.filter(column => column.id !== null || column.items.length > 0);
}
function previewBoard(topics) {
  return {
    id: 'preview',
    name: 'Board preview',
    description: 'A preview using your topics. No project changes are saved.',
    url: null,
    closed: false,
    canUpdate: false,
    statusField: {
      id: 'preview-status',
      name: 'Status',
      options: [{
        id: 'todo',
        name: 'Todo',
        color: 'GRAY'
      }, {
        id: 'in-progress',
        name: 'In progress',
        color: 'BLUE'
      }, {
        id: 'done',
        name: 'Done',
        color: 'GREEN'
      }]
    },
    items: topics.map(topic => ({
      id: `preview-${topic.id}`,
      title: topic.name,
      channelId: topic.id,
      type: 'Issue',
      number: topic.id,
      state: topic.state.toUpperCase(),
      statusId: topic.state === 'closed' ? 'done' : 'todo'
    }))
  };
}
function createProjectTracker() {
  const changes = new Map();
  return {
    remember(item, added = false, fields = ['statusId']) {
      const pending = {
        ...item,
        syncState: 'confirming'
      };
      changes.set(item.id, {
        item: pending,
        added,
        fields
      });
      return pending;
    },
    remove(id) {
      changes.set(id, {
        item: null
      });
    },
    reconcile(incoming) {
      const merged = new Map(incoming.map(item => [item.id, item]));
      for (const [id, desired] of changes) {
        const actual = merged.get(id);
        if (desired.item === null) {
          if (!actual) changes.delete(id);
          merged.delete(id);
        } else if (actual && (desired.added || desired.fields.every(field => actual[field] === desired.item[field]))) changes.delete(id);else merged.set(id, desired.item);
      }
      return [...merged.values()];
    }
  };
}
function sameProjectColumns(a, b) {
  const signature = field => JSON.stringify((field?.options || []).map(option => [option.id, option.name, option.color || 'GRAY', option.description || '']));
  return signature(a) === signature(b);
}

var _tmpl$$4 = /*#__PURE__*/template(`<details class=project-menu><summary></summary><div class=project-menu-options>`),
  _tmpl$2$4 = /*#__PURE__*/template(`<svg width=16 height=16 viewBox="0 0 24 24"fill=currentColor aria-hidden=true><circle cx=5 cy=12 r=1.5></circle><circle cx=12 cy=12 r=1.5></circle><circle cx=19 cy=12 r=1.5>`),
  _tmpl$3$4 = /*#__PURE__*/template(`<button type=button class=project-card-title>`),
  _tmpl$4$4 = /*#__PURE__*/template(`<a class=project-card-title target=_blank rel="noopener noreferrer"> ↗`),
  _tmpl$5$4 = /*#__PURE__*/template(`<span class=project-card-title>`),
  _tmpl$6$4 = /*#__PURE__*/template(`<select><option value>No status`),
  _tmpl$7$4 = /*#__PURE__*/template(`<option>`),
  _tmpl$8$4 = /*#__PURE__*/template(`<button type=button>Edit details`),
  _tmpl$9$3 = /*#__PURE__*/template(`<button type=button>`),
  _tmpl$0$3 = /*#__PURE__*/template(`<a target=_blank rel="noopener noreferrer">Open in GitHub ↗`),
  _tmpl$1$3 = /*#__PURE__*/template(`<a class=preview-badge target=_blank rel="noopener noreferrer">GitHub ↗`),
  _tmpl$10$2 = /*#__PURE__*/template(`<div class=api-error role=alert> <button type=button aria-label="Dismiss project error">×`),
  _tmpl$11$2 = /*#__PURE__*/template(`<button type=button>+ Table`),
  _tmpl$12$2 = /*#__PURE__*/template(`<button type=button>+ Board`),
  _tmpl$13$1 = /*#__PURE__*/template(`<nav class=project-views aria-label="Project views">`),
  _tmpl$14$1 = /*#__PURE__*/template(`<span class=project-view-label>Board`),
  _tmpl$15$1 = /*#__PURE__*/template(`<select aria-label="Add topic to project"value><option value>`),
  _tmpl$16$1 = /*#__PURE__*/template(`<button type=button class=project-add-column>+ Column`),
  _tmpl$17$1 = /*#__PURE__*/template(`<div class=project-toolbar><input type=search aria-label="Filter project cards"placeholder="Filter cards"><button type=button class=project-refresh title="Refresh board">↻`),
  _tmpl$18$1 = /*#__PURE__*/template(`<p class="project-description project-saved-filter">Filter: <code>`),
  _tmpl$19$1 = /*#__PURE__*/template(`<p class=project-description>`),
  _tmpl$20$1 = /*#__PURE__*/template(`<p class=project-description>Read-only project access.`),
  _tmpl$21$1 = /*#__PURE__*/template(`<p class=project-description>Add a Status field in GitHub to organize this board into columns.`),
  _tmpl$22$1 = /*#__PURE__*/template(`<div class=project-board>`),
  _tmpl$23$1 = /*#__PURE__*/template(`<label for=project-view-layout>Layout`),
  _tmpl$24$1 = /*#__PURE__*/template(`<select id=project-view-layout><option value=BOARD_LAYOUT>Board</option><option value=TABLE_LAYOUT>Table`),
  _tmpl$25$1 = /*#__PURE__*/template(`<label for=project-view-filter>Filter`),
  _tmpl$26$1 = /*#__PURE__*/template(`<input id=project-view-filter type=text placeholder="status:&quot;In progress&quot;">`),
  _tmpl$27$1 = /*#__PURE__*/template(`<p class="muted project-filter-help">Optional GitHub filter, such as is:open or status:Done. Empty shows all items.`),
  _tmpl$28$1 = /*#__PURE__*/template(`<label for=project-edit-color>Color`),
  _tmpl$29$1 = /*#__PURE__*/template(`<select id=project-edit-color>`),
  _tmpl$30$1 = /*#__PURE__*/template(`<p class=dialog-error role=alert>`),
  _tmpl$31$1 = /*#__PURE__*/template(`<p>Project items are preserved.`),
  _tmpl$32$1 = /*#__PURE__*/template(`<p>Cards will move to No status.`),
  _tmpl$33$1 = /*#__PURE__*/template(`<p>The underlying issue and its messages are preserved.`),
  _tmpl$34$1 = /*#__PURE__*/template(`<section class=project-workspace aria-label="Project workspace"><header class="chat-header project-header"><h2></h2><p class=muted></p><div class=chat-header-actions></div></header><dialog class="topic-status-dialog project-editor-dialog"aria-labelledby=project-editor-title><form><h2 id=project-editor-title></h2><label for=project-edit-title></label><input id=project-edit-title type=text required maxlength=256 autofocus><div class=dialog-actions><button type=button class=dialog-cancel>Cancel</button><button type=submit></button></div></form></dialog><dialog class=topic-status-dialog aria-labelledby=project-remove-title><form><h2 id=project-remove-title></h2><div class=dialog-actions><button type=button class=dialog-cancel>Cancel</button><button type=submit>`),
  _tmpl$35$1 = /*#__PURE__*/template(`<div class=project-empty><p></p><button type=button>Retry`),
  _tmpl$36$1 = /*#__PURE__*/template(`<button type=button>Edit view`),
  _tmpl$37$1 = /*#__PURE__*/template(`<button type=button>Delete view`),
  _tmpl$38$1 = /*#__PURE__*/template(`<div class=project-view-tab><button type=button><span aria-hidden=true></span> `),
  _tmpl$39$1 = /*#__PURE__*/template(`<option># `),
  _tmpl$40$1 = /*#__PURE__*/template(`<p class=project-empty>Roadmap views can be opened on GitHub.`),
  _tmpl$41$1 = /*#__PURE__*/template(`<tr><td colspan=5 class=project-column-empty>No items`),
  _tmpl$42$1 = /*#__PURE__*/template(`<form class=project-draft-form><input type=text required maxlength=256 aria-label="New project item"placeholder="Start typing to create an item"><div><button type=submit>Add</button><button type=button>Cancel`),
  _tmpl$43$1 = /*#__PURE__*/template(`<p class="project-description is-pending">`),
  _tmpl$44$1 = /*#__PURE__*/template(`<div class=project-table-wrap><table class=project-table><thead><tr><th scope=col>Title</th><th scope=col>Status</th><th scope=col>Repository</th><th scope=col>Type</th><th scope=col><span class=sr-only>Actions</span></th></tr></thead><tbody>`),
  _tmpl$45$1 = /*#__PURE__*/template(`<tr><td></td><td></td><td></td><td></td><td>`),
  _tmpl$46$1 = /*#__PURE__*/template(`<button type=button class=project-add-item>+ Add item`),
  _tmpl$47$1 = /*#__PURE__*/template(`<button type=button>Delete column`),
  _tmpl$48$1 = /*#__PURE__*/template(`<button type=button>Move left`),
  _tmpl$49$1 = /*#__PURE__*/template(`<button type=button>Move right`),
  _tmpl$50$1 = /*#__PURE__*/template(`<button type=button class=project-column-plus title="Add item">+`),
  _tmpl$51$1 = /*#__PURE__*/template(`<p class=project-column-empty>No items`),
  _tmpl$52$1 = /*#__PURE__*/template(`<form class=project-draft-form><input type=text required maxlength=256 placeholder="Start typing to create an item"><div><button type=submit>Add</button><button type=button>Cancel`),
  _tmpl$53$1 = /*#__PURE__*/template(`<section class=project-column><header class=project-column-header><span></span><h3></h3><small></small></header><div class=project-column-cards>`),
  _tmpl$54$1 = /*#__PURE__*/template(`<p class=project-card-body>`),
  _tmpl$55$1 = /*#__PURE__*/template(`<small class=project-card-repository>`),
  _tmpl$56$1 = /*#__PURE__*/template(`<article class=project-card><div class=project-card-meta><span></span><span>`),
  _tmpl$57$1 = /*#__PURE__*/template(`<label for=project-edit-body>Description`),
  _tmpl$58$1 = /*#__PURE__*/template(`<textarea id=project-edit-body rows=4>`);

/* Projects workspace, first pass.
 * TODO: custom visible fields, grouping/sorting configuration, and card ordering.
 * TODO: project creation, fields other than Status, and card ordering.
 * TODO: conversation side panel; currently cards open chat with Back to project.
 * Status is a project field. Moving cards never implicitly closes topics.
 */
function ProjectBoard(props) {
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
  createEffect(() => props.onBusyChange?.(adding() || editorBusy() || removing() || fieldBusy() || Object.values(busy()).some(Boolean)));
  onCleanup(() => props.onBusyChange?.(false));
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
  const activeView = () => views().find(view => view.id === viewId());
  const tableLayout = () => activeView()?.layout === 'TABLE_LAYOUT';
  const supportedLayout = () => !activeView() || ['BOARD_LAYOUT', 'TABLE_LAYOUT'].includes(activeView().layout);
  const visibleItems = () => (board()?.items || []).filter(item => filterIds() === null || filterIds().has(item.id));
  const tableItems = () => boardColumns({
    ...board(),
    items: visibleItems()
  }, search()).flatMap(column => column.items);
  const preview = () => props.projectId === 'preview';
  const columns = () => board() ? boardColumns({
    ...board(),
    items: [...visibleItems(), ...(pendingDraft() ? [pendingDraft()] : [])]
  }, search()) : [];
  const canMove = () => board()?.canUpdate && board()?.statusField && !preview() && !fieldBusy();
  const canChangeColumns = () => canMove() && !fieldUncertain() && !adding() && !Object.values(busy()).some(Boolean);
  const closeMenus = () => workspace?.querySelectorAll('.project-menu[open]').forEach(menu => {
    menu.open = false;
  });
  function outsideDialog(event) {
    const dialog = event.currentTarget;
    const bounds = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
  }
  function trackBackdrop(event) {
    backdropStart = outsideDialog(event) ? event.currentTarget : null;
  }
  function dismissBackdrop(event, busy) {
    const cancel = backdropStart === event.currentTarget && outsideDialog(event);
    backdropStart = null;
    if (cancel && !busy) event.currentTarget.close();
  }
  async function load(force = false) {
    if (preview() || stopped || readPromise || !force && Date.now() < nextRead) return;
    if (viewBusy() || draftColumn() !== undefined || editor() || removal() || workspace?.querySelector('.project-menu[open]')) return;
    const currentVersion = version;
    const currentRevision = revision;
    const id = props.projectId;
    setLoading(true);
    readPromise = Promise.all([props.api.readProject(id), props.api.listProjectViews(id)]);
    try {
      const [incoming, fetchedViews] = await readPromise;
      if (stopped || currentVersion !== version || currentRevision !== revision) return;
      const mergedViews = new Map(fetchedViews.map(view => [view.id, view]));
      for (const [key, desired] of viewChanges) {
        const actual = mergedViews.get(key);
        if (desired === null) {
          mergedViews.delete(key);
          if (!actual) viewChanges.delete(key);
        } else if (actual && ['name', 'layout', 'filter'].every(field => (actual[field] || '') === (desired[field] || ''))) viewChanges.delete(key);else mergedViews.set(key, desired);
      }
      const incomingViews = [...mergedViews.values()];
      const selected = incomingViews.find(view => view.id === viewId()) || incomingViews[0];
      const matching = selected?.filter?.trim() ? new Set(await props.api.projectViewItemIds(id, selected.filter)) : null;
      if (stopped || currentVersion !== version || currentRevision !== revision) return;
      if (draftColumn() !== undefined || editor() || removal() || workspace?.querySelector('.project-menu[open]')) return;
      if (pendingField) {
        if (sameProjectColumns(incoming.statusField, pendingField)) pendingField = null;else incoming.statusField = pendingField;
      }
      setBoard({
        ...incoming,
        items: tracker.reconcile(incoming.items)
      });
      setViews(incomingViews);
      setViewId(selected?.id || null);
      setFilterIds(matching);
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
    setError('');
    setSearch('');
    setBusy({});
    setUncertain({});
    setAddUncertain(false);
    viewChanges.clear();
    setViews([]);
    setFilterIds(null);
    let saved = null;
    try {
      saved = sessionStorage.getItem(`blackboard:project:${id}:view`);
    } catch {/* Storage is optional. */}
    setViewId(saved);
    setBoard(id === 'preview' ? previewBoard(untrack(() => props.topics)) : null);
    // Start after the effect so board reads do not become reactive dependencies.
    queueMicrotask(() => load(true));
  });
  createEffect(() => {
    if (props.projectId === 'preview') setBoard(previewBoard(props.topics));
  });
  onMount(() => {
    const poll = () => {
      if (!document.hidden) load();
    };
    const dismissMenus = event => {
      if (!event.target.closest?.('.project-menu')) closeMenus();
    };
    const escapeMenus = event => {
      if (event.key === 'Escape') closeMenus();
    };
    const timer = setInterval(poll, 10000);
    document.addEventListener('visibilitychange', poll);
    document.addEventListener('pointerdown', dismissMenus);
    document.addEventListener('keydown', escapeMenus);
    document.addEventListener('scroll', closeMenus, true);
    window.addEventListener('resize', closeMenus);
    onCleanup(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
      document.removeEventListener('pointerdown', dismissMenus);
      document.removeEventListener('keydown', escapeMenus);
      document.removeEventListener('scroll', closeMenus, true);
      window.removeEventListener('resize', closeMenus);
    });
  });
  onCleanup(() => {
    stopped = true;
    version++;
  });
  function rememberView(id) {
    try {
      const key = `blackboard:project:${props.projectId}:view`;
      if (id) sessionStorage.setItem(key, id);else sessionStorage.removeItem(key);
    } catch {/* Storage is optional. */}
  }
  async function selectView(view) {
    if (loading() || viewBusy() || Object.values(busy()).some(Boolean) || adding() || fieldBusy()) return;
    closeMenus();
    setDraftColumn(undefined);
    setViewBusy(true);
    setError('');
    const currentVersion = version;
    revision++;
    try {
      const matching = view.filter?.trim() ? new Set(await props.api.projectViewItemIds(props.projectId, view.filter)) : null;
      if (stopped || currentVersion !== version) return;
      setViewId(view.id);
      setFilterIds(matching);
      setSearch('');
      rememberView(view.id);
    } catch (failure) {
      if (!stopped && currentVersion === version) setError(failure.message);
    } finally {
      if (!stopped && currentVersion === version) setViewBusy(false);
    }
  }
  async function move(item, statusId) {
    if (!canMove() || busy()[item.id] || uncertain()[item.id] || item.syncState || item.statusId === statusId) return;
    const id = props.projectId;
    const currentVersion = version;
    setBusy(previous => ({
      ...previous,
      [item.id]: true
    }));
    setError('');
    try {
      await props.api.setProjectItemStatus(id, item.id, board().statusField.id, statusId);
      if (stopped || currentVersion !== version) return;
      revision++;
      const updated = tracker.remember({
        ...item,
        statusId
      });
      setBoard(previous => ({
        ...previous,
        items: previous.items.map(entry => entry.id === item.id ? updated : entry)
      }));
    } catch (failure) {
      if (stopped || currentVersion !== version) return;
      setError(failure.message);
      if (failure.uncertain) setUncertain(previous => ({
        ...previous,
        [item.id]: {
          statusId
        }
      }));
    } finally {
      if (!stopped && currentVersion === version) {
        setBusy(previous => ({
          ...previous,
          [item.id]: false
        }));
        load();
      }
    }
  }
  async function addTopic(channelId) {
    if (!channelId || adding() || addUncertain() || !board()?.canUpdate || preview()) return;
    const currentVersion = version;
    setAdding(true);
    setError('');
    try {
      const item = await props.api.addTopicToProject(props.projectId, channelId);
      if (stopped || currentVersion !== version) return;
      revision++;
      const added = tracker.remember(item, true);
      setBoard(previous => ({
        ...previous,
        items: [...previous.items.filter(entry => entry.id !== item.id), added]
      }));
    } catch (failure) {
      if (stopped || currentVersion !== version) return;
      setError(failure.message);
      if (failure.uncertain) setAddUncertain(channelId);
    } finally {
      if (!stopped && currentVersion === version) {
        setAdding(false);
        load();
      }
    }
  }
  function openDraft(columnId) {
    if (adding() || addUncertain() || fieldBusy()) return;
    closeMenus();
    setDraftColumn(columnId);
    setDraftTitle('');
  }
  async function createDraft(event) {
    event.preventDefault();
    if (!draftTitle().trim() || adding() || addUncertain()) return;
    const title = draftTitle().trim();
    const statusId = draftColumn();
    const currentVersion = version;
    setAdding(true);
    setError('');
    setDraftColumn(undefined);
    setDraftTitle('');
    setPendingDraft({
      id: 'pending-draft',
      type: 'DraftIssue',
      title,
      statusId,
      temporary: true,
      syncState: 'confirming'
    });
    try {
      const item = await props.api.createProjectDraft(props.projectId, {
        title,
        statusId,
        fieldId: board().statusField?.id
      });
      if (stopped || currentVersion !== version) return;
      revision++;
      const added = tracker.remember(item, true);
      setBoard(previous => ({
        ...previous,
        items: [...previous.items, added]
      }));
    } catch (failure) {
      if (stopped || currentVersion !== version) return;
      if (failure.createdItem) {
        revision++;
        const added = tracker.remember(failure.createdItem, true);
        setBoard(previous => ({
          ...previous,
          items: [...previous.items, added]
        }));
      } else if (failure.uncertain) setAddUncertain(true);else {
        setDraftColumn(statusId);
        setDraftTitle(title);
      }
      setError(failure.message);
    } finally {
      if (!stopped && currentVersion === version) {
        setAdding(false);
        setPendingDraft(null);
        load();
      }
    }
  }
  function openEditor(kind, value = null) {
    closeMenus();
    setEditor({
      kind,
      value
    });
    setEditTitle(value?.name || value?.title || '');
    setEditBody(value?.description || value?.body || '');
    setEditColor(value?.color || 'GRAY');
    setEditLayout(kind === 'view' ? value?.layout || 'BOARD_LAYOUT' : 'BOARD_LAYOUT');
    setEditFilter(value?.filter || '');
    setEditorError('');
    setEditorUncertain(false);
    editorDialog.showModal();
  }
  function applyField(field, removedId = null) {
    revision++;
    pendingField = field;
    setBoard(previous => ({
      ...previous,
      statusField: field,
      items: previous.items.map(item => removedId !== null && item.statusId === removedId ? tracker.remember({
        ...item,
        statusId: null
      }) : item)
    }));
  }
  async function saveEditor(event) {
    event.preventDefault();
    const target = editor();
    if (!target || editorBusy() || editorUncertain() || !editTitle().trim()) return;
    setEditorBusy(true);
    setEditorError('');
    if (target.kind === 'column') setFieldBusy(true);
    try {
      if (target.kind === 'view') {
        const changes = {
          name: editTitle(),
          layout: editLayout(),
          filter: editFilter()
        };
        const view = target.value?.id ? await props.api.updateProjectView(target.value.id, changes) : await props.api.createProjectView(props.projectId, changes);
        revision++;
        viewChanges.set(view.id, view);
        setViews(previous => [...previous.filter(entry => entry.id !== view.id), view].sort((a, b) => a.number - b.number));
        setViewId(view.id);
        rememberView(view.id);
        // Hide the old result until the saved filter has been evaluated.
        setFilterIds(view.filter?.trim() ? new Set() : null);
      } else if (target.kind === 'column') {
        applyField(await props.api.changeProjectColumn(props.projectId, {
          id: target.value?.id ?? null,
          name: editTitle(),
          description: editBody(),
          color: editColor()
        }));
      } else {
        let changes;
        if (target.value.type === 'DraftIssue') changes = await props.api.updateProjectDraft(target.value.contentId, {
          title: editTitle(),
          body: editBody()
        });else {
          const updated = await props.api.updateChannelDetails(target.value.channelId, {
            name: editTitle(),
            description: editBody()
          });
          props.onTopicUpdated?.(updated);
          changes = {
            title: updated.name,
            body: updated.description
          };
        }
        revision++;
        const updated = tracker.remember({
          ...target.value,
          ...changes
        }, false, ['title', 'body']);
        setBoard(previous => ({
          ...previous,
          items: previous.items.map(item => item.id === updated.id ? updated : item)
        }));
      }
      editorDialog.close();
      setEditor(null);
    } catch (failure) {
      if (failure.createdView) {
        const view = failure.createdView;
        revision++;
        viewChanges.set(view.id, view);
        setViews(previous => [...previous.filter(entry => entry.id !== view.id), view]);
        setEditor({
          kind: 'view',
          value: view
        });
      }
      setEditorError(failure.message);
      setEditorUncertain(Boolean(failure.uncertain));
    } finally {
      setEditorBusy(false);
      setFieldBusy(false);
      load();
    }
  }
  async function shiftColumn(column, direction) {
    if (!canChangeColumns()) return;
    closeMenus();
    setFieldBusy(true);
    setError('');
    try {
      applyField(await props.api.changeProjectColumn(props.projectId, {
        id: column.id,
        direction
      }));
    } catch (failure) {
      setError(failure.message);
      setFieldUncertain(Boolean(failure.uncertain));
    } finally {
      setFieldBusy(false);
      load();
    }
  }
  function requestRemoval(kind, value) {
    closeMenus();
    setRemoval({
      kind,
      value
    });
    setRemoveError('');
    setRemoveUncertain(false);
    removeDialog.showModal();
  }
  async function confirmRemoval(event) {
    event.preventDefault();
    const target = removal();
    if (!target || removing() || removeUncertain()) return;
    setRemoving(true);
    setRemoveError('');
    try {
      if (target.kind === 'view') {
        await props.api.deleteProjectView(target.value.id);
        revision++;
        viewChanges.set(target.value.id, null);
        setViews(previous => previous.filter(view => view.id !== target.value.id));
        if (viewId() === target.value.id) {
          setViewId(null);
          setFilterIds(null);
          rememberView(null);
        }
      } else if (target.kind === 'column') {
        setFieldBusy(true);
        applyField(await props.api.changeProjectColumn(props.projectId, {
          id: target.value.id,
          remove: true
        }), target.value.id);
      } else {
        setBusy(previous => ({
          ...previous,
          [target.value.id]: true
        }));
        await props.api.removeProjectItem(props.projectId, target.value.id);
        revision++;
        tracker.remove(target.value.id);
        setBoard(previous => ({
          ...previous,
          items: previous.items.filter(item => item.id !== target.value.id)
        }));
      }
      removeDialog.close();
      setRemoval(null);
    } catch (failure) {
      setRemoveError(failure.message);
      setRemoveUncertain(Boolean(failure.uncertain));
    } finally {
      setRemoving(false);
      setFieldBusy(false);
      if (target.kind === 'item') setBusy(previous => ({
        ...previous,
        [target.value.id]: false
      }));
      load();
    }
  }
  function Menu(menuProps) {
    return (() => {
      var _el$ = _tmpl$$4(),
        _el$2 = _el$.firstChild,
        _el$3 = _el$2.nextSibling;
      _el$.addEventListener("toggle", event => {
        const current = event.currentTarget;
        if (current.open) {
          workspace.querySelectorAll('.project-menu[open]').forEach(menu => {
            if (menu !== current) menu.open = false;
          });
          const anchor = current.querySelector('summary').getBoundingClientRect();
          const options = current.querySelector('.project-menu-options');
          options.style.left = `${Math.max(8, Math.min(anchor.right - options.offsetWidth, window.innerWidth - options.offsetWidth - 8))}px`;
          options.style.top = `${Math.max(8, Math.min(anchor.bottom + 4, window.innerHeight - options.offsetHeight - 8))}px`;
        }
      });
      insert(_el$2, createComponent(Show, {
        get when() {
          return menuProps.label === 'New view';
        },
        get fallback() {
          return _tmpl$2$4();
        },
        children: "+ New view"
      }));
      insert(_el$3, () => menuProps.children);
      createRenderEffect(_p$ => {
        var _v$ = menuProps.label,
          _v$2 = menuProps.label;
        _v$ !== _p$.e && setAttribute(_el$2, "aria-label", _p$.e = _v$);
        _v$2 !== _p$.t && setAttribute(_el$2, "title", _p$.t = _v$2);
        return _p$;
      }, {
        e: undefined,
        t: undefined
      });
      return _el$;
    })();
  }
  function ItemTitle(itemProps) {
    const item = () => itemProps.item;
    return createComponent(Show, {
      get when() {
        return memo(() => !!item().channelId)() && props.topics.some(topic => topic.id === item().channelId);
      },
      get fallback() {
        return memo(() => !!item().url)() ? (() => {
          var _el$6 = _tmpl$4$4(),
            _el$7 = _el$6.firstChild;
          insert(_el$6, () => item().title, _el$7);
          createRenderEffect(() => setAttribute(_el$6, "href", item().url));
          return _el$6;
        })() : memo(() => !!(item().type === 'DraftIssue' && !item().temporary && board().canUpdate))() ? (() => {
          var _el$8 = _tmpl$3$4();
          _el$8.$$click = () => openEditor('item', item());
          insert(_el$8, () => item().title);
          return _el$8;
        })() : (() => {
          var _el$9 = _tmpl$5$4();
          insert(_el$9, () => item().title);
          return _el$9;
        })();
      },
      get children() {
        var _el$5 = _tmpl$3$4();
        _el$5.$$click = () => props.onOpenTopic(item().channelId);
        insert(_el$5, () => item().title);
        return _el$5;
      }
    });
  }
  function ItemStatus(itemProps) {
    return createComponent(Show, {
      get when() {
        return canMove();
      },
      get fallback() {
        return board().statusField?.options.find(option => option.id === itemProps.item.statusId)?.name || 'No status';
      },
      get children() {
        var _el$0 = _tmpl$6$4();
          _el$0.firstChild;
        _el$0.addEventListener("change", event => {
          const target = event.currentTarget.value || null;
          event.currentTarget.value = itemProps.item.statusId || '';
          move(itemProps.item, target);
        });
        insert(_el$0, createComponent(For, {
          get each() {
            return board().statusField.options;
          },
          children: option => (() => {
            var _el$10 = _tmpl$7$4();
            insert(_el$10, () => option.name);
            createRenderEffect(() => _el$10.value = option.id);
            return _el$10;
          })()
        }), null);
        createRenderEffect(_p$ => {
          var _v$3 = `Status for ${itemProps.item.title}`,
            _v$4 = busy()[itemProps.item.id] || Boolean(uncertain()[itemProps.item.id]) || Boolean(itemProps.item.syncState);
          _v$3 !== _p$.e && setAttribute(_el$0, "aria-label", _p$.e = _v$3);
          _v$4 !== _p$.t && (_el$0.disabled = _p$.t = _v$4);
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        createRenderEffect(() => _el$0.value = itemProps.item.statusId || '');
        return _el$0;
      }
    });
  }
  function ItemMenu(itemProps) {
    return createComponent(Show, {
      get when() {
        return memo(() => !!board().canUpdate)() && !preview();
      },
      get children() {
        return createComponent(Menu, {
          get label() {
            return `Actions for ${itemProps.item.title}`;
          },
          get children() {
            return [createComponent(Show, {
              get when() {
                return itemProps.item.type === 'DraftIssue' || itemProps.item.channelId;
              },
              get fallback() {
                return memo(() => !!itemProps.item.url)() ? (() => {
                  var _el$13 = _tmpl$0$3();
                  createRenderEffect(() => setAttribute(_el$13, "href", itemProps.item.url));
                  return _el$13;
                })() : null;
              },
              get children() {
                var _el$11 = _tmpl$8$4();
                _el$11.$$click = () => openEditor('item', itemProps.item);
                createRenderEffect(() => _el$11.disabled = busy()[itemProps.item.id] || Boolean(itemProps.item.syncState) || fieldBusy());
                return _el$11;
              }
            }), (() => {
              var _el$12 = _tmpl$9$3();
              _el$12.$$click = () => requestRemoval('item', itemProps.item);
              insert(_el$12, () => itemProps.item.type === 'DraftIssue' ? 'Delete' : 'Remove from project');
              createRenderEffect(() => _el$12.disabled = busy()[itemProps.item.id] || Boolean(itemProps.item.syncState) || fieldBusy());
              return _el$12;
            })()];
          }
        });
      }
    });
  }
  return (() => {
    var _el$14 = _tmpl$34$1(),
      _el$15 = _el$14.firstChild,
      _el$16 = _el$15.firstChild,
      _el$17 = _el$16.nextSibling,
      _el$18 = _el$17.nextSibling,
      _el$40 = _el$15.nextSibling,
      _el$41 = _el$40.firstChild,
      _el$42 = _el$41.firstChild,
      _el$43 = _el$42.nextSibling,
      _el$44 = _el$43.nextSibling,
      _el$53 = _el$44.nextSibling,
      _el$54 = _el$53.firstChild,
      _el$55 = _el$54.nextSibling,
      _el$56 = _el$40.nextSibling,
      _el$57 = _el$56.firstChild,
      _el$58 = _el$57.firstChild,
      _el$63 = _el$58.nextSibling,
      _el$64 = _el$63.firstChild,
      _el$65 = _el$64.nextSibling;
    var _ref$ = workspace;
    typeof _ref$ === "function" ? use(_ref$, _el$14) : workspace = _el$14;
    insert(_el$16, () => board()?.name || props.projectName || 'Project');
    insert(_el$17, (() => {
      var _c$ = memo(() => !!preview());
      return () => _c$() ? 'Preview' : board()?.closed ? 'Closed project' : 'Project workspace';
    })());
    insert(_el$18, createComponent(Show, {
      get when() {
        return board()?.url;
      },
      get children() {
        var _el$19 = _tmpl$1$3();
        createRenderEffect(() => setAttribute(_el$19, "href", board().url));
        return _el$19;
      }
    }));
    insert(_el$14, createComponent(Show, {
      get when() {
        return error();
      },
      get children() {
        var _el$20 = _tmpl$10$2(),
          _el$21 = _el$20.firstChild,
          _el$22 = _el$21.nextSibling;
        insert(_el$20, error, _el$21);
        _el$22.$$click = () => setError('');
        return _el$20;
      }
    }), _el$40);
    insert(_el$14, createComponent(Show, {
      get when() {
        return board();
      },
      get fallback() {
        return (() => {
          var _el$66 = _tmpl$35$1(),
            _el$67 = _el$66.firstChild,
            _el$68 = _el$67.nextSibling;
          insert(_el$67, () => loading() ? 'Loading board…' : 'The board could not be loaded.');
          _el$68.$$click = () => load(true);
          createRenderEffect(() => _el$68.disabled = loading());
          return _el$66;
        })();
      },
      get children() {
        return [(() => {
          var _el$23 = _tmpl$13$1();
          insert(_el$23, createComponent(For, {
            get each() {
              return views();
            },
            children: view => (() => {
              var _el$69 = _tmpl$38$1(),
                _el$70 = _el$69.firstChild,
                _el$71 = _el$70.firstChild;
                _el$71.nextSibling;
              _el$70.$$click = () => selectView(view);
              insert(_el$71, (() => {
                var _c$5 = memo(() => view.layout === 'TABLE_LAYOUT');
                return () => _c$5() ? '▤' : view.layout === 'BOARD_LAYOUT' ? '▥' : '◇';
              })());
              insert(_el$70, () => view.name, null);
              insert(_el$69, createComponent(Show, {
                get when() {
                  return memo(() => !!board().canUpdate)() && !preview();
                },
                get children() {
                  return createComponent(Menu, {
                    get label() {
                      return `View actions for ${view.name}`;
                    },
                    get children() {
                      return [(() => {
                        var _el$73 = _tmpl$36$1();
                        _el$73.$$click = () => openEditor('view', view);
                        return _el$73;
                      })(), (() => {
                        var _el$74 = _tmpl$37$1();
                        _el$74.$$click = () => requestRemoval('view', view);
                        createRenderEffect(() => _el$74.disabled = views().length <= 1);
                        return _el$74;
                      })()];
                    }
                  });
                }
              }), null);
              createRenderEffect(_p$ => {
                var _v$10 = !!(viewId() === view.id),
                  _v$11 = viewId() === view.id ? 'page' : undefined,
                  _v$12 = loading() || viewBusy() || adding() || fieldBusy() || Object.values(busy()).some(Boolean);
                _v$10 !== _p$.e && _el$69.classList.toggle("is-active", _p$.e = _v$10);
                _v$11 !== _p$.t && setAttribute(_el$70, "aria-current", _p$.t = _v$11);
                _v$12 !== _p$.a && (_el$70.disabled = _p$.a = _v$12);
                return _p$;
              }, {
                e: undefined,
                t: undefined,
                a: undefined
              });
              return _el$69;
            })()
          }), null);
          insert(_el$23, createComponent(Show, {
            get when() {
              return memo(() => !!board().canUpdate)() && !preview();
            },
            get children() {
              return createComponent(Menu, {
                label: "New view",
                get children() {
                  return [(() => {
                    var _el$24 = _tmpl$11$2();
                    _el$24.$$click = () => openEditor('view', {
                      layout: 'TABLE_LAYOUT'
                    });
                    return _el$24;
                  })(), (() => {
                    var _el$25 = _tmpl$12$2();
                    _el$25.$$click = () => openEditor('view', {
                      layout: 'BOARD_LAYOUT'
                    });
                    return _el$25;
                  })()];
                }
              });
            }
          }), null);
          createRenderEffect(() => setAttribute(_el$23, "aria-busy", viewBusy()));
          return _el$23;
        })(), (() => {
          var _el$26 = _tmpl$17$1(),
            _el$28 = _el$26.firstChild,
            _el$32 = _el$28.nextSibling;
          insert(_el$26, createComponent(Show, {
            get when() {
              return !views().length;
            },
            get children() {
              return _tmpl$14$1();
            }
          }), _el$28);
          _el$28.$$input = event => setSearch(event.currentTarget.value);
          insert(_el$26, createComponent(Show, {
            get when() {
              return memo(() => !!!preview())() && board().canUpdate;
            },
            get children() {
              var _el$29 = _tmpl$15$1(),
                _el$30 = _el$29.firstChild;
              _el$29.addEventListener("change", event => {
                const id = Number(event.currentTarget.value);
                event.currentTarget.value = '';
                addTopic(id);
              });
              insert(_el$30, () => adding() ? 'Adding…' : 'Add topic…');
              insert(_el$29, createComponent(For, {
                get each() {
                  return props.topics.filter(topic => !board().items.some(item => item.channelId === topic.id));
                },
                children: topic => (() => {
                  var _el$75 = _tmpl$39$1();
                    _el$75.firstChild;
                  insert(_el$75, () => topic.name, null);
                  createRenderEffect(() => _el$75.value = topic.id);
                  return _el$75;
                })()
              }), null);
              createRenderEffect(() => _el$29.disabled = adding() || Boolean(addUncertain()));
              return _el$29;
            }
          }), _el$32);
          insert(_el$26, createComponent(Show, {
            get when() {
              return memo(() => !!canMove())() && !tableLayout();
            },
            get children() {
              var _el$31 = _tmpl$16$1();
              _el$31.$$click = () => openEditor('column');
              createRenderEffect(() => _el$31.disabled = !canChangeColumns());
              return _el$31;
            }
          }), _el$32);
          _el$32.$$click = () => load(true);
          createRenderEffect(() => _el$32.disabled = loading() || preview());
          createRenderEffect(() => _el$28.value = search());
          return _el$26;
        })(), createComponent(Show, {
          get when() {
            return activeView()?.filter;
          },
          get children() {
            var _el$33 = _tmpl$18$1(),
              _el$34 = _el$33.firstChild,
              _el$35 = _el$34.nextSibling;
            insert(_el$35, () => activeView().filter);
            return _el$33;
          }
        }), createComponent(Show, {
          get when() {
            return board().description;
          },
          get children() {
            var _el$36 = _tmpl$19$1();
            insert(_el$36, () => board().description);
            return _el$36;
          }
        }), createComponent(Show, {
          get when() {
            return memo(() => !!!preview())() && !board().canUpdate;
          },
          get children() {
            return _tmpl$20$1();
          }
        }), createComponent(Show, {
          get when() {
            return memo(() => !!!preview())() && !board().statusField;
          },
          get children() {
            return _tmpl$21$1();
          }
        }), createComponent(Show, {
          get when() {
            return supportedLayout();
          },
          get fallback() {
            return _tmpl$40$1();
          },
          get children() {
            return createComponent(Show, {
              get when() {
                return !tableLayout();
              },
              get fallback() {
                return (() => {
                  var _el$78 = _tmpl$44$1(),
                    _el$79 = _el$78.firstChild,
                    _el$80 = _el$79.firstChild,
                    _el$81 = _el$80.nextSibling;
                  insert(_el$81, createComponent(For, {
                    get each() {
                      return tableItems();
                    },
                    children: item => (() => {
                      var _el$89 = _tmpl$45$1(),
                        _el$90 = _el$89.firstChild,
                        _el$91 = _el$90.nextSibling,
                        _el$92 = _el$91.nextSibling,
                        _el$93 = _el$92.nextSibling,
                        _el$94 = _el$93.nextSibling;
                      insert(_el$90, createComponent(ItemTitle, {
                        item: item
                      }));
                      insert(_el$91, createComponent(ItemStatus, {
                        item: item
                      }));
                      insert(_el$92, () => item.repository || '—');
                      insert(_el$93, (() => {
                        var _c$6 = memo(() => item.type === 'DraftIssue');
                        return () => _c$6() ? 'Draft' : memo(() => item.type === 'PullRequest')() ? 'Pull request' : item.type;
                      })());
                      insert(_el$94, createComponent(ItemMenu, {
                        item: item
                      }));
                      createRenderEffect(() => _el$89.classList.toggle("is-pending", !!(busy()[item.id] || Boolean(uncertain()[item.id]) || Boolean(item.syncState))));
                      return _el$89;
                    })()
                  }), null);
                  insert(_el$81, createComponent(Show, {
                    get when() {
                      return !tableItems().length;
                    },
                    get children() {
                      return _tmpl$41$1();
                    }
                  }), null);
                  insert(_el$78, createComponent(Show, {
                    get when() {
                      return memo(() => !!board().canUpdate)() && !preview();
                    },
                    get children() {
                      return [createComponent(Show, {
                        get when() {
                          return draftColumn() !== undefined;
                        },
                        get fallback() {
                          return (() => {
                            var _el$95 = _tmpl$46$1();
                            _el$95.$$click = () => openDraft(null);
                            createRenderEffect(() => _el$95.disabled = adding() || Boolean(addUncertain()));
                            return _el$95;
                          })();
                        },
                        get children() {
                          var _el$83 = _tmpl$42$1(),
                            _el$84 = _el$83.firstChild,
                            _el$85 = _el$84.nextSibling,
                            _el$86 = _el$85.firstChild,
                            _el$87 = _el$86.nextSibling;
                          _el$83.addEventListener("submit", createDraft);
                          _el$84.$$keydown = event => {
                            if (event.key === 'Escape') setDraftColumn(undefined);
                          };
                          _el$84.$$input = event => setDraftTitle(event.currentTarget.value);
                          use(element => requestAnimationFrame(() => element.focus()), _el$84);
                          _el$87.$$click = () => {
                            setDraftColumn(undefined);
                            load();
                          };
                          createRenderEffect(() => _el$86.disabled = !draftTitle().trim());
                          createRenderEffect(() => _el$84.value = draftTitle());
                          return _el$83;
                        }
                      }), createComponent(Show, {
                        get when() {
                          return pendingDraft();
                        },
                        get children() {
                          var _el$88 = _tmpl$43$1();
                          insert(_el$88, () => pendingDraft().title);
                          return _el$88;
                        }
                      })];
                    }
                  }), null);
                  createRenderEffect(() => setAttribute(_el$78, "aria-busy", loading() || viewBusy()));
                  return _el$78;
                })();
              },
              get children() {
                var _el$39 = _tmpl$22$1();
                insert(_el$39, createComponent(For, {
                  get each() {
                    return columns();
                  },
                  children: column => (() => {
                    var _el$96 = _tmpl$53$1(),
                      _el$97 = _el$96.firstChild,
                      _el$98 = _el$97.firstChild,
                      _el$99 = _el$98.nextSibling,
                      _el$100 = _el$99.nextSibling,
                      _el$106 = _el$97.nextSibling;
                    _el$96.addEventListener("drop", event => {
                      event.preventDefault();
                      const item = board().items.find(entry => entry.id === dragging);
                      dragging = null;
                      if (item) move(item, column.id);
                    });
                    _el$96.addEventListener("dragover", event => {
                      if (dragging && canMove()) {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = 'move';
                      }
                    });
                    insert(_el$99, () => column.name);
                    insert(_el$100, () => column.items.length);
                    insert(_el$97, createComponent(Show, {
                      get when() {
                        return memo(() => !!board().canUpdate)() && !preview();
                      },
                      get children() {
                        return [createComponent(Show, {
                          get when() {
                            return column.id !== null;
                          },
                          get children() {
                            return createComponent(Menu, {
                              get label() {
                                return `Column actions for ${column.name}`;
                              },
                              get children() {
                                return [(() => {
                                  var _el$101 = _tmpl$8$4();
                                  _el$101.$$click = () => openEditor('column', column);
                                  createRenderEffect(() => _el$101.disabled = !canChangeColumns());
                                  return _el$101;
                                })(), (() => {
                                  var _el$102 = _tmpl$47$1();
                                  _el$102.$$click = () => requestRemoval('column', column);
                                  createRenderEffect(() => _el$102.disabled = !canChangeColumns() || board().statusField.options.length <= 1);
                                  return _el$102;
                                })(), (() => {
                                  var _el$103 = _tmpl$48$1();
                                  _el$103.$$click = () => shiftColumn(column, -1);
                                  createRenderEffect(() => _el$103.disabled = !canChangeColumns() || board().statusField.options.findIndex(option => option.id === column.id) === 0);
                                  return _el$103;
                                })(), (() => {
                                  var _el$104 = _tmpl$49$1();
                                  _el$104.$$click = () => shiftColumn(column, 1);
                                  createRenderEffect(() => _el$104.disabled = !canChangeColumns() || board().statusField.options.at(-1)?.id === column.id);
                                  return _el$104;
                                })()];
                              }
                            });
                          }
                        }), (() => {
                          var _el$105 = _tmpl$50$1();
                          _el$105.$$click = () => openDraft(column.id);
                          createRenderEffect(_p$ => {
                            var _v$13 = `Add item to ${column.name}`,
                              _v$14 = adding() || Boolean(addUncertain()) || fieldBusy();
                            _v$13 !== _p$.e && setAttribute(_el$105, "aria-label", _p$.e = _v$13);
                            _v$14 !== _p$.t && (_el$105.disabled = _p$.t = _v$14);
                            return _p$;
                          }, {
                            e: undefined,
                            t: undefined
                          });
                          return _el$105;
                        })()];
                      }
                    }), null);
                    insert(_el$106, createComponent(For, {
                      get each() {
                        return column.items;
                      },
                      children: item => (() => {
                        var _el$113 = _tmpl$56$1(),
                          _el$114 = _el$113.firstChild,
                          _el$115 = _el$114.firstChild,
                          _el$116 = _el$115.nextSibling;
                        _el$113.addEventListener("dragend", () => {
                          dragging = null;
                        });
                        _el$113.addEventListener("dragstart", event => {
                          dragging = item.id;
                          event.dataTransfer.setData('text/plain', item.id);
                          event.dataTransfer.effectAllowed = 'move';
                        });
                        insert(_el$115, (() => {
                          var _c$7 = memo(() => item.type === 'DraftIssue');
                          return () => _c$7() ? 'Draft' : memo(() => !!item.number)() ? `#${item.number}` : item.type;
                        })());
                        insert(_el$116, () => item.state === 'CLOSED' || item.state === 'MERGED' ? 'Closed' : '');
                        insert(_el$114, createComponent(Show, {
                          get when() {
                            return memo(() => !!(board().canUpdate && !preview()))() && !item.temporary;
                          },
                          get children() {
                            return createComponent(Menu, {
                              get label() {
                                return `Actions for ${item.title}`;
                              },
                              get children() {
                                return [createComponent(Show, {
                                  get when() {
                                    return item.type === 'DraftIssue' || item.channelId;
                                  },
                                  get fallback() {
                                    return memo(() => !!item.url)() ? (() => {
                                      var _el$124 = _tmpl$0$3();
                                      createRenderEffect(() => setAttribute(_el$124, "href", item.url));
                                      return _el$124;
                                    })() : null;
                                  },
                                  get children() {
                                    var _el$117 = _tmpl$8$4();
                                    _el$117.$$click = () => openEditor('item', item);
                                    createRenderEffect(() => _el$117.disabled = busy()[item.id] || Boolean(item.syncState) || fieldBusy());
                                    return _el$117;
                                  }
                                }), (() => {
                                  var _el$118 = _tmpl$9$3();
                                  _el$118.$$click = () => requestRemoval('item', item);
                                  insert(_el$118, () => item.type === 'DraftIssue' ? 'Delete' : 'Remove from project');
                                  createRenderEffect(() => _el$118.disabled = busy()[item.id] || Boolean(item.syncState) || fieldBusy());
                                  return _el$118;
                                })()];
                              }
                            });
                          }
                        }), null);
                        insert(_el$113, createComponent(Show, {
                          get when() {
                            return memo(() => !!item.channelId)() && props.topics.some(topic => topic.id === item.channelId);
                          },
                          get fallback() {
                            return memo(() => !!item.url)() ? (() => {
                              var _el$125 = _tmpl$4$4(),
                                _el$126 = _el$125.firstChild;
                              insert(_el$125, () => item.title, _el$126);
                              createRenderEffect(() => setAttribute(_el$125, "href", item.url));
                              return _el$125;
                            })() : memo(() => !!(item.type === 'DraftIssue' && !item.temporary && board().canUpdate))() ? (() => {
                              var _el$127 = _tmpl$3$4();
                              _el$127.$$click = () => openEditor('item', item);
                              insert(_el$127, () => item.title);
                              return _el$127;
                            })() : (() => {
                              var _el$128 = _tmpl$5$4();
                              insert(_el$128, () => item.title);
                              return _el$128;
                            })();
                          },
                          get children() {
                            var _el$119 = _tmpl$3$4();
                            _el$119.$$click = () => props.onOpenTopic(item.channelId);
                            insert(_el$119, () => item.title);
                            return _el$119;
                          }
                        }), null);
                        insert(_el$113, createComponent(Show, {
                          get when() {
                            return memo(() => item.type === 'DraftIssue')() && item.body;
                          },
                          get children() {
                            var _el$120 = _tmpl$54$1();
                            insert(_el$120, () => item.body);
                            return _el$120;
                          }
                        }), null);
                        insert(_el$113, createComponent(Show, {
                          get when() {
                            return item.repository;
                          },
                          get children() {
                            var _el$121 = _tmpl$55$1();
                            insert(_el$121, () => item.repository);
                            return _el$121;
                          }
                        }), null);
                        insert(_el$113, createComponent(Show, {
                          get when() {
                            return memo(() => !!canMove())() && !item.temporary;
                          },
                          get children() {
                            var _el$122 = _tmpl$6$4();
                              _el$122.firstChild;
                            _el$122.addEventListener("change", event => {
                              const target = event.currentTarget.value || null;
                              event.currentTarget.value = item.statusId || '';
                              move(item, target);
                            });
                            insert(_el$122, createComponent(For, {
                              get each() {
                                return board().statusField.options;
                              },
                              children: option => (() => {
                                var _el$129 = _tmpl$7$4();
                                insert(_el$129, () => option.name);
                                createRenderEffect(() => _el$129.value = option.id);
                                return _el$129;
                              })()
                            }), null);
                            createRenderEffect(_p$ => {
                              var _v$21 = `Status for ${item.title}`,
                                _v$22 = busy()[item.id] || Boolean(uncertain()[item.id]) || Boolean(item.syncState);
                              _v$21 !== _p$.e && setAttribute(_el$122, "aria-label", _p$.e = _v$21);
                              _v$22 !== _p$.t && (_el$122.disabled = _p$.t = _v$22);
                              return _p$;
                            }, {
                              e: undefined,
                              t: undefined
                            });
                            createRenderEffect(() => _el$122.value = item.statusId || '');
                            return _el$122;
                          }
                        }), null);
                        createRenderEffect(_p$ => {
                          var _v$23 = !!(busy()[item.id] || Boolean(uncertain()[item.id]) || item.syncState === 'confirming'),
                            _v$24 = Boolean(canMove() && !busy()[item.id] && !uncertain()[item.id] && !item.syncState && !item.temporary);
                          _v$23 !== _p$.e && _el$113.classList.toggle("is-pending", _p$.e = _v$23);
                          _v$24 !== _p$.t && setAttribute(_el$113, "draggable", _p$.t = _v$24);
                          return _p$;
                        }, {
                          e: undefined,
                          t: undefined
                        });
                        return _el$113;
                      })()
                    }), null);
                    insert(_el$106, createComponent(Show, {
                      get when() {
                        return !column.items.length;
                      },
                      get children() {
                        return _tmpl$51$1();
                      }
                    }), null);
                    insert(_el$96, createComponent(Show, {
                      get when() {
                        return memo(() => !!board().canUpdate)() && !preview();
                      },
                      get children() {
                        return createComponent(Show, {
                          get when() {
                            return draftColumn() === column.id;
                          },
                          get fallback() {
                            return (() => {
                              var _el$130 = _tmpl$46$1();
                              _el$130.$$click = () => openDraft(column.id);
                              createRenderEffect(() => _el$130.disabled = adding() || Boolean(addUncertain()) || fieldBusy());
                              return _el$130;
                            })();
                          },
                          get children() {
                            var _el$108 = _tmpl$52$1(),
                              _el$109 = _el$108.firstChild,
                              _el$110 = _el$109.nextSibling,
                              _el$111 = _el$110.firstChild,
                              _el$112 = _el$111.nextSibling;
                            _el$108.$$keydown = event => {
                              if (event.key === 'Escape') {
                                event.preventDefault();
                                setDraftColumn(undefined);
                                load();
                              }
                            };
                            _el$108.addEventListener("submit", createDraft);
                            _el$109.$$input = event => setDraftTitle(event.currentTarget.value);
                            use(element => requestAnimationFrame(() => element.focus()), _el$109);
                            _el$112.$$click = () => {
                              setDraftColumn(undefined);
                              load();
                            };
                            createRenderEffect(_p$ => {
                              var _v$15 = `New item in ${column.name}`,
                                _v$16 = !draftTitle().trim();
                              _v$15 !== _p$.e && setAttribute(_el$109, "aria-label", _p$.e = _v$15);
                              _v$16 !== _p$.t && (_el$111.disabled = _p$.t = _v$16);
                              return _p$;
                            }, {
                              e: undefined,
                              t: undefined
                            });
                            createRenderEffect(() => _el$109.value = draftTitle());
                            return _el$108;
                          }
                        });
                      }
                    }), null);
                    createRenderEffect(_p$ => {
                      var _v$17 = !!fieldBusy(),
                        _v$18 = column.name,
                        _v$19 = `project-column-dot color-${column.color?.toLowerCase() || 'gray'}`,
                        _v$20 = column.description;
                      _v$17 !== _p$.e && _el$96.classList.toggle("is-pending", _p$.e = _v$17);
                      _v$18 !== _p$.t && setAttribute(_el$96, "aria-label", _p$.t = _v$18);
                      _v$19 !== _p$.a && className(_el$98, _p$.a = _v$19);
                      _v$20 !== _p$.o && setAttribute(_el$99, "title", _p$.o = _v$20);
                      return _p$;
                    }, {
                      e: undefined,
                      t: undefined,
                      a: undefined,
                      o: undefined
                    });
                    return _el$96;
                  })()
                }));
                createRenderEffect(() => setAttribute(_el$39, "aria-busy", loading() || viewBusy()));
                return _el$39;
              }
            });
          }
        })];
      }
    }), _el$40);
    _el$40.addEventListener("close", () => {
      setEditor(null);
      load();
    });
    _el$40.addEventListener("cancel", event => {
      if (editorBusy()) event.preventDefault();
    });
    _el$40.$$click = event => dismissBackdrop(event, editorBusy());
    _el$40.$$pointerdown = trackBackdrop;
    var _ref$2 = editorDialog;
    typeof _ref$2 === "function" ? use(_ref$2, _el$40) : editorDialog = _el$40;
    _el$41.addEventListener("submit", saveEditor);
    insert(_el$42, (() => {
      var _c$2 = memo(() => editor()?.kind === 'view');
      return () => _c$2() ? editor()?.value?.id ? 'Edit view' : 'New view' : editor()?.kind === 'column' && !editor()?.value ? 'New column' : 'Edit details';
    })());
    insert(_el$43, () => editor()?.kind === 'item' ? 'Title' : 'Name');
    _el$44.$$input = event => setEditTitle(event.currentTarget.value);
    insert(_el$41, createComponent(Show, {
      get when() {
        return editor()?.kind === 'view';
      },
      get fallback() {
        return [_tmpl$57$1(), (() => {
          var _el$132 = _tmpl$58$1();
          _el$132.$$input = event => setEditBody(event.currentTarget.value);
          createRenderEffect(() => _el$132.disabled = editorBusy() || editorUncertain());
          createRenderEffect(() => _el$132.value = editBody());
          return _el$132;
        })()];
      },
      get children() {
        return [_tmpl$23$1(), (() => {
          var _el$46 = _tmpl$24$1();
          _el$46.addEventListener("change", event => setEditLayout(event.currentTarget.value));
          createRenderEffect(() => _el$46.disabled = editorBusy() || editorUncertain());
          createRenderEffect(() => _el$46.value = editLayout());
          return _el$46;
        })(), _tmpl$25$1(), (() => {
          var _el$48 = _tmpl$26$1();
          _el$48.$$input = event => setEditFilter(event.currentTarget.value);
          createRenderEffect(() => _el$48.disabled = editorBusy() || editorUncertain());
          createRenderEffect(() => _el$48.value = editFilter());
          return _el$48;
        })(), _tmpl$27$1()];
      }
    }), _el$53);
    insert(_el$41, createComponent(Show, {
      get when() {
        return editor()?.kind === 'column';
      },
      get children() {
        return [_tmpl$28$1(), (() => {
          var _el$51 = _tmpl$29$1();
          _el$51.addEventListener("change", event => setEditColor(event.currentTarget.value));
          insert(_el$51, createComponent(For, {
            each: ['GRAY', 'BLUE', 'GREEN', 'YELLOW', 'ORANGE', 'RED', 'PINK', 'PURPLE'],
            children: color => (() => {
              var _el$133 = _tmpl$7$4();
              _el$133.value = color;
              insert(_el$133, () => color[0] + color.slice(1).toLowerCase());
              return _el$133;
            })()
          }));
          createRenderEffect(() => _el$51.disabled = editorBusy() || editorUncertain());
          createRenderEffect(() => _el$51.value = editColor());
          return _el$51;
        })()];
      }
    }), _el$53);
    insert(_el$41, createComponent(Show, {
      get when() {
        return editorError();
      },
      get children() {
        var _el$52 = _tmpl$30$1();
        insert(_el$52, editorError);
        return _el$52;
      }
    }), _el$53);
    _el$54.$$click = () => editorDialog.close();
    insert(_el$55, () => editorBusy() ? 'Saving…' : 'Save');
    _el$56.addEventListener("close", () => {
      setRemoval(null);
      load();
    });
    _el$56.addEventListener("cancel", event => {
      if (removing()) event.preventDefault();
    });
    _el$56.$$click = event => dismissBackdrop(event, removing());
    _el$56.$$pointerdown = trackBackdrop;
    var _ref$3 = removeDialog;
    typeof _ref$3 === "function" ? use(_ref$3, _el$56) : removeDialog = _el$56;
    _el$57.addEventListener("submit", confirmRemoval);
    insert(_el$58, (() => {
      var _c$3 = memo(() => removal()?.kind === 'view');
      return () => _c$3() ? `Delete view ${removal().value.name}?` : memo(() => removal()?.kind === 'column')() ? `Delete column ${removal().value.name}?` : removal()?.value.type === 'DraftIssue' ? 'Delete draft?' : 'Remove card?';
    })());
    insert(_el$57, createComponent(Show, {
      get when() {
        return removal()?.kind === 'view';
      },
      get children() {
        return _tmpl$31$1();
      }
    }), _el$63);
    insert(_el$57, createComponent(Show, {
      get when() {
        return removal()?.kind === 'column';
      },
      get children() {
        return _tmpl$32$1();
      }
    }), _el$63);
    insert(_el$57, createComponent(Show, {
      get when() {
        return memo(() => removal()?.kind === 'item')() && removal()?.value.type !== 'DraftIssue';
      },
      get children() {
        return _tmpl$33$1();
      }
    }), _el$63);
    insert(_el$57, createComponent(Show, {
      get when() {
        return removeError();
      },
      get children() {
        var _el$62 = _tmpl$30$1();
        insert(_el$62, removeError);
        return _el$62;
      }
    }), _el$63);
    _el$64.$$click = () => removeDialog.close();
    insert(_el$65, (() => {
      var _c$4 = memo(() => !!removing());
      return () => _c$4() ? 'Removing…' : removal()?.kind === 'view' || removal()?.kind === 'column' || removal()?.value.type === 'DraftIssue' ? 'Delete' : 'Remove';
    })());
    createRenderEffect(_p$ => {
      var _v$5 = editorBusy(),
        _v$6 = editorBusy() || editorUncertain(),
        _v$7 = editorBusy(),
        _v$8 = editorBusy() || editorUncertain() || !editTitle().trim(),
        _v$9 = removing(),
        _v$0 = removing(),
        _v$1 = removing() || removeUncertain();
      _v$5 !== _p$.e && setAttribute(_el$41, "aria-busy", _p$.e = _v$5);
      _v$6 !== _p$.t && (_el$44.disabled = _p$.t = _v$6);
      _v$7 !== _p$.a && (_el$54.disabled = _p$.a = _v$7);
      _v$8 !== _p$.o && (_el$55.disabled = _p$.o = _v$8);
      _v$9 !== _p$.i && setAttribute(_el$57, "aria-busy", _p$.i = _v$9);
      _v$0 !== _p$.n && (_el$64.disabled = _p$.n = _v$0);
      _v$1 !== _p$.s && (_el$65.disabled = _p$.s = _v$1);
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined
    });
    createRenderEffect(() => _el$44.value = editTitle());
    return _el$14;
  })();
}
delegateEvents(["click", "input", "pointerdown", "keydown"]);

var _tmpl$$3 = /*#__PURE__*/template(`<button type=button>`),
  _tmpl$2$3 = /*#__PURE__*/template(`<p class=note-error role=alert>`),
  _tmpl$3$3 = /*#__PURE__*/template(`<button type=button>Check GitHub`),
  _tmpl$4$3 = /*#__PURE__*/template(`<form class=note-editor><textarea aria-label="Note content"></textarea><div class=note-editor-actions><button type=button>Cancel`),
  _tmpl$5$3 = /*#__PURE__*/template(`<section class=note-view><div class=note-toolbar><span class=note-type>Note`),
  _tmpl$6$3 = /*#__PURE__*/template(`<div class=note-content>`),
  _tmpl$7$3 = /*#__PURE__*/template(`<span class=muted>This note is empty.`),
  _tmpl$8$3 = /*#__PURE__*/template(`<button type=submit>`);
function NoteView(props) {
  function savedDraft() {
    try {
      const value = JSON.parse(sessionStorage.getItem(props.draftKey) || 'null');
      return typeof value?.base === 'string' && typeof value?.text === 'string' ? value : null;
    } catch {
      return null;
    }
  }
  const [hasDraft, setHasDraft] = createSignal(Boolean(savedDraft()));
  function rememberDraft(baseText, text) {
    try {
      sessionStorage.setItem(props.draftKey, JSON.stringify({
        base: baseText,
        text
      }));
    } catch {/* Editing still works without storage. */}
    setHasDraft(true);
  }
  function clearDraft() {
    try {
      sessionStorage.removeItem(props.draftKey);
    } catch {/* The in-memory editor still works. */}
    setHasDraft(false);
  }
  const [editing, setEditing] = createSignal(false);
  const [draft, setDraft] = createSignal('');
  const [base, setBase] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [uncertain, setUncertain] = createSignal(false);
  const [error, setError] = createSignal('');
  async function edit() {
    setBusy(true);
    setError('');
    try {
      const latest = await props.api.readNote(props.topic.id);
      const saved = savedDraft();
      setBase(saved?.base ?? latest.description);
      setDraft(saved?.text ?? latest.description);
      setEditing(true);
      if (saved && saved.base !== latest.description) setError('This note changed since your draft was saved. Copy your draft before editing the latest version.');
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  async function save(event) {
    event.preventDefault();
    if (busy() || uncertain()) return;
    setBusy(true);
    props.onBusyChange(true);
    setError('');
    try {
      const updated = await props.api.updateNote(props.topic.id, draft(), base());
      props.onUpdated(updated);
      clearDraft();
      setEditing(false);
    } catch (failure) {
      setUncertain(Boolean(failure.uncertain));
      setError(failure.message);
    } finally {
      setBusy(false);
      props.onBusyChange(false);
    }
  }
  async function checkSave() {
    setBusy(true);
    setError('');
    try {
      const latest = await props.api.readNote(props.topic.id);
      props.onUpdated(latest);
      if (latest.description === draft()) {
        clearDraft();
        setEditing(false);
        setUncertain(false);
      } else if (latest.description === base()) {
        setUncertain(false);
        setError('The note is unchanged on GitHub. You can try saving again.');
      } else {
        setUncertain(false);
        setError('The note changed on GitHub. Copy your draft before editing the latest version.');
      }
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  return (() => {
    var _el$ = _tmpl$5$3(),
      _el$2 = _el$.firstChild;
      _el$2.firstChild;
    insert(_el$2, createComponent(Show, {
      get when() {
        return !editing();
      },
      get children() {
        var _el$4 = _tmpl$$3();
        _el$4.$$click = edit;
        insert(_el$4, () => hasDraft() ? 'Resume draft' : 'Edit note');
        createRenderEffect(() => _el$4.disabled = busy());
        return _el$4;
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return error();
      },
      get children() {
        var _el$5 = _tmpl$2$3();
        insert(_el$5, error);
        return _el$5;
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return editing();
      },
      get fallback() {
        return (() => {
          var _el$1 = _tmpl$6$3();
          insert(_el$1, () => props.topic.description || _tmpl$7$3());
          return _el$1;
        })();
      },
      get children() {
        var _el$6 = _tmpl$4$3(),
          _el$7 = _el$6.firstChild,
          _el$8 = _el$7.nextSibling,
          _el$0 = _el$8.firstChild;
        _el$6.addEventListener("submit", save);
        _el$7.$$input = event => {
          const text = event.currentTarget.value;
          setDraft(text);
          rememberDraft(base(), text);
        };
        insert(_el$8, createComponent(Show, {
          get when() {
            return uncertain();
          },
          get fallback() {
            return (() => {
              var _el$11 = _tmpl$8$3();
              insert(_el$11, () => busy() ? 'Saving…' : 'Save');
              createRenderEffect(() => _el$11.disabled = busy() || draft() === base());
              return _el$11;
            })();
          },
          get children() {
            var _el$9 = _tmpl$3$3();
            _el$9.$$click = checkSave;
            createRenderEffect(() => _el$9.disabled = busy());
            return _el$9;
          }
        }), _el$0);
        _el$0.$$click = () => {
          clearDraft();
          setEditing(false);
          setUncertain(false);
          setError('');
        };
        createRenderEffect(_p$ => {
          var _v$ = busy(),
            _v$2 = busy();
          _v$ !== _p$.e && (_el$7.disabled = _p$.e = _v$);
          _v$2 !== _p$.t && (_el$0.disabled = _p$.t = _v$2);
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        createRenderEffect(() => _el$7.value = draft());
        return _el$6;
      }
    }), null);
    createRenderEffect(() => setAttribute(_el$, "aria-label", `${props.topic.name} note`));
    return _el$;
  })();
}
delegateEvents(["click", "input"]);

// List issues remain ordinary GitHub Markdown task lists.
const TASK_LINE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/;
const FENCE_LINE = /^ {0,3}([\x60~])\1{2,}/;
function checklist(body) {
  const newline = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  const items = [];
  let fence = null;
  lines.forEach((line, index) => {
    const marker = FENCE_LINE.exec(line);
    if (fence) {
      if (marker && marker[1] === fence.char && marker[0].trim().length >= fence.length && !line.slice(marker[0].length).trim()) fence = null;
      return;
    }
    if (marker) {
      fence = {
        char: marker[1],
        length: marker[0].trim().length
      };
      return;
    }
    const match = TASK_LINE.exec(line);
    if (match) items.push({
      index,
      checked: match[2].toLowerCase() === 'x',
      text: match[4]
    });
  });
  return {
    lines,
    newline,
    items
  };
}
function changeChecklistItem(body, index, change) {
  const {
    lines,
    newline
  } = checklist(body);
  const match = TASK_LINE.exec(lines[index] || '');
  if (!match) throw new Error('This list item changed. Refresh the list and try again.');
  if (change === 'remove') lines.splice(index, 1);else if (change === 'toggle') lines[index] = `${match[1]}${match[2].toLowerCase() === 'x' ? ' ' : 'x'}${match[3]}${match[4]}`;else {
    const text = String(change).trim();
    if (!text || /[\r\n]/.test(text)) throw new Error('Enter one line of text for a list item.');
    lines[index] = `${match[1]}${match[2]}${match[3]}${text}`;
  }
  return lines.join(newline);
}
function appendChecklistItem(body, text) {
  const item = String(text).trim();
  if (!item || /[\r\n]/.test(item)) throw new Error('Enter one line of text for a list item.');
  return `${body}${body && !/\r?\n$/.test(body) ? body.includes('\r\n') ? '\r\n' : '\n' : ''}- [ ] ${item}`;
}

var _tmpl$$2 = /*#__PURE__*/template(`<button type=button>`),
  _tmpl$2$2 = /*#__PURE__*/template(`<p class=list-error role=alert>`),
  _tmpl$3$2 = /*#__PURE__*/template(`<button type=button class=list-check-save>Check GitHub before trying again`),
  _tmpl$4$2 = /*#__PURE__*/template(`<form class=list-source-editor><textarea aria-label="List Markdown"></textarea><div class=list-source-actions><button type=submit>Save</button><button type=button>Cancel`),
  _tmpl$5$2 = /*#__PURE__*/template(`<section class=list-view><div class=list-toolbar><span class=list-progress> of <!> complete`),
  _tmpl$6$2 = /*#__PURE__*/template(`<form class=list-add><input type=text aria-label="New list item"placeholder="Add an item"maxlength=500><button type=submit>Add`),
  _tmpl$7$2 = /*#__PURE__*/template(`<p class=list-other-content>This list also contains other Markdown. Use Edit Markdown to view or change it.`),
  _tmpl$8$2 = /*#__PURE__*/template(`<div class=list-items>`),
  _tmpl$9$2 = /*#__PURE__*/template(`<p class=muted>No items yet.`),
  _tmpl$0$2 = /*#__PURE__*/template(`<form class=list-item-edit><input type=text aria-label="Edit list item"maxlength=500><button type=submit>Save</button><button type=button>Cancel`),
  _tmpl$1$2 = /*#__PURE__*/template(`<div class=list-item>`),
  _tmpl$10$1 = /*#__PURE__*/template(`<label><input type=checkbox><span>`),
  _tmpl$11$1 = /*#__PURE__*/template(`<button type=button>Edit`),
  _tmpl$12$1 = /*#__PURE__*/template(`<button type=button>Remove`);
function ListView(props) {
  const [newItem, setNewItem] = createSignal('');
  const [editingIndex, setEditingIndex] = createSignal(null);
  const [editingText, setEditingText] = createSignal('');
  const [sourceEditing, setSourceEditing] = createSignal(false);
  const [sourceDraft, setSourceDraft] = createSignal('');
  const [sourceBase, setSourceBase] = createSignal('');
  const [busy, setBusy] = createSignal(false);
  const [uncertain, setUncertain] = createSignal(false);
  const [error, setError] = createSignal('');
  const [pendingBody, setPendingBody] = createSignal('');
  const [baseBody, setBaseBody] = createSignal('');
  let pendingSuccess = null;
  const parsed = () => checklist(props.topic.description);
  const completed = () => parsed().items.filter(item => item.checked).length;
  function savedSource() {
    try {
      const value = JSON.parse(sessionStorage.getItem(props.draftKey) || 'null');
      return typeof value?.base === 'string' && typeof value?.text === 'string' ? value : null;
    } catch {
      return null;
    }
  }
  const [hasSourceDraft, setHasSourceDraft] = createSignal(Boolean(savedSource()));
  function clearSourceDraft() {
    try {
      sessionStorage.removeItem(props.draftKey);
    } catch {/* Editing still works without storage. */}
    setHasSourceDraft(false);
  }
  function rememberSource(text) {
    try {
      sessionStorage.setItem(props.draftKey, JSON.stringify({
        base: sourceBase(),
        text
      }));
    } catch {/* Editing still works without storage. */}
    setHasSourceDraft(true);
  }
  function confirmed(updated) {
    props.onUpdated(updated);
    pendingSuccess?.();
    pendingSuccess = null;
    setUncertain(false);
    setError('');
  }
  async function write(nextBody, afterSuccess = () => {}, expectedBody = props.topic.description) {
    if (busy() || uncertain() || nextBody === expectedBody) return;
    setBusy(true);
    props.onBusyChange(true);
    setError('');
    setPendingBody(nextBody);
    setBaseBody(expectedBody);
    pendingSuccess = afterSuccess;
    try {
      confirmed(await props.api.updateList(props.topic.id, nextBody, expectedBody));
    } catch (failure) {
      setUncertain(Boolean(failure.uncertain));
      setError(failure.message);
      if (!failure.uncertain) pendingSuccess = null;
    } finally {
      setBusy(false);
      props.onBusyChange(false);
    }
  }
  async function checkSave() {
    setBusy(true);
    setError('');
    try {
      const latest = await props.api.readList(props.topic.id);
      if (latest.description === pendingBody()) confirmed(latest);else {
        props.onUpdated(latest);
        pendingSuccess = null;
        setUncertain(false);
        setError(latest.description === baseBody() ? 'The list is unchanged on GitHub. You can try again.' : 'The list changed on GitHub. Review it before trying again.');
      }
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  async function openSource() {
    setBusy(true);
    setError('');
    try {
      const latest = await props.api.readList(props.topic.id);
      const saved = savedSource();
      setSourceBase(saved?.base ?? latest.description);
      setSourceDraft(saved?.text ?? latest.description);
      setSourceEditing(true);
      if (saved && saved.base !== latest.description) setError('This list changed since your draft was saved. Copy your draft before editing the latest version.');
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }
  function editItem(item) {
    setEditingIndex(item.index);
    setEditingText(item.text);
  }
  return (() => {
    var _el$ = _tmpl$5$2(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.firstChild,
      _el$4 = _el$3.firstChild,
      _el$6 = _el$4.nextSibling;
      _el$6.nextSibling;
    insert(_el$3, completed, _el$4);
    insert(_el$3, () => parsed().items.length, _el$6);
    insert(_el$2, createComponent(Show, {
      get when() {
        return !sourceEditing();
      },
      get children() {
        var _el$7 = _tmpl$$2();
        _el$7.$$click = openSource;
        insert(_el$7, () => hasSourceDraft() ? 'Resume Markdown draft' : 'Edit Markdown');
        createRenderEffect(() => _el$7.disabled = busy() || uncertain());
        return _el$7;
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return error();
      },
      get children() {
        var _el$8 = _tmpl$2$2();
        insert(_el$8, error);
        return _el$8;
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return uncertain();
      },
      get children() {
        var _el$9 = _tmpl$3$2();
        _el$9.$$click = checkSave;
        createRenderEffect(() => _el$9.disabled = busy());
        return _el$9;
      }
    }), null);
    insert(_el$, createComponent(Show, {
      get when() {
        return sourceEditing();
      },
      get fallback() {
        return [(() => {
          var _el$13 = _tmpl$6$2(),
            _el$14 = _el$13.firstChild,
            _el$15 = _el$14.nextSibling;
          _el$13.addEventListener("submit", event => {
            event.preventDefault();
            if (newItem().trim()) write(appendChecklistItem(props.topic.description, newItem()), () => setNewItem(''));
          });
          _el$14.$$input = event => setNewItem(event.currentTarget.value);
          createRenderEffect(_p$ => {
            var _v$4 = busy() || uncertain(),
              _v$5 = busy() || uncertain() || !newItem().trim();
            _v$4 !== _p$.e && (_el$14.disabled = _p$.e = _v$4);
            _v$5 !== _p$.t && (_el$15.disabled = _p$.t = _v$5);
            return _p$;
          }, {
            e: undefined,
            t: undefined
          });
          createRenderEffect(() => _el$14.value = newItem());
          return _el$13;
        })(), (() => {
          var _el$16 = _tmpl$8$2();
          insert(_el$16, createComponent(Show, {
            get when() {
              return parsed().items.length;
            },
            get fallback() {
              return _tmpl$9$2();
            },
            get children() {
              return createComponent(For, {
                get each() {
                  return parsed().items;
                },
                children: item => (() => {
                  var _el$19 = _tmpl$1$2();
                  insert(_el$19, createComponent(Show, {
                    get when() {
                      return editingIndex() === item.index;
                    },
                    get fallback() {
                      return [(() => {
                        var _el$24 = _tmpl$10$1(),
                          _el$25 = _el$24.firstChild,
                          _el$26 = _el$25.nextSibling;
                        _el$25.addEventListener("change", event => {
                          event.currentTarget.checked = item.checked;
                          write(changeChecklistItem(props.topic.description, item.index, 'toggle'));
                        });
                        insert(_el$26, () => item.text);
                        createRenderEffect(_p$ => {
                          var _v$9 = busy() || uncertain(),
                            _v$0 = !!item.checked;
                          _v$9 !== _p$.e && (_el$25.disabled = _p$.e = _v$9);
                          _v$0 !== _p$.t && _el$26.classList.toggle("is-complete", _p$.t = _v$0);
                          return _p$;
                        }, {
                          e: undefined,
                          t: undefined
                        });
                        createRenderEffect(() => _el$25.checked = item.checked);
                        return _el$24;
                      })(), (() => {
                        var _el$27 = _tmpl$11$1();
                        _el$27.$$click = () => editItem(item);
                        createRenderEffect(_p$ => {
                          var _v$1 = busy() || uncertain(),
                            _v$10 = `Edit ${item.text}`;
                          _v$1 !== _p$.e && (_el$27.disabled = _p$.e = _v$1);
                          _v$10 !== _p$.t && setAttribute(_el$27, "aria-label", _p$.t = _v$10);
                          return _p$;
                        }, {
                          e: undefined,
                          t: undefined
                        });
                        return _el$27;
                      })(), (() => {
                        var _el$28 = _tmpl$12$1();
                        _el$28.$$click = () => write(changeChecklistItem(props.topic.description, item.index, 'remove'));
                        createRenderEffect(_p$ => {
                          var _v$11 = busy() || uncertain(),
                            _v$12 = `Remove ${item.text}`;
                          _v$11 !== _p$.e && (_el$28.disabled = _p$.e = _v$11);
                          _v$12 !== _p$.t && setAttribute(_el$28, "aria-label", _p$.t = _v$12);
                          return _p$;
                        }, {
                          e: undefined,
                          t: undefined
                        });
                        return _el$28;
                      })()];
                    },
                    get children() {
                      var _el$20 = _tmpl$0$2(),
                        _el$21 = _el$20.firstChild,
                        _el$22 = _el$21.nextSibling,
                        _el$23 = _el$22.nextSibling;
                      _el$20.addEventListener("submit", event => {
                        event.preventDefault();
                        if (editingText().trim()) write(changeChecklistItem(props.topic.description, item.index, editingText()), () => setEditingIndex(null));
                      });
                      _el$21.$$input = event => setEditingText(event.currentTarget.value);
                      _el$23.$$click = () => setEditingIndex(null);
                      createRenderEffect(_p$ => {
                        var _v$6 = busy() || uncertain(),
                          _v$7 = busy() || uncertain() || !editingText().trim(),
                          _v$8 = busy();
                        _v$6 !== _p$.e && (_el$21.disabled = _p$.e = _v$6);
                        _v$7 !== _p$.t && (_el$22.disabled = _p$.t = _v$7);
                        _v$8 !== _p$.a && (_el$23.disabled = _p$.a = _v$8);
                        return _p$;
                      }, {
                        e: undefined,
                        t: undefined,
                        a: undefined
                      });
                      createRenderEffect(() => _el$21.value = editingText());
                      return _el$20;
                    }
                  }));
                  createRenderEffect(() => _el$19.classList.toggle("is-pending", !!busy()));
                  return _el$19;
                })()
              });
            }
          }), null);
          insert(_el$16, createComponent(Show, {
            get when() {
              return parsed().lines.some(line => line.trim() && !/^\s*[-*+]\s+\[[ xX]\]\s+/.test(line));
            },
            get children() {
              return _tmpl$7$2();
            }
          }), null);
          return _el$16;
        })()];
      },
      get children() {
        var _el$0 = _tmpl$4$2(),
          _el$1 = _el$0.firstChild,
          _el$10 = _el$1.nextSibling,
          _el$11 = _el$10.firstChild,
          _el$12 = _el$11.nextSibling;
        _el$0.addEventListener("submit", event => {
          event.preventDefault();
          write(sourceDraft(), () => {
            clearSourceDraft();
            setSourceEditing(false);
          }, sourceBase());
        });
        _el$1.$$input = event => {
          const text = event.currentTarget.value;
          setSourceDraft(text);
          rememberSource(text);
        };
        _el$12.$$click = () => {
          clearSourceDraft();
          setSourceEditing(false);
          setError('');
        };
        createRenderEffect(_p$ => {
          var _v$ = busy() || uncertain(),
            _v$2 = busy() || uncertain() || sourceDraft() === sourceBase(),
            _v$3 = busy();
          _v$ !== _p$.e && (_el$1.disabled = _p$.e = _v$);
          _v$2 !== _p$.t && (_el$11.disabled = _p$.t = _v$2);
          _v$3 !== _p$.a && (_el$12.disabled = _p$.a = _v$3);
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        createRenderEffect(() => _el$1.value = sourceDraft());
        return _el$0;
      }
    }), null);
    createRenderEffect(() => setAttribute(_el$, "aria-label", `${props.topic.name} list`));
    return _el$;
  })();
}
delegateEvents(["click", "input"]);

var _tmpl$$1 = /*#__PURE__*/template(`<div class=repository-recents role=group aria-label="Recent repositories">`),
  _tmpl$2$1 = /*#__PURE__*/template(`<p class=muted>Connecting...`),
  _tmpl$3$1 = /*#__PURE__*/template(`<p class=muted>Waiting for the current change to finish.`),
  _tmpl$4$1 = /*#__PURE__*/template(`<p class=dialog-error role=alert>`),
  _tmpl$5$1 = /*#__PURE__*/template(`<div id=repository-menu class=repository-menu aria-label="Repository selection"><div class=repository-current><span></span><button type=button class=repository-permit aria-haspopup=dialog></button></div><button type=button class=repository-connect aria-haspopup=dialog>Connect repository`),
  _tmpl$6$1 = /*#__PURE__*/template(`<label for=permit-project-token>Projects token <span class=muted>(optional)`),
  _tmpl$7$1 = /*#__PURE__*/template(`<input id=permit-project-token type=password autocomplete=off spellcheck=false>`),
  _tmpl$8$1 = /*#__PURE__*/template(`<button type=button class=permit-forget>Forget credentials`),
  _tmpl$9$1 = /*#__PURE__*/template(`<button type=button>Continue without Projects`),
  _tmpl$0$1 = /*#__PURE__*/template(`<header class="workspace-header repository-header"><button type=button class=repository-trigger aria-controls=repository-menu><img class=workspace-icon src=./lyra.jpg alt><span class=repository-heading><span class=repository-title></span><span class=muted></span></span><svg class=repository-chevron width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=1.5 aria-hidden=true><path d="m6 9 6 6 6-6"></path></svg></button><dialog class="topic-status-dialog permit-dialog"aria-labelledby=permit-title><form><h2 id=permit-title></h2><label for=permit-repository>Repository</label><input id=permit-repository type=text required autocomplete=off placeholder="owner/repo or GitHub URL"><label for=permit-token>Repository token</label><input id=permit-token type=password required autocomplete=off spellcheck=false><label class=permit-remember><input type=checkbox> Remember on this browser</label><div class=dialog-actions><button type=button class=dialog-cancel>Cancel</button><button type=submit>`),
  _tmpl$1$1 = /*#__PURE__*/template(`<button type=button>`);
function RepositorySelector(props) {
  const [open, setOpen] = createSignal(false);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal('');
  const [address, setAddress] = createSignal('');
  const [token, setToken] = createSignal('');
  const [projectToken, setProjectToken] = createSignal('');
  const [remember, setRemember] = createSignal(true);
  const [mode, setMode] = createSignal('permit');
  const [validated, setValidated] = createSignal(null);
  let element, trigger, dialog;
  let stopped = false,
    attempt = 0,
    tokensEdited = false;
  const closeMenu = () => {
    if (!dialog?.open) {
      attempt++;
      setBusy(false);
      setOpen(false);
      setError('');
    }
  };
  const outside = event => {
    if (!element?.contains(event.target)) closeMenu();
  };
  const escape = event => {
    if (event.key === 'Escape' && open() && !dialog?.open) {
      closeMenu();
      trigger?.focus();
    }
  };
  document.addEventListener('pointerdown', outside);
  document.addEventListener('keydown', escape);
  onCleanup(() => {
    stopped = true;
    attempt++;
    document.removeEventListener('pointerdown', outside);
    document.removeEventListener('keydown', escape);
  });
  function openPermit(repository = props.repository, connecting = false, connectedName = '') {
    if (props.switchDisabled) return;
    attempt++;
    setOpen(false);
    setBusy(false);
    setError('');
    setValidated(null);
    tokensEdited = false;
    const saved = props.getCredentials(repository);
    setAddress(connecting ? connectedName : repositoryName(repository));
    setToken(saved?.token || (connecting ? props.credentials?.token : '') || '');
    setProjectToken(saved?.projectToken || (props.projectsEnabled && connecting ? props.credentials?.projectToken : '') || '');
    setRemember(saved?.remember ?? true);
    setMode(connecting ? 'connect' : 'permit');
    dialog.showModal();
    requestAnimationFrame(() => dialog.querySelector(connecting ? '#permit-repository' : '#permit-token')?.focus());
  }
  function finish(repository, credentials) {
    if (props.switchDisabled) throw new Error('Wait for the current change to finish, then connect again.');
    props.onConnect(repository, credentials, remember());
  }
  async function permit(event) {
    event.preventDefault();
    if (busy() || props.switchDisabled) return;
    setError('');
    setValidated(null);
    let repository, credentials;
    try {
      repository = parseRepository(address());
      credentials = normalizeCredentials({
        token: token(),
        projectToken: projectToken()
      });
      if (!credentials) throw new Error('Enter a repository token without spaces or line breaks.');
    } catch (failure) {
      setError(failure.message);
      return;
    }
    const version = ++attempt;
    setBusy(true);
    try {
      const api = createGitHubClient({
        ...repository,
        ...credentials
      });
      const canonical = await api.checkRepository();
      if (stopped || version !== attempt) return;
      if (props.projectsEnabled && credentials.projectToken) {
        try {
          await createGitHubClient({
            ...canonical,
            ...credentials
          }).listProjects();
        } catch (failure) {
          if (!stopped && version === attempt) {
            setValidated({
              repository: canonical,
              credentials: {
                ...credentials,
                projectToken: ''
              }
            });
            setError(`Repository access verified. Projects: ${failure.message}`);
          }
          return;
        }
      }
      if (!stopped && version === attempt) finish(canonical, credentials);
    } catch (failure) {
      if (!stopped && version === attempt) {
        setError(failure.status === 401 || failure.status === 403 || failure.status === 404 ? 'Could not authenticate for this repository. Check the repository address and token.' : failure.message);
      }
    } finally {
      if (!stopped && version === attempt) setBusy(false);
    }
  }
  function withoutProjects() {
    const checked = validated();
    if (!checked || busy()) return;
    try {
      finish(checked.repository, checked.credentials);
    } catch (failure) {
      setError(failure.message);
    }
  }
  function forget() {
    if (busy() || props.switchDisabled) return;
    try {
      props.onForget();
    } catch (failure) {
      setError(failure.message);
    }
  }
  function changed() {
    setValidated(null);
    setError('');
  }
  function restoreSavedCredentials() {
    if (tokensEdited || mode() !== 'connect') return;
    try {
      const saved = props.getCredentials(parseRepository(address()));
      if (saved) {
        setToken(saved.token);
        setProjectToken(saved.projectToken);
        setRemember(saved.remember);
        changed();
      }
    } catch {/* Address validation runs on Connect. */}
  }
  return (() => {
    var _el$ = _tmpl$0$1(),
      _el$2 = _el$.firstChild,
      _el$3 = _el$2.firstChild,
      _el$4 = _el$3.nextSibling,
      _el$5 = _el$4.firstChild,
      _el$6 = _el$5.nextSibling,
      _el$14 = _el$2.nextSibling,
      _el$15 = _el$14.firstChild,
      _el$16 = _el$15.firstChild,
      _el$17 = _el$16.nextSibling,
      _el$18 = _el$17.nextSibling,
      _el$19 = _el$18.nextSibling,
      _el$20 = _el$19.nextSibling,
      _el$23 = _el$20.nextSibling,
      _el$24 = _el$23.firstChild,
      _el$27 = _el$23.nextSibling,
      _el$28 = _el$27.firstChild,
      _el$30 = _el$28.nextSibling;
    var _ref$ = element;
    typeof _ref$ === "function" ? use(_ref$, _el$) : element = _el$;
    _el$2.$$click = () => {
      if (open()) closeMenu();else setOpen(true);
    };
    var _ref$2 = trigger;
    typeof _ref$2 === "function" ? use(_ref$2, _el$2) : trigger = _el$2;
    insert(_el$5, () => props.repository.repo || 'Connect repository');
    insert(_el$6, () => props.repository.owner || 'Blackboard');
    insert(_el$, createComponent(Show, {
      get when() {
        return open();
      },
      get children() {
        var _el$7 = _tmpl$5$1(),
          _el$8 = _el$7.firstChild,
          _el$9 = _el$8.firstChild,
          _el$0 = _el$9.nextSibling,
          _el$10 = _el$8.nextSibling;
        insert(_el$9, () => repositoryName(props.repository));
        _el$0.$$click = () => openPermit();
        insert(_el$0, () => props.permitted ? 'Permitted' : 'Permit');
        insert(_el$7, createComponent(Show, {
          get when() {
            return props.recentRepositories?.length;
          },
          get children() {
            var _el$1 = _tmpl$$1();
            insert(_el$1, createComponent(For, {
              get each() {
                return props.recentRepositories;
              },
              children: repository => (() => {
                var _el$31 = _tmpl$1$1();
                _el$31.$$click = () => openPermit(repository, true, repositoryName(repository));
                insert(_el$31, () => repositoryName(repository));
                createRenderEffect(() => _el$31.disabled = busy() || props.switchDisabled);
                return _el$31;
              })()
            }));
            return _el$1;
          }
        }), _el$10);
        _el$10.$$click = () => openPermit(props.repository, true);
        insert(_el$7, createComponent(Show, {
          get when() {
            return busy();
          },
          get children() {
            return _tmpl$2$1();
          }
        }), null);
        insert(_el$7, createComponent(Show, {
          get when() {
            return props.switchDisabled;
          },
          get children() {
            return _tmpl$3$1();
          }
        }), null);
        insert(_el$7, createComponent(Show, {
          get when() {
            return error();
          },
          get children() {
            var _el$13 = _tmpl$4$1();
            insert(_el$13, error);
            return _el$13;
          }
        }), null);
        createRenderEffect(_p$ => {
          var _v$ = busy(),
            _v$2 = repositoryName(props.repository),
            _v$3 = busy() || props.switchDisabled,
            _v$4 = busy() || props.switchDisabled;
          _v$ !== _p$.e && setAttribute(_el$7, "aria-busy", _p$.e = _v$);
          _v$2 !== _p$.t && setAttribute(_el$9, "title", _p$.t = _v$2);
          _v$3 !== _p$.a && (_el$0.disabled = _p$.a = _v$3);
          _v$4 !== _p$.o && (_el$10.disabled = _p$.o = _v$4);
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined
        });
        return _el$7;
      }
    }), _el$14);
    _el$14.addEventListener("close", () => {
      attempt++;
      setBusy(false);
      setToken('');
      setProjectToken('');
      setValidated(null);
      setError('');
      trigger?.focus();
    });
    var _ref$3 = dialog;
    typeof _ref$3 === "function" ? use(_ref$3, _el$14) : dialog = _el$14;
    _el$15.addEventListener("submit", permit);
    insert(_el$16, () => mode() === 'connect' ? 'Connect repository' : 'Permit repository');
    _el$18.$$input = event => {
      setAddress(event.currentTarget.value);
      changed();
    };
    _el$18.addEventListener("blur", restoreSavedCredentials);
    _el$20.$$input = event => {
      tokensEdited = true;
      setToken(event.currentTarget.value);
      changed();
    };
    insert(_el$15, createComponent(Show, {
      get when() {
        return props.projectsEnabled;
      },
      get children() {
        return [_tmpl$6$1(), (() => {
          var _el$22 = _tmpl$7$1();
          _el$22.$$input = event => {
            tokensEdited = true;
            setProjectToken(event.currentTarget.value);
            changed();
          };
          createRenderEffect(() => _el$22.disabled = busy());
          createRenderEffect(() => _el$22.value = projectToken());
          return _el$22;
        })()];
      }
    }), _el$23);
    _el$24.addEventListener("change", event => setRemember(event.currentTarget.checked));
    insert(_el$15, createComponent(Show, {
      get when() {
        return error();
      },
      get children() {
        var _el$25 = _tmpl$4$1();
        insert(_el$25, error);
        return _el$25;
      }
    }), _el$27);
    insert(_el$15, createComponent(Show, {
      get when() {
        return memo(() => mode() === 'permit')() && props.credentials?.token;
      },
      get children() {
        var _el$26 = _tmpl$8$1();
        _el$26.$$click = forget;
        createRenderEffect(() => _el$26.disabled = busy() || props.switchDisabled);
        return _el$26;
      }
    }), _el$27);
    _el$28.$$click = () => dialog.close();
    insert(_el$27, createComponent(Show, {
      get when() {
        return validated();
      },
      get children() {
        var _el$29 = _tmpl$9$1();
        _el$29.$$click = withoutProjects;
        createRenderEffect(() => _el$29.disabled = busy() || props.switchDisabled);
        return _el$29;
      }
    }), _el$30);
    insert(_el$30, () => busy() ? 'Checking...' : 'Connect');
    createRenderEffect(_p$ => {
      var _v$5 = repositoryName(props.repository),
        _v$6 = `Repository ${repositoryName(props.repository)}`,
        _v$7 = open(),
        _v$8 = busy(),
        _v$9 = mode() !== 'connect',
        _v$0 = busy(),
        _v$1 = busy(),
        _v$10 = busy(),
        _v$11 = busy() || props.switchDisabled || !token().trim() || !address().trim();
      _v$5 !== _p$.e && setAttribute(_el$2, "title", _p$.e = _v$5);
      _v$6 !== _p$.t && setAttribute(_el$2, "aria-label", _p$.t = _v$6);
      _v$7 !== _p$.a && setAttribute(_el$2, "aria-expanded", _p$.a = _v$7);
      _v$8 !== _p$.o && setAttribute(_el$15, "aria-busy", _p$.o = _v$8);
      _v$9 !== _p$.i && (_el$18.readOnly = _p$.i = _v$9);
      _v$0 !== _p$.n && (_el$18.disabled = _p$.n = _v$0);
      _v$1 !== _p$.s && (_el$20.disabled = _p$.s = _v$1);
      _v$10 !== _p$.h && (_el$24.disabled = _p$.h = _v$10);
      _v$11 !== _p$.r && (_el$30.disabled = _p$.r = _v$11);
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined,
      h: undefined,
      r: undefined
    });
    createRenderEffect(() => _el$18.value = address());
    createRenderEffect(() => _el$20.value = token());
    createRenderEffect(() => _el$24.checked = remember());
    return _el$;
  })();
}
delegateEvents(["click", "input"]);

// Keep acknowledged local changes visible until GitHub's list catches up.
const sameTags = (a = [], b = []) => a.length === b.length && a.every(tag => b.some(other => other.name.toLowerCase() === tag.name.toLowerCase()));
function createTopicTracker() {
  const changes = new Map();
  return {
    remember(topic) {
      const pending = {
        ...topic,
        syncState: 'confirming'
      };
      changes.set(topic.id, pending);
      return pending;
    },
    remove(id) {
      changes.set(id, null);
    },
    reconcile(incoming) {
      const merged = new Map(incoming.map(topic => [topic.id, topic]));
      for (const [id, desired] of changes) {
        const actual = merged.get(id);
        if (desired === null) {
          if (!actual) changes.delete(id);
          merged.delete(id);
        } else if (actual && actual.name === desired.name && actual.kind === desired.kind && actual.description === desired.description && actual.state === desired.state && actual.archived === desired.archived && (actual.parentId ?? null) === (desired.parentId ?? null) && (actual.milestoneId ?? null) === (desired.milestoneId ?? null) && sameTags(actual.tags, desired.tags)) {
          changes.delete(id);
        } else {
          merged.set(id, desired);
        }
      }
      return [...merged.values()].sort((a, b) => (a.number ?? a.id) - (b.number ?? b.id));
    }
  };
}

// Missing parents become roots. Guard cycles so malformed remote data stays usable.
function topicRows(topics, collapsed = new Set()) {
  const ids = new Set(topics.map(topic => topic.id));
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
    rows.push({
      ...topic,
      depth,
      hasChildren: Boolean(children.get(topic.id)?.length)
    });
    for (const child of children.get(topic.id) || []) {
      if (collapsed.has(topic.id)) hide(child);else visit(child, depth + 1);
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

// A small, text-only Markdown subset. Never interpret message HTML.
function messageBlocks(text) {
  const blocks = [];
  for (const line of text.split('\n')) {
    const quote = /^> ?/.test(line);
    const content = quote ? line.replace(/^> ?/, '') : line;
    const previous = blocks.at(-1);
    if (previous?.quote === quote) previous.text += `\n${content}`;else blocks.push({
      quote,
      text: content
    });
  }
  return blocks;
}
function messageTokens(text) {
  const tokens = [];
  const pattern = /`([^`\n]+)`|\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)|(?<![\w@/])@([A-Za-z][A-Za-z0-9_-]{0,63})(?![\w-])/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > start) tokens.push({
      type: 'text',
      text: text.slice(start, match.index)
    });
    if (match[1]) tokens.push({
      type: 'code',
      text: match[1]
    });else if (match[2]) tokens.push({
      type: 'link',
      text: match[2],
      url: match[3]
    });else tokens.push({
      type: 'mention',
      text: match[0],
      name: match[4]
    });
    start = match.index + match[0].length;
  }
  if (start < text.length) tokens.push({
    type: 'text',
    text: text.slice(start)
  });
  return tokens;
}
function quoteReply(message) {
  const name = (message.sender || message.author).replace(/[\[\]\r\n]/g, '');
  const source = /^https:\/\/github\.com\//.test(message.url) ? `[${name}](${message.url})` : name;
  return `${source} wrote:\n${message.text.split('\n').map(line => `> ${line}`).join('\n')}\n\n`;
}

// Preserve acknowledged writes while GitHub's list catches up.
function listCompletion(list) {
  const items = checklist(list.description).items;
  return {
    total: items.length,
    complete: items.filter(item => item.checked).length
  };
}
function goalProgress(goal, lists = []) {
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
  return {
    complete,
    total,
    percent: total ? complete / total * 100 : 0
  };
}
const sortMilestones = items => [...items].sort((a, b) => (a.state === b.state ? 0 : a.state === 'open' ? -1 : 1) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.id - b.id);
function createMilestoneTracker() {
  const changes = new Map();
  return {
    remember(item) {
      const pending = {
        ...item,
        syncState: 'confirming'
      };
      changes.set(item.id, pending);
      return pending;
    },
    reconcile(incoming) {
      const merged = new Map(incoming.map(item => [item.id, item]));
      for (const [id, desired] of changes) {
        const actual = merged.get(id);
        if (actual && ['name', 'description', 'dueDate', 'state'].every(field => actual[field] === desired[field])) changes.delete(id);else merged.set(id, desired);
      }
      return sortMilestones([...merged.values()]);
    }
  };
}

var _tmpl$ = /*#__PURE__*/template(`<p class=api-error role=alert>`),
  _tmpl$2 = /*#__PURE__*/template(`<section class="chat-panel empty-chat"><h2></h2><button type=button>Back to topics`),
  _tmpl$3 = /*#__PURE__*/template(`<div class=api-error role=alert> <button type=button aria-label="Dismiss error">×`),
  _tmpl$4 = /*#__PURE__*/template(`<p class=milestone-due>Due `),
  _tmpl$5 = /*#__PURE__*/template(`<div class=milestone-topic-list>`),
  _tmpl$6 = /*#__PURE__*/template(`<section class="chat-panel milestone-overview"><header class=chat-header><h2></h2><p class=muted>Goal</p><div class=chat-header-actions><a class=preview-badge target=_blank rel="noopener noreferrer">GitHub ↗</a></div></header><div class=milestone-detail><div class=milestone-detail-actions><button type=button class=topic-status><span class=topic-status-dot aria-hidden=true></span></button><button type=button class=milestone-edit-button>Edit</button></div><div class=milestone-progress-label><strong> / <!> complete</strong></div><progress class=milestone-progress max=100></progress><div class=milestone-topics-heading><h3>Tasks</h3><select aria-label="Add task to goal"value><option value>Add task…`),
  _tmpl$7 = /*#__PURE__*/template(`<option>`),
  _tmpl$8 = /*#__PURE__*/template(`<p class=muted>No tasks assigned yet.`),
  _tmpl$9 = /*#__PURE__*/template(`<small>`),
  _tmpl$0 = /*#__PURE__*/template(`<div class=milestone-topic-row><button type=button class=milestone-topic-link><span class=milestone-task-title><span class=topic-status-dot aria-hidden=true></span></span><small></small></button><button type=button class=milestone-topic-remove title="Remove from goal">−`),
  _tmpl$1 = /*#__PURE__*/template(`<code>`),
  _tmpl$10 = /*#__PURE__*/template(`<a target=_blank rel="noopener noreferrer">`),
  _tmpl$11 = /*#__PURE__*/template(`<a class=message-mention target=_blank rel="noopener noreferrer">`),
  _tmpl$12 = /*#__PURE__*/template(`<span class=message-mention title="Declared Blackboard identity">`),
  _tmpl$13 = /*#__PURE__*/template(`<div class=message-text>`),
  _tmpl$14 = /*#__PURE__*/template(`<blockquote>`),
  _tmpl$15 = /*#__PURE__*/template(`<div>`),
  _tmpl$16 = /*#__PURE__*/template(`<svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=1.6 stroke-linecap=round stroke-linejoin=round aria-hidden=true><path d="M4 5h3v3H4zM4 11h3v3H4zM4 17h3v3H4zM10 6h10M10 12h10M10 18h10">`),
  _tmpl$17 = /*#__PURE__*/template(`<span class=channel-hash>`),
  _tmpl$18 = /*#__PURE__*/template(`<svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=1.6 stroke-linecap=round stroke-linejoin=round aria-hidden=true><path d="M5 3h10l4 4v14H5zM15 3v5h4M8 12h8M8 16h8">`),
  _tmpl$19 = /*#__PURE__*/template(`<svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=1.6 stroke-linecap=round stroke-linejoin=round aria-hidden=true><path d="M8 5h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-3l-3 3v-3"></path><path d="M13 7H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2l3 3v-3h3a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2Z">`),
  _tmpl$20 = /*#__PURE__*/template(`<svg width=14 height=14 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=1.6 stroke-linecap=round stroke-linejoin=round aria-hidden=true><path d="M5 4h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6 4V6a2 2 0 0 1 2-2Z"></path><path d="M8 9h8M8 13h5">`),
  _tmpl$21 = /*#__PURE__*/template(`<label><input type=radio name=topicKind value=discussion><span>Discussion`),
  _tmpl$22 = /*#__PURE__*/template(`<form id=new-topic-form class=new-topic-form><label for=topic-name></label><input id=topic-name name=topicName type=text required maxlength=80><fieldset class=topic-kind-options><legend class=sr-only>Topic type</legend><label><input type=radio name=topicKind value=talk><span>Talk</span></label><label><input type=radio name=topicKind value=list><span>List</span></label><label><input type=radio name=topicKind value=note><span>Note</span></label></fieldset><div class=new-topic-form-actions><button type=button class=cancel-topic-button>Cancel</button><button type=submit>`),
  _tmpl$23 = /*#__PURE__*/template(`<p class=project-sidebar-error role=alert>`),
  _tmpl$24 = /*#__PURE__*/template(`<section class=sidebar-section aria-label=Projects><button type=button class=sidebar-section-toggle aria-controls=projects-panel><span class=sidebar-label>Projects</span><svg width=16 height=16 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=1.5 stroke-linecap=round stroke-linejoin=round aria-hidden=true><path></path></svg></button><div id=projects-panel class=sidebar-section-panel><nav class=project-list aria-label=Projects>`),
  _tmpl$25 = /*#__PURE__*/template(`<nav class=milestone-list aria-label=Goals>`),
  _tmpl$26 = /*#__PURE__*/template(`<p class=dialog-error role=alert>`),
  _tmpl$27 = /*#__PURE__*/template(`<p role=status>`),
  _tmpl$28 = /*#__PURE__*/template(`<section class=app-shell><aside class=sidebar aria-label="Chat topics"><div class=sidebar-actions><button type=button class=new-topic-button aria-controls=new-topic-form><span class=new-topic-plus aria-hidden=true>+</span> New topic</button></div><div class=topic-list-heading><div class=sidebar-label>Topics</div><button type=button class=topic-filter aria-label="Filter topics (coming soon)"aria-disabled=true title="Filter topics — coming soon"><svg width=16 height=16 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=1.5 stroke-linecap=round stroke-linejoin=round aria-hidden=true><path d="M3 6h4m4 0h10M3 12h10m4 0h4M3 18h2m4 0h12"></path><circle cx=9 cy=6 r=2></circle><circle cx=15 cy=12 r=2></circle><circle cx=7 cy=18 r=2></circle></svg></button></div><nav class=channel-list aria-label=Topics></nav><section class=sidebar-section aria-label=Goals><button type=button class=sidebar-section-toggle aria-controls=milestones-panel><span class=sidebar-label>Goals</span><svg width=16 height=16 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=1.5 stroke-linecap=round stroke-linejoin=round aria-hidden=true><path></path></svg></button><div id=milestones-panel class=sidebar-section-panel><div class=milestone-list-actions><button type=button class=new-milestone-button><span aria-hidden=true>+</span> New goal</button></div></div></section><footer class=sidebar-footer><span class=status-dot role=img></span></footer></aside><dialog class="topic-status-dialog milestone-dialog"aria-labelledby=milestone-form-title><form><h2 id=milestone-form-title></h2><label for=milestone-name>Name</label><input id=milestone-name type=text required maxlength=256 autofocus><label for=milestone-description>Description</label><textarea id=milestone-description rows=4></textarea><label for=milestone-date>Due date <span class=muted>(optional)</span></label><input id=milestone-date type=date><div class=dialog-actions><button type=button class=dialog-cancel>Cancel</button><button type=submit></button></div></form></dialog><dialog class=topic-status-dialog aria-labelledby=topic-status-title></dialog><dialog class="topic-status-dialog reaction-dialog"aria-labelledby=reaction-title><h2 id=reaction-title>React</h2><div class=reaction-choices></div><div class=dialog-actions><button type=button autofocus>Cancel</button></div></dialog><dialog class=topic-status-dialog aria-labelledby=remove-topic-title>`),
  _tmpl$29 = /*#__PURE__*/template(`<small class=topic-parent-hint>Under: `),
  _tmpl$30 = /*#__PURE__*/template(`<button type=button class=topic-expand>`),
  _tmpl$31 = /*#__PURE__*/template(`<small role=status>`),
  _tmpl$32 = /*#__PURE__*/template(`<button type=button class=add-subtopic-button title="Create subtopic"><span aria-hidden=true>+`),
  _tmpl$33 = /*#__PURE__*/template(`<div class=channel-row><button type=button class=channel-button></button><button type=button class=remove-topic-button aria-haspopup=dialog><span aria-hidden=true>−`),
  _tmpl$34 = /*#__PURE__*/template(`<span class=topic-expand aria-hidden=true>`),
  _tmpl$35 = /*#__PURE__*/template(`<div class="channel-row is-pending"><span class=topic-expand aria-hidden=true></span><div class=channel-button><small role=status>`),
  _tmpl$36 = /*#__PURE__*/template(`<small>Closed`),
  _tmpl$37 = /*#__PURE__*/template(`<button type=button class=project-list-item><span>`),
  _tmpl$38 = /*#__PURE__*/template(`<p>`),
  _tmpl$39 = /*#__PURE__*/template(`<button type=button class=milestone-list-item><span class=milestone-list-title></span><progress class=milestone-progress max=100>`),
  _tmpl$40 = /*#__PURE__*/template(`<p class=muted>`),
  _tmpl$41 = /*#__PURE__*/template(`<button type=button class=parent-topic-link>‹ Back to project`),
  _tmpl$42 = /*#__PURE__*/template(`<option>Goal #`),
  _tmpl$43 = /*#__PURE__*/template(`<label class=topic-milestone-select><span class=sr-only>Goal</span><span class=topic-milestone-value aria-hidden=true></span><svg width=12 height=12 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=1.5 stroke-linecap=round stroke-linejoin=round aria-hidden=true><path d="m6 9 6 6 6-6"></path></svg><select aria-label="Add to goal"><option value>None`),
  _tmpl$44 = /*#__PURE__*/template(`<form class=topic-tag-form aria-label="Add topic tag"><input type=text aria-label="Tag name"placeholder="Tag name"list=topic-tag-suggestions maxlength=50 required><datalist id=topic-tag-suggestions></datalist><button type=submit>Add</button><button type=button aria-label="Cancel tag">×`),
  _tmpl$45 = /*#__PURE__*/template(`<div class=message-list role=log aria-label=Messages aria-live=polite aria-relevant=additions>`),
  _tmpl$46 = /*#__PURE__*/template(`<form class=composer><div class=composer-box><textarea rows=2></textarea><button type=submit>Send <span aria-hidden=true>↗</span></button></div><p class=composer-hint>Enter to send · Shift + Enter for a new line <span>/`),
  _tmpl$47 = /*#__PURE__*/template(`<section class=chat-panel><header class=chat-header><h2> </h2><div class=chat-header-actions><a class=preview-badge target=_blank rel=noreferrer>GitHub ↗</a></div></header><div class=chat-topic-controls><button type=button class=topic-status aria-haspopup=dialog><span class=topic-status-dot aria-hidden=true></span></button></div><div class=topic-tags aria-label="Topic tags">`),
  _tmpl$48 = /*#__PURE__*/template(`<section class="chat-panel empty-chat"><h2></h2><p class=muted></p><button type=button>New topic`),
  _tmpl$49 = /*#__PURE__*/template(`<button type=button class=parent-topic-link>‹ `),
  _tmpl$50 = /*#__PURE__*/template(`<span class=topic-tag><span class=topic-tag-dot aria-hidden=true></span><span class=topic-tag-name></span><button type=button>×`),
  _tmpl$51 = /*#__PURE__*/template(`<button type=button class=add-tag-button>+ Tag`),
  _tmpl$52 = /*#__PURE__*/template(`<a class=message-reply-reference target=_blank rel="noopener noreferrer">↳ Replying to `),
  _tmpl$53 = /*#__PURE__*/template(`<article class=message><span class=avatar aria-hidden=true></span><div class=message-content><div class=message-meta><span class=message-author></span><time></time></div><div class=message-reactions role=group aria-label=Reactions><button type=button class=reaction-add aria-label="Add or remove a reaction"aria-haspopup=dialog title=React><svg width=16 height=16 viewBox="0 0 24 24"fill=none stroke=currentColor stroke-width=1.5 stroke-linecap=round aria-hidden=true><path d="M21 13a9 9 0 1 1-10-10M8 14c1.8 2 6.2 2 8 0M17 4h6m-3-3v6"></path><path d="M8 9h.01M14 9h.01"stroke-width=3></path></svg></button><button type=button class=message-reply title="Quote reply">Reply`),
  _tmpl$54 = /*#__PURE__*/template(`<span role=img>`),
  _tmpl$55 = /*#__PURE__*/template(`<article class="message is-pending"><span class="avatar avatar-you"aria-hidden=true>Y</span><div class=message-content><div class=message-meta><span class=message-author>You</span><span class=delivery-state role=status>`),
  _tmpl$56 = /*#__PURE__*/template(`<form><h2 id=topic-status-title></h2><div class=dialog-actions><button type=button class=dialog-cancel autofocus>Cancel</button><button type=submit>`),
  _tmpl$57 = /*#__PURE__*/template(`<button type=button class=reaction-choice>`),
  _tmpl$58 = /*#__PURE__*/template(`<button type=button>Yes`),
  _tmpl$59 = /*#__PURE__*/template(`<button type=button>No`),
  _tmpl$60 = /*#__PURE__*/template(`<div><h2 id=remove-topic-title></h2><div class=dialog-actions>`),
  _tmpl$61 = /*#__PURE__*/template(`<button type=button>Archive`),
  _tmpl$62 = /*#__PURE__*/template(`<button type=button>Delete`),
  _tmpl$63 = /*#__PURE__*/template(`<button type=button autofocus>Cancel`);
const formatTime = date => date.toLocaleTimeString([], {
  hour: '2-digit',
  minute: '2-digit'
});
const POLL_INTERVAL_MS = 10000;
const reactionSymbols = {
  '+1': ['👍', 'Thumbs up'],
  '-1': ['👎', 'Thumbs down'],
  laugh: ['😄', 'Laugh'],
  confused: ['😕', 'Confused'],
  heart: ['❤️', 'Heart'],
  hooray: ['🎉', 'Hooray'],
  rocket: ['🚀', 'Rocket'],
  eyes: ['👀', 'Eyes']
};
function App(props = {}) {
  const defaults = parseRepository(props.defaultRepository || 'orazdow/Blackboard');
  let storage;
  try {
    storage = localStorage;
  } catch {/* In-memory credentials still work. */}
  const credentials = createCredentialStore(storage);
  const siteSelectionKey = `blackboard:site:${new URL('.', window.location.href).pathname}:active-repository`;
  const recentRepositoriesKey = `${siteSelectionKey}:recent-repositories`;
  let initial = defaults;
  try {
    const requested = new URL(window.location.href).searchParams.get('repo');
    if (requested) initial = parseRepository(requested);else {
      const saved = sessionStorage.getItem(siteSelectionKey);
      if (saved) initial = parseRepository(saved);
    }
  } catch {/* Invalid saved selections fall back to local configuration. */}
  let restoredRecentRepositories = [];
  try {
    restoredRecentRepositories = normalizeRecentRepositories(JSON.parse(storage?.getItem(recentRepositoriesKey) || '[]'), initial);
  } catch {/* Recent repositories are optional. */}
  const [recentRepositories, setRecentRepositories] = createSignal(restoredRecentRepositories);
  const [connection, setConnection] = createSignal({
    repository: initial,
    credentials: credentials.get(initial)
  });
  const repository = () => connection().repository;
  const [permitted, setPermitted] = createSignal(false);
  const sessionState = new Map();
  function connect(next, tokens, remember) {
    const saved = credentials.save(next, tokens, remember);
    const recent = recentRepositoriesAfterConnect(recentRepositories(), repository(), next);
    setRecentRepositories(recent);
    try {
      storage?.setItem(recentRepositoriesKey, JSON.stringify(recent.map(repositoryName)));
    } catch {/* Repository switching works without saved history. */}
    try {
      sessionStorage.setItem(siteSelectionKey, repositoryName(next));
    } catch {/* Switching still works without browser storage. */}
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('repo', repositoryName(next));
      history.replaceState(null, '', url);
    } catch {/* URL updates are optional. */}
    batch(() => {
      setPermitted(true);
      setConnection({
        repository: next,
        credentials: saved
      });
    });
  }
  function forget() {
    credentials.forget(repository());
    batch(() => {
      setPermitted(false);
      setConnection({
        repository: repository(),
        credentials: null
      });
    });
  }
  return createComponent(Show, {
    get when() {
      return connection();
    },
    keyed: true,
    children: selected => createComponent(Workspace, {
      get repository() {
        return selected.repository;
      },
      get credentials() {
        return selected.credentials;
      },
      get permitted() {
        return permitted();
      },
      onConnect: connect,
      onForget: forget,
      getCredentials: repo => credentials.get(repo),
      get recentRepositories() {
        return recentRepositories();
      },
      onAccessChange: value => {
        if (connection() === selected) setPermitted(value);
      },
      sessionState: sessionState,
      get discussionsEnabled() {
        return props.discussionsEnabled;
      },
      get projectsEnabled() {
        return props.projectsEnabled;
      }
    })
  });
}
function Workspace(props) {
  const GITHUB_OWNER = props.repository.owner;
  const GITHUB_REPO = props.repository.repo;
  const isConfigured = Boolean(props.credentials?.token && GITHUB_OWNER && GITHUB_REPO);
  const projectsEnabled = props.projectsEnabled === true;
  const isProjectConfigured = projectsEnabled && Boolean(props.credentials?.projectToken);
  const topicSelectionKey = `blackboard:${GITHUB_OWNER}/${GITHUB_REPO}:topic`;
  const milestonesExpandedKey = `blackboard:${GITHUB_OWNER}/${GITHUB_REPO}:milestones-expanded`;
  const sidebarSectionKey = `blackboard:${GITHUB_OWNER}/${GITHUB_REPO}:sidebar-section`;
  const activeMilestoneKey = `blackboard:${GITHUB_OWNER}/${GITHUB_REPO}:milestone`;
  const activeProjectKey = `blackboard:${GITHUB_OWNER}/${GITHUB_REPO}:project`;
  const topicKindKey = `blackboard:${GITHUB_OWNER}/${GITHUB_REPO}:new-topic-kind`;
  const storedTopicId = value => isDiscussionId(value) ? value : Number(value);
  const compareMessages = (a, b) => a.time - b.time || String(a.id).localeCompare(String(b.id), undefined, {
    numeric: true
  });
  function savedTopicKind() {
    try {
      const kind = localStorage.getItem(topicKindKey);
      return ['discussion', 'note', 'list'].includes(kind) ? kind : 'talk';
    } catch {
      return 'talk';
    }
  }
  function savedProject() {
    try {
      const id = sessionStorage.getItem(activeProjectKey);
      return id && id !== 'preview' ? id : null;
    } catch {
      return null;
    }
  }
  function savedMilestone() {
    try {
      const id = Number(sessionStorage.getItem(activeMilestoneKey));
      return Number.isSafeInteger(id) && id > 0 ? id : null;
    } catch {
      return null;
    }
  }
  const formatDueDate = date => new Date(`${date}T00:00:00`).toLocaleDateString([], {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  });
  function savedSidebarSection() {
    try {
      const saved = localStorage.getItem(sidebarSectionKey);
      if (saved !== null) return saved === 'milestones' || projectsEnabled && saved === 'projects' ? saved : null;
      return localStorage.getItem(milestonesExpandedKey) === 'true' ? 'milestones' : null;
    } catch {
      return null;
    }
  }
  function savedTopic() {
    try {
      const id = storedTopicId(sessionStorage.getItem(topicSelectionKey));
      return isDiscussionId(id) || Number.isSafeInteger(id) && id > 0 ? id : null;
    } catch {
      return null;
    }
  }
  const discussionsEnabled = props.discussionsEnabled === true;
  const api = createGitHubClient({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    token: props.credentials?.token || '',
    projectToken: props.credentials?.projectToken || ''
  });
  const topicTracker = createTopicTracker();
  const milestoneTracker = createMilestoneTracker();
  const [topics, setTopics] = createSignal([]);
  const [goalLists, setGoalLists] = createSignal([]);
  const [projects, setProjects] = createSignal([]);
  const [projectsLoading, setProjectsLoading] = createSignal(false);
  const [projectsError, setProjectsError] = createSignal('');
  const [activeProjectId, setActiveProjectId] = createSignal(isConfigured && isProjectConfigured ? savedProject() : null);
  const [returnProjectId, setReturnProjectId] = createSignal(null);
  createEffect(() => {
    if (!projectsEnabled) return;
    const id = activeProjectId();
    try {
      if (id) sessionStorage.setItem(activeProjectKey, id);else sessionStorage.removeItem(activeProjectKey);
    } catch {/* Navigation still works without storage. */}
  });
  const [knownTags, setKnownTags] = createSignal([]);
  const [tagEditing, setTagEditing] = createSignal(null);
  const [tagDrafts, setTagDrafts] = createSignal({});
  const [tagOperations, setTagOperations] = createSignal({});
  const [milestones, setMilestones] = createSignal([]);
  const [milestonesLoaded, setMilestonesLoaded] = createSignal(false);
  const [activeMilestoneId, setActiveMilestoneId] = createSignal(isConfigured ? savedMilestone() : null);
  const selectedMilestone = () => milestones().find(item => item.id === activeMilestoneId());
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
      if (id === null) sessionStorage.removeItem(activeMilestoneKey);else sessionStorage.setItem(activeMilestoneKey, String(id));
    } catch {/* Navigation still works without storage. */}
  });
  const [expandedSidebarSection, setExpandedSidebarSection] = createSignal(savedSidebarSection());
  const milestonesExpanded = () => expandedSidebarSection() === 'milestones';
  const projectsExpanded = () => projectsEnabled && expandedSidebarSection() === 'projects';
  const toggleSidebarSection = section => setExpandedSidebarSection(previous => previous === section ? null : section);
  createEffect(() => {
    const expanded = expandedSidebarSection();
    try {
      localStorage.setItem(sidebarSectionKey, expanded || '');
    } catch {/* The section still toggles when browser storage is unavailable. */}
  });
  const [creatingTopic, setCreatingTopic] = createSignal(false);
  const [topicKind, setTopicKind] = createSignal(savedTopicKind());
  const creationKind = () => topicKind() === 'discussion' && (!discussionsEnabled || topicParent()) ? 'talk' : topicKind();
  function chooseTopicKind(kind) {
    setTopicKind(kind);
    try {
      localStorage.setItem(topicKindKey, kind);
    } catch {/* Storage is optional. */}
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
      if (id === null) sessionStorage.removeItem(topicSelectionKey);else sessionStorage.setItem(topicSelectionKey, String(id));
    } catch {/* Selection still works when browser storage is unavailable. */}
  });
  const [messages, setMessages] = createSignal({});
  const workspaceKey = repositoryKey(props.repository);
  const draftKey = `blackboard:${workspaceKey}:drafts`;
  let restoredDrafts = props.sessionState.get(workspaceKey)?.drafts || {};
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey) || 'null');
    if (saved && typeof saved === 'object' && !Array.isArray(saved)) restoredDrafts = Object.fromEntries(Object.entries(saved).filter(([, value]) => typeof value === 'string'));
  } catch {/* Drafts still survive workspace switches in memory. */}
  const [drafts, setDrafts] = createSignal(restoredDrafts);
  createEffect(() => {
    try {
      sessionStorage.setItem(draftKey, JSON.stringify(drafts()));
    } catch {/* Storage is optional. */}
  });
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
  const ownReaction = type => reactionRecords().find(entry => entry.type === type && entry.author === reactionViewer());
  const [outbox, setOutbox] = createSignal(props.sessionState.get(workspaceKey)?.outbox || {});
  const [projectWriting, setProjectWriting] = createSignal(false);
  const [noteWriting, setNoteWriting] = createSignal(false);
  const [listWriting, setListWriting] = createSignal(false);
  const switchingDisabled = () => creating() || milestoneSaving() || milestoneStateBusy() || reactionBusy() || projectWriting() || noteWriting() || listWriting() || Object.values(assignmentBusy()).some(Boolean) || Object.values(closing()).some(change => change?.status === 'pending') || Object.values(tagOperations()).some(operation => operation?.status === 'pending') || Object.values(outbox()).some(entry => entry?.state === 'pending');
  onCleanup(() => props.sessionState.set(workspaceKey, {
    drafts: drafts(),
    outbox: outbox()
  }));
  const [error, setError] = createSignal('');
  const [syncing, setSyncing] = createSignal(false);
  const [syncFailed, setSyncFailed] = createSignal(false);
  const [lastSync, setLastSync] = createSignal(null);
  const syncDescription = () => !isConfigured ? 'GitHub is not configured' : syncing() ? 'Syncing with GitHub' : syncFailed() ? 'GitHub sync failed; waiting to retry' : lastSync() ? `Last synced ${lastSync().toLocaleString()}` : 'Waiting to sync with GitHub';
  const topic = () => topics().find(item => item.id === activeId());
  const displayedTags = () => {
    const tags = topic()?.tags || [];
    const operation = tagOperations()[activeId()];
    return operation?.target === 'add' && !tags.some(tag => tag.name.toLowerCase() === operation.name.toLowerCase()) ? [...tags, {
      name: operation.name,
      color: '52769b',
      description: ''
    }] : tags;
  };
  const topicMilestoneLabel = () => {
    const id = topic()?.milestoneId;
    return id ? milestones().find(item => item.id === id)?.name || `Goal #${id}` : 'Add to goal';
  };
  const currentGoalProgress = goal => goalProgress(goal, goalLists());
  const listProgressLabel = entry => {
    const progress = listCompletion(entry);
    return `(${progress.complete} / ${progress.total})`;
  };
  const statusLabel = id => {
    const change = closing()[id];
    if (!change) return '';
    return change.status === 'unconfirmed' ? 'Unconfirmed' : {
      closed: 'Closing…',
      open: 'Reopening…',
      archived: 'Archiving…',
      deleted: 'Deleting…'
    }[change.target];
  };
  const statusPending = () => closing()[statusChange()?.id]?.status === 'pending';
  const removalPending = () => closing()[removeTarget()?.id]?.status === 'pending';
  let backdropPointerDown = null;
  function outsideDialog(event) {
    const dialog = event.currentTarget;
    const bounds = dialog.getBoundingClientRect();
    return event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom);
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
    if (!discussionsEnabled) return {
      items: [],
      failure: null
    };
    if (Date.now() < discussionsNextAttempt) return {
      items: discussionSnapshot,
      failure: discussionFailure
    };
    try {
      discussionSnapshot = await api.listDiscussions({
        includeClosed: true,
        includeArchived: true
      });
      discussionFailures = 0;
      discussionFailure = null;
      discussionsNextAttempt = 0;
    } catch (failure) {
      discussionFailure = failure;
      discussionsNextAttempt = Math.max(failure.retryAt || 0, Date.now() + Math.min(120000, POLL_INTERVAL_MS * 2 ** discussionFailures++));
    }
    return {
      items: discussionSnapshot,
      failure: discussionFailure
    };
  }
  onCleanup(() => {
    stopped = true;
  });

  // Never overlap refreshes. Errors back off, while GitHub rate-limit reset
  // times take precedence. Poll only while the tab is visible.
  async function refresh() {
    if (!isConfigured || stopped || syncingNow || Date.now() < nextAttempt) return;
    syncingNow = true;
    setSyncing(true);
    try {
      const revision = channelRevision;
      // These share the issue-list requests, including pagination and conditional reads.
      const [issueChannels, incomingTags, discussionRead] = await Promise.all([api.listChannels({
        includeClosed: true,
        includeArchived: true,
        includeHierarchy: true
      }), api.listTags(), loadDiscussions()]);
      if (stopped) return;
      props.onAccessChange(true);
      // A discussion permission failure must not hide or prevent reading tasks.
      const discussions = discussionRead.items;
      const allChannels = [...issueChannels, ...discussions];
      if (discussionRead.failure) setError(`Discussions: ${discussionRead.failure.message}`);
      if (revision === channelRevision) {
        batch(() => {
          const reconciled = topicTracker.reconcile(allChannels);
          const channels = reconciled.filter(item => !item.archived);
          setTopics(channels);
          setGoalLists(reconciled.filter(item => item.kind === 'list'));
          setKnownTags([...new Map([...incomingTags, ...channels.flatMap(item => item.tags)].map(tag => [tag.name.toLowerCase(), tag])).values()]);
          if (!channels.some(item => item.id === activeId())) {
            setActiveId((channels.find(item => item.state === 'open') || channels[0])?.id ?? null);
          }
          for (const [key, change] of Object.entries(closing())) {
            if (change?.status !== 'unconfirmed') continue;
            const id = storedTopicId(key);
            if (isDiscussionId(id) && discussionRead.failure) continue;
            const item = allChannels.find(entry => entry.id === id);
            const confirmed = change.target === 'deleted' ? !item : change.target === 'archived' ? item?.archived : item?.state === change.target;
            if (confirmed) {
              setClosing(previous => ({
                ...previous,
                [id]: null
              }));
              if (statusChange()?.id === id) statusDialog.close();
              if (removeTarget()?.id === id) removeDialog.close();
            }
          }
          for (const [key, operation] of Object.entries(tagOperations())) {
            if (operation?.status !== 'unconfirmed') continue;
            const item = allChannels.find(entry => entry.id === storedTopicId(key));
            if (!item) continue;
            const present = item.tags.some(tag => tag.name.toLowerCase() === operation.name.toLowerCase());
            if (present === (operation.target === 'add')) setTagOperations(previous => ({
              ...previous,
              [key]: null
            }));
          }
        });
      }
      const milestoneReadRevision = milestoneRevision;
      const incomingMilestones = await api.listMilestones({
        includeClosed: true
      });
      if (stopped) return;
      if (milestoneReadRevision === milestoneRevision) {
        setMilestones(milestoneTracker.reconcile(incomingMilestones));
        setMilestonesLoaded(true);
      }
      if (activeMilestoneId() === null && activeProjectId() === null && !['note', 'list'].includes(topic()?.kind)) await loadMessages(activeId());
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
    setMessages(previous => {
      const merged = new Map([...(previous[id] || []), ...incoming].map(item => [item.id, item]));
      return {
        ...previous,
        [id]: [...merged.values()].sort(compareMessages)
      };
    });
  }
  async function selectTopic(id, fromProject = null) {
    setActiveProjectId(null);
    setReturnProjectId(fromProject);
    setTagEditing(null);
    setActiveMilestoneId(null);
    setCollapsedTopics(previous => {
      const next = new Set(previous);
      const seen = new Set();
      let parent = topics().find(item => item.id === id)?.parentId;
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        next.delete(parent);
        parent = topics().find(item => item.id === parent)?.parentId;
      }
      return next;
    });
    setActiveId(id);
    if (!['note', 'list'].includes(topics().find(item => item.id === id)?.kind)) {
      try {
        await loadMessages(id);
      } catch (failure) {
        if (!stopped) setError(failure.message);
      }
    }
  }
  function selectMilestone(id) {
    setActiveProjectId(null);
    setReturnProjectId(null);
    setTagEditing(null);
    setActiveMilestoneId(id);
  }
  async function loadProjects(force = false) {
    if (!projectsEnabled || !isProjectConfigured || stopped || projectsLoading() || !force && Date.now() < projectsNextAttempt) return;
    setProjectsLoading(true);
    try {
      const incoming = await api.listProjects();
      if (!stopped) {
        setProjects(incoming);
        setProjectsError('');
      }
      projectFailures = 0;
      projectsNextAttempt = Date.now() + 30000;
    } catch (failure) {
      if (!stopped) setProjectsError(failure.message);
      projectFailures++;
      projectsNextAttempt = Math.max(failure.retryAt || 0, Date.now() + Math.min(120000, 10000 * 2 ** (projectFailures - 1)));
    } finally {
      if (!stopped) setProjectsLoading(false);
    }
  }
  function selectProject(id) {
    if (!projectsEnabled) return;
    setActiveMilestoneId(null);
    setReturnProjectId(null);
    setTagEditing(null);
    setExpandedSidebarSection('projects');
    setActiveProjectId(id);
  }
  createEffect(() => {
    if (projectsExpanded()) queueMicrotask(() => loadProjects());
  });
  function startTag() {
    const id = activeId();
    if (tagOperations()[id]) return;
    setTagEditing(id);
  }
  async function changeTag(id, name, target) {
    name = name.trim();
    if (!name || tagOperations()[id]) return;
    if (target === 'add' && topics().find(item => item.id === id)?.tags.some(tag => tag.name.toLowerCase() === name.toLowerCase())) {
      setTagEditing(null);
      setTagDrafts(previous => ({
        ...previous,
        [id]: ''
      }));
      return;
    }
    setTagOperations(previous => ({
      ...previous,
      [id]: {
        name,
        target,
        status: 'pending'
      }
    }));
    if (target === 'add') {
      setTagEditing(null);
      setTagDrafts(previous => ({
        ...previous,
        [id]: ''
      }));
    }
    try {
      const tags = await (target === 'add' ? api.addChannelTag(id, name) : api.removeChannelTag(id, name));
      rememberChange({
        id,
        tags
      });
      setKnownTags(previous => [...new Map([...previous, ...tags].map(tag => [tag.name.toLowerCase(), tag])).values()]);
      setTagOperations(previous => ({
        ...previous,
        [id]: null
      }));
      refresh();
    } catch (failure) {
      const unconfirmed = failure.uncertain && !failure.tagNotApplied;
      setTagOperations(previous => ({
        ...previous,
        [id]: unconfirmed ? {
          name,
          target,
          status: 'unconfirmed'
        } : null
      }));
      if (target === 'add' && !unconfirmed) {
        setTagDrafts(previous => ({
          ...previous,
          [id]: name
        }));
        if (activeId() === id && activeMilestoneId() === null) setTagEditing(id);
      }
      setError(failure.message);
    }
  }
  function rememberMilestone(item) {
    milestoneRevision++;
    const updated = milestoneTracker.remember(item);
    setMilestones(previous => sortMilestones([...previous.filter(entry => entry.id !== item.id), updated]));
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
      const details = {
        name: milestoneName(),
        description: milestoneDescription(),
        dueDate: milestoneDueDate() || null
      };
      const saved = await (editing ? api.updateMilestone(editing.id, details) : api.createMilestone(details));
      rememberMilestone(saved);
      setExpandedSidebarSection('milestones');
      selectMilestone(saved.id);
      milestoneDialog.close();
      refresh();
    } catch (failure) {
      setMilestoneUncertain(Boolean(failure.uncertain));
      setMilestoneFormError(failure.message);
    } finally {
      setMilestoneSaving(false);
    }
  }
  async function toggleMilestoneState() {
    const item = selectedMilestone();
    if (!item || milestoneStateBusy()) return;
    setMilestoneStateBusy(true);
    try {
      rememberMilestone(await api.updateMilestone(item.id, {
        state: item.state === 'open' ? 'closed' : 'open'
      }));
      refresh();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setMilestoneStateBusy(false);
    }
  }
  async function assignMilestone(id, milestoneId) {
    if (assignmentBusy()[id]) return;
    setAssignmentBusy(previous => ({
      ...previous,
      [id]: true
    }));
    try {
      const updated = await api.setChannelMilestone(id, milestoneId);
      rememberChange({
        ...updated,
        parentId: topics().find(item => item.id === id)?.parentId ?? null
      });
      refresh();
    } catch (failure) {
      setError(failure.message);
    } finally {
      setAssignmentBusy(previous => ({
        ...previous,
        [id]: false
      }));
    }
  }
  function MilestoneOverview() {
    const linkedTopics = () => topics().filter(item => item.milestoneId === activeMilestoneId());
    return createComponent(Show, {
      get when() {
        return selectedMilestone();
      },
      get fallback() {
        return (() => {
          var _el$ = _tmpl$2(),
            _el$2 = _el$.firstChild,
            _el$4 = _el$2.nextSibling;
          insert(_el$2, () => milestonesLoaded() ? 'Goal unavailable' : 'Loading goal…');
          insert(_el$, createComponent(Show, {
            get when() {
              return error();
            },
            get children() {
              var _el$3 = _tmpl$();
              insert(_el$3, error);
              return _el$3;
            }
          }), _el$4);
          _el$4.$$click = () => setActiveMilestoneId(null);
          return _el$;
        })();
      },
      children: item => (() => {
        var _el$5 = _tmpl$6(),
          _el$6 = _el$5.firstChild,
          _el$7 = _el$6.firstChild,
          _el$8 = _el$7.nextSibling,
          _el$9 = _el$8.nextSibling,
          _el$0 = _el$9.firstChild,
          _el$12 = _el$6.nextSibling,
          _el$13 = _el$12.firstChild,
          _el$14 = _el$13.firstChild;
          _el$14.firstChild;
          var _el$16 = _el$14.nextSibling,
          _el$19 = _el$13.nextSibling,
          _el$20 = _el$19.firstChild,
          _el$21 = _el$20.firstChild,
          _el$23 = _el$21.nextSibling;
          _el$23.nextSibling;
          var _el$24 = _el$19.nextSibling,
          _el$25 = _el$24.nextSibling,
          _el$26 = _el$25.firstChild,
          _el$27 = _el$26.nextSibling;
          _el$27.firstChild;
        insert(_el$7, () => item().name);
        insert(_el$5, createComponent(Show, {
          get when() {
            return error();
          },
          get children() {
            var _el$1 = _tmpl$3(),
              _el$10 = _el$1.firstChild,
              _el$11 = _el$10.nextSibling;
            insert(_el$1, error, _el$10);
            _el$11.$$click = () => setError('');
            return _el$1;
          }
        }), _el$12);
        _el$14.$$click = toggleMilestoneState;
        insert(_el$14, () => item().state === 'open' ? 'Open' : 'Closed', null);
        _el$16.$$click = () => editMilestone(item());
        insert(_el$12, createComponent(Show, {
          get when() {
            return item().description;
          },
          get children() {
            return createComponent(MessageText, {
              get text() {
                return item().description;
              }
            });
          }
        }), _el$19);
        insert(_el$12, createComponent(Show, {
          get when() {
            return item().dueDate;
          },
          get children() {
            var _el$17 = _tmpl$4();
              _el$17.firstChild;
            insert(_el$17, () => formatDueDate(item().dueDate), null);
            return _el$17;
          }
        }), _el$19);
        insert(_el$20, () => currentGoalProgress(item()).complete, _el$21);
        insert(_el$20, () => currentGoalProgress(item()).total, _el$23);
        _el$27.addEventListener("change", event => {
          const id = Number(event.currentTarget.value);
          if (id) assignMilestone(id, item().id);
          event.currentTarget.value = '';
        });
        _el$27.disabled = !isConfigured;
        insert(_el$27, createComponent(For, {
          get each() {
            return topics().filter(entry => entry.kind !== 'discussion' && entry.milestoneId !== item().id);
          },
          children: entry => (() => {
            var _el$30 = _tmpl$7();
            insert(_el$30, () => entry.name, null);
            insert(_el$30, () => entry.milestoneId ? ' (move here)' : '', null);
            createRenderEffect(() => _el$30.disabled = assignmentBusy()[entry.id]);
            createRenderEffect(() => _el$30.value = entry.id);
            return _el$30;
          })()
        }), null);
        insert(_el$12, createComponent(Show, {
          get when() {
            return linkedTopics().length;
          },
          get fallback() {
            return _tmpl$8();
          },
          get children() {
            var _el$29 = _tmpl$5();
            insert(_el$29, createComponent(For, {
              get each() {
                return linkedTopics();
              },
              children: entry => (() => {
                var _el$32 = _tmpl$0(),
                  _el$33 = _el$32.firstChild,
                  _el$34 = _el$33.firstChild,
                  _el$35 = _el$34.firstChild,
                  _el$37 = _el$34.nextSibling,
                  _el$38 = _el$33.nextSibling;
                _el$33.$$click = () => selectTopic(entry.id);
                insert(_el$34, () => entry.name, null);
                insert(_el$34, createComponent(Show, {
                  get when() {
                    return entry.kind === 'list';
                  },
                  get children() {
                    var _el$36 = _tmpl$9();
                    insert(_el$36, () => listProgressLabel(entry));
                    return _el$36;
                  }
                }), null);
                insert(_el$37, () => entry.state === 'open' ? 'Open' : 'Closed');
                _el$38.$$click = () => assignMilestone(entry.id, null);
                createRenderEffect(_p$ => {
                  var _v$9 = !!(assignmentBusy()[entry.id] || entry.syncState === 'confirming'),
                    _v$0 = !!(entry.state !== 'open'),
                    _v$1 = assignmentBusy()[entry.id],
                    _v$10 = `Remove ${entry.name} from goal`;
                  _v$9 !== _p$.e && _el$32.classList.toggle("is-pending", _p$.e = _v$9);
                  _v$0 !== _p$.t && _el$35.classList.toggle("is-closed", _p$.t = _v$0);
                  _v$1 !== _p$.a && (_el$38.disabled = _p$.a = _v$1);
                  _v$10 !== _p$.o && setAttribute(_el$38, "aria-label", _p$.o = _v$10);
                  return _p$;
                }, {
                  e: undefined,
                  t: undefined,
                  a: undefined,
                  o: undefined
                });
                return _el$32;
              })()
            }));
            return _el$29;
          }
        }), null);
        createRenderEffect(_p$ => {
          var _v$ = `${item().name} goal`,
            _v$2 = item().url,
            _v$3 = !!(item().state === 'closed'),
            _v$4 = !!milestoneStateBusy(),
            _v$5 = milestoneStateBusy(),
            _v$6 = item().state === 'open' ? 'Close goal' : 'Reopen goal',
            _v$7 = milestoneStateBusy(),
            _v$8 = `${item().name}: ${currentGoalProgress(item()).complete} of ${currentGoalProgress(item()).total} complete`;
          _v$ !== _p$.e && setAttribute(_el$5, "aria-label", _p$.e = _v$);
          _v$2 !== _p$.t && setAttribute(_el$0, "href", _p$.t = _v$2);
          _v$3 !== _p$.a && _el$14.classList.toggle("is-closed", _p$.a = _v$3);
          _v$4 !== _p$.o && _el$14.classList.toggle("is-pending", _p$.o = _v$4);
          _v$5 !== _p$.i && (_el$14.disabled = _p$.i = _v$5);
          _v$6 !== _p$.n && setAttribute(_el$14, "title", _p$.n = _v$6);
          _v$7 !== _p$.s && (_el$16.disabled = _p$.s = _v$7);
          _v$8 !== _p$.h && setAttribute(_el$24, "aria-label", _p$.h = _v$8);
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined,
          i: undefined,
          n: undefined,
          s: undefined,
          h: undefined
        });
        createRenderEffect(() => _el$24.value = currentGoalProgress(item()).percent);
        return _el$5;
      })()
    });
  }
  function replyTo(message) {
    const id = activeId();
    setDrafts(previous => {
      const existing = previous[id] || '';
      return {
        ...previous,
        [id]: `${existing}${existing ? '\n\n' : ''}${quoteReply(message)}`
      };
    });
    composerInput.focus();
    composerInput.setSelectionRange(composerInput.value.length, composerInput.value.length);
  }
  function MessageText(props) {
    const isDeclaredSender = name => currentMessages().some(message => message.sender?.toLowerCase() === name.toLowerCase() && message.author.toLowerCase() !== name.toLowerCase());
    const Inline = inlineProps => createComponent(For, {
      get each() {
        return messageTokens(inlineProps.text);
      },
      children: token => {
        if (token.type === 'code') return (() => {
          var _el$39 = _tmpl$1();
          insert(_el$39, () => token.text);
          return _el$39;
        })();
        if (token.type === 'link') return (() => {
          var _el$40 = _tmpl$10();
          insert(_el$40, () => token.text);
          createRenderEffect(() => setAttribute(_el$40, "href", token.url));
          return _el$40;
        })();
        if (token.type === 'mention') return createComponent(Show, {
          get when() {
            return !isDeclaredSender(token.name);
          },
          get fallback() {
            return (() => {
              var _el$42 = _tmpl$12();
              insert(_el$42, () => token.text);
              return _el$42;
            })();
          },
          get children() {
            var _el$41 = _tmpl$11();
            insert(_el$41, () => token.text);
            createRenderEffect(() => setAttribute(_el$41, "href", `https://github.com/${encodeURIComponent(token.name)}`));
            return _el$41;
          }
        });
        return token.text;
      }
    });
    return (() => {
      var _el$43 = _tmpl$13();
      insert(_el$43, createComponent(For, {
        get each() {
          return messageBlocks(props.text);
        },
        children: block => block.quote ? (() => {
          var _el$44 = _tmpl$14();
          insert(_el$44, createComponent(Inline, {
            get text() {
              return block.text;
            }
          }));
          return _el$44;
        })() : (() => {
          var _el$45 = _tmpl$15();
          insert(_el$45, createComponent(Inline, {
            get text() {
              return block.text;
            }
          }));
          return _el$45;
        })()
      }));
      return _el$43;
    })();
  }
  function TopicMarker(props) {
    const type = props.kind === 'note' ? 'Note' : props.kind === 'list' ? 'List' : props.kind === 'discussion' ? 'Discussion' : 'Talk';
    return (() => {
      var _el$46 = _tmpl$17();
      setAttribute(_el$46, "title", type);
      setAttribute(_el$46, "aria-label", type);
      insert(_el$46, createComponent(Show, {
        get when() {
          return props.kind === 'list';
        },
        get fallback() {
          return createComponent(Show, {
            get when() {
              return props.kind === 'note';
            },
            get fallback() {
              return createComponent(Show, {
                get when() {
                  return props.kind === 'discussion';
                },
                get fallback() {
                  return _tmpl$20();
                },
                get children() {
                  return _tmpl$19();
                }
              });
            },
            get children() {
              return _tmpl$18();
            }
          });
        },
        get children() {
          return _tmpl$16();
        }
      }));
      return _el$46;
    })();
  }
  async function openReactions(commentId) {
    const version = ++reactionLoadVersion;
    setReactionTarget({
      commentId,
      channelId: activeId()
    });
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
        records = reactionRecords().filter(entry => entry.id !== existing.id);
      } else {
        const added = await api.addReaction(target.commentId, type);
        records = [...reactionRecords().filter(entry => entry.id !== added.id), added];
      }
      const types = Object.keys(reactionSymbols).filter(key => records.some(entry => entry.type === key));
      messageRevisions.set(target.channelId, (messageRevisions.get(target.channelId) || 0) + 1);
      setMessages(previous => ({
        ...previous,
        [target.channelId]: (previous[target.channelId] || []).map(message => message.id === target.commentId ? {
          ...message,
          reactions: types
        } : message)
      }));
      reactionDialog.close();
    } catch (failure) {
      // Reaction create/delete is idempotent. Reload ownership before allowing
      // another action if delivery is uncertain, rather than guessing a toggle.
      setReactionError(failure.message);
      if (failure.uncertain) setReactionViewer(null);
    } finally {
      setReactionBusy(false);
    }
  }
  onMount(() => {
    const refreshVisible = () => {
      if (!document.hidden) refresh();
    };
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
    setCollapsedTopics(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);else next.add(id);
      return next;
    });
  }
  function rememberChange(change) {
    const previous = topics().find(item => item.id === change.id);
    const updated = topicTracker.remember({
      ...previous,
      ...change,
      parentId: change.parentId === undefined ? previous?.parentId ?? null : change.parentId
    });
    channelRevision += 1;
    setTopics(items => items.map(item => item.id === updated.id ? updated : item).filter(item => !item.archived));
    if (updated.kind === 'list') setGoalLists(items => [...items.filter(item => item.id !== updated.id), updated]);
  }
  async function createTopic(event) {
    event.preventDefault();
    const name = topicName().trim();
    if (!name || creating() || createUncertain() || !isConfigured) return;
    setCreating(true);
    const parentId = topicParent()?.id ?? null;
    const kind = creationKind();
    setPendingTopic({
      name,
      parentId,
      kind,
      status: 'creating'
    });
    setError('');
    try {
      const created = topicTracker.remember(await (kind === 'discussion' ? api.createDiscussion({
        name
      }) : api.createChannel({
        name,
        parentId,
        kind
      })));
      channelRevision += 1;
      batch(() => {
        setTopics(previous => [...previous.filter(item => item.id !== created.id), created]);
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
        setTopics(previous => [...previous.filter(item => item.id !== created.id), created]);
        setActiveId(created.id);
        setPendingTopic(null);
        setCreating(false);
        closeTopicForm();
        setError(failure.message);
        return;
      }
      setCreateUncertain(failure.uncertain);
      setPendingTopic(failure.uncertain ? {
        name,
        parentId,
        kind,
        status: 'unconfirmed'
      } : null);
      setError(failure.message);
    } finally {
      setCreating(false);
    }
  }
  function requestStatusChange(item) {
    if (closing()[item.id] || !isConfigured) return;
    setStatusError('');
    setStatusChange({
      id: item.id,
      name: item.name,
      target: item.state === 'open' ? 'closed' : 'open'
    });
    statusDialog.showModal();
  }
  function requestRemoval(item) {
    if (closing()[item.id] || !isConfigured) return;
    setRemoveError('');
    setConfirmDelete(false);
    setRemoveTarget({
      id: item.id,
      name: item.name
    });
    removeDialog.showModal();
  }
  async function confirmRemoval(target) {
    const item = removeTarget();
    if (!item || closing()[item.id]) return;
    const id = item.id;
    setClosing(previous => ({
      ...previous,
      [id]: {
        target,
        status: 'pending'
      }
    }));
    setRemoveError('');
    try {
      if (target === 'deleted') await api.deleteChannelPreservingChildren(id, rememberChange);else await api.archiveChannelTree(id, rememberChange);
      if (target === 'deleted') {
        topicTracker.remove(id);
        setGoalLists(items => items.filter(item => item.id !== id));
      }
      channelRevision += 1;
      batch(() => {
        const remaining = topics().filter(entry => entry.id !== id);
        setTopics(remaining);
        if (!remaining.some(entry => entry.id === activeId())) setActiveId((remaining.find(entry => entry.state === 'open') || remaining[0])?.id ?? null);
        setClosing(previous => ({
          ...previous,
          [id]: null
        }));
      });
      removeDialog.close();
      newTopicButton.focus();
      try {
        await loadMessages(activeId());
      } catch (failure) {
        setError(failure.message);
      }
    } catch (failure) {
      if (!topics().some(entry => entry.id === activeId())) setActiveId(topics()[0]?.id ?? null);
      const affectedId = failure.affectedChannelId ?? id;
      setClosing(previous => ({
        ...previous,
        [id]: null,
        [affectedId]: failure.uncertain && !failure.deletionNotAttempted ? {
          target,
          status: 'unconfirmed'
        } : null
      }));
      setRemoveError(failure.uncertain ? 'Change unconfirmed. We’ll check during the next sync. Check GitHub before repeating this action.' : failure.message);
    }
  }
  async function confirmStatusChange(event) {
    event.preventDefault();
    const change = statusChange();
    if (!change || closing()[change.id]) return;
    const {
      id,
      target
    } = change;
    setClosing(previous => ({
      ...previous,
      [id]: {
        target,
        status: 'pending'
      }
    }));
    setStatusError('');
    try {
      if (target === 'closed') await api.closeChannelTree(id, rememberChange);else rememberChange({
        ...(await api.reopenChannel(id)),
        parentId: topics().find(item => item.id === id)?.parentId ?? null
      });
      channelRevision += 1;
      batch(() => {
        setClosing(previous => ({
          ...previous,
          [id]: null
        }));
      });
      statusDialog.close();
    } catch (failure) {
      const affectedId = failure.affectedChannelId ?? id;
      setClosing(previous => ({
        ...previous,
        [id]: null,
        [affectedId]: failure.uncertain ? {
          target,
          status: 'unconfirmed'
        } : null
      }));
      setStatusError(failure.uncertain ? 'Change unconfirmed. We’ll check GitHub during the next sync. You can dismiss this dialog; avoid repeating the action until confirmed.' : failure.message);
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
    const pending = {
      text,
      time: new Date(),
      state: 'pending'
    };
    setOutbox(previous => ({
      ...previous,
      [id]: pending
    }));
    setDrafts(previous => ({
      ...previous,
      [id]: ''
    }));
    setError('');
    try {
      const sent = await api.sendMessage(id, text);
      setMessages(previous => ({
        ...previous,
        [id]: [...(previous[id] || []).filter(item => item.id !== sent.id), sent].sort(compareMessages)
      }));
      setOutbox(previous => ({
        ...previous,
        [id]: null
      }));
    } catch (failure) {
      if (failure.uncertain) {
        setOutbox(previous => ({
          ...previous,
          [id]: {
            ...pending,
            state: 'unconfirmed'
          }
        }));
      } else {
        setOutbox(previous => ({
          ...previous,
          [id]: null
        }));
        setDrafts(previous => ({
          ...previous,
          [id]: text + (previous[id] ? `\n${previous[id]}` : '')
        }));
      }
      setError(failure.message);
    }
  }
  return (() => {
    var _el$51 = _tmpl$28(),
      _el$52 = _el$51.firstChild,
      _el$53 = _el$52.firstChild,
      _el$54 = _el$53.firstChild,
      _el$71 = _el$53.nextSibling,
      _el$72 = _el$71.nextSibling,
      _el$81 = _el$72.nextSibling,
      _el$82 = _el$81.firstChild,
      _el$83 = _el$82.firstChild,
      _el$84 = _el$83.nextSibling,
      _el$85 = _el$84.firstChild,
      _el$86 = _el$82.nextSibling,
      _el$87 = _el$86.firstChild,
      _el$88 = _el$87.firstChild,
      _el$90 = _el$81.nextSibling,
      _el$91 = _el$90.firstChild,
      _el$92 = _el$52.nextSibling,
      _el$93 = _el$92.firstChild,
      _el$94 = _el$93.firstChild,
      _el$95 = _el$94.nextSibling,
      _el$96 = _el$95.nextSibling,
      _el$97 = _el$96.nextSibling,
      _el$98 = _el$97.nextSibling,
      _el$99 = _el$98.nextSibling,
      _el$100 = _el$99.nextSibling,
      _el$102 = _el$100.nextSibling,
      _el$103 = _el$102.firstChild,
      _el$104 = _el$103.nextSibling,
      _el$105 = _el$92.nextSibling,
      _el$106 = _el$105.nextSibling,
      _el$107 = _el$106.firstChild,
      _el$108 = _el$107.nextSibling,
      _el$111 = _el$108.nextSibling,
      _el$112 = _el$111.firstChild,
      _el$113 = _el$106.nextSibling;
    insert(_el$52, createComponent(RepositorySelector, {
      get repository() {
        return props.repository;
      },
      get credentials() {
        return props.credentials;
      },
      get permitted() {
        return props.permitted;
      },
      get getCredentials() {
        return props.getCredentials;
      },
      get onConnect() {
        return props.onConnect;
      },
      get onForget() {
        return props.onForget;
      },
      get recentRepositories() {
        return props.recentRepositories;
      },
      get switchDisabled() {
        return switchingDisabled();
      },
      projectsEnabled: projectsEnabled
    }), _el$53);
    _el$54.$$click = () => creatingTopic() ? closeTopicForm() : startTopic();
    var _ref$ = newTopicButton;
    typeof _ref$ === "function" ? use(_ref$, _el$54) : newTopicButton = _el$54;
    _el$54.disabled = !isConfigured;
    insert(_el$53, createComponent(Show, {
      get when() {
        return creatingTopic();
      },
      get children() {
        var _el$55 = _tmpl$22(),
          _el$56 = _el$55.firstChild,
          _el$57 = _el$56.nextSibling,
          _el$58 = _el$57.nextSibling,
          _el$59 = _el$58.firstChild,
          _el$60 = _el$59.nextSibling,
          _el$61 = _el$60.firstChild,
          _el$62 = _el$60.nextSibling,
          _el$63 = _el$62.firstChild,
          _el$64 = _el$62.nextSibling,
          _el$65 = _el$64.firstChild,
          _el$68 = _el$58.nextSibling,
          _el$69 = _el$68.firstChild,
          _el$70 = _el$69.nextSibling;
        _el$55.$$keydown = event => {
          if (event.key === 'Escape') closeTopicForm();
        };
        _el$55.addEventListener("submit", createTopic);
        insert(_el$56, () => topicParent() ? 'Sub-topic name' : 'Topic name');
        insert(_el$55, createComponent(Show, {
          get when() {
            return topicParent();
          },
          children: parent => (() => {
            var _el$114 = _tmpl$29();
              _el$114.firstChild;
            insert(_el$114, () => parent().name, null);
            return _el$114;
          })()
        }), _el$57);
        _el$57.$$input = event => setTopicName(event.currentTarget.value);
        use(element => requestAnimationFrame(() => element.focus()), _el$57);
        _el$61.addEventListener("change", () => chooseTopicKind('talk'));
        _el$63.addEventListener("change", () => chooseTopicKind('list'));
        _el$65.addEventListener("change", () => chooseTopicKind('note'));
        insert(_el$58, createComponent(Show, {
          get when() {
            return discussionsEnabled && !topicParent();
          },
          get children() {
            var _el$66 = _tmpl$21(),
              _el$67 = _el$66.firstChild;
            _el$67.addEventListener("change", () => chooseTopicKind('discussion'));
            createRenderEffect(() => _el$67.checked = creationKind() === 'discussion');
            return _el$66;
          }
        }), null);
        _el$69.$$click = closeTopicForm;
        insert(_el$70, (() => {
          var _c$ = memo(() => !!creating());
          return () => _c$() ? 'Creating…' : createUncertain() ? 'Unconfirmed' : 'Create';
        })());
        createRenderEffect(_p$ => {
          var _v$11 = creating() || createUncertain(),
            _v$12 = !!(discussionsEnabled && !topicParent()),
            _v$13 = creating() || createUncertain(),
            _v$14 = creating(),
            _v$15 = !topicName().trim() || creating() || createUncertain();
          _v$11 !== _p$.e && (_el$57.disabled = _p$.e = _v$11);
          _v$12 !== _p$.t && _el$58.classList.toggle("with-discussions", _p$.t = _v$12);
          _v$13 !== _p$.a && (_el$58.disabled = _p$.a = _v$13);
          _v$14 !== _p$.o && (_el$69.disabled = _p$.o = _v$14);
          _v$15 !== _p$.i && (_el$70.disabled = _p$.i = _v$15);
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined,
          i: undefined
        });
        createRenderEffect(() => _el$57.value = topicName());
        createRenderEffect(() => _el$61.checked = creationKind() === 'talk');
        createRenderEffect(() => _el$63.checked = creationKind() === 'list');
        createRenderEffect(() => _el$65.checked = creationKind() === 'note');
        return _el$55;
      }
    }), null);
    insert(_el$72, createComponent(For, {
      get each() {
        return visibleTopics();
      },
      children: item => (() => {
        var _el$116 = _tmpl$33(),
          _el$118 = _el$116.firstChild,
          _el$121 = _el$118.nextSibling;
        insert(_el$116, createComponent(Show, {
          get when() {
            return item.hasChildren;
          },
          get fallback() {
            return _tmpl$34();
          },
          get children() {
            var _el$117 = _tmpl$30();
            _el$117.$$click = () => toggleTopic(item.id);
            insert(_el$117, () => collapsedTopics().has(item.id) ? '›' : '⌄');
            createRenderEffect(_p$ => {
              var _v$37 = `${collapsedTopics().has(item.id) ? 'Expand' : 'Collapse'} ${item.name}`,
                _v$38 = !collapsedTopics().has(item.id);
              _v$37 !== _p$.e && setAttribute(_el$117, "aria-label", _p$.e = _v$37);
              _v$38 !== _p$.t && setAttribute(_el$117, "aria-expanded", _p$.t = _v$38);
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$117;
          }
        }), _el$118);
        _el$118.$$click = () => selectTopic(item.id);
        insert(_el$118, createComponent(TopicMarker, {
          get kind() {
            return item.kind;
          }
        }), null);
        insert(_el$118, () => item.name, null);
        insert(_el$118, createComponent(Show, {
          get when() {
            return closing()[item.id] || item.state === 'closed';
          },
          get children() {
            var _el$119 = _tmpl$31();
            insert(_el$119, () => statusLabel(item.id) || 'Closed');
            return _el$119;
          }
        }), null);
        insert(_el$116, createComponent(Show, {
          get when() {
            return item.kind !== 'discussion';
          },
          get children() {
            var _el$120 = _tmpl$32();
            _el$120.$$click = () => startTopic(item);
            createRenderEffect(_p$ => {
              var _v$39 = Boolean(closing()[item.id]) || creating() || createUncertain() || !isConfigured,
                _v$40 = `Create subtopic under ${item.name}`;
              _v$39 !== _p$.e && (_el$120.disabled = _p$.e = _v$39);
              _v$40 !== _p$.t && setAttribute(_el$120, "aria-label", _p$.t = _v$40);
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$120;
          }
        }), _el$121);
        _el$121.$$click = () => requestRemoval(item);
        createRenderEffect(_p$ => {
          var _v$41 = `${Math.min(item.depth, 5) * 16}px`,
            _v$42 = !!(activeProjectId() === null && activeMilestoneId() === null && activeId() === item.id),
            _v$43 = !!(Boolean(closing()[item.id]) || item.syncState === 'confirming'),
            _v$44 = closing()[item.id]?.status === 'pending' || item.syncState === 'confirming',
            _v$45 = activeProjectId() === null && activeMilestoneId() === null && activeId() === item.id ? 'page' : undefined,
            _v$46 = Boolean(closing()[item.id]),
            _v$47 = `Remove topic ${item.name}`,
            _v$48 = `Remove topic ${item.name}`;
          _v$41 !== _p$.e && setStyleProperty(_el$116, "margin-left", _p$.e = _v$41);
          _v$42 !== _p$.t && _el$116.classList.toggle("is-active", _p$.t = _v$42);
          _v$43 !== _p$.a && _el$116.classList.toggle("is-pending", _p$.a = _v$43);
          _v$44 !== _p$.o && setAttribute(_el$116, "aria-busy", _p$.o = _v$44);
          _v$45 !== _p$.i && setAttribute(_el$118, "aria-current", _p$.i = _v$45);
          _v$46 !== _p$.n && (_el$121.disabled = _p$.n = _v$46);
          _v$47 !== _p$.s && setAttribute(_el$121, "aria-label", _p$.s = _v$47);
          _v$48 !== _p$.h && setAttribute(_el$121, "title", _p$.h = _v$48);
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined,
          i: undefined,
          n: undefined,
          s: undefined,
          h: undefined
        });
        return _el$116;
      })()
    }), null);
    insert(_el$72, createComponent(Show, {
      get when() {
        return pendingTopic();
      },
      children: pending => (() => {
        var _el$123 = _tmpl$35(),
          _el$124 = _el$123.firstChild,
          _el$125 = _el$124.nextSibling,
          _el$126 = _el$125.firstChild;
        insert(_el$125, createComponent(TopicMarker, {
          get kind() {
            return pending().kind;
          }
        }), _el$126);
        insert(_el$125, () => pending().name, _el$126);
        insert(_el$126, () => pending().status === 'creating' ? 'Creating…' : 'Unconfirmed');
        createRenderEffect(_p$ => {
          var _v$49 = pending().parentId ? `${Math.min((visibleTopics().find(item => item.id === pending().parentId)?.depth ?? 0) + 1, 5) * 16}px` : '0',
            _v$50 = pending().status === 'creating';
          _v$49 !== _p$.e && setStyleProperty(_el$123, "margin-left", _p$.e = _v$49);
          _v$50 !== _p$.t && setAttribute(_el$123, "aria-busy", _p$.t = _v$50);
          return _p$;
        }, {
          e: undefined,
          t: undefined
        });
        return _el$123;
      })()
    }), null);
    insert(_el$52, createComponent(Show, {
      when: projectsEnabled,
      get children() {
        var _el$73 = _tmpl$24(),
          _el$74 = _el$73.firstChild,
          _el$75 = _el$74.firstChild,
          _el$76 = _el$75.nextSibling,
          _el$77 = _el$76.firstChild,
          _el$78 = _el$74.nextSibling,
          _el$80 = _el$78.firstChild;
        _el$74.$$click = () => toggleSidebarSection('projects');
        insert(_el$78, createComponent(Show, {
          get when() {
            return projectsError();
          },
          get children() {
            var _el$79 = _tmpl$23();
            insert(_el$79, projectsError);
            return _el$79;
          }
        }), _el$80);
        insert(_el$80, createComponent(For, {
          get each() {
            return projects();
          },
          children: item => (() => {
            var _el$127 = _tmpl$37(),
              _el$128 = _el$127.firstChild;
            _el$127.$$click = () => selectProject(item.id);
            insert(_el$128, () => item.name);
            insert(_el$127, createComponent(Show, {
              get when() {
                return item.closed;
              },
              get children() {
                return _tmpl$36();
              }
            }), null);
            createRenderEffect(_p$ => {
              var _v$51 = !!(activeProjectId() === item.id),
                _v$52 = activeProjectId() === item.id ? 'page' : undefined;
              _v$51 !== _p$.e && _el$127.classList.toggle("is-active", _p$.e = _v$51);
              _v$52 !== _p$.t && setAttribute(_el$127, "aria-current", _p$.t = _v$52);
              return _p$;
            }, {
              e: undefined,
              t: undefined
            });
            return _el$127;
          })()
        }));
        createRenderEffect(_p$ => {
          var _v$16 = !!projectsExpanded(),
            _v$17 = projectsExpanded(),
            _v$18 = projectsExpanded() ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6',
            _v$19 = !projectsExpanded();
          _v$16 !== _p$.e && _el$73.classList.toggle("is-expanded", _p$.e = _v$16);
          _v$17 !== _p$.t && setAttribute(_el$74, "aria-expanded", _p$.t = _v$17);
          _v$18 !== _p$.a && setAttribute(_el$77, "d", _p$.a = _v$18);
          _v$19 !== _p$.o && (_el$78.hidden = _p$.o = _v$19);
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined
        });
        return _el$73;
      }
    }), _el$81);
    _el$82.$$click = () => toggleSidebarSection('milestones');
    _el$88.$$click = () => editMilestone();
    _el$88.disabled = !isConfigured;
    insert(_el$86, createComponent(Show, {
      get when() {
        return milestones().length;
      },
      get fallback() {
        return (() => {
          var _el$130 = _tmpl$38();
          insert(_el$130, () => !isConfigured ? 'Connect to GitHub to load goals.' : milestonesLoaded() ? 'No goals yet.' : 'Loading goals…');
          return _el$130;
        })();
      },
      get children() {
        var _el$89 = _tmpl$25();
        insert(_el$89, createComponent(For, {
          get each() {
            return milestones();
          },
          children: item => (() => {
            var _el$131 = _tmpl$39(),
              _el$132 = _el$131.firstChild,
              _el$134 = _el$132.nextSibling;
            _el$131.$$click = () => selectMilestone(item.id);
            insert(_el$132, () => item.name, null);
            insert(_el$132, createComponent(Show, {
              get when() {
                return item.state === 'closed';
              },
              get children() {
                return _tmpl$36();
              }
            }), null);
            createRenderEffect(_p$ => {
              var _v$53 = !!(activeMilestoneId() === item.id),
                _v$54 = !!(item.syncState === 'confirming'),
                _v$55 = activeMilestoneId() === item.id ? 'page' : undefined,
                _v$56 = `${item.name}: ${currentGoalProgress(item).complete} of ${currentGoalProgress(item).total} complete`;
              _v$53 !== _p$.e && _el$131.classList.toggle("is-active", _p$.e = _v$53);
              _v$54 !== _p$.t && _el$131.classList.toggle("is-pending", _p$.t = _v$54);
              _v$55 !== _p$.a && setAttribute(_el$131, "aria-current", _p$.a = _v$55);
              _v$56 !== _p$.o && setAttribute(_el$134, "aria-label", _p$.o = _v$56);
              return _p$;
            }, {
              e: undefined,
              t: undefined,
              a: undefined,
              o: undefined
            });
            createRenderEffect(() => _el$134.value = currentGoalProgress(item).percent);
            return _el$131;
          })()
        }));
        return _el$89;
      }
    }), null);
    insert(_el$51, createComponent(Show, {
      get when() {
        return projectsEnabled && activeProjectId();
      },
      keyed: true,
      get fallback() {
        return createComponent(Show, {
          get when() {
            return activeMilestoneId() === null;
          },
          get fallback() {
            return createComponent(MilestoneOverview, {});
          },
          get children() {
            return createComponent(Show, {
              get when() {
                return topic();
              },
              get fallback() {
                return (() => {
                  var _el$172 = _tmpl$48(),
                    _el$173 = _el$172.firstChild,
                    _el$174 = _el$173.nextSibling,
                    _el$176 = _el$174.nextSibling;
                  insert(_el$173, () => !isConfigured ? 'Connect to GitHub' : syncing() ? 'Loading topics…' : 'No topics yet');
                  insert(_el$174, !isConfigured ? 'Open the repository menu and choose Permit to connect.' : 'Create a topic to start a conversation.');
                  insert(_el$172, createComponent(Show, {
                    get when() {
                      return error();
                    },
                    get children() {
                      var _el$175 = _tmpl$();
                      insert(_el$175, error);
                      return _el$175;
                    }
                  }), _el$176);
                  _el$176.$$click = () => startTopic();
                  createRenderEffect(() => _el$176.disabled = !isConfigured || syncing());
                  return _el$172;
                })();
              },
              get children() {
                var _el$135 = _tmpl$47(),
                  _el$136 = _el$135.firstChild,
                  _el$137 = _el$136.firstChild,
                  _el$138 = _el$137.firstChild,
                  _el$140 = _el$137.nextSibling,
                  _el$141 = _el$140.firstChild,
                  _el$145 = _el$136.nextSibling,
                  _el$155 = _el$145.firstChild;
                  _el$155.firstChild;
                  var _el$157 = _el$145.nextSibling;
                insert(_el$137, createComponent(TopicMarker, {
                  get kind() {
                    return topic().kind;
                  }
                }), _el$138);
                insert(_el$137, () => topic().name, null);
                insert(_el$136, createComponent(Show, {
                  get when() {
                    return !['note', 'list'].includes(topic().kind);
                  },
                  get children() {
                    var _el$139 = _tmpl$40();
                    insert(_el$139, () => topic().description);
                    return _el$139;
                  }
                }), _el$140);
                insert(_el$135, createComponent(Show, {
                  get when() {
                    return error();
                  },
                  get children() {
                    var _el$142 = _tmpl$3(),
                      _el$143 = _el$142.firstChild,
                      _el$144 = _el$143.nextSibling;
                    insert(_el$142, error, _el$143);
                    _el$144.$$click = () => setError('');
                    return _el$142;
                  }
                }), _el$145);
                insert(_el$145, createComponent(Show, {
                  get when() {
                    return projectsEnabled && returnProjectId();
                  },
                  get children() {
                    var _el$146 = _tmpl$41();
                    _el$146.$$click = () => selectProject(returnProjectId());
                    return _el$146;
                  }
                }), _el$155);
                insert(_el$145, createComponent(Show, {
                  get when() {
                    return topics().find(item => item.id === topic().parentId);
                  },
                  children: parent => (() => {
                    var _el$177 = _tmpl$49();
                      _el$177.firstChild;
                    _el$177.$$click = () => selectTopic(parent().id);
                    insert(_el$177, () => parent().name, null);
                    return _el$177;
                  })()
                }), _el$155);
                insert(_el$145, createComponent(Show, {
                  get when() {
                    return topic().kind !== 'discussion';
                  },
                  get children() {
                    var _el$147 = _tmpl$43(),
                      _el$148 = _el$147.firstChild,
                      _el$149 = _el$148.nextSibling,
                      _el$150 = _el$149.nextSibling,
                      _el$151 = _el$150.nextSibling;
                      _el$151.firstChild;
                    insert(_el$149, topicMilestoneLabel);
                    _el$151.addEventListener("change", event => {
                      const id = topic().id;
                      const next = event.currentTarget.value ? Number(event.currentTarget.value) : null;
                      event.currentTarget.value = String(topic().milestoneId ?? '');
                      assignMilestone(id, next);
                    });
                    insert(_el$151, createComponent(Show, {
                      get when() {
                        return memo(() => !!topic().milestoneId)() && !milestones().some(item => item.id === topic().milestoneId);
                      },
                      get children() {
                        var _el$153 = _tmpl$42();
                          _el$153.firstChild;
                        insert(_el$153, () => topic().milestoneId, null);
                        createRenderEffect(() => _el$153.value = topic().milestoneId);
                        return _el$153;
                      }
                    }), null);
                    insert(_el$151, createComponent(For, {
                      get each() {
                        return milestones();
                      },
                      children: item => (() => {
                        var _el$179 = _tmpl$7();
                        insert(_el$179, () => item.name, null);
                        insert(_el$179, () => item.state === 'closed' ? ' (closed)' : '', null);
                        createRenderEffect(() => _el$179.value = item.id);
                        return _el$179;
                      })()
                    }), null);
                    createRenderEffect(_p$ => {
                      var _v$57 = !!assignmentBusy()[topic().id],
                        _v$58 = topicMilestoneLabel(),
                        _v$59 = assignmentBusy()[topic().id] || !milestonesLoaded();
                      _v$57 !== _p$.e && _el$147.classList.toggle("is-pending", _p$.e = _v$57);
                      _v$58 !== _p$.t && setAttribute(_el$147, "title", _p$.t = _v$58);
                      _v$59 !== _p$.a && (_el$151.disabled = _p$.a = _v$59);
                      return _p$;
                    }, {
                      e: undefined,
                      t: undefined,
                      a: undefined
                    });
                    createRenderEffect(() => _el$151.value = topic().milestoneId ?? '');
                    return _el$147;
                  }
                }), _el$155);
                _el$155.$$click = () => requestStatusChange(topic());
                insert(_el$155, () => statusLabel(topic().id) || (topic().state === 'open' ? 'Open' : 'Closed'), null);
                insert(_el$157, createComponent(For, {
                  get each() {
                    return displayedTags();
                  },
                  children: tag => (() => {
                    var _el$180 = _tmpl$50(),
                      _el$181 = _el$180.firstChild,
                      _el$182 = _el$181.nextSibling,
                      _el$183 = _el$182.nextSibling;
                    insert(_el$182, () => tag.name);
                    _el$183.$$click = () => changeTag(topic().id, tag.name, 'remove');
                    createRenderEffect(_p$ => {
                      var _v$68 = !!(tagOperations()[topic().id]?.name.toLowerCase() === tag.name.toLowerCase()),
                        _v$69 = tagOperations()[topic().id]?.name.toLowerCase() === tag.name.toLowerCase(),
                        _v$70 = tag.description || tag.name,
                        _v$71 = `#${tag.color}`,
                        _v$72 = Boolean(tagOperations()[topic().id]),
                        _v$73 = `Remove tag ${tag.name}`,
                        _v$74 = `Remove tag ${tag.name}`;
                      _v$68 !== _p$.e && _el$180.classList.toggle("is-pending", _p$.e = _v$68);
                      _v$69 !== _p$.t && setAttribute(_el$180, "aria-busy", _p$.t = _v$69);
                      _v$70 !== _p$.a && setAttribute(_el$180, "title", _p$.a = _v$70);
                      _v$71 !== _p$.o && setStyleProperty(_el$181, "background", _p$.o = _v$71);
                      _v$72 !== _p$.i && (_el$183.disabled = _p$.i = _v$72);
                      _v$73 !== _p$.n && setAttribute(_el$183, "aria-label", _p$.n = _v$73);
                      _v$74 !== _p$.s && setAttribute(_el$183, "title", _p$.s = _v$74);
                      return _p$;
                    }, {
                      e: undefined,
                      t: undefined,
                      a: undefined,
                      o: undefined,
                      i: undefined,
                      n: undefined,
                      s: undefined
                    });
                    return _el$180;
                  })()
                }), null);
                insert(_el$157, createComponent(Show, {
                  get when() {
                    return tagEditing() === topic().id;
                  },
                  get fallback() {
                    return (() => {
                      var _el$184 = _tmpl$51();
                      _el$184.$$click = startTag;
                      createRenderEffect(() => _el$184.disabled = Boolean(tagOperations()[topic().id]) || !isConfigured);
                      return _el$184;
                    })();
                  },
                  get children() {
                    var _el$158 = _tmpl$44(),
                      _el$159 = _el$158.firstChild,
                      _el$160 = _el$159.nextSibling,
                      _el$161 = _el$160.nextSibling,
                      _el$162 = _el$161.nextSibling;
                    _el$158.$$keydown = event => {
                      if (event.key === 'Escape') {
                        event.preventDefault();
                        setTagEditing(null);
                      }
                    };
                    _el$158.addEventListener("submit", event => {
                      event.preventDefault();
                      changeTag(topic().id, tagDrafts()[topic().id] || '', 'add');
                    });
                    _el$159.$$input = event => setTagDrafts(previous => ({
                      ...previous,
                      [topic().id]: event.currentTarget.value
                    }));
                    use(element => requestAnimationFrame(() => element.focus()), _el$159);
                    insert(_el$160, createComponent(For, {
                      get each() {
                        return knownTags().filter(tag => !topic().tags.some(entry => entry.name.toLowerCase() === tag.name.toLowerCase()));
                      },
                      children: tag => (() => {
                        var _el$185 = _tmpl$7();
                        createRenderEffect(() => _el$185.value = tag.name);
                        return _el$185;
                      })()
                    }));
                    _el$162.$$click = () => setTagEditing(null);
                    createRenderEffect(() => _el$161.disabled = !(tagDrafts()[topic().id] || '').trim());
                    createRenderEffect(() => _el$159.value = tagDrafts()[topic().id] || '');
                    return _el$158;
                  }
                }), null);
                insert(_el$135, createComponent(Show, {
                  get when() {
                    return !['note', 'list'].includes(topic().kind);
                  },
                  get children() {
                    return [(() => {
                      var _el$163 = _tmpl$45();
                      var _ref$6 = messageList;
                      typeof _ref$6 === "function" ? use(_ref$6, _el$163) : messageList = _el$163;
                      insert(_el$163, createComponent(For, {
                        get each() {
                          return currentMessages();
                        },
                        children: message => (() => {
                          var _el$186 = _tmpl$53(),
                            _el$187 = _el$186.firstChild,
                            _el$188 = _el$187.nextSibling,
                            _el$189 = _el$188.firstChild,
                            _el$190 = _el$189.firstChild,
                            _el$191 = _el$190.nextSibling,
                            _el$194 = _el$189.nextSibling,
                            _el$195 = _el$194.firstChild,
                            _el$196 = _el$195.nextSibling;
                          insert(_el$187, () => (message.sender || message.author).slice(0, 1));
                          insert(_el$190, () => message.sender || message.author);
                          insert(_el$191, () => formatTime(message.time));
                          insert(_el$188, createComponent(Show, {
                            get when() {
                              return message.replyTo;
                            },
                            get children() {
                              var _el$192 = _tmpl$52();
                                _el$192.firstChild;
                              insert(_el$192, () => message.replyTo.author, null);
                              createRenderEffect(() => setAttribute(_el$192, "href", message.replyTo.url));
                              return _el$192;
                            }
                          }), _el$194);
                          insert(_el$188, createComponent(MessageText, {
                            get text() {
                              return message.text;
                            }
                          }), _el$194);
                          insert(_el$194, createComponent(For, {
                            get each() {
                              return message.reactions;
                            },
                            children: type => (() => {
                              var _el$197 = _tmpl$54();
                              insert(_el$197, () => reactionSymbols[type][0]);
                              createRenderEffect(_p$ => {
                                var _v$78 = reactionSymbols[type][1],
                                  _v$79 = reactionSymbols[type][1];
                                _v$78 !== _p$.e && setAttribute(_el$197, "aria-label", _p$.e = _v$78);
                                _v$79 !== _p$.t && setAttribute(_el$197, "title", _p$.t = _v$79);
                                return _p$;
                              }, {
                                e: undefined,
                                t: undefined
                              });
                              return _el$197;
                            })()
                          }), _el$195);
                          _el$195.$$click = () => openReactions(message.id);
                          _el$196.$$click = () => replyTo(message);
                          createRenderEffect(_p$ => {
                            var _v$75 = !!(message.author === 'You'),
                              _v$76 = message.sender ? `Declared sender: ${message.sender} · GitHub author: ${message.author}` : message.author,
                              _v$77 = message.time.toISOString();
                            _v$75 !== _p$.e && _el$187.classList.toggle("avatar-you", _p$.e = _v$75);
                            _v$76 !== _p$.t && setAttribute(_el$190, "title", _p$.t = _v$76);
                            _v$77 !== _p$.a && setAttribute(_el$191, "datetime", _p$.a = _v$77);
                            return _p$;
                          }, {
                            e: undefined,
                            t: undefined,
                            a: undefined
                          });
                          return _el$186;
                        })()
                      }), null);
                      insert(_el$163, createComponent(Show, {
                        get when() {
                          return outgoing();
                        },
                        children: entry => (() => {
                          var _el$198 = _tmpl$55(),
                            _el$199 = _el$198.firstChild,
                            _el$200 = _el$199.nextSibling,
                            _el$201 = _el$200.firstChild,
                            _el$202 = _el$201.firstChild,
                            _el$203 = _el$202.nextSibling;
                          insert(_el$203, () => entry().state === 'pending' ? 'Sending…' : 'Delivery unconfirmed — check GitHub before resending');
                          insert(_el$200, createComponent(MessageText, {
                            get text() {
                              return entry().text;
                            }
                          }), null);
                          createRenderEffect(() => setAttribute(_el$198, "aria-busy", entry().state === 'pending'));
                          return _el$198;
                        })()
                      }), null);
                      return _el$163;
                    })(), (() => {
                      var _el$164 = _tmpl$46(),
                        _el$165 = _el$164.firstChild,
                        _el$166 = _el$165.firstChild,
                        _el$167 = _el$166.nextSibling,
                        _el$168 = _el$165.nextSibling,
                        _el$169 = _el$168.firstChild,
                        _el$170 = _el$169.nextSibling,
                        _el$171 = _el$170.firstChild;
                      _el$164.addEventListener("submit", sendMessage);
                      _el$166.$$keydown = event => {
                        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) sendMessage(event);
                      };
                      _el$166.$$input = event => setDrafts(previous => ({
                        ...previous,
                        [activeId()]: event.currentTarget.value
                      }));
                      var _ref$7 = composerInput;
                      typeof _ref$7 === "function" ? use(_ref$7, _el$166) : composerInput = _el$166;
                      insert(_el$170, GITHUB_OWNER, _el$171);
                      insert(_el$170, GITHUB_REPO, null);
                      createRenderEffect(_p$ => {
                        var _v$60 = `Message ${topic().kind === 'discussion' ? '' : '#'}${topic().name}`,
                          _v$61 = `Message ${topic().kind === 'discussion' ? '' : '#'}${topic().name}`,
                          _v$62 = Boolean(outgoing());
                        _v$60 !== _p$.e && setAttribute(_el$166, "aria-label", _p$.e = _v$60);
                        _v$61 !== _p$.t && setAttribute(_el$166, "placeholder", _p$.t = _v$61);
                        _v$62 !== _p$.a && (_el$167.disabled = _p$.a = _v$62);
                        return _p$;
                      }, {
                        e: undefined,
                        t: undefined,
                        a: undefined
                      });
                      createRenderEffect(() => _el$166.value = draft());
                      return _el$164;
                    })()];
                  }
                }), null);
                insert(_el$135, createComponent(Show, {
                  get when() {
                    return memo(() => topic().kind === 'note')() ? topic().id : null;
                  },
                  keyed: true,
                  children: () => createComponent(NoteView, {
                    get topic() {
                      return topic();
                    },
                    api: api,
                    get draftKey() {
                      return `blackboard:${workspaceKey}:note:${topic().id}:draft`;
                    },
                    onBusyChange: setNoteWriting,
                    onUpdated: updated => rememberChange({
                      ...updated,
                      parentId: topics().find(item => item.id === updated.id)?.parentId ?? null
                    })
                  })
                }), null);
                insert(_el$135, createComponent(Show, {
                  get when() {
                    return memo(() => topic().kind === 'list')() ? topic().id : null;
                  },
                  keyed: true,
                  children: () => createComponent(ListView, {
                    get topic() {
                      return topic();
                    },
                    api: api,
                    get draftKey() {
                      return `blackboard:${workspaceKey}:list:${topic().id}:draft`;
                    },
                    onBusyChange: setListWriting,
                    onUpdated: updated => rememberChange({
                      ...updated,
                      parentId: topics().find(item => item.id === updated.id)?.parentId ?? null
                    })
                  })
                }), null);
                createRenderEffect(_p$ => {
                  var _v$63 = `${topic().name} ${['note', 'list'].includes(topic().kind) ? topic().kind : 'chat'}`,
                    _v$64 = topic().url,
                    _v$65 = !!(topic().state === 'closed'),
                    _v$66 = Boolean(closing()[topic().id]),
                    _v$67 = `${topic().state === 'open' ? 'Open' : 'Closed'} topic: ${topic().state === 'open' ? 'close' : 'reopen'} ${topic().name}`;
                  _v$63 !== _p$.e && setAttribute(_el$135, "aria-label", _p$.e = _v$63);
                  _v$64 !== _p$.t && setAttribute(_el$141, "href", _p$.t = _v$64);
                  _v$65 !== _p$.a && _el$155.classList.toggle("is-closed", _p$.a = _v$65);
                  _v$66 !== _p$.o && (_el$155.disabled = _p$.o = _v$66);
                  _v$67 !== _p$.i && setAttribute(_el$155, "aria-label", _p$.i = _v$67);
                  return _p$;
                }, {
                  e: undefined,
                  t: undefined,
                  a: undefined,
                  o: undefined,
                  i: undefined
                });
                return _el$135;
              }
            });
          }
        });
      },
      children: id => createComponent(ProjectBoard, {
        onBusyChange: setProjectWriting,
        api: api,
        projectId: id,
        get projectName() {
          return projects().find(item => item.id === id)?.name;
        },
        get topics() {
          return topics().filter(item => item.kind !== 'discussion');
        },
        onOpenTopic: topicId => selectTopic(topicId, id),
        onTopicUpdated: updated => rememberChange({
          ...updated,
          parentId: topics().find(topic => topic.id === updated.id)?.parentId ?? null
        })
      })
    }), _el$92);
    _el$92.addEventListener("cancel", event => {
      if (milestoneSaving()) event.preventDefault();
    });
    _el$92.$$click = event => dismissBackdrop(event, milestoneSaving());
    _el$92.$$pointerdown = trackBackdrop;
    var _ref$2 = milestoneDialog;
    typeof _ref$2 === "function" ? use(_ref$2, _el$92) : milestoneDialog = _el$92;
    _el$93.addEventListener("submit", saveMilestone);
    insert(_el$94, () => milestoneEditing() ? 'Edit goal' : 'New goal');
    _el$96.$$input = event => setMilestoneName(event.currentTarget.value);
    _el$98.$$input = event => setMilestoneDescription(event.currentTarget.value);
    _el$100.$$input = event => setMilestoneDueDate(event.currentTarget.value);
    insert(_el$93, createComponent(Show, {
      get when() {
        return milestoneFormError();
      },
      get children() {
        var _el$101 = _tmpl$26();
        insert(_el$101, milestoneFormError);
        return _el$101;
      }
    }), _el$102);
    _el$103.$$click = () => milestoneDialog.close();
    insert(_el$104, (() => {
      var _c$2 = memo(() => !!milestoneSaving());
      return () => _c$2() ? 'Saving…' : milestoneEditing() ? 'Save' : 'Create';
    })());
    _el$105.addEventListener("close", () => {
      setStatusChange(null);
      setStatusError('');
    });
    _el$105.addEventListener("cancel", event => {
      if (statusPending()) event.preventDefault();
    });
    _el$105.$$click = event => dismissBackdrop(event, statusPending());
    _el$105.$$pointerdown = trackBackdrop;
    var _ref$3 = statusDialog;
    typeof _ref$3 === "function" ? use(_ref$3, _el$105) : statusDialog = _el$105;
    insert(_el$105, createComponent(Show, {
      get when() {
        return statusChange();
      },
      children: change => (() => {
        var _el$204 = _tmpl$56(),
          _el$205 = _el$204.firstChild,
          _el$207 = _el$205.nextSibling,
          _el$208 = _el$207.firstChild,
          _el$209 = _el$208.nextSibling;
        _el$204.addEventListener("submit", confirmStatusChange);
        insert(_el$205, () => change().target === 'closed' ? 'Close this topic?' : 'Reopen this topic?');
        insert(_el$204, createComponent(Show, {
          get when() {
            return statusError();
          },
          get children() {
            var _el$206 = _tmpl$26();
            insert(_el$206, statusError);
            return _el$206;
          }
        }), _el$207);
        _el$208.$$click = () => statusDialog.close();
        insert(_el$209, (() => {
          var _c$3 = memo(() => !!statusPending());
          return () => _c$3() ? statusLabel(change().id) : change().target === 'closed' ? 'Close topic' : 'Reopen topic';
        })());
        createRenderEffect(_p$ => {
          var _v$80 = statusPending(),
            _v$81 = statusPending(),
            _v$82 = Boolean(closing()[change().id]);
          _v$80 !== _p$.e && setAttribute(_el$204, "aria-busy", _p$.e = _v$80);
          _v$81 !== _p$.t && (_el$208.disabled = _p$.t = _v$81);
          _v$82 !== _p$.a && (_el$209.disabled = _p$.a = _v$82);
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined
        });
        return _el$204;
      })()
    }));
    _el$106.addEventListener("close", () => {
      reactionLoadVersion++;
      setReactionTarget(null);
      setReactionLoading(false);
    });
    _el$106.addEventListener("cancel", event => {
      if (reactionBusy()) event.preventDefault();
    });
    _el$106.$$click = event => dismissBackdrop(event, reactionBusy());
    _el$106.$$pointerdown = trackBackdrop;
    var _ref$4 = reactionDialog;
    typeof _ref$4 === "function" ? use(_ref$4, _el$106) : reactionDialog = _el$106;
    insert(_el$108, createComponent(For, {
      get each() {
        return Object.keys(reactionSymbols);
      },
      children: type => (() => {
        var _el$210 = _tmpl$57();
        _el$210.$$click = () => toggleReaction(type);
        insert(_el$210, () => reactionSymbols[type][0]);
        createRenderEffect(_p$ => {
          var _v$83 = !!Boolean(ownReaction(type)),
            _v$84 = Boolean(ownReaction(type)),
            _v$85 = `${ownReaction(type) ? 'Remove' : 'Add'} ${reactionSymbols[type][1]}`,
            _v$86 = `${ownReaction(type) ? 'Remove' : 'Add'} ${reactionSymbols[type][1]}`,
            _v$87 = reactionLoading() || reactionBusy() || !reactionViewer();
          _v$83 !== _p$.e && _el$210.classList.toggle("is-selected", _p$.e = _v$83);
          _v$84 !== _p$.t && setAttribute(_el$210, "aria-pressed", _p$.t = _v$84);
          _v$85 !== _p$.a && setAttribute(_el$210, "aria-label", _p$.a = _v$85);
          _v$86 !== _p$.o && setAttribute(_el$210, "title", _p$.o = _v$86);
          _v$87 !== _p$.i && (_el$210.disabled = _p$.i = _v$87);
          return _p$;
        }, {
          e: undefined,
          t: undefined,
          a: undefined,
          o: undefined,
          i: undefined
        });
        return _el$210;
      })()
    }));
    insert(_el$106, createComponent(Show, {
      get when() {
        return reactionLoading() || reactionBusy();
      },
      get children() {
        var _el$109 = _tmpl$27();
        insert(_el$109, () => reactionLoading() ? 'Loading…' : 'Saving…');
        return _el$109;
      }
    }), _el$111);
    insert(_el$106, createComponent(Show, {
      get when() {
        return reactionError();
      },
      get children() {
        var _el$110 = _tmpl$26();
        insert(_el$110, reactionError);
        return _el$110;
      }
    }), _el$111);
    _el$112.$$click = () => reactionDialog.close();
    _el$113.addEventListener("close", () => {
      setRemoveTarget(null);
      setRemoveError('');
      setConfirmDelete(false);
    });
    _el$113.addEventListener("cancel", event => {
      if (removalPending()) event.preventDefault();
    });
    _el$113.$$click = event => dismissBackdrop(event, removalPending());
    _el$113.$$pointerdown = trackBackdrop;
    var _ref$5 = removeDialog;
    typeof _ref$5 === "function" ? use(_ref$5, _el$113) : removeDialog = _el$113;
    insert(_el$113, createComponent(Show, {
      get when() {
        return removeTarget();
      },
      children: item => (() => {
        var _el$211 = _tmpl$60(),
          _el$212 = _el$211.firstChild,
          _el$215 = _el$212.nextSibling;
        insert(_el$212, (() => {
          var _c$4 = memo(() => !!confirmDelete());
          return () => _c$4() ? 'Permanently Delete?' : `Remove ${item().name}`;
        })());
        insert(_el$211, createComponent(Show, {
          get when() {
            return removeError();
          },
          get children() {
            var _el$213 = _tmpl$26();
            insert(_el$213, removeError);
            return _el$213;
          }
        }), _el$215);
        insert(_el$211, createComponent(Show, {
          get when() {
            return removalPending();
          },
          get children() {
            var _el$214 = _tmpl$27();
            insert(_el$214, () => statusLabel(item().id));
            return _el$214;
          }
        }), _el$215);
        insert(_el$215, createComponent(Show, {
          get when() {
            return confirmDelete();
          },
          get fallback() {
            return [(() => {
              var _el$218 = _tmpl$61();
              _el$218.$$click = () => confirmRemoval('archived');
              createRenderEffect(() => _el$218.disabled = Boolean(closing()[item().id]));
              return _el$218;
            })(), (() => {
              var _el$219 = _tmpl$62();
              _el$219.$$click = () => setConfirmDelete(true);
              createRenderEffect(() => _el$219.disabled = Boolean(closing()[item().id]));
              return _el$219;
            })(), (() => {
              var _el$220 = _tmpl$63();
              _el$220.$$click = () => removeDialog.close();
              createRenderEffect(() => _el$220.disabled = removalPending());
              return _el$220;
            })()];
          },
          get children() {
            return [(() => {
              var _el$216 = _tmpl$58();
              _el$216.$$click = () => confirmRemoval('deleted');
              createRenderEffect(() => _el$216.disabled = Boolean(closing()[item().id]));
              return _el$216;
            })(), (() => {
              var _el$217 = _tmpl$59();
              _el$217.$$click = () => {
                setConfirmDelete(false);
                setRemoveError('');
              };
              createRenderEffect(() => _el$217.disabled = removalPending());
              return _el$217;
            })()];
          }
        }));
        createRenderEffect(() => setAttribute(_el$211, "aria-busy", removalPending()));
        return _el$211;
      })()
    }));
    createRenderEffect(_p$ => {
      var _v$20 = creatingTopic(),
        _v$21 = !!milestonesExpanded(),
        _v$22 = milestonesExpanded(),
        _v$23 = milestonesExpanded() ? 'M6 9l6 6 6-6' : 'M6 15l6-6 6 6',
        _v$24 = !milestonesExpanded(),
        _v$25 = !!(Boolean(lastSync()) && !syncing() && !syncFailed()),
        _v$26 = !!(syncing() || syncFailed()),
        _v$27 = syncDescription(),
        _v$28 = syncDescription(),
        _v$29 = milestoneSaving(),
        _v$30 = milestoneSaving() || milestoneUncertain(),
        _v$31 = milestoneSaving() || milestoneUncertain(),
        _v$32 = milestoneSaving() || milestoneUncertain(),
        _v$33 = milestoneSaving(),
        _v$34 = milestoneSaving() || milestoneUncertain() || !milestoneName().trim(),
        _v$35 = reactionLoading() || reactionBusy(),
        _v$36 = reactionBusy();
      _v$20 !== _p$.e && setAttribute(_el$54, "aria-expanded", _p$.e = _v$20);
      _v$21 !== _p$.t && _el$81.classList.toggle("is-expanded", _p$.t = _v$21);
      _v$22 !== _p$.a && setAttribute(_el$82, "aria-expanded", _p$.a = _v$22);
      _v$23 !== _p$.o && setAttribute(_el$85, "d", _p$.o = _v$23);
      _v$24 !== _p$.i && (_el$86.hidden = _p$.i = _v$24);
      _v$25 !== _p$.n && _el$91.classList.toggle("is-connected", _p$.n = _v$25);
      _v$26 !== _p$.s && _el$91.classList.toggle("is-syncing", _p$.s = _v$26);
      _v$27 !== _p$.h && setAttribute(_el$91, "aria-label", _p$.h = _v$27);
      _v$28 !== _p$.r && setAttribute(_el$91, "title", _p$.r = _v$28);
      _v$29 !== _p$.d && setAttribute(_el$93, "aria-busy", _p$.d = _v$29);
      _v$30 !== _p$.l && (_el$96.disabled = _p$.l = _v$30);
      _v$31 !== _p$.u && (_el$98.disabled = _p$.u = _v$31);
      _v$32 !== _p$.c && (_el$100.disabled = _p$.c = _v$32);
      _v$33 !== _p$.w && (_el$103.disabled = _p$.w = _v$33);
      _v$34 !== _p$.m && (_el$104.disabled = _p$.m = _v$34);
      _v$35 !== _p$.f && setAttribute(_el$108, "aria-busy", _p$.f = _v$35);
      _v$36 !== _p$.y && (_el$112.disabled = _p$.y = _v$36);
      return _p$;
    }, {
      e: undefined,
      t: undefined,
      a: undefined,
      o: undefined,
      i: undefined,
      n: undefined,
      s: undefined,
      h: undefined,
      r: undefined,
      d: undefined,
      l: undefined,
      u: undefined,
      c: undefined,
      w: undefined,
      m: undefined,
      f: undefined,
      y: undefined
    });
    createRenderEffect(() => _el$96.value = milestoneName());
    createRenderEffect(() => _el$98.value = milestoneDescription());
    createRenderEffect(() => _el$100.value = milestoneDueDate());
    return _el$51;
  })();
}
delegateEvents(["click", "keydown", "input", "pointerdown"]);

// Experimental GitHub Discussions integration.
const ENABLE_DISCUSSIONS = false;
// Optional GitHub Projects integration.
const ENABLE_PROJECTS = false;
// Public default only. Credentials are entered at runtime through Permit.
const DEFAULT_REPOSITORY = "" || repositoryFromPagesUrl(window.location.href) || 'orazdow/Blackboard';
render(() => App({
  discussionsEnabled: ENABLE_DISCUSSIONS,
  projectsEnabled: ENABLE_PROJECTS,
  defaultRepository: DEFAULT_REPOSITORY
}), document.querySelector('#app'));
