// Svelte stores for pusher-js on Hibira (and Laravel Echo, or any
// Pusher-compatible server): one connection for the app, channels shared
// between components, events, presence members, connection state, client
// events, and useStream() for LLM output sent with streamToChannel().
//
// Works with Svelte 5 (runes or not) and Svelte 4, and with SvelteKit's
// server rendering: the stores are plain svelte/store readables, so `$store`
// works in any component. A store does its work while something subscribes
// to it: the first subscriber joins the channel, the last one leaving lets go.
//
// The connection opens the first time a store is subscribed in the browser.
// On the server the client is null and every store keeps its empty value,
// so server rendering never connects.

import { getContext, onDestroy, setContext } from 'svelte';
import * as svelteStore from 'svelte/store';
import DefaultPusher from 'pusher-js';
import { acquireChannel, hibiraOptions, isClientEvent, presenceMembers, releaseChannel } from './client.js';
import { STREAM_EVENT, createStreamStore, followStream, latestStream } from './stream.js';
import { AGENT_EVENTS, createAgentStore, latestRun } from './agent.js';

export { HIBIRA_DEFAULTS, hibiraOptions } from './client.js';
export { STREAM_EVENT, createStreamStore, followStream } from './stream.js';
export { AGENT_EVENTS, CHUNK_EVENT, createAgentStore } from './agent.js';

const { readable } = svelteStore;

export const HIBIRA_KEY = Symbol.for('hibira');

// The last instance created, for stores made outside a component (a module,
// a +page.js load) and for apps that never call setHibira().
let fallback = null;

/**
 * Creates the Hibira instance. Call it once, in the root +layout.svelte,
 * and pass it to setHibira() so every component below finds it.
 *
 * @param {object} config
 * @param {string} [config.appKey] the app key from the Hibira portal
 * @param {object} [config.options] pusher-js options, merged over HIBIRA_DEFAULTS
 * @param {object|(() => object)} [config.client] an existing pusher-js client
 *   (or a function returning one) to use instead, e.g. `echo.connector.pusher`
 * @param {Function} [config.Pusher] the pusher-js class to open the
 *   connection with; pass the one from `pusher-js/with-encryption` for
 *   `private-encrypted-` channels
 */
export function createHibira({ appKey, options, client, Pusher = DefaultPusher } = {}) {
  let pusher = null;
  let warned = false;
  const hibira = {
    /** The pusher-js client; opened on first use in the browser, null on the server. */
    get client() {
      if (pusher) return pusher;
      if (typeof window === 'undefined') return null;
      if (client) pusher = typeof client === 'function' ? client() : client;
      else if (appKey) pusher = new Pusher(appKey, hibiraOptions(options));
      else if (!warned) {
        warned = true;
        console.warn('@hibira-io/svelte: createHibira() got no appKey, so nothing connects. Check the variable you pass (on SvelteKit 3, $env/dynamic/public is empty unless declared; import.meta.env.VITE_HIBIRA_KEY works on Kit 2 and 3).');
      }
      return pusher;
    },
    /** Disconnects a client this instance opened. */
    disconnect() {
      if (pusher && !client) pusher.disconnect();
      pusher = null;
    },
  };
  fallback = hibira;
  return hibira;
}

/** Makes `hibira` the instance for this component and the ones below it. */
export function setHibira(hibira) {
  fallback = hibira;
  setContext(HIBIRA_KEY, hibira);
  return hibira;
}

/** The instance from setHibira() above this component, or else the last one created. */
export function useHibira() {
  let provided = null;
  try {
    provided = getContext(HIBIRA_KEY) ?? null;
  } catch {
    // Called outside component initialisation: use the fallback.
  }
  return provided ?? fallback;
}

/** The pusher-js client, or null on the server or without an instance. */
export function usePusher() {
  return useHibira()?.client ?? null;
}

function isStore(value) {
  return value != null && typeof value === 'object' && typeof value.subscribe === 'function' && typeof value.bind !== 'function';
}

// A channel name subscribes; a channel object (Echo's .subscription, the
// value of useChannel) is used as is. pusher-js channels have a subscribe()
// method too, so they are told apart from stores by bind().
function isChannel(value) {
  return value != null && typeof value === 'object' && typeof value.bind === 'function';
}

// A store for a plain value, a store, or (Svelte 5) a getter over $state.
function toReadable(source) {
  if (isStore(source)) return source;
  if (typeof source === 'function') {
    if (svelteStore.toStore) return svelteStore.toStore(source);
    return readable(source());
  }
  return readable(source);
}

// Runs `stop` when the component is destroyed; outside a component the
// caller keeps `stop` and calls it.
function whileMounted(stop) {
  try {
    onDestroy(stop);
  } catch {
    // Not in component initialisation.
  }
  return stop;
}

// Runs `fn` after the current task, so the first values a store sends in
// the browser come after hydration and match what the server rendered.
function soon(fn) {
  let live = true;
  queueMicrotask(() => live && fn());
  return () => {
    live = false;
  };
}

// The channel for a target (a name, a channel, or a store of either), as a
// store. Names are subscribed while the store has subscribers.
function channelStore(target, hibira) {
  const source = toReadable(target);
  return readable(null, (set) => {
    const pusher = hibira?.client ?? null;
    let current = null;
    const leave = () => {
      if (current) releaseChannel(pusher, current);
      current = null;
    };
    const unsubscribe = source.subscribe((next) => {
      if (isChannel(next)) {
        leave();
        set(next);
        return;
      }
      if (next && next === current) return;
      leave();
      set(null);
      if (!pusher || !next) return;
      current = next;
      set(acquireChannel(pusher, next));
    });
    return () => {
      unsubscribe();
      leave();
    };
  });
}

// Calls `attach(channel, extra)` for each channel the target resolves to,
// and the cleanup it returns when the channel (or `extra`) changes.
function onChannel(channel, extra, attach) {
  let ch = null;
  let ex = undefined;
  let cleanup = null;
  let ready = false;
  const run = () => {
    if (!ready) return;
    cleanup?.();
    cleanup = ch ? attach(ch, ex) ?? null : null;
  };
  const a = channel.subscribe((value) => {
    ch = value;
    run();
  });
  const b = extra.subscribe((value) => {
    ex = value;
    run();
  });
  ready = true;
  run();
  return () => {
    ready = false;
    a();
    b();
    cleanup?.();
    cleanup = null;
  };
}

const none = readable(undefined);

/**
 * A store of the pusher-js channel for `name` (null while there is none).
 * Components that use the same name share one subscription; the channel is
 * left when the last subscriber goes.
 * @param {string|null|import('svelte/store').Readable|(() => string|null)} name
 */
export function useChannel(name, { hibira } = {}) {
  return channelStore(name, hibira ?? useHibira());
}

/**
 * Calls handler(data, metadata) for each `event` on a channel while the
 * component lives. Outside a component, call the returned function to stop.
 * @param target channel name, channel, or a store (or Svelte 5 getter) of either
 * @param {string|import('svelte/store').Readable|(() => string)} event
 * @returns {() => void} stop
 */
export function useEvent(target, event, handler, { hibira } = {}) {
  const channel = channelStore(target, hibira ?? useHibira());
  const fn = (data, metadata) => handler(data, metadata);
  return whileMounted(
    onChannel(channel, toReadable(event), (ch, ev) => {
      if (!ev) return null;
      ch.bind(ev, fn);
      return () => ch.unbind(ev, fn);
    }),
  );
}

/**
 * A store of the connection state: "initialized", "connecting", "connected",
 * "unavailable", "failed" or "disconnected".
 */
export function useConnectionState({ hibira } = {}) {
  const h = hibira ?? useHibira();
  // Starts as "initialized", what the server rendered, and catches up right
  // after hydration.
  return readable('initialized', (set) => {
    const pusher = h?.client;
    if (!pusher) return;
    const fn = ({ current }) => set(current);
    pusher.connection.bind('state_change', fn);
    const cancel = soon(() => set(pusher.connection.state));
    return () => {
      cancel();
      pusher.connection.unbind('state_change', fn);
    };
  });
}

const PRESENCE_EVENTS = ['pusher:subscription_succeeded', 'pusher:member_added', 'pusher:member_removed'];

function presenceValue(channel, members) {
  return {
    channel,
    members,
    others: members.filter((m) => !m.me),
    me: members.find((m) => m.me) ?? null,
    count: members.length,
  };
}

/**
 * A store of a presence channel's members, kept up to date:
 * `{ channel, members, others, me, count }`. Members are [{ id, info, me }]
 * with you first; info is the user_info your auth endpoint signed.
 */
export function usePresence(target, { hibira } = {}) {
  const channel = channelStore(target, hibira ?? useHibira());
  return readable(presenceValue(null, []), (set) => {
    let first = true;
    return onChannel(channel, none, (ch) => {
      const update = () => set(presenceValue(ch, presenceMembers(ch)));
      for (const ev of PRESENCE_EVENTS) ch.bind(ev, update);
      const cancel = first ? soon(update) : (update(), null);
      first = false;
      return () => {
        cancel?.();
        for (const ev of PRESENCE_EVENTS) ch.unbind(ev, update);
        set(presenceValue(null, []));
      };
    });
  });
}

/**
 * A function that sends a client event on a private or presence channel:
 * `trigger('client-typing', { at: Date.now() })`. Returns false when the
 * channel is not subscribed yet. Turn on client events for the app first.
 * Holds the channel while the component lives (outside one, call
 * `trigger.stop()` when done).
 */
export function useTrigger(target, { hibira } = {}) {
  const channel = channelStore(target, hibira ?? useHibira());
  let current = null;
  const stop = whileMounted(
    channel.subscribe((ch) => {
      current = ch;
    }),
  );
  const trigger = (event, data) => {
    if (!isClientEvent(event)) throw new Error(`useTrigger: "${event}" must start with "client-"`);
    if (!current || !current.subscribed) return false;
    return current.trigger(event, data ?? {});
  };
  trigger.stop = stop;
  return trigger;
}

function streamValue(channel, streams, want, history) {
  const stream = want != null ? streams[String(want)] ?? null : latestStream(streams);
  return {
    channel,
    stream,
    streams,
    text: stream?.text ?? '',
    done: stream?.done ?? false,
    error: stream?.error ?? null,
    history,
  };
}

/**
 * A store of text streamed to a channel with streamToChannel(), put back
 * together: `{ text, done, error, stream, streams, history, channel }`.
 * Call `.reset()` on the store to forget every stream.
 *
 * @param target channel name, channel, or a store (or Svelte 5 getter) of either
 * @param {object} [options]
 * @param {string} [options.event="ai-stream"] event name
 * @param {string|import('svelte/store').Readable|(() => string)} [options.id] follow only this stream id
 * @param {number} [options.maxStreams=50] streams kept, oldest dropped first
 * @param {boolean|object} [options.rewind] catch up from channel history on
 *   each subscription: true, or { seconds = 300, limit, timeout = 5000 }
 */
export function useStream(target, { event = STREAM_EVENT, id, maxStreams = 50, rewind, hibira } = {}) {
  const h = hibira ?? useHibira();
  const channel = channelStore(target, h);
  const ids = toReadable(id);
  let streams = {};
  let history = null;
  let ch = null;
  let want = null;
  let emit = () => {};
  const push = () => emit(streamValue(ch, streams, want, history));
  const store = createStreamStore(
    (next) => {
      streams = next;
      push();
    },
    { maxStreams },
  );

  const { subscribe } = readable(streamValue(null, {}, null, null), (set) => {
    emit = set;
    const stopId = ids.subscribe((value) => {
      want = value ?? null;
      push();
    });
    const stopChannel = onChannel(channel, toReadable(event), (c, ev) => {
      ch = c;
      push();
      if (!ev) return null;
      const stopFollowing = followStream(c, {
        event: ev,
        client: c.pusher ?? h?.client,
        rewind,
        onHistory: (result) => {
          history = result;
          push();
        },
        apply: (payload) => {
          if (want != null && String(payload?.id) !== String(want)) return;
          store.apply(payload);
        },
      });
      return () => {
        stopFollowing();
        ch = null;
        push();
      };
    });
    return () => {
      stopChannel();
      stopId();
      emit = () => {};
    };
  });
  return { subscribe, reset: store.reset };
}

function agentValue(channel, runs, want, history) {
  const run = want != null ? runs[String(want)] ?? null : latestRun(runs);
  return {
    channel,
    run,
    runs,
    text: run?.text ?? '',
    reasoning: run?.reasoning ?? '',
    status: run?.status ?? 'idle',
    done: run?.done ?? false,
    error: run?.error ?? null,
    toolCalls: run?.toolCalls ?? [],
    approvals: run?.approvals ?? [],
    history,
  };
}

/**
 * A store of a Laravel AI SDK agent's stream (laravel/ai broadcastOnQueue(),
 * broadcast() or broadcastNow()), put back together: `{ text, reasoning,
 * status, done, error, toolCalls, approvals, run, runs, history, channel }`.
 * Events hibira-io/laravel split into chunks are joined. `.reset()` forgets
 * every run.
 *
 * @param target channel name, channel, or a store (or Svelte 5 getter) of either,
 *   e.g. `private-hibira-ai.user.${user.id}` (AgentChannel::user() in Laravel)
 * @param {object} [options]
 * @param {string|import('svelte/store').Readable|(() => string)} [options.invocationId] follow only this run
 * @param {number} [options.maxRuns=20] runs kept, oldest dropped first
 * @param {boolean|object} [options.rewind] catch up from channel history on
 *   each subscription: true, or { seconds = 300, limit, timeout = 5000 }
 * @param {string[]} [options.events] extra event names to listen to
 */
export function useAgentStream(target, { invocationId, maxRuns = 20, rewind, events, hibira } = {}) {
  const h = hibira ?? useHibira();
  const channel = channelStore(target, h);
  const ids = toReadable(invocationId);
  let runs = {};
  let history = null;
  let ch = null;
  let want = null;
  let emit = () => {};
  const push = () => emit(agentValue(ch, runs, want, history));
  const store = createAgentStore(
    (next) => {
      runs = next;
      push();
    },
    { maxRuns },
  );

  const { subscribe } = readable(agentValue(null, {}, null, null), (set) => {
    emit = set;
    const stopId = ids.subscribe((value) => {
      want = value ?? null;
      push();
    });
    const stopChannel = onChannel(channel, none, (c) => {
      ch = c;
      push();
      const stopFollowing = followStream(c, {
        event: events?.length ? [...AGENT_EVENTS, ...events] : AGENT_EVENTS,
        client: c.pusher ?? h?.client,
        rewind,
        onHistory: (result) => {
          history = result;
          push();
        },
        apply: (payload, name) => store.apply(payload, name),
      });
      return () => {
        stopFollowing();
        ch = null;
        push();
      };
    });
    return () => {
      stopChannel();
      stopId();
      emit = () => {};
    };
  });
  return { subscribe, reset: store.reset };
}
