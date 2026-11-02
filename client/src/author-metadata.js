const AUTHOR_LINE = /^<!-- @([a-z][a-z0-9_-]{0,63}) -->[ \t]*(?:\r?\n|$)/;

export const validAuthor = (name) => typeof name === 'string' && /^[a-z][a-z0-9_-]{0,63}$/.test(name);

export function splitAuthorMetadata(body) {
  const text = String(body ?? '');
  const match = AUTHOR_LINE.exec(text);
  return match
    ? { author: match[1], prefix: match[0], content: text.slice(match[0].length) }
    : { author: null, prefix: '', content: text };
}

export function withAuthorMetadata(originalBody, content) {
  const { prefix } = splitAuthorMetadata(originalBody);
  if (!prefix) return content;
  const newline = prefix.includes('\r\n') ? '\r\n' : '\n';
  const text = String(content).replace(/\r\n?/g, '\n').replace(/\n/g, newline);
  return prefix + (text && !prefix.endsWith('\n') ? newline : '') + text;
}
