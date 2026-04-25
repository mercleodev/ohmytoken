#!/usr/bin/env node
import { argv, stdout, exit } from "node:process";

import { runCli } from "./cli.js";

const code = await runCli(argv.slice(2), stdout);
exit(code);
