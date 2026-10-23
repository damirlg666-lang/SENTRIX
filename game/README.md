# Ragdoll Sandbox

A 3D physics sandbox in the browser: spawn people and objects, then grab, throw, shoot,
blow up, tie and freeze them. People are active ragdolls — they stand, walk around, run
away from danger, fall over when hit, get back up, bleed, and can be knocked out or killed.

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

## Controls

| Action | Mouse / keys | Touch |
| --- | --- | --- |
| Use the selected tool | Left mouse | One finger |
| Look around | Right mouse drag | Two-finger drag |
| Move the camera | `W` `A` `S` `D`, `Q` / `E` down / up, `Shift` faster | — |
| Zoom | Mouse wheel | Pinch |
| Pan | Middle mouse drag | — |
| Focus on what is under the cursor | `F` | — |
| Select tool | `1`–`8` or the toolbar | Toolbar |
| Spawn menu | `Tab` or the **Spawn** button | **Spawn** button |
| Activate (arm TNT, start a car) | `G` while hovering it | — |
| Delete what is under the cursor | `Delete` | Delete tool |
| Pause / slow motion | `P` / `T` | Top bar |
| Undo last spawn | `Ctrl` + `Z` | Top bar |

### Tools

- **Hand** – drag anything; the wheel pulls it closer or pushes it away, `F` pins it in
  mid-air, letting go throws it.
- **Weapons** – pistol, assault rifle, shotgun, sniper rifle (penetrates), rocket launcher
  and grenades. `R` switches weapon.
- **Explode** – small, medium or huge explosions anywhere; clicking an explosive sets it off.
- **Rope** – click two points to tie them. Tie a bunch of balloons to someone's hand.
- **Force** – a blast of air that knocks things over.
- **Freeze** – freezes objects, or pins the body part of a person you click.
- **Heal** – heals and revives people, repairs objects.
- **Delete** – removes things.

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
  explosions and sudden deceleration.
- `js/engine/` – renderer, sky and image-based lighting, post-processing, camera, physics
  wrapper and procedural textures.
- `js/world/map.js` – terrain, plaza, drop tower, ramp, container, trampoline, trees.
- `js/catalog/`, `js/entities/` – props, explosives, the car and weapon definitions.
- `js/fx/effects.js`, `js/audio.js` – particles, decals and Web Audio sound synthesis.

## Third-party code

- [three.js](https://threejs.org) r182 (MIT) – `vendor/three`
- [Rapier](https://rapier.rs) 0.19.3 via `@dimforge/rapier3d-compat` (Apache-2.0) – `vendor/rapier`
