// Runs against whichever Svelte is installed: 5 by default, 4 in CI's
// svelte-4 job (npm install --no-save svelte@4). Needs node
// --conditions=browser (npm test passes it) so `svelte` is the client build;
// server rendering is tested in render.ssr.mjs, without it.
import './dom.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writable } from 'svelte/store';
import {
  createHibira,
  useAgentStream,
  useChannel,
  useConnectionState,
  useEvent,
  useHibira,
  usePresence,
  useStream,
  useTrigger,
} from '../index.js';
import { fakePusher, sleep } from './fake-pusher.mjs';
import { mount, svelte5, version } from './compile.mjs';

const tag = `[svelte ${version}]`;
const tick = () => sleep(0);

// Subscribes to a store and keeps its latest value in .value.
function watch(store) {
  const box = { value: undefined };
  box.stop = store.subscribe((v) => {
    box.value = v;
  });
  return box;
}

function setup() {
  const pusher = fakePusher();
  const hibira = createHibira({ client: pusher });
  return { pusher, hibira };
}

test(`${tag} useChannel shares one subscription and leaves with the last subscriber`, () => {
  const { pusher, hibira } = setup();
  const a = watch(useChannel('private-a', { hibira }));
  const b = watch(useChannel('private-a', { hibira }));
  assert.equal(a.value, pusher.channel('private-a'));
  assert.equal(a.value, b.value);
  assert.equal(pusher.log.filter(([op]) => op === 'subscribe').length, 1);
  a.stop();
  assert.ok(pusher.channel('private-a'));
  b.stop();
  assert.equal(pusher.channel('private-a'), undefined);
});

test(`${tag} useChannel is lazy and follows a store`, () => {
  const { pusher } = setup();
  const name = writable('x');
  const store = useChannel(name);
  assert.equal(useHibira().client, pusher, 'falls back to the last instance');
  assert.equal(pusher.channels.size, 0, 'nothing until subscribed');
  const ch = watch(store);
  assert.equal(ch.value.name, 'x');
  name.set('y');
  assert.equal(ch.value.name, 'y');
  assert.equal(pusher.channel('x'), undefined);
  name.set(null);
  assert.equal(ch.value, null);
  assert.equal(pusher.channels.size, 0);
  ch.stop();
});

test(`${tag} useEvent binds once, follows the event name, unbinds on stop`, () => {
  const { pusher, hibira } = setup();
  const got = [];
  const event = writable('created');
  const stop = useEvent('orders', event, (d, m) => got.push([d, m]), { hibira });
  const ch = pusher.channel('orders');
  ch.emit('created', { id: 1 }, { user_id: 'u' });
  event.set('updated');
  ch.emit('created', { id: 2 });
  ch.emit('updated', { id: 3 });
  assert.deepEqual(got, [
    [{ id: 1 }, { user_id: 'u' }],
    [{ id: 3 }, undefined],
  ]);
  stop();
  assert.equal(ch.count('updated'), 0);
  assert.equal(pusher.channel('orders'), undefined);
});

test(`${tag} useEvent takes a channel object (Echo subscription)`, () => {
  const { pusher, hibira } = setup();
  const ch = pusher.subscribe('private-echo');
  const got = [];
  const stop = useEvent(ch, 'ping', (d) => got.push(d), { hibira });
  ch.emit('ping', 1);
  stop();
  ch.emit('ping', 2);
  assert.deepEqual(got, [1]);
  assert.ok(pusher.channel('private-echo'), 'not unsubscribed');
});

test(`${tag} useConnectionState catches up after the current task`, async () => {
  const { pusher, hibira } = setup();
  const s = watch(useConnectionState({ hibira }));
  assert.equal(s.value, 'initialized', 'what the server rendered');
  await tick();
  assert.equal(s.value, 'connecting');
  pusher.setState('connected');
  assert.equal(s.value, 'connected');
  s.stop();
  pusher.setState('unavailable');
  assert.equal(s.value, 'connected', 'unbound after stop');
  assert.equal(pusher.connection.count('state_change'), 0);
});

test(`${tag} usePresence`, async () => {
  const { pusher, hibira } = setup();
  const p = watch(usePresence('presence-room', { hibira }));
  assert.deepEqual(p.value.members, []);
  await tick();
  pusher.succeed('presence-room', { a: { name: 'A' }, b: { name: 'B' } }, 'b');
  assert.deepEqual(p.value.members, [
    { id: 'b', info: { name: 'B' }, me: true },
    { id: 'a', info: { name: 'A' }, me: false },
  ]);
  assert.equal(p.value.me.id, 'b');
  assert.equal(p.value.channel, pusher.channel('presence-room'));
  pusher.join('presence-room', 'c', { name: 'C' });
  assert.deepEqual(p.value.others.map((m) => m.id), ['a', 'c']);
  pusher.leave('presence-room', 'a');
  assert.equal(p.value.count, 2);
  p.stop();
  assert.equal(pusher.channel('presence-room'), undefined);
});

test(`${tag} useTrigger`, () => {
  const { pusher, hibira } = setup();
  const trigger = useTrigger('private-chat', { hibira });
  assert.equal(trigger('client-typing', { a: 1 }), false);
  pusher.succeed('private-chat');
  assert.equal(trigger('client-typing', { a: 1 }), true);
  assert.deepEqual(pusher.channel('private-chat').sent, [['client-typing', { a: 1 }]]);
  assert.throws(() => trigger('typing'), /must start with "client-"/);
  trigger.stop();
  assert.equal(pusher.channel('private-chat'), undefined);
});

test(`${tag} useStream`, () => {
  const { pusher, hibira } = setup();
  const store = useStream('private-ai', { hibira });
  const s = watch(store);
  const ch = pusher.channel('private-ai');
  assert.equal(s.value.text, '');
  assert.equal(s.value.channel, ch);
  ch.emit('ai-stream', { id: 's1', seq: 0, delta: 'Hel', meta: { model: 'm' } });
  ch.emit('ai-stream', { id: 's1', seq: 1, delta: 'lo' });
  assert.equal(s.value.text, 'Hello');
  assert.equal(s.value.done, false);
  assert.deepEqual(s.value.stream.meta, { model: 'm' });
  ch.emit('ai-stream', { id: 's1', seq: 2, done: true, error: 'overloaded' });
  assert.equal(s.value.done, true);
  assert.equal(s.value.error, 'overloaded');
  ch.emit('ai-stream', { id: 's2', seq: 0, delta: 'Next' });
  assert.equal(s.value.text, 'Next');
  store.reset();
  assert.equal(s.value.stream, null);
  s.stop();
  assert.equal(ch.count('ai-stream'), 0);
});

test(`${tag} useStream with rewind catches up after subscribing`, () => {
  const { pusher, hibira } = setup();
  const s = watch(useStream('private-ai', { rewind: { seconds: 120 }, hibira }));
  assert.equal(s.value.history, null);
  const ch = pusher.succeed('private-ai');
  assert.deepEqual(pusher.log.at(-1), ['send_event', 'pusher:rewind', { channel: 'private-ai', seconds: 120 }, 'private-ai']);
  ch.emit('ai-stream', { id: 's1', seq: 1, delta: 'lo' });
  ch.emit('ai-stream', { id: 's1', seq: 0, delta: 'Hel' });
  assert.equal(s.value.text, '', 'held until the history answers');
  ch.emit('pusher:rewind_succeeded', { count: 1, window: 3600, complete: true });
  assert.equal(s.value.text, 'Hello');
  assert.equal(s.value.stream.incomplete, false);
  assert.deepEqual(s.value.history, { count: 1, window: 3600, complete: true });
});

test(`${tag} useStream with an id store and a custom event`, () => {
  const { pusher, hibira } = setup();
  const id = writable('mine');
  const s = watch(useStream('private-ai', { id, event: 'answer', hibira }));
  const ch = pusher.channel('private-ai');
  ch.emit('answer', { id: 'other', seq: 0, delta: 'no' });
  ch.emit('ai-stream', { id: 'mine', seq: 0, delta: 'no' });
  ch.emit('answer', { id: 'mine', seq: 0, delta: 'yes' });
  assert.equal(s.value.text, 'yes');
  id.set('other');
  assert.equal(s.value.stream, null);
});

test(`${tag} useAgentStream follows Laravel AI events, chunks and rewind`, () => {
  const { pusher, hibira } = setup();
  const invocationId = writable(null);
  const a = watch(useAgentStream('private-hibira-ai.user.1', { rewind: true, invocationId, hibira }));
  assert.equal(a.value.status, 'idle');
  const ch = pusher.succeed('private-hibira-ai.user.1');
  assert.equal(pusher.log.at(-1)[1], 'pusher:rewind');
  const e = (id, type, fields) => ({ id, invocation_id: 'inv', type, ...fields });
  ch.emit('stream_start', e('1', 'stream_start', { model: 'm' }));
  ch.emit('text_delta', e('2', 'text_delta', { delta: 'Hi' }));
  ch.emit('pusher:rewind_succeeded', { count: 1, window: 600, complete: true });
  ch.emit('text_delta', e('2', 'text_delta', { delta: 'Hi' }));
  assert.equal(a.value.text, 'Hi');
  const json = JSON.stringify(e('3', 'tool_result', { tool_id: 't', result: 'x'.repeat(300), successful: true }));
  ch.emit('hibira:chunk', { id: 'c', event: 'tool_result', index: 1, count: 2, data: json.slice(150) });
  ch.emit('hibira:chunk', { id: 'c', event: 'tool_result', index: 0, count: 2, data: json.slice(0, 150) });
  assert.equal(a.value.toolCalls[0].result, 'x'.repeat(300));
  ch.emit('tool_approval_request', e('4', 'tool_approval_request', { approvals: [{ id: 'a' }] }));
  assert.equal(a.value.status, 'awaiting_approval');
  assert.deepEqual(a.value.approvals, [{ id: 'a' }]);
  invocationId.set('other');
  assert.equal(a.value.run, null);
});

test(`${tag} in components: context, $store, events, cleanup on destroy`, async () => {
  const pusher = fakePusher();
  const app = await mount('Root', { pusher });
  const text = (id) => app.target.querySelector(`#${id}`)?.textContent;
  assert.equal(text('client'), 'yes');
  assert.equal(text('channel'), 'private-orders');
  assert.equal(pusher.log.filter(([op, n]) => op === 'subscribe' && n === 'private-orders').length, 1, 'shared');
  await tick();
  app.flush();
  await app.tick?.();
  assert.equal(text('state'), 'connecting');
  pusher.succeed('presence-room', { u1: { name: 'Ann' } }, 'u1');
  pusher.channel('private-orders').emit('created', { id: 'o-7' });
  pusher.channel('private-ai').emit('ai-stream', { id: 's', seq: 0, delta: 'Hi' });
  app.flush();
  await app.tick?.();
  assert.equal(text('count'), '1');
  assert.equal(text('me'), 'Ann');
  assert.equal(text('last'), 'o-7');
  assert.equal(text('text'), 'Hi');
  app.unmount();
  assert.equal(pusher.channels.size, 0, 'every channel left');
  assert.equal(pusher.connection.count('state_change'), 0);
});

test(`${tag} Svelte 5 runes: a getter over $state picks the channel`, { skip: !svelte5 && 'Svelte 5 only' }, async () => {
  const pusher = fakePusher();
  const app = await mount('Runes', { pusher });
  const text = () => app.target.querySelector('#channel').textContent;
  assert.equal(text(), 'private-order-1');
  app.instance.next();
  app.flush();
  assert.equal(text(), 'private-order-2');
  assert.equal(pusher.channel('private-order-1'), undefined);
  app.unmount();
  assert.equal(pusher.channels.size, 0);
});

test(`${tag} createHibira opens pusher-js lazily with Hibira defaults`, () => {
  const hibira = createHibira({ appKey: 'key', options: { wsHost: '127.0.0.1', wsPort: 9, forceTLS: false, enabledTransports: ['ws'] } });
  const saved = globalThis.window;
  delete globalThis.window;
  try {
    assert.equal(hibira.client, null, 'no connection on the server');
  } finally {
    globalThis.window = saved;
  }
  const pusher = hibira.client;
  assert.equal(pusher.key, 'key');
  assert.equal(pusher.config.cluster, 'hkg');
  assert.equal(pusher.config.wsHost, '127.0.0.1');
  assert.equal(hibira.client, pusher, 'one client');
  hibira.disconnect();
  assert.equal(pusher.connection.state, 'disconnected');
});
