#!/usr/bin/env node
/**
 * opdeck CLI entry — thin by design.
 *
 * This file does exactly two things: set up the program and register commands.
 * No command logic lives here. Each command is one module under `src/cli/` that
 * parses flags and calls the tested library; see the ENFORCED RULE in each.
 */

import { Command } from 'commander'
import { registerBuild } from './build.js'
import { registerDiff } from './diff.js'
import { registerInit } from './init.js'
import { registerServe } from './serve.js'

const program = new Command()
program.name('opdeck').description('Compile your app into an MCP server').version('0.0.1')

registerBuild(program)
registerDiff(program)
registerInit(program)
registerServe(program)

program.parseAsync()
