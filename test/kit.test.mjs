import { test } from 'node:test';
import assert from 'node:assert/strict';
import Pusher from 'pusher';
import { channelAuth, userAuth } from '../kit.js';

const pusher = new Pusher({ appId: '1', key: 'key', secret: 'secret', host: 'api.hibira.io' });

function post(body, json = false) {
  return new Request('http://localhost/api/hibira/auth', {
    method: 'POST',
    headers: { 'content-type': json ? 'application/json' : 'application/x-www-form-urlencoded' },
    body: json ? JSON.stringify(body) : new URLSearchParams(body).toString(),
  });
}

test('channelAuth signs a private channel the callback allows', async () => {
  const seen = [];
  const POST = channelAuth(pusher, (event, req) => (seen.push([event.locals, req]), true));
  const res = await POST({ request: post({ socket_id: '1.2', channel_name: 'private-a' }), locals: { user: 1 } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json');
  assert.deepEqual(await res.json(), pusher.authorizeChannel('1.2', 'private-a'));
  assert.deepEqual(seen, [[{ user: 1 }, { channelName: 'private-a', socketId: '1.2' }]]);
});

test('channelAuth signs presence members, and takes JSON bodies', async () => {
  const POST = channelAuth(pusher, async () => ({ user_id: 7, user_info: { name: 'Ann' } }));
  const res = await POST({ request: post({ socket_id: '1.2', channel_name: 'presence-room' }, true) });
  const body = await res.json();
  assert.deepEqual(body, pusher.authorizeChannel('1.2', 'presence-room', { user_id: '7', user_info: { name: 'Ann' } }));
  assert.deepEqual(JSON.parse(body.channel_data), { user_id: '7', user_info: { name: 'Ann' } });
});

test('channelAuth refuses with 403, and 400 without the fields', async () => {
  const POST = channelAuth(pusher, () => false);
  assert.equal((await POST({ request: post({ socket_id: '1.2', channel_name: 'private-a' }) })).status, 403);
  assert.equal((await POST({ request: post({ channel_name: 'private-a' }) })).status, 400);
  const presence = channelAuth(pusher, () => true);
  await assert.rejects(presence({ request: post({ socket_id: '1.2', channel_name: 'presence-x' }) }), /user_id/);
});

test('userAuth signs the user in', async () => {
  const signin = userAuth(pusher, () => ({ id: 3, name: 'Bo' }));
  const res = await signin({ request: post({ socket_id: '1.2' }) });
  assert.deepEqual(await res.json(), pusher.authenticateUser('1.2', { id: '3', name: 'Bo' }));
  const refuse = userAuth(pusher, () => null);
  assert.equal((await refuse({ request: post({ socket_id: '1.2' }) })).status, 403);
});
