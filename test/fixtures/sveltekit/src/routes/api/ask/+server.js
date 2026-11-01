import { error, json } from '@sveltejs/kit';
import { streamToChannel } from '@hibira-io/svelte/server';
import { pusher } from '$lib/server/hibira.js';

// A pretend model; swap in anthropic.messages.stream(...), openai, ai-sdk...
async function* model(question) {
  const answer = `You asked "${question}". SvelteKit renders this page on the server, then the stores take over in the browser and the answer streams in token by token.`;
  for (const word of answer.split(/(?<= )/)) {
    await new Promise((r) => setTimeout(r, 40));
    yield word;
  }
}

export async function POST({ locals, request }) {
  if (!locals.user) error(401);
  const { question } = await request.json();
  const { id } = await streamToChannel(pusher, `private-ai.${locals.user.id}`, model(question), { meta: { question } });
  return json({ id });
}
