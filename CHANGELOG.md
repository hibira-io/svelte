# Changelog

## Unreleased

`createHibira()` warns once in the browser when it gets no `appKey`, instead of
staying silent. The README's setup reads the key from
`import.meta.env.VITE_HIBIRA_KEY`, which works on SvelteKit 2 and 3 (on Kit 3,
`$env/dynamic/public` is empty unless the variable is declared).

## 0.1.0

First release, for Svelte 5 and Svelte 4 with SvelteKit: `createHibira()`,
`setHibira()`, `useHibira`, `usePusher`, and stores `useChannel` (shared,
reference-counted subscriptions), `useEvent`, `usePresence`, `useTrigger`,
`useConnectionState`, `useStream` (with `rewind`) and `useAgentStream`;
LLM streaming with `streamToChannel()` (`@hibira-io/svelte/server`); and
`channelAuth()` / `userAuth()` request handlers for `+server.js`
(`@hibira-io/svelte/kit`).
