import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ActionFlowList } from '../ActionFlowList';
import type { ToolCall } from '../../../types';

const noop = () => {};

const toolCall: ToolCall = {
  index: 0,
  name: 'Read',
  input_summary: '/tmp/example.ts',
  timestamp: '2026-04-20T00:00:00Z',
};

const renderList = () =>
  renderToStaticMarkup(
    <ActionFlowList
      toolCalls={[toolCall]}
      expandedActions={new Set()}
      onToggleAction={noop}
      onOpenFile={noop}
      scanTimestamp="2026-04-20T00:00:00Z"
      isCompleted={true}
    />,
  );

const entryOpenTag = (html: string): string => {
  const match = html.match(/<[a-z]+\s+class="action-flow-entry"[^>]*>/i);
  expect(match).not.toBeNull();
  return match![0];
};

describe('ActionFlowList (GPU-friendly enter/exit)', () => {
  it('renders the tool call content', () => {
    const html = renderList();
    expect(html).toContain('Read');
    expect(html).toContain('example.ts');
  });

  it('does not emit height style on the item wrapper (no height-auto animation)', () => {
    const html = renderList();
    const tag = entryOpenTag(html);
    expect(tag).not.toMatch(/height\s*:/i);
  });

  it('does not emit overflow:hidden on the item wrapper', () => {
    const html = renderList();
    const tag = entryOpenTag(html);
    expect(tag).not.toMatch(/overflow\s*:\s*hidden/i);
  });
});
