# FlightControlReplay for Stream Deck

Stream Deck keys that control FlightControlReplay (FCR) by sending requests directly to its local HTTP server. Includes recording and playback controls and replay tools, with live availability and status shown on each key.

## Install

1. Install **dist/com.local.fcr.streamDeckPlugin** by double-clicking it and accepting Stream Deck's installation prompt.
2. Start FCR with its HTTP server available at `http://127.0.0.1:8085/`.
3. In Stream Deck, expand **FlightControlReplay** and drag actions onto your keys.
4. Keys automatically read FCR's state and become available when their controls are enabled in FCR.

Requires Windows 10 or later and Stream Deck 6.6 or later. Stream Deck supplies the Node 20 runtime; Node and npm are needed only for development. Buttons work on keypad devices, including Stream Deck Mobile. Dial/touchscreen actions are not included.

The plugin's Node process makes the requests, so the Flow CORS patch is **not required for this plugin**. It works alongside the patch in `../fcr-cors` and the widget in `../flow-fcr-widget`. No proxy, browser automation, simulator keyboard shortcuts, or additional listening service is used. The property inspector communicates only with Stream Deck.

## Controls

| Action | Behavior |
| --- | --- |
| Record / Stop | Start recording; stop when FCR reports an active recording |
| Play / Pause | Play, pause, or resume according to FCR; blocked while recording |
| Load Replay | Open FCR's desktop file picker |
| Go to Start / Go to End | Native replay start/end actions |
| Backward / Forward | Native FCR steps; no assumed time interval |
| ReLive / Take Control / CinematicR / Ghost | Native actions with confirmed active state |

Loading a replay or stopping a recording can open desktop file dialogs. Bring FCR forward and complete its native load/save workflow. The plugin does not choose files or dismiss dialogs.

The property inspector has a local server URL (default `http://127.0.0.1:8085/`). Press **Save settings** after editing. Localhost aliases are normalized to IPv4 so keys share one connection and command lock. Only local HTTP root URLs are supported.

Keys show active, disabled, reading, sending, checking, and offline states. Recording is red; other active controls are green. **CHECK FCR** means a command's response was not confirmed and the command may have run. Review FCR before repeating it; clear the warning with **I checked FCR** in the property inspector. **Retry status** only reads state and never repeats a command.

Multi Actions are disabled because commands require asynchronous state confirmation and may open desktop dialogs.

## Direct request protocol

FCR's HTML interface is observed behavior, not a versioned public API. This implementation follows the captured pages and protocol from `flow-fcr-widget`:

- GET the root page and parse inert HTML using parse5. Never execute returned scripts.
- Discover allowlisted form action paths with their current GUID, named submit/hidden values, labels, disabled flags and `activated` classes.
- Before each command, perform a fresh GET and recheck availability. Send one form-encoded POST to the discovered URL.
- Read fresh state after POST. Keep controls locked until a valid page is read, even after a timeout. Never retry POST automatically.

All keys for a server share a synchronous command lock. Concurrent presses are rejected, not queued. Polling runs every two seconds while keys are visible, with five-second retry after failures and an eight-second absolute request deadline. Hiding keys stops polling but lets an in-flight command finish and preserves its warning/lock across profile changes. Starting the plugin never connects the simulator, records, or plays automatically.

The desktop app and Flow widget are independent controllers; the plugin cannot lock their requests. Fresh pre-command reads reduce stale-state risk but cannot make FCR's HTML interface atomic across clients. Unsupported HTML, cross-origin action URLs, unexpected redirects, and ambiguous actions fail closed.

## Develop and verify

```powershell
npm.cmd ci
npm.cmd test
npm.cmd run build
npm.cmd run validate
npm.cmd run pack
```

Optional browser verification (uses an installed Chrome or Edge, or `FCR_TEST_CHROME`):

```powershell
npm.cmd run test:visual
```

This checks the inspector in a headless browser and writes button/inspector previews under `test-results/`.

The bundle in `com.local.fcr.sdPlugin/bin/plugin.cjs` includes its dependencies. Elgato's CLI validates and packages the self-contained plugin into `dist/`. Install that package to test in Stream Deck; rebuilding the project does not update an installed copy automatically.

```powershell
npm.cmd run probe
# Optional alternate local port (GET only):
node scripts/probe.mjs http://127.0.0.1:18085/
```

Tests use captured FCR fixtures and isolated HTTP/WebSocket servers, never real control commands. They cover parsing, rotating tokens, exact bodies, disabled/recording guards, shared locking, profile changes, uncertain POSTs, recovery, and the bundled plugin's Stream Deck registration/events. `probe` checks the running FCR with GET only. Real hardware presses and FCR's native dialogs require a manual smoke test after installation.

Key source files: `src/parser.mjs` (FCR HTML), `src/client.mjs` (request coordination), `src/controller.mjs` (Stream Deck events), `src/render.mjs` (button state), and `com.local.fcr.sdPlugin/ui/` (settings).

Protocol references: [Elgato manifest](https://docs.elgato.com/streamdeck/sdk/references/manifest/), [WebSocket API](https://docs.elgato.com/streamdeck/sdk/references/websocket/plugin/), and [packaging](https://docs.elgato.com/streamdeck/sdk/introduction/distribution/). Runtime dependencies' licenses are included in `THIRD-PARTY-NOTICES.txt` inside the plugin.
