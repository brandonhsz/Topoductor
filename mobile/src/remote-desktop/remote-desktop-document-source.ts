import { REMOTE_DESKTOP_DOCUMENT_SCRIPT } from './remote-desktop-document.generated'

// The input stays focusable but invisible: it only collects soft-keyboard text for the session.
export function remoteDesktopDocumentSource(background: string): { html: string; baseUrl: string } {
  return {
    // A secure origin exposes crypto.subtle, which macOS account sign-in (Apple Remote Desktop auth) needs; nothing loads from it.
    baseUrl: 'https://localhost/',
    html: [
      '<!doctype html><html><head><meta charset="utf-8">',
      '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">',
      '<style>',
      `html,body{margin:0;height:100%;overflow:hidden;background:${background};touch-action:none}`,
      '#screen{position:absolute;inset:0}',
      '#keyboard{position:absolute;left:0;bottom:0;width:1px;height:1px;opacity:0;border:0;padding:0;resize:none;font-size:16px}',
      '</style></head><body>',
      '<div id="screen"></div>',
      '<textarea id="keyboard" autocapitalize="off" autocomplete="off" autocorrect="off" spellcheck="false"></textarea>',
      `<script type="module">${REMOTE_DESKTOP_DOCUMENT_SCRIPT}</script>`,
      '</body></html>'
    ].join('')
  }
}
