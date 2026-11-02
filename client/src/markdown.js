import { For, Show } from 'solid-js';
import { issueNumberForUrl, markdownBlocks, markdownInlines } from './markdown-state.js';

function openIssue(event, number, handler) {
  if (!number || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  if (handler?.(number)) event.preventDefault();
}

export function InlineMarkdown(props) {
  const tokens = () => markdownInlines(props.text);
  return <For each={tokens()}>{(token) => {
    if (token.type === 'code') return <code>{token.text}</code>;
    if (token.type === 'strong') return <strong>{token.text}</strong>;
    if (token.type === 'emphasis') return <em>{token.text}</em>;
    if (token.type === 'link') return <a href={token.url} target="_blank" rel="noopener noreferrer"
      onClick={(event) => openIssue(event, issueNumberForUrl(token.url, props.issueBase), props.onOpenIssue)}>{token.text}</a>;
    if (token.type === 'issue') return <Show when={props.issueBase} fallback={token.text}>
      <a href={`${props.issueBase}${token.number}`} target="_blank" rel="noopener noreferrer"
        onClick={(event) => openIssue(event, Number(token.number), props.onOpenIssue)}>{token.text}</a>
    </Show>;
    if (token.type === 'mention') return <Show when={!props.isDeclaredSender?.(token.name)} fallback={
      <span class="message-mention" title="Declared Blackboard identity">{token.text}</span>
    }>
      <a class="message-mention" href={`https://github.com/${encodeURIComponent(token.name)}`} target="_blank" rel="noopener noreferrer">{token.text}</a>
    </Show>;
    return token.text;
  }}</For>;
}

function MarkdownList(props) {
  const Items = (itemProps) => <For each={itemProps.items}>{(item) => <li>
    <Show when={item.checked !== null}><span class="markdown-check">{item.checked ? '☑' : '☐'} </span></Show>
    <InlineMarkdown text={item.text} issueBase={props.issueBase} isDeclaredSender={props.isDeclaredSender} onOpenIssue={props.onOpenIssue} />
    <For each={item.children}>{(group) => <MarkdownList group={group} issueBase={props.issueBase} isDeclaredSender={props.isDeclaredSender} onOpenIssue={props.onOpenIssue} />}</For>
  </li>}</For>;
  return <Show when={props.group.ordered} fallback={<ul><Items items={props.group.items} /></ul>}>
    <ol><Items items={props.group.items} /></ol>
  </Show>;
}

function MarkdownBlocks(props) {
  const Inline = (inlineProps) => <InlineMarkdown text={inlineProps.text} issueBase={props.issueBase} isDeclaredSender={props.isDeclaredSender} onOpenIssue={props.onOpenIssue} />;
  return <For each={props.blocks}>{(block) => {
    if (block.type === 'paragraph') return <p><Inline text={block.text} /></p>;
    if (block.type === 'heading') {
      if (block.level === 1) return <h1><Inline text={block.text} /></h1>;
      if (block.level === 2) return <h2><Inline text={block.text} /></h2>;
      return <h3><Inline text={block.text} /></h3>;
    }
    if (block.type === 'code') return <pre><code>{block.text}</code></pre>;
    if (block.type === 'quote') return <blockquote><MarkdownBlocks blocks={block.blocks} issueBase={props.issueBase} isDeclaredSender={props.isDeclaredSender} onOpenIssue={props.onOpenIssue} /></blockquote>;
    if (block.type === 'lists') return <For each={block.groups}>{(group) => <MarkdownList group={group} issueBase={props.issueBase} isDeclaredSender={props.isDeclaredSender} onOpenIssue={props.onOpenIssue} />}</For>;
    return <hr />;
  }}</For>;
}

export default function Markdown(props) {
  return <div class={`markdown-content ${props.class || ''}`}>
    <MarkdownBlocks blocks={markdownBlocks(props.text)} issueBase={props.issueBase} isDeclaredSender={props.isDeclaredSender} onOpenIssue={props.onOpenIssue} />
  </div>;
}
