// Gives node a DOM for mounting components.
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'http://localhost/' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
for (const name of ['Element', 'SVGElement', 'HTMLElement', 'Node', 'Text', 'Comment', 'DocumentFragment', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle', 'requestAnimationFrame', 'navigator']) {
  globalThis[name] ??= typeof dom.window[name] === 'function' && name[0] === name[0].toLowerCase() ? dom.window[name].bind(dom.window) : dom.window[name];
}
