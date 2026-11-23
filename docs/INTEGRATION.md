# Integration contract: liteSubs as a platform other products can drive

Status: **I1 and I2 implemented** (2026-11-23). Extends `docs/REFOCUS.md` and
`docs/PLATFORM-BILLING.md`. I3 is Plannerie-side; I4 is partial (prose casing done).

## Ownership model

liteSubs is a product in its own right that **any** platform can drive. Plannerie
is one customer of it, not a special case.

- **Creator is the tenant.** Each teacher optionally creates their own liteSubs
  account — their own Stripe Connect, their own plans, their own customers.
- **Plannerie is a client**, holding one connection per teacher who enabled it.
- **The learner is the teacher's customer.** Never a Plannerie user (Plannerie
  D019), and not a "platform user" either.

Consequence: nothing in liteSubs may assume Plannerie. No `plannerie` columns, no
branching on the caller's product, no Plannerie-shaped response. The only shared
thing is the API contract and the brand attribution.

## The flow: "connect liteSubs" with one API key

A liteSubs API key already carries the scopes it was minted for, so one pasted
string authorizes exactly what a delegated grant would. There is no consent
screen, no Client ID Metadata Document, and no PKCE.

1. The teacher creates a key in liteSubs (**Developers → API keys**) with the
   scopes the platform needs, or a connected client mints one for them via
   `POST /api/v1/integrationkeys`.
2. They paste it into the platform's own settings screen.
3. The platform verifies it against `GET /api/v1/me` — which returns the creator
   id, name, tier and the credential's own scopes — and stores it encrypted.
4. From then on the platform provisions learners and consumes credits with no
   further teacher action.

**An earlier draft of this document specified OAuth + CIMD + PKCE.** It was
dropped, and the reason is worth recording so nobody rebuilds it: liteSubs's CIMD
validator refuses a `client_id` that resolves to a private address, and loopback
is exempted only for `redirect_uris`. A local connect therefore returned
`invalid_client` regardless of configuration, which made the whole flow
untestable outside a public deployment. An API key has no such restriction.

## Resolved — one credential can now both manage and consume

This used to be a blocker. `requireScope` refused every creator scope to a machine
key ("Machine keys can only consume credits"), which forced any integration that
did more than spend credits into an OAuth app.

That restriction is gone. A key stores `{ resource: [action] }`, and
`apiKeyPrincipal` derives the principal's scopes from the stored key — the same
`requireScope` then authorizes either transport identically. What keeps it safe:

- **Scopes come from the key, never from the request.** Nothing a caller sends can
  widen its own access.
- **`credits:consume` stays API-key-only.** The credential that spends money
  should be one a teacher can name and revoke on its own, not folded into a broad
  management grant.
- `mintIntegrationKey` deliberately omits `webhooks:manage`: a delegated key must
  not choose where a tenant's data is sent.

## Gap B — there is no "create my customer" endpoint

`enrollCustomer` with an unknown email creates an **invite**; the learner must
sign up and claim it. That is correct for self-serve, and wrong for a teacher
setting up a class on Monday morning.

**Plan:** teacher-initiated provisioning, as a distinct operation:

- `POST /api/v1/customers` (`customers:write`) with `{ email, name? }`:
  - if a liteSubs user with that email exists, link them as this creator's
    customer (no duplicate account);
  - if not, create the account **unclaimed**, and send the standard invite so the
    learner later sets a password and can see their own balance;
  - never email a temporary password. An emailed default password is a
    credential in a mailbox, and the invite flow already proves the address.
- Idempotent per `(creator, email)`: calling twice returns the same customer.

Then `enroll_customer` / `grant_credits` work against that customer immediately,
so the teacher can hand out credits before the learner has ever logged in.

## Gap C — the learner still has to buy

Unchanged and intended: the teacher sends the link, the learner pays normally.
Planning assumes **consume works for an unclaimed customer** — the credit ledger is
keyed by enrollment, not by the learner being signed in. Worth a test.

## Where bookings hook in

Plannerie owns scheduling (T200). The join is one call each way:

- on confirm: `POST /api/v1/credits/consume` with `idempotency_key: booking:<id>`;
- on policy-allowed cancel: a compensating grant keyed `cancel:<id>`.

liteSubs knows nothing about bookings. It knows "spend N" and "give back N".
A platform with no bookings uses the same two calls for anything else.

## Brand

**liteSubs, by Plannerie** — a subtitle, never part of the wordmark.

| Context | Text |
| --- | --- |
| App chrome subtitle | `by Plannerie` |
| Landing hero | `liteSubs, by Plannerie` |
| Consent screen app name | `liteSubs` / `by Plannerie` |
| Org metadata | `Organization` for liteSubs, `parentOrganization` Plannerie |

Casing note: the repo says **liteSubs** 160 times and `liteSubs` 3. The brand mark
is `liteSubs`; whether prose follows is a separate, mechanical decision — flagged
rather than mass-renamed here, because a 160-site rename buried in a feature
commit makes review harder.

Attribution must not imply subordination: "by Plannerie" says who made it, not
who it is only for. The product still has to work for any platform.

## Slices

- **I1 — key minting.** **Done.** `POST /api/v1/integrationkeys` (OAuth
  connection only — a key must not mint another key, or one leaked key escalates
  to a fresh long-lived credential), `GET` to list metadata, `DELETE /:id` to
  revoke. A second mint refuses with `KEY_EXISTS` because the secret cannot be
  shown twice. The key it mints carries consumption **and** management scopes, so
  one key drives the integration. Proven by
  `lib/integration-contract.integration.test.ts`.
- **I0 — keys carry creator scopes.** **Done.** `apiKeyPrincipal` derives scopes
  from the stored key, so a pasted key authorizes management without an OAuth app.
  `GET /api/v1/me` exists so a client can learn whose account a key acts for.
- **I2 — customer provisioning.** **Done.** `POST /api/v1/customers`, idempotent
  per `(creator, email)`, creates an unclaimed account, links a
  `creator_customers` row, and emails nothing. Proven: the customer is granted
  and debited while `emailVerified` is still false.
- **I3 — the enable flow in Plannerie.** Not started (Plannerie side). Two
  buttons, one connection per teacher, Stripe onboarding surfaced only when it
  blocks selling. Depends on I1 and I2, both done.
- **I4 — brand subtitle.** **Done.** `AnimatedLogo subtitle`, metadata title
  template + OpenGraph siteName, and Organization JSON-LD with
  `parentOrganization`. Prose casing normalised in 59 files; wire headers and
  URLs deliberately untouched.

## STOP conditions

- A shortcut widens machine keys beyond `credits:consume`. Stop; that trades a
  drainable balance for a rewritable catalogue.
- Provisioning would email a password or skip address proof. Stop; use the invite.
- Any liteSubs change branches on "is the caller Plannerie". Stop; it is a general
  contract or it is not built.
