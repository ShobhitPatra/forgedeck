import { defineConfig } from 'forgedeck'

// Authorization audit surface for hybrid-shop: two mutations are enabled for agents
// in this deployment — creating documents (a pages-api route) and deleting a survey
// (a server action). Every other write stays disabled. `bridges: true` turns the
// enabled SERVER ACTIONS into real HTTP endpoints under app/api/.agent (delete_survey
// gets a shim; post_documents already has an address, so it does not).
export default defineConfig({
  enabledActions: ['post_documents', 'delete_survey'],
  bridges: true,
})
