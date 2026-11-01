<script>
  import { useChannel, useConnectionState, useEvent, usePresence, usePusher, useStream } from '../../index.js';

  const pusher = usePusher();
  const state = useConnectionState();
  const room = usePresence('presence-room');
  const channel = useChannel('private-orders');
  const answer = useStream('private-ai');
  let last = '';
  useEvent('private-orders', 'created', (order) => (last = order.id));
</script>

<p id="state">{$state}</p>
<p id="count">{$room.count}</p>
<p id="me">{$room.me?.info?.name ?? ''}</p>
<p id="channel">{$channel?.name ?? ''}</p>
<p id="text">{$answer.text}</p>
<p id="last">{last}</p>
<p id="client">{pusher ? 'yes' : 'no'}</p>
