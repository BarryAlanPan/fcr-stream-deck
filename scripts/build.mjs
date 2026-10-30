import { mkdir, writeFile, copyFile, readFile } from 'node:fs/promises';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { Resvg } from '@resvg/resvg-js';
import { ACTIONS, PLUGIN_ID } from '../src/actions.mjs';
import { GLYPHS, keySvg } from '../src/render.mjs';

const root = new URL('../', import.meta.url);
const plugin = new URL(`${PLUGIN_ID}.sdPlugin/`, root);
await mkdir(new URL('bin/', plugin), { recursive: true });
await mkdir(new URL('imgs/', plugin), { recursive: true });
await mkdir(new URL('dist/', root), { recursive: true });
await build({ entryPoints: [fileURLToPath(new URL('src/plugin.mjs', root))], outfile: fileURLToPath(new URL('bin/plugin.cjs', plugin)), platform: 'node', target: 'node20', bundle: true, format: 'cjs', external: ['bufferutil', 'utf-8-validate'], legalComments: 'eof' });
for (const action of ACTIONS) {
  for (const [suffix, size] of [['', 20], ['@2x', 40]]) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 50 50"><g fill="none" stroke="currentColor" color="#FFFFFF" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round">${GLYPHS[action.id]}</g></svg>`;
    await writeFile(new URL(`imgs/${action.id}${suffix}.svg`, plugin), svg);
  }
  await writeFile(new URL(`imgs/${action.id}-key.svg`, plugin), keySvg({ title: action.title, glyph: action.id, state: 'reading', active: false }));
}
const icon = `<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 144 144"><rect width="144" height="144" rx="24" fill="#192635"/><path d="M72 22v66M35 65l37-23 37 23M51 93l21-13 21 13" fill="none" stroke="#69e3c0" stroke-width="7" stroke-linecap="round"/><text x="72" y="126" font-family="Arial,sans-serif" font-weight="700" font-size="26" text-anchor="middle" fill="white">FCR</text></svg>`;
await writeFile(new URL('imgs/plugin.svg', plugin), icon);
await writeFile(new URL('imgs/plugin@2x.svg', plugin), icon.replace('width="256" height="256"', 'width="512" height="512"'));
for (const [suffix, size] of [['', 256], ['@2x', 512]]) {
  await writeFile(new URL(`imgs/plugin${suffix}.png`, plugin), new Resvg(icon, { fitTo: { mode: 'width', value: size } }).render().asPng());
}
await writeFile(new URL('ui/actions.js', plugin), `window.fcrActions = ${JSON.stringify(Object.fromEntries(ACTIONS.map(a => [a.uuid, { name: a.name, description: a.description }])))};\n`);
const manifest = {
  $schema: 'https://schemas.elgato.com/streamdeck/plugins/manifest.json', UUID: PLUGIN_ID,
  Name: 'FlightControlReplay', Version: '1.1.1.0', Author: 'FCR Stream Deck Contributors',
  Description: 'Control FlightControlReplay directly through its local HTTP server.',
  Category: 'FlightControlReplay', CategoryIcon: 'imgs/takeControl', Icon: 'imgs/plugin',
  CodePath: 'bin/plugin.cjs', Nodejs: { Version: '20' }, SDKVersion: 2,
  Software: { MinimumVersion: '6.6' }, OS: [{ Platform: 'windows', MinimumVersion: '10' }],
  PropertyInspectorPath: 'ui/settings.html',
  Actions: ACTIONS.map(action => ({ UUID: action.uuid, Name: action.name, Tooltip: action.description,
    Icon: `imgs/${action.id}`, Controllers: [action.id === 'replay' ? 'Encoder' : 'Keypad'], SupportedInMultiActions: false,
    ...(action.id === 'replay' ? { Encoder: { layout: 'layouts/replay.json', TriggerDescription: {
      Push: 'Start / Stop replay', Rotate: 'Seek backward / forward (configured step)', Touch: 'Start / Stop replay',
    } } } : {}),
    DisableAutomaticStates: true, UserTitleEnabled: false,
    States: [{ Image: `imgs/${action.id}-key`, ShowTitle: false }] })),
};
await writeFile(new URL('manifest.json', plugin), JSON.stringify(manifest, null, 2) + '\n');
await copyFile(new URL('README.md', root), new URL('README.md', plugin));
let licenses = 'Third-party libraries bundled in bin/plugin.cjs\n';
for (const name of ['parse5', 'entities', 'ws']) {
  licenses += `\n--- ${name} ---\n${await readFile(new URL(`node_modules/${name}/LICENSE`, root), 'utf8')}\n`;
}
await writeFile(new URL('THIRD-PARTY-NOTICES.txt', plugin), licenses);
console.log(`Built ${PLUGIN_ID}.sdPlugin (${ACTIONS.length} actions)`);
