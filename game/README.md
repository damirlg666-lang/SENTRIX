# Ragdoll Sandbox

A 3D physics sandbox in the browser in the spirit of People Playground: spawn people and
objects, then grab, throw, shoot, stab, burn, electrocute, blow up, tie and freeze them.
People are active ragdolls — they stand, walk around, run away from danger, fall over when
hit, get back up, bleed, and can be knocked out or killed. Bones break, limbs and heads come
off, and syringes, fire and electricity all do what you would expect. A bloodless crash test
dummy is in the People tab too.

### What's in it

- **People**: random men and women in four body types, crowds, and a crash test dummy.
- **Injuries**: bullet wounds, bleeding and blood pools, broken bones (limp, bending the wrong
  way; broken legs or backs stop people standing), and dismemberment — big bullets, blasts,
  blades, violent impacts, or pulling on an anchored body can take limbs, heads or the
  lower body off, leaving a skin/fat/muscle/bone cross-section and arterial spray.
- **Melee**: knife, sword and axe, both as weapons in the weapon bar (stab, slash, chop under
  the cursor) and as physical props that cut when they move fast and stick in point-first.
- **Syringes**: adrenaline (wakes people up, stronger and faster; too much stops the heart),
  life serum (heals, mends bones, revives), acid (dissolves the body from the needle out)
  and sedative.
- **Fire**: wood, cloth, rubber, people and cars burn, char and spread fire; burning people
  panic. The flamethrower lights anything in its cone; explosions start fires.
- **Electricity**: a taser that makes people convulse, and a tesla coil that throws
  lightning at whoever comes close.
- **Machines and props**: thrusters that stick to things, explosives (barrels, TNT, mines),
  crates, barrels, furniture, balloons, dominoes, a brick wall and a drivable car.

Everything (characters, props, textures, sounds) is generated procedurally at load time,
so the game ships without any image, model or audio files.

## Running it

The game is static files only. Serve the `game/` folder with any web server and open it:

```sh
cd game
python3 -m http.server 8000
# then open http://localhost:8000
```

Opening `index.html` directly from disk (`file://`) does not work because browsers block
ES modules and web workers there. GitHub Pages works as-is (the page lives at `/game/`).

Needs a browser with WebGL 2 (current Chrome, Edge, Firefox or Safari).

### Single-file version (offline, Google Sites)

`ragdoll-sandbox.html` is the whole game in one file (about 1.5 MB). Download it and open it
with a double-click — no server needed, and it works offline (including on a Chromebook:
open it from the Files app and it starts in Chrome).

To put it on a Google Site: in the site editor choose **Insert → Embed → Embed code**, paste
the entire contents of `ragdoll-sandbox.html`, click **Next → Insert**, then drag the embed's
corners to make it big. If you have the game hosted somewhere (GitHub Pages), **Embed → By
URL** with that link works too.

Rebuild it after changing the code with `npm install --no-save esbuild` and
`node tools/build-single-file.mjs`.

## Controls

| Action | Mouse / keys | Touch |
| --- | --- | --- |
| Use the selected tool | Left mouse | One finger |
| Look around | Right mouse drag | Two-finger drag |
| Move the camera | `W` `A` `S` `D`, `Q` / `E` down / up, `Shift` faster | — |
| Zoom | Mouse wheel | Pinch |
| Pan | Middle mouse drag | — |
| Focus on what is under the cursor | `F` | — |
| Select tool | `1`–`9` or the toolbar | Toolbar |
| Spawn menu | `Tab` or the **Spawn** button | **Spawn** button |
| Activate (arm TNT, start a car, switch on a thruster or tesla coil) | `G` while hovering it | — |
| Delete what is under the cursor | `Delete` | Delete tool |
| Pause / slow motion | `P` / `T` | Top bar |
| Undo last spawn | `Ctrl` + `Z` | Top bar |

### Tools

- **Hand** – drag anything; the wheel pulls it closer or pushes it away, `F` pins it in
  mid-air, letting go throws it.
- **Weapons** – pistol, assault rifle, shotgun, sniper rifle (penetrates, breaks bones and
  can take limbs off), rocket launcher, grenades, knife, sword, axe, flamethrower and taser.
  `R` switches weapon.
- **Explode** – small, medium or huge explosions anywhere; clicking an explosive sets it off.
- **Rope** – click two points to tie them. Tie a bunch of balloons to someone's hand.
- **Force** – a blast of air that knocks things over.
- **Freeze** – freezes objects, or pins the body part of a person you click (pull on
  something else and limbs can tear off). Also puts out fires.
- **Heal** – heals and revives people, mends broken bones, puts out fires, repairs objects.
  Lost limbs stay lost, and nobody comes back without a head.
- **Delete** – removes things.
- **Control** – take over a person: `WASD` walks relative to the camera, `Shift` runs,
  `Space` jumps and clicking throws punches. `Esc` lets go.

Blades, syringes and thrusters placed from the spawn menu onto a person stick into the part
you click. Grab a stuck item with the hand to pull it out; `G` on a person switches on any
thrusters stuck to them.

## Settings

The gear button opens settings: graphics quality (Low / Medium / High), time of day,
gravity, slow-motion speed, volume, blood on/off and whether people walk around.

- **High**: 4K shadow map, ambient occlusion, bloom, 4× MSAA, most detailed people.
- **Medium**: 2K shadows, bloom and MSAA, lighter people meshes.
- **Low**: no post-processing, 1K shadows, lightest meshes — for laptops and phones.

## How it works

- `js/characters/` – people are sculpted from signed distance fields (smoothly blended
  ellipsoids and tapered capsules), meshed with surface nets inside web workers and skinned
  to a 16-bone skeleton. Clothing is painted per instance and drawn with per-pixel hems.
- `js/characters/ragdoll.js`, `js/entities/person.js` – each person is 16 Rapier rigid
  bodies joined with anatomical joint limits and force-based motors ("muscles"). A balance
  controller keeps conscious people upright; a small state machine handles walking,
  fleeing, falling, getting up, unconsciousness and death. Injuries come from bullets,
  blades, explosions, fire, electricity and sudden deceleration.
- `js/entities/injury.js`, `js/characters/gore.js` – broken bones (slack, loosened joints)
  and dismemberment: the joint is cut, the skinned mesh is split along the skin weights,
  both openings get a cross-section cap, and the material turns double-sided so the
  inside of the body shows through the wound.
- `js/entities/chem.js`, `js/catalog/syringes.js` – syringe substances and their effects.
- `js/fx/fire.js` – flammability, burning, charring and fire spread.
- `js/catalog/melee.js`, `js/catalog/machines.js` – blades, thruster and tesla coil.
- `js/engine/` – renderer, sky and image-based lighting, post-processing, camera, physics
  wrapper and procedural textures.
- `js/world/map.js` – terrain, plaza, drop tower, ramp, container, trampoline, trees.
- `js/catalog/`, `js/entities/` – props, explosives, the car and weapon definitions.
- `js/fx/effects.js`, `js/audio.js` – particles, decals and Web Audio sound synthesis.

## Third-party code

- [three.js](https://threejs.org) r182 (MIT) – `vendor/three`
- [Rapier](https://rapier.rs) 0.19.3 via `@dimforge/rapier3d-compat` (Apache-2.0) – `vendor/rapier`
