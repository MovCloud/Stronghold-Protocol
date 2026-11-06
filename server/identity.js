// server/identity.js — the reserved Identity seam (DESIGN: 后续可接入 OAuth 规范的外部登录态).
// Today every player session is anonymous: the hello message carries a self-chosen name and a browser identity, and
// the server mints the session token (server/net.js Network). This module only names the interface so a later OAuth
// provider or the admin dashboard can slot in without touching the session stack. Until then `createIdentityProvider()`
// returns the anonymous default and /auth/* answers 501 (server/http/routes.js).

export const IDENTITY_KINDS = Object.freeze(['anonymous', 'admin', 'oauth']);

/**
 * The contract a provider fulfils once identities land:
 *   kind: one of IDENTITY_KINDS
 *   identify(conn, hello) → Promise<{ playerId: string, name: string, authed: boolean, provider?: string }>
 *     - playerId is authoritative and stable across reconnects for authed identities (the admin dashboard's records
 *       and LP history keep working); anonymous providers keep the current behaviour (server/net.js mints it).
 *     - authed=false sessions may only matchmake, never open rooms (计划: 双轨并存).
 * The default below is a placeholder that defers entirely to the existing anonymous flow — it must never be called
 * while that flow is in place; it exists to fix the shape and for unit tests.
 * @param {{ kind?: string }} [opts]
 */
export function createIdentityProvider({ kind = 'anonymous' } = {}) {
  if (!IDENTITY_KINDS.includes(kind)) throw new Error(`unknown identity kind: ${kind}`);
  return {
    kind,
    async identify() {
      if (kind === 'anonymous') return { authed: false, provider: null };
      throw new Error(`identity provider ${kind} is not configured on this installation`);
    },
  };
}
