# Hon na oříšky!

A side-scrolling arcade game: jump the squirrel Lískulka from tree to tree,
left to right, collecting nuts. Touch the ground and the squirrel gets dizzy: game over.

Plain HTML5 canvas and vanilla JavaScript. No build step and no dependencies.

## Play

```bash
python3 tools/serve.py
```

Then open http://localhost:8123. Opening `game/index.html` directly also works.

| Action | Keys | Touch |
| --- | --- | --- |
| Run | ← → / A D | left part of the screen |
| Jump (hold for higher) | Space / ↑ / W | right half of the screen |
| Mute all sound | M | |
| Music on/off | H | |

Pick the difficulty on the start screen (← →, or tap a button):

- **Lehká** (easy): calm jumping; only falling to the ground ends the game.
- **Těžká** (hard) adds:
  - an energy bar that drains over time, faster the longer you play; nuts
    refill it, and when it runs out the squirrel drops ("Došly mi síly!")
  - cracked branches (bare, grey, with cracks) that break about a second after
    you land; the branches on the guaranteed way forward never crack
  - wind that pushes the squirrel while it is in the air
  - slippery branches while it rains

Each mode keeps its own best score. The tuning constants are at the top of
`game/game.js`.

Nuts are worth 10–50 points (rarer ones are worth more). The game UI is in Czech. The best score is
kept in the browser's localStorage.

## Layout

- `assets/`: the original drawings (photos on paper)
- `game/index.html`, `game/game.js`: the game
- `game/npcs.js`: the forest neighbours (pure decoration, no collisions): an
  owl that sits on some branches, shuffles and hoots ("hú-hú"), and bunnies
  hopping on the ground
- `game/music.js`: the 8-bit background music, synthesized with Web Audio
  (a bouncy day tune and a slower night version)
- `game/weather.js`: day/night cycle and weather (sun, clouds, wind, rain,
  storm, fog). Both run on the game clock, even when the squirrel stands still;
  see the constants at the top of the file
- `game/sprites/`, `game/sprite-data.js`: generated from `assets/`
- `tools/process_assets.py`: removes the paper background, crops and scales
  the drawings, and finds each tree's trunk and branches. The branches become
  the platforms you stand on.

After changing or adding drawings, regenerate the sprites (needs Pillow and
numpy):

```bash
python3 tools/process_assets.py
```

`assets/birds.png` is special: its three gulls (stacked top to bottom) become
the wing-flap frames `bird-1` to `bird-3`.
`assets/sun.png` and `assets/moon.png` are the sun and moon in the sky, and
`assets/trees-bg.png` (three trees side by side) becomes `tree-bg-1` to
`tree-bg-3`, the small trees on the distant hills.
`assets/owl.png` and `assets/bunny.png` are the owl and the bunny; their pencil
legs and whiskers are kept along with the crayon.
`assets/grass.png`: only the plants above the green band are used, as
`grass-1` to `grass-5`, scattered along the ground.
`assets/umbrella.jpg` becomes the umbrella the squirrel holds while it rains;
the script also records where the paw grips its handle.

New trees must be named `tree-N.png` and added to `TREES` in `game/game.js`.
The same goes for nuts (`NUT_TYPES`) and leaves (`LEAVES`).
