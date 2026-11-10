// Export needs paper layouts without sticky chrome or hover affordances; keep it independent of live app styles.
export const EXPORT_CSS = `
* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  background: #ffffff;
  color: #1f2328;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial,
    sans-serif, "Apple Color Emoji", "Segoe UI Emoji";
  font-size: 14px;
  line-height: 1.6;
}

.topo-export-root {
  padding: 0;
  max-width: 100%;
}

.topo-export-root h1,
.topo-export-root h2,
.topo-export-root h3,
.topo-export-root h4,
.topo-export-root h5,
.topo-export-root h6 {
  font-weight: 600;
  line-height: 1.25;
  margin-top: 1.5em;
  margin-bottom: 0.5em;
}

.topo-export-root h1 { font-size: 1.9em; }
.topo-export-root h2 { font-size: 1.5em; }
.topo-export-root h3 { font-size: 1.25em; }
.topo-export-root h4 { font-size: 1em; }

.topo-export-root p,
.topo-export-root blockquote,
.topo-export-root ul,
.topo-export-root ol,
.topo-export-root pre,
.topo-export-root table {
  margin-top: 0;
  margin-bottom: 1em;
}

.topo-export-root a {
  color: #0969da;
  text-decoration: underline;
}

.topo-export-root blockquote {
  padding: 0 1em;
  color: #57606a;
  border-left: 0.25em solid #d0d7de;
}

.topo-export-root [data-callout] {
  margin: 0 0 1em;
  padding: 0 1em;
  border-left: 0.25em solid var(--callout);
}

.topo-export-root [data-callout] > :first-child {
  display: flex;
  align-items: center;
  gap: 0.4em;
  margin-bottom: 0.25em;
  color: var(--callout);
  font-weight: 600;
}

.topo-export-root [data-callout] > :first-child svg { width: 1em; height: 1em; }

.topo-export-root [data-callout="note"] { --callout: #0969da; }
.topo-export-root [data-callout="tip"] { --callout: #1a7f37; }
.topo-export-root [data-callout="important"] { --callout: #8250df; }
.topo-export-root [data-callout="warning"] { --callout: #9a6700; }
.topo-export-root [data-callout="caution"] { --callout: #cf222e; }

.topo-export-root code,
.topo-export-root pre {
  font-family: "SF Mono", Menlo, Consolas, "Liberation Mono", monospace;
  font-size: 0.9em;
}

.topo-export-root code {
  background: #f6f8fa;
  padding: 0.2em 0.4em;
  border-radius: 4px;
}

.topo-export-root pre {
  background: #f6f8fa;
  padding: 12px 16px;
  border-radius: 6px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.topo-export-root pre code {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
}

.topo-export-root table {
  border-collapse: collapse;
  width: 100%;
}

.topo-export-root th,
.topo-export-root td {
  border: 1px solid #d0d7de;
  padding: 6px 12px;
  text-align: left;
}

.topo-export-root th { background: #f6f8fa; }

.topo-export-root img,
.topo-export-root svg {
  max-width: 100%;
  height: auto;
}

.topo-export-root ul,
.topo-export-root ol { padding-left: 2em; }

.topo-export-root li { margin: 0.25em 0; }

.topo-export-root input[type="checkbox"] {
  margin-right: 0.4em;
}

.topo-export-root hr {
  border: 0;
  border-top: 1px solid #d0d7de;
  margin: 1.5em 0;
}

/* Why: the export subtree selection already excludes the big chrome (toolbar,
   search bar, etc.), but in-document affordances like the code-copy button
   and preview annotation controls can still leak. Hide the well-known
   offenders as a belt-and-suspenders defense on top of DOM scrubbing. */
.code-block-copy-btn,
.markdown-preview-search,
.markdown-annotation-controls,
.rich-markdown-toolbar,
[data-topo-export-hide] {
  display: none !important;
}

.code-block-wrapper { position: static !important; }

@media print {
  pre, code, table, img, svg { page-break-inside: avoid; }
  h1, h2, h3, h4, h5, h6 { page-break-after: avoid; }
}
`
