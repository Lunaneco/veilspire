# Veilspire

[![CI](https://github.com/Lunaneco/veilspire/actions/workflows/ci.yml/badge.svg)](https://github.com/Lunaneco/veilspire/actions/workflows/ci.yml)
[![Deploy GitHub Pages](https://github.com/Lunaneco/veilspire/actions/workflows/pages.yml/badge.svg)](https://github.com/Lunaneco/veilspire/actions/workflows/pages.yml)

Veilspire is an original browser-based, open-world magical action RPG built
with Three.js. Its world, characters, effects, textures, and audio are
generated at runtime; the repository does not include third-party game assets.

Created by Lunaneco.

This is an independent project and is not affiliated with or endorsed by any
existing game, film, book, publisher, or entertainment franchise.

**[Play Veilspire in your browser](https://lunaneco.github.io/veilspire/)**

## Gameplay trailer

<a href="./media/veilspire-pv-ja.mp4">
  <img src="./media/veilspire-pv-poster.jpg" alt="Veilspire gameplay trailer title card" width="800">
</a>

[日本語版を見る（irodori-TTSナレーション付き）](./media/veilspire-pv-ja.mp4)
·
[Watch in English](./media/veilspire-pv-en.mp4)

## Features

- A procedural 3D world with a castle, village, ruins, cavern, weather, and a
  day/night cycle
- Third-person exploration, swimming, flight, lock-on combat, spells, enemies,
  a boss encounter, quests, dialogue, equipment, crafting, and progression
- A north-up valley map with color-coded markers for the player, main and side
  objectives, unopened treasure, and living enemies
- Procedurally synthesized ambience and effects
- Local-only save data with no account, analytics, advertising, or remote API

## Requirements

- Node.js 24 recommended; Node.js 20.19+ within 20.x or Node.js 22.12+ is
  supported
- npm
- A modern desktop browser with WebGL 2 support

## Run locally

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. The development server binds to
`127.0.0.1` so it is not exposed to the local network.

For a production build:

```sh
npm run build
npm run preview
```

The generated site is written to `dist/`. `vite preview` is intended only for
local verification, not as a production server.

## Controls

| Action | Input |
| --- | --- |
| Move / sprint / jump / dodge | WASD or arrows / Shift / Space / Q |
| Basic bolt / ward | Left mouse or Z / right mouse or X |
| Push / ember / frost / levitate | E / R / C / V |
| Lock on / interact / fly | Tab / F / G |
| Character panel / potions | I / 1 or 2 |
| Veilbreak | T |
| Controls panel / profiler | ? or `/` / F3 |

## Privacy and security

Veilspire has no backend and sends no gameplay or personal data to a server.
Progress is stored in the browser's `localStorage` under keys beginning with
`veilspire.`. Clearing the site's browser storage resets that progress.

No environment variables or credentials are required. Never add secrets to
client-side code: everything shipped in a browser bundle is public. See
[SECURITY.md](SECURITY.md) for responsible vulnerability reporting.

The repository intentionally excludes dependency folders, build output,
machine-local assistant/editor settings, environment files, certificates, and
private keys. Install exactly the dependency versions recorded in
`package-lock.json` with `npm ci`.

## GitHub Pages

The included workflow builds and deploys `dist/` from the `main` branch. In the
repository's **Settings → Pages**, select **GitHub Actions** as the publishing
source. Do not select **Deploy from a branch**: that option serves the
unbundled source files and the game will not load correctly. Relative asset
paths are configured so project pages work under a repository subpath.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md)
before opening a pull request.

## License

Released under the [MIT License](LICENSE).
