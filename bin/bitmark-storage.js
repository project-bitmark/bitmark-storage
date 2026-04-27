#!/usr/bin/env node
/**
 * bitmark-storage — your Bitmark pod.
 *
 * A thin wrapper around `javascript-solid-server` with sensible
 * defaults for the Bitmark community: single-user mode + IDP +
 * content negotiation + WebSocket notifications. All flags can be
 * overridden — anything you pass to bitmark-storage is forwarded
 * verbatim to jss after our defaults.
 *
 * Examples:
 *   bitmark-storage start
 *   bitmark-storage start --port 4443
 *   bitmark-storage start --root ~/main --port 4443
 *   bitmark-storage --help    (passes through to jss --help)
 */

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import process from "node:process";

const require = createRequire(import.meta.url);

let jssPath;
try {
  jssPath = require.resolve("javascript-solid-server/bin/jss.js");
} catch {
  console.error("bitmark-storage: javascript-solid-server is not installed.\n" +
    "Run `npm install` here or `npm install -g bitmark-storage` first.");
  process.exit(1);
}

const userArgs = process.argv.slice(2);

// Bitmark defaults — only applied to `start` (the common case). Other
// jss subcommands (passwd, account, init, invite, …) pass through with
// no injection.
const isStart = userArgs[0] === "start";
const startDefaults = ["--single-user", "--idp", "--conneg", "--notifications"];

let finalArgs;
if (isStart) {
  // Drop `start` from userArgs, prepend our defaults, then user args.
  // User flags later in the list win because commander uses last-wins
  // for repeated options.
  const tail = userArgs.slice(1);
  finalArgs = ["start", ...startDefaults, ...tail];
} else {
  finalArgs = userArgs.length ? userArgs : ["--help"];
}

const child = spawn(process.execPath, [jssPath, ...finalArgs], { stdio: "inherit" });
child.on("exit", (code) => process.exit(code ?? 0));
