// Server rendering, as SvelteKit does it: run without --conditions=browser
// so `svelte` resolves to its server build.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakePusher } from './fake-pusher.mjs';
import { render, version } from './compile.mjs';

const tag = `[svelte ${version}]`;

test(`${tag} server rendering never connects`, async () => {
  const saved = globalThis.window;
  delete globalThis.window;
  try {
    const html = await render('Root', { pusher: fakePusher() });
    assert.match(html, /<p id="state">initialized<\/p>/);
    assert.match(html, /<p id="count">0<\/p>/);
    assert.match(html, /<p id="client">no<\/p>/);
  } finally {
    globalThis.window = saved;
  }
});

