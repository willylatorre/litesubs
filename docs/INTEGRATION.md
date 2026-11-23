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

## The flow we want: "Enable liteSubs for my account"

One button in Plannerie's **student subscriptions** section. The teacher should
never see a key, a scope, a webhook, or a plan id.

1. Teacher clicks **Enable liteSubs** in Plannerie.
2. If they have no liteSubs account: Plannerie sends them to sign up (one page),
   then straight back. No separate onboarding wizard.
3. They land on the **liteSubs consent screen** (`/oauth/consent`, already built),
   which asks for the scopes Plannerie needs and names Plannerie as the app.
4. On approve, Plannerie stores the connection and receives:
   - the OAuth grant, for managing plans and customers;
   - a **consume-scoped machine key**, minted for Plannerie as part of the same
     approval (see Gap A).
5. Plannerie now shows the section as enabled, and a single **Connect Stripe**
   button if the teacher cannot sell yet.
6. From then on Plannerie provisions the learner and consumes credits with no
   further teacher action.

The teacher-facing surfaces are exactly two buttons. Everything else is a call.

## Gap A — one credential cannot both manage and consume

Verified in `lib/services/principal.ts`:

```
apiKey  -> only `credits:consume`; every creator scope is FORBIDDEN
oauth   -> every creator scope; `credits:consume` is FORBIDDEN
```

So "Plannerie drives liteSubs" needs **two credentials per teacher**: an OAuth
grant for management, and a machine key for consumption. That split is correct on
the merits — a leaked OAuth token can rewrite plans, a leaked machine key can only
spend credits — but it must not leak into the teacher's experience.

**Plan:** during consent approval, the OAuth client may mint itself one
consume-only key. This needs a new capability, because `auth.api.createApiKey`
requires a browser session today, not an OAuth token:

- New endpoint `POST /api/v1/integration/key` (or an MCP tool) available to an
  **OAuth principal only**, which:
  - creates a key bound to the same creator, permissions `credits:consume`;
  - returns the raw key **once**, never again;
  - records which OAuth client minted it, so revoking the connection revokes it;
  - refuses if the caller is a machine key (no key-minting escalation).
- The key is stored server-side by the client, never sent to a browser.

Rejected alternative: widening machine keys to creator scopes. That would make a
leaked key able to rewrite prices and publish plans, which is a far worse failure
than a drained balance.

## Gap B — there is no "create my customer" endpoint

`enrollCustomer` with an unknown email creates an **invite**; the learner must
sign up and claim it. That is correct for self-serve, and wrong for a teacher
setting up a class on Monday morning.

**Plan:** teacher-initiated provisioning, as a distinct operation:

- `POST /api/v1/customers` (OAuth, `customers:write`) with `{ email, name? }`:
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

- **I1 — key minting on consent.** **Done.** `POST /api/v1/integrationkeys`
  (OAuth only), `GET` to list metadata, `DELETE /:id` to revoke. Machine keys are
  refused with `FORBIDDEN`; a second mint refuses with `KEY_EXISTS` because the
  secret cannot be shown twice. Proven by `lib/integration-contract.integration.test.ts`.
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
