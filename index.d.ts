import type { Readable } from 'svelte/store';
import type Pusher from 'pusher-js';
import type { Options } from 'pusher-js';
import type { Member } from './client.js';
import type { HistoryResult, RewindOptions, Stream } from './stream.js';
import type { AgentRun, AgentRunStatus, AgentToolCall } from './agent.js';

export type { Member } from './client.js';
export type { HistoryResult, RewindOptions, Stream, StreamPayload, StreamStore } from './stream.js';
export { HIBIRA_DEFAULTS, hibiraOptions } from './client.js';
export { STREAM_EVENT, createStreamStore, followStream } from './stream.js';
export type { AgentPart, AgentRun, AgentRunStatus, AgentStore, AgentToolCall } from './agent.js';
export { AGENT_EVENTS, CHUNK_EVENT, createAgentStore } from './agent.js';

/** A pusher-js channel (PresenceChannel and PrivateChannel included). */
export type Channel = ReturnType<Pusher['subscribe']>;
/** A value, a store, or (Svelte 5) a getter that reads $state. */
export type Source<T> = T | Readable<T> | (() => T);
/** A channel name to subscribe to, a channel to use as is, or null for none. */
export type ChannelTarget = Source<string | Channel | null | undefined>;

export type ConnectionState = 'initialized' | 'connecting' | 'connected' | 'unavailable' | 'failed' | 'disconnected';

export interface HibiraConfig {
  /** App key from the Hibira portal. */
  appKey?: string;
  /** pusher-js options merged over HIBIRA_DEFAULTS. */
  options?: Partial<Options>;
  /** Use this client (or the one this returns) instead, e.g. `echo.connector.pusher`. Not disconnected by disconnect(). */
  client?: Pusher | (() => Pusher);
}

export interface Hibira {
  /** The pusher-js client; opened on first use in the browser, null on the server. */
  readonly client: Pusher | null;
  /** Disconnects a client this instance opened. */
  disconnect(): void;
}

/** Use this instance instead of the one from context. */
export interface WithHibira {
  hibira?: Hibira | null;
}

export const HIBIRA_KEY: unique symbol;

export function createHibira(config?: HibiraConfig): Hibira;
/** Puts the instance in context for this component and those below it. Call during component initialisation. */
export function setHibira(hibira: Hibira): Hibira;
/** The instance from setHibira(), or else the last one created. */
export function useHibira(): Hibira | null;
/** The pusher-js client, or null on the server or without an instance. */
export function usePusher(): Pusher | null;

/** The channel for a name; one subscription per name, held while the store has subscribers. */
export function useChannel(name: Source<string | null | undefined>, options?: WithHibira): Readable<Channel | null>;

/** Calls handler for each event while the component lives; returns stop. */
export function useEvent<T = any>(
  target: ChannelTarget,
  event: Source<string | null | undefined>,
  handler: (data: T, metadata?: { user_id?: string }) => void,
  options?: WithHibira,
): () => void;

export function useConnectionState(options?: WithHibira): Readable<ConnectionState>;

export interface Presence<Info = any> {
  channel: Channel | null;
  /** You first. */
  members: Member<Info>[];
  others: Member<Info>[];
  me: Member<Info> | null;
  count: number;
}

export function usePresence<Info = any>(target: ChannelTarget, options?: WithHibira): Readable<Presence<Info>>;

export interface Trigger {
  /** Sends a client event ("client-..."); false when not subscribed yet. */
  (event: `client-${string}`, data?: any): boolean;
  /** Lets go of the channel (done for you when the component is destroyed). */
  stop(): void;
}

export function useTrigger(target: ChannelTarget, options?: WithHibira): Trigger;

export interface UseStreamOptions extends WithHibira {
  /** Default "ai-stream". */
  event?: Source<string | null | undefined>;
  /** Follow only this stream. */
  id?: Source<string | null | undefined>;
  /** Streams kept, default 50. */
  maxStreams?: number;
  /**
   * Catch up from channel history (pusher:rewind) on each subscription, so a
   * reload or a dropped connection does not lose chunks. Needs channel
   * history on for the app (Hobby plans and up).
   */
  rewind?: boolean | RewindOptions;
}

export interface StreamState<Meta = any> {
  channel: Channel | null;
  /** The stream with `id`, or else the one that started last. */
  stream: Stream<Meta> | null;
  streams: Record<string, Stream<Meta>>;
  text: string;
  done: boolean;
  error: string | null;
  /** The last rewind's result, or null before one (or without `rewind`). */
  history: HistoryResult | null;
}

export interface StreamStoreReadable<T> extends Readable<T> {
  /** Forget everything received. */
  reset(): void;
}

export function useStream<Meta = any>(target: ChannelTarget, options?: UseStreamOptions): StreamStoreReadable<StreamState<Meta>>;

export interface UseAgentStreamOptions extends WithHibira {
  /** Follow only this run (the invocation id of broadcastOnQueue()). */
  invocationId?: Source<string | null | undefined>;
  /** Runs kept, default 20. */
  maxRuns?: number;
  /** Catch up from channel history (pusher:rewind) on each subscription. Hobby plans and up. */
  rewind?: boolean | RewindOptions;
  /** Extra event names to listen to, such as a provider's own error types. */
  events?: string[];
}

export interface AgentStreamState {
  channel: Channel | null;
  /** The run with invocationId, or else the one that started last. */
  run: AgentRun | null;
  runs: Record<string, AgentRun>;
  text: string;
  reasoning: string;
  /** "idle" before the first event. */
  status: AgentRunStatus | 'idle';
  done: boolean;
  error: string | null;
  toolCalls: AgentToolCall[];
  approvals: any[];
  history: HistoryResult | null;
}

/** A Laravel AI SDK agent stream (laravel/ai broadcastOnQueue()), put back together. */
export function useAgentStream(target: ChannelTarget, options?: UseAgentStreamOptions): StreamStoreReadable<AgentStreamState>;
