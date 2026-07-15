export const copy = {
  nav: { wordmark: 'forgedeck', docs: 'Docs', github: 'GitHub' },
  hero: {
    h1: 'Compile your Next.js app into an MCP server.',
    command: 'npx forgedeck init',
    copied: 'Copied',
    copyFailed: 'Copy failed',
    copyLabel: 'Copy command',
  },
  seeIt: {
    lead: 'Today, your app is invisible to AI agents.',
    body: 'forgedeck reads your routes, server actions, and schemas at build time and emits the semantics agents need to operate your app. Deterministic extraction — no LLM in the loop, nothing guessed.',
  },
  artifacts: {
    heading: 'What a build gives you',
    items: [
      {
        title: '.agent/ bundle',
        body: 'A readable Markdown tree describing every action your app exposes. Check it into your repo. Review it like code.',
      },
      {
        title: 'A live MCP endpoint',
        body: 'Your app serves its own agent surface at /api/mcp. No separate server to deploy, nothing new to run.',
      },
      {
        title: 'A coverage report',
        body: 'See exactly what the compiler understood — with evidence for every claim it makes.',
      },
    ],
  },
  safety: {
    heading: 'Locked by default',
    items: [
      {
        effects: ['read', 'write', 'irreversible'] as const,
        body: 'Every action is labeled read, write, or irreversible. The label travels with the tool.',
      },
      {
        effect: 'write' as const,
        body: 'Mutations ship disabled. You enable them one by one, by exact name. No wildcards, ever.',
      },
      {
        marker: 'locked' as const,
        body: 'Unconfigured endpoints return 404. Without a token, your agent surface is invisible.',
      },
      {
        marker: 'auth' as const,
        body: "Your app's own auth still runs on every request. forgedeck never bypasses it.",
      },
    ],
  },
  handWrite: {
    heading: 'You could write all this by hand',
    body: "The MCP SDK is good. But every tool you hand-write is documentation that can lie: rename a field, change an auth rule, delete a route — your bindings won't notice. forgedeck recompiles on every build, and semantic diffs show up in every PR.",
  },
  proof: {
    heading: 'Measured, not promised',
    preVerdict:
      'forgedeck is developed against OperateBench — an open benchmark asking whether AI agents can operate real web apps. We built it and pre-registered the methodology before running it. Every task, transcript, and failure is public.',
    disclosure: 'OperateBench is built and pre-registered by us. Run it yourself.',
    linkLabel: 'OperateBench',
  },
  humanNote: {
    heading: 'Why forgedeck exists',
    body: "I'm building forgedeck because agents shouldn't need a hand-written translation layer for every app on the web — and no team should have to maintain one. It's early: one person, version 0.x, moving fast. The compiler is free forever under Apache-2.0. It is the product, not the meter.",
    roadmap: 'Roadmap',
  },
  closer: {
    heading: 'Make your app operable.',
    command: 'npx forgedeck init',
    quickstart: 'Quickstart',
  },
  footer: {
    license: 'Apache-2.0',
    links: [
      { label: 'GitHub', href: 'https://github.com/ShobhitPatra/forgedeck' },
      { label: 'Docs', href: '/docs' },
      { label: 'OperateBench', href: 'https://github.com/operatebench/operatebench' },
    ],
  },
} as const
