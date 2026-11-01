<script>
  import { createHibira, setHibira } from '../../index.js';
  import Child from './Child.svelte';

  export let pusher = null;
  export let show = true;
  setHibira(createHibira({ client: () => pusher }));
</script>

{#if show}<Child />{/if}
