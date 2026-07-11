#!/usr/bin/env node
import { Command } from 'commander'

const program = new Command()
program.name('forgedeck').description('Compile your app into an MCP server').version('0.0.1')
program.parseAsync()
