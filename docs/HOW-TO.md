# How to

Practical steps for running, checking, changing and sharing BomberBot.

- [Set it up on a computer](#set-it-up-on-a-computer)
- [Build and play it](#build-and-play-it)
- [Play your build on your phone](#play-your-build-on-your-phone)
- [Check that nothing is broken](#check-that-nothing-is-broken)
- [Change things](#change-things)
- [Share the game](#share-the-game)
- [Work on it with Claude](#work-on-it-with-claude)
- [Retake the screenshots](#retake-the-screenshots)
- [When something looks wrong](#when-something-looks-wrong)

## Set it up on a computer

You need two free tools: [Git](https://git-scm.com) to fetch the code and [Node.js](https://nodejs.org) to build it. Version 22 of Node.js is what the game is built and tested with.

```sh
git clone https://github.com/codybakerxx/BomberBot.git
cd BomberBot
npm install
```

`npm install` fetches the build tools into a folder called `node_modules`. You only need to run it once, and again if `package.json` changes.

## Build and play it

```sh
npm run build
```

This writes `dist/index.html`. Open that file in a browser, by double-clicking it or dragging it into a browser window. It is the whole game in one file and needs no server.

On a computer, play with the keyboard: arrow keys to move, Space to drop a bomb, Shift to lift and throw. The on-screen controls only appear on touch screens.

Run `npm run build` again after any change to the code to see it.

## Play your build on your phone

The phone has to fetch the file from your computer, so the computer needs to serve it. With both on the same Wi-Fi:

```sh
npm run build
npx serve dist
```

`serve` prints two addresses. Type the one labelled **Network** (it looks like `http://192.168.1.23:3000`) into the browser on your phone.

The first time, `npx` asks to download `serve`; say yes. Press Ctrl+C in the terminal to stop it.

## Check that nothing is broken

```sh
npm test          # runs every automatic check
npm run typecheck # looks for mistakes in the code without running it
npm run check     # both of the above, then a build
```

`npm test` ends with `all checks passed`. If a check fails, it stops and prints which one and what it expected.

Run `npm run check` before saving any change to GitHub.

The checks cover the rules, the swipe pad and the Match my thumb maths. They cannot tell you how the game *feels*. For that, play it on a phone.

## Change things

### Change one of the game's numbers

Every number has a name. Change the value, then run `npm run check`.

| To change | Edit | In |
|---|---|---|
| Walking speed, bomb fuse, blast time, kick speed, throw distance, the 3-second carry timer | The constants near the top | `src/sim.ts` |
| Starting bombs and blast length | `bombsMax` and `fire` in `createWorld` | `src/sim.ts` |
| How often each power-up appears | The percentages in `createWorld` | `src/sim.ts` |
| How many bricks the arena starts with | `softDensity` default in `createWorld` (0.78) | `src/sim.ts` |
| How far a thumb must move | The constants near the top | `src/swipe.ts` |

The meaning of each one is listed in [GAME-RULES.md](GAME-RULES.md) and [CONTROLS.md](CONTROLS.md).

Some checks state today's numbers on purpose, for example that a thrown bomb lands three tiles away. If you change such a number, the check that mentions it will fail, and the expected value in the test needs changing to match.

### Change the arena size

`createWorld` in `src/sim.ts` takes `cols` and `rows`, the playable size without the outer wall. They default to 13 and 11 and must be odd numbers so the pillars line up. To try another size, pass them where the arena is made, in `newWorld` in `src/main.ts`:

```ts
world = createWorld({
  seed: (Math.random() * 2 ** 31) | 0,
  cols: 17,
  rows: 13,
  players: [...],
});
```

The screen layout adjusts to any size by itself.

### Change who is in the round

`newWorld` in `src/main.ts` lists the players: you first, then the targets. There can be up to four for now, one per corner.

### Add or change a bot colour

The colours are the `COLORS` list at the top of `src/render.ts`. Each has an `id`, a `name` shown in the menu, three shades for the armour (`body`, `light`, `dark`) and a `glow` for the trim, bombs and blasts.

- To change a colour, edit its values.
- To add one, add a line. The menu is laid out for nine (three rows of three on a phone), so a tenth also needs the grid in `src/page.html` changing: look for `#picker`.

The black parts of the robot are the same for every colour and are set once, as `BLACK` and `BLACK_HI`.

### Add a power-up

1. `src/sim.ts`: add its name to `ItemKind`.
2. `src/sim.ts`, `createWorld`: give it a share of the percentages.
3. `src/sim.ts`, `applyItem`: say what picking it up does. If it needs a new ability, add a field to `Player` and set its starting value in `createWorld`.
4. `src/render.ts`: give it a colour in `ITEM_COLOR` and draw its icon in `drawItemIcon`.
5. `src/main.ts`, `drawHud`: show it in the top bar if the player should see they have it.
6. `tests/rules.test.ts`: add a check that it does what it should.

### Change a sound

Each sound is one line in `sfx` at the bottom of `src/audio.ts`: a starting pitch, an ending pitch, a length in seconds, a wave shape and a volume.

### Change words on the screen

Fixed text is in `src/page.html`. Text that changes while playing (the result messages, the Match my thumb prompts) is in `src/main.ts`.

## Share the game

`dist/index.html` is self-contained. To let friends play, put that one file anywhere that serves web pages and send them the address. Any static web host will do.

Things to know:

- The page asks Google Fonts for its typeface. Without a connection it falls back to a font already on the device, and everything still works.
- Settings (bot colour, D-pad setting, Match my thumb) are saved on each person's own phone.
- There is no online play yet. Everyone who opens the page gets their own separate game. Online play will need a small server as well as the page; see [ROADMAP.md](ROADMAP.md).

## Work on it with Claude

This project is written with Claude. To change something, give Claude access to this repository and say what you want in plain words.

What helps most:

- **Say what you saw, not what to change.** "When I run down a corridor and swipe left, the robot goes back up" is far more useful than "make turning better". A screenshot or a sketch helps even more.
- **One thing at a time** when it is about feel. It is much easier to tell what helped.
- **Say what you liked** as well, so it is not changed by accident.
- **Play it on your phone** after every change to the controls. The automatic checks cannot feel anything.

[`CLAUDE.md`](../CLAUDE.md) at the top of the repository tells Claude how this project is organised, the decisions already made, and what to check before finishing. Claude Code reads it at the start of a session.

## Retake the screenshots

The pictures in `docs/screenshots/` come from a script that plays the built game in a phone-sized browser window. It is optional and needs Python 3 and Chrome:

```sh
pip install playwright
npm run build
python3 tools/screenshots.py
```

## When something looks wrong

| What you see | Why, and what to do |
|---|---|
| No on-screen controls | You are on a computer without a touch screen. That is intended: use the keyboard. |
| No sound | Browsers stay silent until the first tap or key press. On some phones the game also goes quiet when the silent switch is on. |
| The robot reads your swipes as the wrong direction | On the menu's Controls tab, check **Steering thumb** is the thumb you steer with, then tap **My thumb** to run Match my thumb. See [MATCH-MY-THUMB.md](MATCH-MY-THUMB.md). |
| You want the swipe pad on the right | On the menu's Controls tab, set **Steering thumb** to Right thumb. |
| You opened the menu by mistake | Tap **✕** or **Resume**. The round was paused, not lost. |
| The robot reacts to tiny thumb movements, or needs too big a swipe | Swipe length is fixed, with no menu setting. To change it for everyone, edit `QUIET` near the top of `src/swipe.ts` (see [CONTROLS.md](CONTROLS.md)). |
| You cannot tell whether Match my thumb is on | On the menu's Controls tab, under Swipe direction, the side in use is filled in and tagged **On**. While playing, the corner of the swipe pad says **Standard swipes** or **✓ My thumb swipes**. |
| Your settings are gone | They are saved per browser, per device. A different browser, a private window or cleared site data starts fresh. |
| You changed the code and nothing looks different | Run `npm run build` again, then reload the page. |
| `npm run build` says the marker is missing | `src/page.html` must still contain `/*__BUNDLE__*/` inside its last `<script>` tag. That is where the code goes. |
| `npm test` fails | The message names the check and what it expected. Either the change broke a rule, or the rule was changed on purpose and the check needs updating to match. |
