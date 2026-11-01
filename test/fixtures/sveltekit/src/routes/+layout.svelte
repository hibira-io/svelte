<script>
  import { env } from '$env/dynamic/public';
  import { createHibira, setHibira } from '@hibira-io/svelte';

  let { children } = $props();

  setHibira(
    createHibira({
      appKey: env.PUBLIC_HIBIRA_KEY,
      options: {
        ...(env.PUBLIC_HIBIRA_WS_HOST && {
          wsHost: env.PUBLIC_HIBIRA_WS_HOST,
          wsPort: Number(env.PUBLIC_HIBIRA_WS_PORT),
          forceTLS: false,
          enabledTransports: ['ws'],
        }),
        channelAuthorization: { endpoint: '/api/hibira/auth', transport: 'ajax' },
      },
    }),
  );
</script>

{@render children()}
