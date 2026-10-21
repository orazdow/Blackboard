// A small, text-only Markdown subset. Never interpret message HTML.
export function messageBlocks(text) {
  const blocks = [];
  for (const line of text.split('\n')) {
    const quote = /^> ?/.test(line);
    const content = quote ? line.replace(/^> ?/, '') : line;
    const previous = blocks.at(-1);
    if (previous?.quote === quote) previous.text += `\n${content}`;
    else blocks.push({ quote, text: content });
  }
  return blocks;
}

export function messageTokens(text) {
  const tokens = [];
  const pattern = /`([^`\n]+)`|\[([^\]\n]+)\]\((https:\/\/[^\s)]+)\)|(?<![\w@/])@([A-Za-z][A-Za-z0-9_-]{0,63})(?![\w-])/g;
  let start = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > start) tokens.push({ type: 'text', text: text.slice(start, match.index) });
    if (match[1]) tokens.push({ type: 'code', text: match[1] });
    else if (match[2]) tokens.push({ type: 'link', text: match[2], url: match[3] });
    else tokens.push({ type: 'mention', text: match[0], name: match[4] });
    start = match.index + match[0].length;
  }
  if (start < text.length) tokens.push({ type: 'text', text: text.slice(start) });
  return tokens;
}

export function quoteReply(message) {
  const name = (message.sender || message.author).replace(/[\[\]\r\n]/g, '');
  const source = /^https:\/\/github\.com\//.test(message.url) ? `[${name}](${message.url})` : name;
  return `${source} wrote:\n${message.text.split('\n').map((line) => `> ${line}`).join('\n')}\n\n`;
}
