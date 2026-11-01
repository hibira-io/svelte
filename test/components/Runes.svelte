<script>
  import { createHibira, setHibira, useChannel } from '../../index.js';

  let { pusher } = $props();
  setHibira(createHibira({ client: pusher }));
  let id = $state(1);
  const channel = useChannel(() => `private-order-${id}`);

  export function next() {
    id++;
  }
</script>

<p id="channel">{$channel?.name ?? ''}</p>
