// List issues remain ordinary GitHub Markdown task lists.
const TASK_LINE = /^(\s*[-*+]\s+\[)([ xX])(\]\s+)(.*)$/;
const FENCE_LINE = /^ {0,3}([\x60~])\1{2,}/;

export function checklist(body) {
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
    if (marker) { fence = { char: marker[1], length: marker[0].trim().length }; return; }
    const match = TASK_LINE.exec(line);
    if (match) items.push({ index, checked: match[2].toLowerCase() === 'x', text: match[4] });
  });
  return { lines, newline, items };
}

export function changeChecklistItem(body, index, change) {
  const { lines, newline } = checklist(body);
  const match = TASK_LINE.exec(lines[index] || '');
  if (!match) throw new Error('This list item changed. Refresh the list and try again.');
  if (change === 'remove') lines.splice(index, 1);
  else if (change === 'toggle') lines[index] = `${match[1]}${match[2].toLowerCase() === 'x' ? ' ' : 'x'}${match[3]}${match[4]}`;
  else {
    const text = String(change).trim();
    if (!text || /[\r\n]/.test(text)) throw new Error('Enter one line of text for a list item.');
    lines[index] = `${match[1]}${match[2]}${match[3]}${text}`;
  }
  return lines.join(newline);
}

export function appendChecklistItem(body, text) {
  const item = String(text).trim();
  if (!item || /[\r\n]/.test(item)) throw new Error('Enter one line of text for a list item.');
  return `${body}${body && !/\r?\n$/.test(body) ? (body.includes('\r\n') ? '\r\n' : '\n') : ''}- [ ] ${item}`;
}
