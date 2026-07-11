import { defineConfig } from 'forgedeck'

// Authorization audit surface for hybrid-shop: exactly one mutation is enabled for
// agents in this deployment — creating documents. Every other write stays disabled.
export default defineConfig({
  enabledActions: ['post_documents'],
})
