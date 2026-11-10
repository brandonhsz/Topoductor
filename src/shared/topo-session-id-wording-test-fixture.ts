/** Detect address used as a noun for Topo session identity; exclude verbs and distinct run:/dispatch:/group mailboxes. */
export const TOPO_SESSION_ID_AS_ADDRESS =
  /\b(?:orchestration|session|Topo|coordinator's|your(?: own)?) address\b|caller\.address|naming its address/i
