# bitmark-storage

> **Your Bitmark pod.**

A thin wrapper around [JavaScript Solid Server](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer)
(JSS) with sensible defaults for the Bitmark community. Runs locally,
serves your data over LDP + WebSocket Notifications, and pairs with
[bitmark-os](https://github.com/project-bitmark/bitmark-os).

> 📜 **Heads up.** This repo used to track [`solid/node-solid-server`](https://github.com/solid/node-solid-server)
> (NSS), which is no longer actively maintained. We've cleared house
> and pinned to JSS — same Solid spec, JSON-LD native, actively
> developed, smaller surface, real-time built in.

## Quick start

```bash
# Install (run from a clone of this repo)
git clone https://github.com/project-bitmark/bitmark-storage.git
cd bitmark-storage
npm install

# Run — pod data lives in ~/.bitmark by default; pick anywhere
JSS_SINGLE_USER_PASSWORD=changeme \
  ./bin/bitmark-storage.js start --port 4443 --root ~/.bitmark
```

You'll get a Bitmark pod at `http://localhost:4443/me/` with:

| Endpoint | Purpose |
|---|---|
| `/me/profile/card.jsonld#me` | Your WebID |
| `/me/`                       | Pod root (LDP container) |
| `/idp/credentials`           | OIDC credentials endpoint |
| `/.notifications`            | WebSocket notifications (live updates) |

## Connect bitmark-os

Open <https://project-bitmark.github.io/bitmark-os/>, click **Sign in**,
enter `http://localhost:4443` as the issuer, log in as `me` with the
password you set in `JSS_SINGLE_USER_PASSWORD`. Your shelf, installed
apps, and wallpaper now sync to your pod.

## What this is, exactly

`bitmark-storage` is **not** a fork of JSS. It's a ~30-line wrapper
that:

1. Pulls JSS in as an npm dependency.
2. Calls `jss start` with `--single-user --idp --conneg --notifications`
   pre-baked.
3. Forwards any extra flags through to JSS verbatim.

If you want raw JSS, install it directly. If you want "the storage
layer for the Bitmark community" with sane defaults, install this.

Anything `jss` accepts, `bitmark-storage` accepts:

```bash
bitmark-storage start --port 4443 --root ~/.bitmark
bitmark-storage start --port 4443 --no-conneg          # opt out
bitmark-storage start --port 4443 --nostr --git        # opt in to extras
bitmark-storage passwd me -p hunter2 -r ~/.bitmark      # subcommands pass through
```

## Why not just use JSS directly?

You can — and we recommend it for anything beyond "I want a Bitmark
pod with the defaults the community uses." `bitmark-storage` exists
so:

- Newcomers in the Bitmark community have one canonical "how to run
  your pod" path that matches what bitmark-os expects.
- Bitmark-specific defaults (single-user, IDP, conneg, notifications)
  are versioned together rather than re-typed in every README.
- We can add Bitmark-specific extras over time without forking JSS —
  just append flags or call other JSS subcommands.

## Run as a service

`pm2` works well:

```bash
JSS_SINGLE_USER_PASSWORD=changeme pm2 start "$(which node)" \
  --name bitmark-storage -- ./bin/bitmark-storage.js start \
  --port 4443 --root ~/.bitmark
pm2 save
```

Or `systemd`, `launchd`, etc. — same shape.

## License

AGPL-3.0. © 2026 The Bitmark project and contributors.

JSS, the upstream this wraps, is MIT-licensed.

## See also

- [`project-bitmark/bitmark-os`](https://github.com/project-bitmark/bitmark-os) — the desktop OS that consumes this pod
- [`project-bitmark/bitmark-hub`](https://github.com/project-bitmark/bitmark-hub) — workspace UI for this pod
- [`JavaScriptSolidServer/JavaScriptSolidServer`](https://github.com/JavaScriptSolidServer/JavaScriptSolidServer) — the upstream server
