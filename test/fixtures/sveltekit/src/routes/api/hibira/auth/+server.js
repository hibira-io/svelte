import { channelAuth } from '@hibira-io/svelte/kit';
import { pusher } from '$lib/server/hibira.js';

export const POST = channelAuth(pusher, ({ locals }, { channelName }) => {
  if (!locals.user) return false;
  if (channelName === 'presence-lobby') return { user_id: locals.user.id, user_info: { name: locals.user.name } };
  return channelName === `private-ai.${locals.user.id}`;
});
