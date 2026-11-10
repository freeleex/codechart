import { THEMES, type Theme } from '../../config/schema.js';
import { CLIENT_JS } from '../web/client.js';
import { esc, jsonForScript, PAGE_CSP, type HtmlMeta } from '../web/page.js';

export const LEGEND = `<div class="legend"><div class="grp"><span class="lab">How sure</span><span class="ev ok">Checked in code</span><span class="ev guess">Agent's reading — please confirm</span></div>
<div class="grp"><span class="lab">Steps</span><span class="mk add">New</span><span class="mk chg">Changed</span><span class="mk rem">Removed</span><span>plain = same as now</span></div></div>`;

const DIALOG = `<div class="modal" id="send-modal" role="dialog" aria-modal="true" aria-labelledby="send-title" hidden>
<div class="sheet"><h3 id="send-title">Your message for the developer</h3>
<p id="send-hint">Paste it into the chat or ticket where the developer works.</p>
<p id="send-part" hidden></p>
<p id="send-when">You can send it whenever you're ready, in an email or chat message.</p>
<pre id="send-text"></pre>
<div class="row"><button type="button" id="send-copy">Copy again</button><button type="button" id="send-next" hidden>Next part</button><button type="button" class="send" id="send-done">Done</button></div></div></div>`;

export const updateNote = (meta: HtmlMeta): string => (meta.update ? `<span class="update">codechart ${esc(meta.update)} is out</span>` : '');

interface ShellParts {
  /** What the page script branches on. */
  page: 'business' | 'release';
  title: string;
  css: string;
  meta: HtmlMeta;
  /** Inside `<header>`, `<main class="wrap">` and after `<main>`: HTML already. */
  header: string;
  main: string;
  bar: string;
}

/** The document around a business or release page: one CSP, one inline script, the send dialog. */
export function pageShell(p: ShellParts): string {
  const theme: Theme = p.meta.theme && THEMES.includes(p.meta.theme) ? p.meta.theme : 'auto';
  const data = { page: p.page, repoKey: p.meta.repoKey ?? p.meta.repo, ...(p.meta.change && { change: p.meta.change }) };
  return `<!doctype html>
<html lang="en" data-theme="${theme}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${PAGE_CSP}">
<title>${esc(p.title)}</title>
<style>${p.css}</style></head>
<body data-page="${p.page}">
<header>${p.header}</header>
<main class="wrap">
${p.main}
</main>
${p.bar}
${DIALOG}
<script type="application/json" id="spec-data">${jsonForScript(data)}</script>
<script>${CLIENT_JS}</script>
</body></html>
`;
}
