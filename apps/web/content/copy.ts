const name = 'opdeck'
const github = 'https://github.com/ShobhitPatra/forgedeck'

export const copy = {
  name,
  github,
  nav: { github: 'GitHub' },
  hero: {
    h1: 'Make your Next.js app agent-ready.',
    sub: `${name} reads your routes, server actions and schemas at build time and emits the MCP tools agents need. Every mutation stays locked until you allow it by name. No LLM in the loop, nothing guessed.`,
    note: 'Open source, Apache-2.0.',
    noteLink: 'View on GitHub',
  },
  evidence: {
    caption:
      'Literal compiler output. The handler goes in; a described, classified, disabled tool comes out.',
  },
  waitlist: {
    label: 'Email address',
    placeholder: 'you@company.com',
    submit: 'Join the waitlist',
    submitting: 'Joining',
    invalid: 'That does not look like an email address. Check it and try again.',
    duplicate: (email: string) => `${email} is already on the list. Nothing more to do.`,
    failed: 'We could not save that. Your email was not added; try again in a minute.',
    joined: 'You are on the list.',
    joinedDetail: (email: string) => `We will email ${email} when early access opens.`,
    question: 'One optional question, so we build the right thing first:',
    questionLabel: 'What would you want an agent to do in your Next.js app?',
    send: 'Send',
    sending: 'Sending',
    skip: 'Skip',
    thanks: 'Thanks. That goes straight to the person building this.',
    answerFailed: 'We could not save your answer. You are still on the list.',
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
        body: 'See exactly what the compiler understood, with evidence for every claim it makes.',
      },
    ],
  },
  safety: {
    heading: 'Locked by default',
    items: [
      {
        effects: ['read', 'write', 'irreversible'] as const,
        body: 'Every action is labeled. The label travels with the tool.',
      },
      {
        title: 'Mutations ship disabled',
        body: 'You enable them one by one, by exact name. No wildcards, ever.',
      },
      {
        title: 'Invisible without a token',
        body: 'Unconfigured endpoints return 404.',
      },
      {
        title: 'Your auth still runs',
        body: `On every request. ${name} never bypasses it.`,
      },
    ],
  },
  closer: { heading: 'Make your app operable.' },
  footer: {
    license: 'Apache-2.0',
    builtFor: 'Built for Next.js',
    links: [{ label: 'GitHub', href: github }],
  },
} as const
