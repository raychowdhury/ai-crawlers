# Throwaway business fix-plan prototype

Question: Which presentation makes it easiest for a business owner to understand a finding, approve a proposed fix, and understand its outcome?

Run `PORT=3120 npm start` and open `http://localhost:3120/?prototype=fix-plan&variant=A`.

Three options on the existing homepage route:
- A: overview dashboard with a prioritized task list.
- B: guided review with one task in focus.
- C: editorial action list with developer handoff emphasized.

Use the bottom arrows or keyboard arrows to switch. State is in memory only. Example findings are explicitly labeled. Real audits use the existing read-only checking API. Approve and undo are simulations; there is no website connection, AI model, source editing, backup, or publication.

Prototype assets and routing are disabled when NODE_ENV=production. Keep this branch separate from production. Do not merge as a production implementation.

Decision: awaiting owner feedback. After a choice, remove the other layouts and rebuild the selected workflow with real authorization, data handling, tests and connection support.
