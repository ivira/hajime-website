/**
 * Markdown for Agents — content negotiation at the edge.
 *
 * Runs in front of the static assets (assets.run_worker_first = true). When a
 * client sends `Accept: text/markdown`, the HTML asset is converted to Markdown
 * and returned as `text/markdown; charset=utf-8` with an `x-markdown-tokens`
 * header. Every other request is served the static asset unchanged, so HTML
 * stays the default for browsers.
 */

const rough = (s) => Math.max(1, Math.ceil(s.length / 4)); // ~4 chars/token estimate

export default {
  async fetch(request, env) {
    const asset = await env.ASSETS.fetch(request);
    const accept = request.headers.get('Accept') || '';
    const type = asset.headers.get('content-type') || '';
    const wantsMarkdown = accept.split(',').some((p) => p.trim().toLowerCase().startsWith('text/markdown'));

    if (wantsMarkdown && type.includes('text/html')) {
      const html = await asset.text();
      const markdown = await htmlToMarkdown(html, new URL(request.url).origin);
      const headers = new Headers({
        'content-type': 'text/markdown; charset=utf-8',
        'x-markdown-tokens': String(rough(markdown)),
        'x-original-tokens': String(rough(html)),
        'vary': 'Accept',
        'cache-control': asset.headers.get('cache-control') || 'public, max-age=0, must-revalidate',
      });
      return new Response(markdown, { status: asset.status, headers });
    }

    // Default path: serve the asset as-is, but signal that the representation
    // varies by Accept so shared caches keep HTML and Markdown separate.
    const out = new Response(asset.body, asset);
    out.headers.append('vary', 'Accept');
    return out;
  },
};

function resolveUrl(u, base) {
  if (!u) return u;
  if (/^(https?:|mailto:|tel:|#|data:)/i.test(u)) return u;
  return base.replace(/\/$/, '') + '/' + u.replace(/^\//, '');
}

/**
 * Convert an HTML document to Markdown using the runtime's HTMLRewriter.
 * Handlers append to a shared buffer in document order; `skip` masks out
 * non-content regions (nav, header, footer, media, scripts, styles).
 */
async function htmlToMarkdown(html, base) {
  const out = [];
  const state = { skip: 0 };
  const push = (s) => { if (state.skip === 0) out.push(s); };
  // Void elements (e.g. <source>, <img>) have no end tag; onEndTag() throws
  // for them, so fall back to running the callback immediately.
  const onEnd = (el, cb) => { try { el.onEndTag(cb); } catch { cb(); } };

  const heading = (prefix) => ({
    element(el) {
      if (state.skip) return;
      out.push(`\n\n${prefix} `);
      onEnd(el, () => out.push('\n'));
    },
  });
  const wrap = (mark) => ({
    element(el) {
      if (state.skip) return;
      out.push(mark);
      onEnd(el, () => out.push(mark));
    },
  });

  const rewriter = new HTMLRewriter()
    // Regions whose text should never reach the output.
    .on('head, script, style, svg, header, footer, nav, noscript, video, audio, source, picture', {
      element(el) {
        state.skip++;
        onEnd(el, () => { state.skip--; });
      },
    })
    // The document title becomes the top-level heading. It lives in <head>,
    // which is skipped above, so re-enable output just for this element.
    .on('title', {
      element(el) {
        const wasSkipped = state.skip;
        state.skip = 0;
        out.push('# ');
        onEnd(el, () => { out.push('\n'); state.skip = wasSkipped; });
      },
    })
    .on('h1', heading('#'))
    .on('h2', heading('##'))
    .on('h3', heading('###'))
    .on('h4', heading('####'))
    .on('p', {
      element(el) {
        if (state.skip) return;
        out.push('\n\n');
        onEnd(el, () => out.push('\n'));
      },
    })
    .on('li', {
      element(el) {
        if (state.skip) return;
        out.push('\n- ');
      },
    })
    .on('strong, b', wrap('**'))
    .on('em, i', wrap('*'))
    .on('a', {
      element(el) {
        if (state.skip) return;
        const href = resolveUrl(el.getAttribute('href'), base);
        out.push('[');
        onEnd(el, () => out.push(`](${href})`));
      },
    })
    .on('img', {
      element(el) {
        if (state.skip) return;
        const alt = el.getAttribute('alt') || '';
        const src = resolveUrl(el.getAttribute('src'), base);
        if (src) out.push(`\n\n![${alt}](${src})\n\n`);
      },
    })
    .on('br', { element() { push('\n'); } })
    // Catch every text node; block structure comes from the markers above.
    .on('*', {
      text(t) { push(t.text); },
    });

  await rewriter.transform(new Response(html)).text();

  return out
    .join('')
    .replace(/\r/g, '')
    .replace(/[ \t]+/g, ' ')     // collapse runs of spaces/tabs
    .replace(/ *\n */g, '\n')    // trim spaces around newlines
    .replace(/\n{3,}/g, '\n\n')  // at most one blank line
    .replace(/\[([^\]]*)\]/g, (_, t) => '[' + t.replace(/\s+/g, ' ').trim() + ']') // keep link/image text on one line
    .trim() + '\n';
}
