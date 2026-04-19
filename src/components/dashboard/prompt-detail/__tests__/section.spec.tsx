import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Section } from '../Section';

const noop = () => {};

describe('Section (CSS-grid collapsible)', () => {
  it('emits "collapsible open" class when id is in expanded set', () => {
    const html = renderToStaticMarkup(
      <Section title="T" id="x" expanded={new Set(['x'])} onToggle={noop}>
        <div>child-content</div>
      </Section>,
    );
    expect(html).toMatch(/class="[^"]*\bcollapsible\b[^"]*\bopen\b/);
    expect(html).toContain('child-content');
  });

  it('emits "collapsible" without "open" when id not in expanded set', () => {
    const html = renderToStaticMarkup(
      <Section title="T" id="x" expanded={new Set<string>()} onToggle={noop}>
        <div>child-content</div>
      </Section>,
    );
    expect(html).toMatch(/class="[^"]*\bcollapsible\b/);
    expect(html).not.toMatch(/class="[^"]*\bcollapsible\b[^"]*\bopen\b/);
  });

  it('wraps children in .collapsible-inner so overflow clipping lives on the inner element', () => {
    const html = renderToStaticMarkup(
      <Section title="T" id="x" expanded={new Set(['x'])} onToggle={noop}>
        <div>child-content</div>
      </Section>,
    );
    expect(html).toMatch(/class="[^"]*\bcollapsible-inner\b/);
  });

  it('keeps children mounted even when collapsed (CSS-only transition)', () => {
    const html = renderToStaticMarkup(
      <Section title="T" id="x" expanded={new Set<string>()} onToggle={noop}>
        <div>child-content</div>
      </Section>,
    );
    expect(html).toContain('child-content');
  });

  it('toggles chevron expanded modifier in sync with open state', () => {
    const htmlOpen = renderToStaticMarkup(
      <Section title="T" id="x" expanded={new Set(['x'])} onToggle={noop}>
        <span>c</span>
      </Section>,
    );
    const htmlClosed = renderToStaticMarkup(
      <Section title="T" id="x" expanded={new Set<string>()} onToggle={noop}>
        <span>c</span>
      </Section>,
    );
    expect(htmlOpen).toMatch(/detail-section-chevron[^"]*\bexpanded\b/);
    expect(htmlClosed).not.toMatch(/detail-section-chevron[^"]*\bexpanded\b/);
  });
});
