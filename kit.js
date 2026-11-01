// SvelteKit server helpers: request handlers for the endpoints pusher-js
// calls to join private and presence channels (channelAuthorization) and to
// sign a user in (userAuthentication). Use them in a +server.js:
//
//   // src/routes/api/hibira/auth/+server.js
//   import { channelAuth } from '@hibira-io/svelte/kit';
//   export const POST = channelAuth(pusher, ({ locals }, { channelName }) => ...);
//
// Only standard Request and Response are used, so the handlers also work in
// any framework that passes `{ request }`.

async function readBody(request) {
  const type = request.headers.get('content-type') ?? '';
  if (type.includes('application/json')) {
    const body = await request.json().catch(() => null);
    return body && typeof body === 'object' ? body : {};
  }
  const text = await request.text();
  return Object.fromEntries(new URLSearchParams(text));
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const forbidden = () => json({ error: 'forbidden' }, 403);

/**
 * A POST handler for pusher-js channelAuthorization.
 *
 * `authorize(event, { channelName, socketId })` decides: return false (or
 * null/undefined) to refuse with 403, true to allow a private channel, and
 * for presence channels the member, `{ user_id, user_info }`.
 *
 * @param {object} pusher a `pusher` (Node) instance
 * @param {(event: any, request: { channelName: string, socketId: string }) => any} authorize
 */
export function channelAuth(pusher, authorize) {
  return async (event) => {
    const body = await readBody(event.request);
    const socketId = String(body.socket_id ?? '');
    const channelName = String(body.channel_name ?? '');
    if (!socketId || !channelName) return json({ error: 'socket_id and channel_name are required' }, 400);
    const result = await authorize(event, { channelName, socketId });
    if (!result) return forbidden();
    if (channelName.startsWith('presence-')) {
      if (typeof result !== 'object' || result.user_id == null) {
        throw new TypeError(`channelAuth: return { user_id, user_info } for presence channel "${channelName}"`);
      }
      return json(pusher.authorizeChannel(socketId, channelName, { ...result, user_id: String(result.user_id) }));
    }
    return json(pusher.authorizeChannel(socketId, channelName));
  };
}

/**
 * A POST handler for pusher-js userAuthentication (`pusher.signin()`).
 *
 * `authenticate(event, { socketId })` returns the user, `{ id, ...info }`,
 * or false/null to refuse with 403.
 *
 * @param {object} pusher a `pusher` (Node) instance
 * @param {(event: any, request: { socketId: string }) => any} authenticate
 */
export function userAuth(pusher, authenticate) {
  return async (event) => {
    const body = await readBody(event.request);
    const socketId = String(body.socket_id ?? '');
    if (!socketId) return json({ error: 'socket_id is required' }, 400);
    const user = await authenticate(event, { socketId });
    if (!user) return forbidden();
    if (typeof user !== 'object' || user.id == null) throw new TypeError('userAuth: return { id, ... } for the user');
    return json(pusher.authenticateUser(socketId, { ...user, id: String(user.id) }));
  };
}
