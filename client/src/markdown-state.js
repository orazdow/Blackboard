// A deliberately small Markdown subset. Content is rendered as Solid text nodes,
// never as raw HTML. HTML comments are omitted from the display only.
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const HEADING = /^ {0,3}(#{1,3})\s+(.+)$/;
const QUOTE = /^\s*> ?(.*)$/;
const LIST = /^(\s*)(?:([-*+])\s+(?:\[([ xX])\]\s+)?|(\d+)[.)]\s+)(.*)$/;
const RULE = /^ {0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/;

function cleanComments(lines) {
  let inComment = false;
  let fence = null;
  return lines.map((line) => {
    const marker = FENCE.exec(line);
    if (fence) {
      if (marker && marker[1][0] === fence.char && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      return line;
    }
    if (!inComment && marker) {
      fence = { char: marker[1][0], length: marker[1].length };
      return line;
    }
    let visible = '';
    let offset = 0;
    while (offset < line.length) {
      if (inComment) {
        const end = line.indexOf('-->', offset);
        if (end < 0) return visible;
        inComment = false;
        offset = end + 3;
      } else {
        const start = line.indexOf('<!--', offset);
        if (start < 0) return visible + line.slice(offset);
        visible += line.slice(offset, start);
        inComment = true;
        offset = start + 4;
      }
    }
    return visible;
  });
}

function listTree(lines) {
  const groups = [];
  const stack = [];
  for (const line of lines) {
    const match = LIST.exec(line);
    if (!match) continue;
    const indent = match[1].replace(/\t/g, '    ').length;
    const ordered = Boolean(match[4]);
    while (stack.length && indent <= stack.at(-1).indent) stack.pop();
    const collection = stack.length ? stack.at(-1).item.children : groups;
    let group = collection.at(-1);
    if (!group || group.ordered !== ordered) {
      group = { ordered, items: [] };
      collection.push(group);
    }
    const item = { text: match[5], checked: match[3] === undefined ? null : match[3].toLowerCase() === 'x', children: [] };
    group.items.push(item);
    stack.push({ indent, item });
  }
  return groups;
}

export function markdownBlocks(value) {
  const lines = cleanComments(String(value ?? '').replace(/\r\n?/g, '\n').split('\n'));
  const blocks = [];
  let index = 0;
  const isBlockStart = (line) => FENCE.test(line) || HEADING.test(line) || QUOTE.test(line) || LIST.test(line) || RULE.test(line);
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) { index++; continue; }
    const fence = FENCE.exec(line);
    if (fence) {
      const content = [];
      index++;
      while (index < lines.length) {
        const closing = FENCE.exec(lines[index]);
        if (closing && closing[1][0] === fence[1][0] && closing[1].length >= fence[1].length && !closing[2].trim()) { index++; break; }
        content.push(lines[index++]);
      }
      blocks.push({ type: 'code', text: content.join('\n') });
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) { blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].replace(/\s+#+\s*$/, '') }); index++; continue; }
    if (RULE.test(line)) { blocks.push({ type: 'rule' }); index++; continue; }
    if (QUOTE.test(line)) {
      const quoted = [];
      while (index < lines.length && QUOTE.test(lines[index])) quoted.push(QUOTE.exec(lines[index++])[1]);
      blocks.push({ type: 'quote', blocks: markdownBlocks(quoted.join('\n')) });
      continue;
    }
    if (LIST.test(line)) {
      const listLines = [];
      while (index < lines.length && LIST.test(lines[index])) listLines.push(lines[index++]);
      blocks.push({ type: 'lists', groups: listTree(listLines) });
      continue;
    }
    const paragraph = [line];
    index++;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) paragraph.push(lines[index++]);
    blocks.push({ type: 'paragraph', text: paragraph.join('\n') });
  }
  return blocks;
}

export function markdownInlines(value) {
  const text = cleanComments(String(value ?? '').replace(/\r\n?/g, '\n').split('\n')).join('\n');
  const tokens = [];
  const pattern = /`([^`\n]+)`|\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)|\*\*([^*\n]+)\*\*|__([^_\n]+)__|(?<!\*)\*([^*\n]+)\*(?!\*)|(?<!_)_([^_\n]+)_(?!_)|(?<![\w@/])@([A-Za-z][A-Za-z0-9_-]{0,63})(?![\w-])|(?<![\w/])#(\d+)\b/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > start) tokens.push({ type: 'text', text: text.slice(start, match.index) });
    if (match[1]) tokens.push({ type: 'code', text: match[1] });
    else if (match[2]) tokens.push({ type: 'link', text: match[2], url: match[3] });
    else if (match[4] || match[5]) tokens.push({ type: 'strong', text: match[4] || match[5] });
    else if (match[6] || match[7]) tokens.push({ type: 'emphasis', text: match[6] || match[7] });
    else if (match[8]) tokens.push({ type: 'mention', text: match[0], name: match[8] });
    else tokens.push({ type: 'issue', text: match[0], number: match[9] });
    start = match.index + match[0].length;
  }
  if (start < text.length) tokens.push({ type: 'text', text: text.slice(start) });
  return tokens;
}

export function issueNumberForUrl(href, issueBase) {
  try {
    const link = new URL(href);
    const base = new URL(issueBase);
    if (link.origin !== base.origin || link.search || link.hash) return null;
    const linkedPath = link.pathname.replace(/\/$/, '').split('/');
    const basePath = base.pathname.replace(/\/$/, '').split('/');
    if (linkedPath.length !== basePath.length + 1 || !/^\d+$/.test(linkedPath.at(-1))) return null;
    if (!basePath.every((part, index) => part.toLowerCase() === linkedPath[index].toLowerCase())) return null;
    const number = Number(linkedPath.at(-1));
    return Number.isSafeInteger(number) && number > 0 ? number : null;
  } catch { return null; }
}
