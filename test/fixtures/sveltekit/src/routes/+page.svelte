<script>
  import { useConnectionState, useEvent, usePresence, useStream, useTrigger } from '@hibira-io/svelte';

  let { data } = $props();
  const connection = useConnectionState();
  const lobby = usePresence('presence-lobby');
  const trigger = useTrigger('presence-lobby');
  const answer = useStream(() => (data.user ? `private-ai.${data.user.id}` : null));

  let typing = $state('');
  let timer;
  useEvent('presence-lobby', 'client-typing', (_, meta) => {
    typing = $lobby.members.find((m) => m.id === meta?.user_id)?.info?.name ?? '';
    clearTimeout(timer);
    timer = setTimeout(() => (typing = ''), 1500);
  });

  let question = $state('What does this page do?');
  async function ask(event) {
    event.preventDefault();
    await fetch('/api/ask', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question }) });
  }
</script>

<main>
  <h1>Hibira + SvelteKit</h1>
  <p>Connection: <strong id="state">{$connection}</strong></p>
  <p>Signed in as <strong id="me">{data.user?.name ?? 'nobody'}</strong></p>

  <section>
    <h2>Lobby (<span id="count">{$lobby.count}</span> online)</h2>
    <ul id="members">
      {#each $lobby.members as m (m.id)}
        <li>{m.info?.name}{m.me ? ' (you)' : ''}</li>
      {/each}
    </ul>
    <p id="typing">{typing ? `${typing} is typing…` : ''}</p>
  </section>

  <form onsubmit={ask}>
    <input bind:value={question} oninput={() => trigger('client-typing', {})} aria-label="Question" />
    <button>Ask</button>
  </form>
  <p id="answer">{$answer.text}{$answer.stream && !$answer.done ? '▍' : ''}</p>
</main>

<style>
  main { font-family: system-ui, sans-serif; max-width: 40rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  form { display: flex; gap: 0.5rem; }
  input { flex: 1; padding: 0.4rem 0.6rem; }
  #answer { min-height: 4.5rem; padding: 0.75rem; background: #f4f4f7; border-radius: 0.5rem; }
</style>
