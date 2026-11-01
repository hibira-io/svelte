// End-to-end test against a running Hibira (or any Pusher-compatible) server
// with client events enabled. Skipped unless HIBIRA_E2E_KEY is set:
//
//   HIBIRA_E2E_HOST=127.0.0.1 HIBIRA_E2E_PORT=8080 HIBIRA_E2E_TLS=0 \
//   HIBIRA_E2E_APP_ID=... HIBIRA_E2E_KEY=... HIBIRA_E2E_SECRET=... npm run test:e2e
//
// The stores are used without components here, the way a module or a
// SvelteKit load function would; the component path is covered by
// svelte.test.mjs.
import '../dom.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import PusherServer from 'pusher';
import { createHibira, useConnectionState, useEvent, usePresence, useStream, useTrigger } from '../../index.js';
import { streamToChannel } from '../../server.js';
import { channelAuth } from '../../kit.js';

const env = process.env;
const skip = !env.HIBIRA_E2E_KEY && 'set HIBIRA_E2E_KEY to run';
const host = env.HIBIRA_E2E_HOST ?? '127.0.0.1';
const port = Number(env.HIBIRA_E2E_PORT ?? 8080);
const tls = env.HIBIRA_E2E_TLS === '1';

const server = skip
  ? null
  : new PusherServer({ appId: env.HIBIRA_E2E_APP_ID, key: env.HIBIRA_E2E_KEY, secret: env.HIBIRA_E2E_SECRET, host, port: String(port), useTLS: tls });

// pusher-js asks the kit.js handler, as it would a SvelteKit +server.js.
const options = (userId, name) => {
  const POST = channelAuth(server, (event, { channelName }) =>
    channelName.startsWith('presence-') ? { user_id: userId, user_info: { name } } : true,
  );
  return {
    wsHost: host,
    wsPort: port,
    wssPort: port,
    forceTLS: tls,
    enabledTransports: ['ws'],
    channelAuthorization: {
      customHandler: ({ socketId, channelName }, cb) => {
        const request = new Request('http://app/api/hibira/auth', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ socket_id: socketId, channel_name: channelName }),
        });
        POST({ request, locals: {} })
          .then((res) => res.json())
          .then((data) => cb(null, data), (err) => cb(err, null));
      },
    },
  };
};

function watch(store) {
  const box = { value: undefined };
  box.stop = store.subscribe((v) => {
    box.value = v;
  });
  return box;
}

async function waitFor(check, what) {
  const until = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > until) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 25));
  }
}

test('stores on a real server: presence, client events, streamed text', { skip }, async () => {
  const room = `presence-e2e-${Date.now()}`;
  const ai = `private-ai-${Date.now()}`;
  const views = {};
  const typing = [];
  const stops = { alice: [], bob: [] };
  const instances = [];

  for (const [id, name] of [
    ['alice', 'Alice'],
    ['bob', 'Bob'],
  ]) {
    const hibira = createHibira({ appKey: env.HIBIRA_E2E_KEY, options: options(id, name) });
    instances.push(hibira);
    const v = {
      state: watch(useConnectionState({ hibira })),
      presence: watch(usePresence(room, { hibira })),
      trigger: useTrigger(room, { hibira }),
      stream: watch(useStream(ai, { hibira })),
    };
    views[id] = v;
    stops[id].push(v.state.stop, v.presence.stop, v.trigger.stop, v.stream.stop);
    stops[id].push(useEvent(room, 'client-typing', (data, meta) => typing.push([id, data, meta?.user_id]), { hibira }));
  }
  const stopAll = (id) => stops[id].splice(0).forEach((fn) => fn());
  try {
    await waitFor(() => views.alice.state.value === 'connected' && views.bob.state.value === 'connected', 'connected');
    await waitFor(() => views.alice.presence.value.count === 2 && views.bob.presence.value.count === 2, 'both members');
    assert.equal(views.alice.presence.value.me.id, 'alice');
    assert.deepEqual(views.bob.presence.value.others.map((m) => m.info.name), ['Alice']);

    assert.equal(views.alice.trigger('client-typing', { on: true }), true);
    await waitFor(() => typing.length === 1, 'client event');
    assert.deepEqual(typing[0], ['bob', { on: true }, 'alice']);

    async function* llm() {
      for (let i = 0; i < 200; i++) {
        await new Promise((r) => setTimeout(r, 2));
        yield { choices: [{ delta: { content: `토큰${i} ` } }] };
      }
    }
    const res = await streamToChannel(server, ai, llm(), { meta: { model: 'test' }, interval: 50 });
    assert.ok(res.events < 30, `${res.events} events for 200 tokens`);
    await waitFor(() => views.alice.stream.value.done && views.bob.stream.value.done, 'stream done');
    for (const who of ['alice', 'bob']) {
      assert.equal(views[who].stream.value.text, res.text);
      assert.deepEqual(views[who].stream.value.stream.meta, { model: 'test' });
    }

    stopAll('bob');
    instances[1].disconnect();
    await waitFor(() => views.alice.presence.value.count === 1, 'bob left');
  } finally {
    stopAll('alice');
    stopAll('bob');
    for (const h of instances) h.disconnect();
  }
});

// Needs channel history on for the app (history: true, history_seconds > 0).
test('useStream rewind: a reload mid-answer, then a dropped connection', { skip: skip || (!env.HIBIRA_E2E_HISTORY && 'set HIBIRA_E2E_HISTORY=1 (app with channel history)') }, async () => {
  const ai = `private-ai-rewind-${Date.now()}`;
  const parts = Array.from({ length: 90 }, (_, i) => `p${i} `);
  const gates = [];
  const waits = [0, 1].map((n) => new Promise((r) => (gates[n] = r)));
  async function* llm() {
    for (let i = 0; i < parts.length; i++) {
      if (i === 30) await waits[0];
      if (i === 60) await waits[1];
      yield parts[i];
    }
  }
  const sending = streamToChannel(server, ai, llm(), { interval: 10 });
  await new Promise((r) => setTimeout(r, 300)); // a third is out before the page loads

  const hibira = createHibira({ appKey: env.HIBIRA_E2E_KEY, options: options('u', 'U') });
  const state = watch(useConnectionState({ hibira }));
  const s = watch(useStream(ai, { rewind: true, hibira }));
  await waitFor(() => s.value.history, 'rewind answer');
  assert.equal(s.value.history.error, undefined, s.value.history.error);
  const first = parts.slice(0, 30).join('');
  await waitFor(() => s.value.text.length >= first.length, 'first third');
  assert.equal(s.value.text, first);

  hibira.client.disconnect();
  await waitFor(() => state.value === 'disconnected', 'disconnected');
  gates[0]();
  await new Promise((r) => setTimeout(r, 500)); // the middle third goes out while offline
  hibira.client.connect();
  const middle = parts.slice(0, 60).join('');
  await waitFor(() => s.value.text.length >= middle.length, 'middle third after reconnect');
  assert.equal(s.value.text, middle);
  assert.equal(s.value.done, false);

  gates[1]();
  const res = await sending;
  await waitFor(() => s.value.done, 'done');
  assert.equal(s.value.text, res.text);
  assert.equal(s.value.stream.incomplete, false);
  s.stop();
  state.stop();
  hibira.client.disconnect();
});
