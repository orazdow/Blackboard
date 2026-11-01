// List issues remain ordinary GitHub Markdown task lists.
const TASK_LINE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/;
const FENCE_LINE = /^ {0,3}([\x60~])\1{2,}/;
const indentOf = (line) => (line.match(/^[ \t]*/) || [''])[0].replace(/\t/g, '    ').length;

export function checklist(body) {
  const newline = body.includes('\r\n') ? '\r\n' : '\n';
  const lines = body.split(/\r?\n/);
  const items = [];
  const indentStack = [];
  let fence = null;
  lines.forEach((line, index) => {
    const marker = FENCE_LINE.exec(line);
    if (fence) {
      if (marker && marker[1] === fence.char && marker[0].trim().length >= fence.length && !line.slice(marker[0].length).trim()) fence = null;
      return;
    }
    if (marker) { fence = { char: marker[1], length: marker[0].trim().length }; return; }
    const match = TASK_LINE.exec(line);
    if (match) {
      const indent = indentOf(line);
      while (indentStack.length && indent <= indentStack.at(-1)) indentStack.pop();
      items.push({ index, indent, depth: indentStack.length, checked: match[2].toLowerCase() === 'x', text: match[4] });
      indentStack.push(indent);
    }
  });
  return { lines, newline, items };
}

export function listDescription(body) {
  const parsed = checklist(body);
  const firstItem = parsed.items[0]?.index ?? parsed.lines.length;
  return parsed.lines.slice(0, firstItem).join(parsed.newline).trimEnd();
}

export function replaceListDescription(body, description) {
  const parsed = checklist(body);
  const firstItem = parsed.items[0]?.index;
  const text = String(description).trimEnd();
  if (firstItem === undefined) return text;
  const itemsAndFollowingText = parsed.lines.slice(firstItem).join(parsed.newline);
  return text ? `${text}${parsed.newline}${parsed.newline}${itemsAndFollowingText}` : itemsAndFollowingText;
}

export function changeChecklistItem(body, index, change) {
  const { lines, newline, items } = checklist(body);
  const itemIndex = items.findIndex((item) => item.index === index);
  if (itemIndex < 0) throw new Error('This list item changed. Refresh the list and try again.');
  const match = TASK_LINE.exec(lines[index] || '');
  if (!match) throw new Error('This list item changed. Refresh the list and try again.');
  if (change === 'remove') {
    const parentIndent = items[itemIndex].indent;
    const descendants = [];
    for (const item of items.slice(itemIndex + 1)) {
      if (item.indent <= parentIndent) break;
      descendants.push(item);
    }
    const childIndent = Math.min(...descendants.map((item) => item.indent));
    const shift = Number.isFinite(childIndent) ? childIndent - parentIndent : 0;
    for (const child of descendants) {
      lines[child.index] = ' '.repeat(child.indent - shift) + lines[child.index].replace(/^[ \t]*/, '');
    }
    lines.splice(index, 1);
  }
  else if (change === 'toggle') lines[index] = `${match[1]}${match[2].toLowerCase() === 'x' ? ' ' : 'x'}${match[3]}${match[4]}`;
  else {
    const text = String(change).trim();
    if (!text || /[\r\n]/.test(text)) throw new Error('Enter one line of text for a list item.');
    lines[index] = `${match[1]}${match[2]}${match[3]}${text}`;
  }
  return lines.join(newline);
}

export function insertChecklistChild(body, parentIndex, text) {
  const child = String(text).trim();
  if (!child || /[\r\n]/.test(child)) throw new Error('Enter one line of text for a list item.');
  const { lines, newline, items } = checklist(body);
  const itemIndex = items.findIndex((item) => item.index === parentIndex);
  if (itemIndex < 0) throw new Error('This list item changed. Refresh the list and try again.');
  const parent = items[itemIndex];
  let insertionIndex = parent.index + 1;
  let childIndent = parent.indent + 2;
  let foundChild = false;
  for (const item of items.slice(itemIndex + 1)) {
    if (item.indent <= parent.indent) break;
    if (!foundChild) childIndent = item.indent;
    foundChild = true;
    insertionIndex = item.index + 1;
  }
  lines.splice(insertionIndex, 0, `${' '.repeat(childIndent)}- [ ] ${child}`);
  return lines.join(newline);
}

export function appendChecklistItem(body, text) {
  const item = String(text).trim();
  if (!item || /[\r\n]/.test(item)) throw new Error('Enter one line of text for a list item.');
  const separator = body && !/\r?\n$/.test(body) ? (body.includes('\r\n') ? '\r\n' : '\n') : '';
  const descriptionBreak = body && !checklist(body).items.length && !/\r?\n\s*\r?\n$/.test(body) ? (body.includes('\r\n') ? '\r\n' : '\n') : '';
  return `${body}${separator}${descriptionBreak}- [ ] ${item}`;
}
