// Compiled by `npm run typecheck`, never run.
import EncryptedPusher from 'pusher-js/with-encryption';
import { get, writable } from 'svelte/store';
import Pusher from 'pusher';
import {
  createHibira,
  setHibira,
  useAgentStream,
  useChannel,
  useConnectionState,
  useEvent,
  usePresence,
  usePusher,
  useStream,
  useTrigger,
} from '@hibira-io/svelte';
import { streamToChannel } from '@hibira-io/svelte/server';
import { channelAuth, userAuth } from '@hibira-io/svelte/kit';

export function layout() {
  setHibira(createHibira({ appKey: 'key', options: { channelAuthorization: { endpoint: '/api/hibira/auth', transport: 'ajax' } } }));
}

export function page() {
  const id = writable(1);
  const channel = useChannel(`private-order-1`);
  const byGetter = useChannel(() => `private-order-${get(id)}`);
  const stop: () => void = useEvent<{ text: string }>(channel, 'message', (m) => m.text.toUpperCase());
  const room = usePresence<{ name: string }>('presence-room');
  const names: (string | undefined)[] = get(room).members.map((m) => m.info?.name);
  const trigger = useTrigger('private-chat');
  trigger('client-typing', {});
  trigger.stop();
  const answer = useStream<{ model: string }>('private-ai', { id: writable('s1'), rewind: true });
  const model: string | undefined = get(answer).stream?.meta?.model;
  answer.reset();
  const agent = useAgentStream('private-hibira-ai.user.1', { rewind: { seconds: 60 }, invocationId: writable('inv') });
  const status: 'idle' | 'streaming' | 'awaiting_approval' | 'done' | 'error' = get(agent).status;
  const state: string = get(useConnectionState());
  return { byGetter, stop, names, model, status, state, pusher: usePusher() };
}

const pusher = new Pusher({ appId: '1', key: 'k', secret: 's', host: 'api.hibira.io' });

type Locals = { user: { id: number; name: string } | null };
export const POST = channelAuth<{ request: Request; locals: Locals }>(pusher, ({ locals }, { channelName }) => {
  if (!locals.user) return false;
  if (channelName.startsWith('presence-')) return { user_id: locals.user.id, user_info: { name: locals.user.name } };
  return channelName === `private-user.${locals.user.id}`;
});
export const signin = userAuth(pusher, () => ({ id: 1, name: 'Ann' }));

export async function server() {
  const r = await streamToChannel(pusher, 'private-ai', ['a', 'b'], { meta: { model: 'm' } });
  return r.id + r.text;
}
export const encrypted = createHibira({ appKey: 'key', Pusher: EncryptedPusher });
