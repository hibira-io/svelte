// Compiles test/components/*.svelte with whichever Svelte is installed (5 by
// default, 4 in CI's svelte-4 job) into test/.compiled, and mounts or
// server-renders them.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compile } from 'svelte/compiler';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '.compiled');
export const version = createRequire(import.meta.url)('svelte/package.json').version;
export const svelte5 = version.startsWith('5.');

async function load(name, ssr) {
  const dir = join(out, ssr ? 'server' : 'client');
  mkdirSync(dir, { recursive: true });
  const source = readFileSync(join(here, 'components', `${name}.svelte`), 'utf8');
  const generate = svelte5 ? (ssr ? 'server' : 'client') : ssr ? 'ssr' : 'dom';
  const { js } = compile(source, { filename: `${name}.svelte`, generate, ...(svelte5 ? {} : { format: 'esm' }) });
  const code = js.code
    .replace(/(['"])\.\/(\w+)\.svelte\1/g, '$1./$2.js$1')
    .replace(/(['"])\.\.\/\.\.\/index\.js\1/g, '$1../../../index.js$1');
  for (const [, child] of code.matchAll(/['"]\.\/(\w+)\.js['"]/g)) await load(child, ssr);
  const file = join(dir, `${name}.js`);
  writeFileSync(file, code);
  return (await import(`${pathToFileURL(file).href}?${Date.now()}`)).default;
}

/** Mounts a component in the DOM; returns { target, instance, unmount, flush }. */
export async function mount(name, props = {}) {
  const Component = await load(name, false);
  const target = document.createElement('div');
  document.body.append(target);
  if (svelte5) {
    const { mount, unmount, flushSync } = await import('svelte');
    const instance = mount(Component, { target, props });
    flushSync();
    return { target, instance, unmount: () => unmount(instance), flush: flushSync };
  }
  const { tick } = await import('svelte');
  const instance = new Component({ target, props });
  return { target, instance, unmount: () => instance.$destroy(), flush: () => {}, tick };
}

/** Server-renders a component to HTML. */
export async function render(name, props = {}) {
  const Component = await load(name, true);
  if (svelte5) {
    const { render } = await import('svelte/server');
    return render(Component, { props }).body;
  }
  return Component.render(props).html;
}
