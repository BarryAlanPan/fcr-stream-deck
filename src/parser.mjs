import { parse } from 'parse5';
import { COMMANDS, DEFAULT_URL } from './actions.mjs';

const attr = (node, name) => node.attrs?.find(a => a.name === name)?.value;
const has = (node, name) => attr(node, name) !== undefined;
function descendants(node) {
  return (node.childNodes || []).flatMap(child => [child, ...descendants(child)]);
}
function text(node) {
  return (node.nodeName === '#text' ? node.value : (node.childNodes || []).map(text).join('')).replace(/\s+/g, ' ').trim();
}
function disabled(node) {
  for (let current = node; current; current = current.parentNode) {
    if (has(current, 'disabled') && (current === node || current.tagName === 'fieldset')) return true;
  }
  return false;
}

// Parse inert HTML. Scripts, styles, base URLs and event handlers are never executed.
export function parsePage(html, baseUrl = DEFAULT_URL) {
  const nodes = descendants(parse(html));
  const actions = {};
  for (const form of nodes.filter(n => n.tagName === 'form')) {
    if ((attr(form, 'method') || '').toLowerCase() !== 'post') continue;
    const raw = attr(form, 'action') || '';
    let url;
    try { url = new URL(raw, baseUrl); } catch { continue; }
    // FCR sometimes emits absolute localhost URLs even when contacted via IPv4.
    if (url.hostname === 'localhost' || url.hostname === '[::1]') url.hostname = '127.0.0.1';
    const base = new URL(baseUrl);
    if (base.hostname === 'localhost' || base.hostname === '[::1]') base.hostname = '127.0.0.1';
    if (url.origin !== base.origin || url.username || url.password || url.search || url.hash) continue;
    const match = /^\/([a-zA-Z]+)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(url.pathname);
    if (!match || !COMMANDS.has(match[1])) continue;
    const name = match[1];
    const inputs = descendants(form).filter(n => ['input', 'button'].includes(n.tagName));
    const submits = inputs.filter(n => (attr(n, 'type') || (n.tagName === 'button' ? 'submit' : 'text')).toLowerCase() === 'submit');
    if (submits.length !== 1 || actions[name]) throw new Error('Ambiguous FCR action');
    const submit = submits[0];
    if (has(submit, 'formaction') || has(submit, 'formmethod')) throw new Error('Unsupported FCR form override');
    const body = new URLSearchParams();
    for (const input of inputs) {
      if (!disabled(input) && attr(input, 'name') && (input === submit || (attr(input, 'type') || '').toLowerCase() === 'hidden')) {
        body.append(attr(input, 'name'), attr(input, 'value') || '');
      }
    }
    actions[name] = {
      url: url.href, body: body.toString(), disabled: disabled(submit),
      label: attr(submit, 'value') || text(submit),
      active: (attr(submit, 'class') || '').split(/\s+/).includes('activated'),
    };
  }
  if (!['connection', 'refresh', 'play', 'startrecord'].every(name => actions[name])) {
    throw new Error('Unrecognized FCR page');
  }
  const fields = nodes.filter(n => n.tagName === 'fieldset' && !descendants(n).some(c => ['form', 'input', 'button', 'legend'].includes(c.tagName)));
  const range = nodes.find(n => n.tagName === 'input' && attr(n, 'id') === 'sliderRange');
  let timeline = null;
  if (range && ['min', 'max', 'value'].every(a => has(range, a) && attr(range, a).trim() !== '')) {
    const [min, max, value] = ['min', 'max', 'value'].map(a => Number(attr(range, a)));
    if ([min, max, value].every(Number.isFinite) && max > min) {
      timeline = { min, max, value: Math.max(min, Math.min(max, value)), disabled: disabled(range) };
    }
  }
  return { actions, timeline, status: fields.map(text).filter(Boolean).pop() || 'FCR server available' };
}
