# Outgoing webhooks

Creators can point Litesubs at their own service and receive a signed HTTP
request when a customer buys a pack or a credit balance changes. This document
is the contract a receiver implements against.

## Scope and access

Configuring webhooks requires the `webhooks:manage` scope. It is separate from
`plans:write` on purpose: registering an endpoint causes customer ids, plan ids,
and balances to leave Litesubs for a URL the caller names, so an OAuth client
must be granted that egress explicitly.

- A **dashboard session** holds `webhooks:manage` and can use the page at
  `/dashboard/developers/webhooks`.
- An **OAuth client** needs the scope granted at consent time.
- A **machine API key** can never configure or read webhooks. It can only hold
  `credits:consume`, and the service rejects it with `FORBIDDEN` even if a scope
  check would otherwise pass.

## Events

| Type | When |
| --- | --- |
| `purchase.completed` | A one-time pack was paid for and its credits were granted. |
| `credits.changed` | A manual adjustment, a usage debit, or a refund changed a balance. |

Payload (the exact bytes that are signed):

```json
{
  "id": "evt_credits_0f1e…",
  "type": "credits.changed",
  "createdAt": "2026-11-16T12:00:00.000Z",
  "data": {
    "creatorId": "…",
    "customerId": "…",
    "planId": "…",
    "transactionId": "…",
    "amount": 5,
    "balance": 12,
    "amountMoney": null,
    "currency": null
  }
}
```

`amount` is the signed credit delta. `balance` is the spendable balance after the
movement. `amountMoney` (minor units) and `currency` are only set for a paid
purchase. There are no Stripe ids, tokens, emails, or names in a payload.

## Headers

| Header | Meaning |
| --- | --- |
| `X-Litesubs-Event-Id` | Stable event identity. **Dedupe on this.** |
| `X-Litesubs-Event-Type` | The event type above. |
| `X-Litesubs-Timestamp` | Unix seconds used in the signature. |
| `X-Litesubs-Signature` | `t=<unix>,v1=<lowercase hex HMAC-SHA256>` |

## Verifying a signature

`v1` is the HMAC-SHA256 of `` `${t}.${rawBody}` `` with the endpoint's signing
secret, over the exact bytes received. Verify against the raw body, not a
re-serialized JSON object.

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(rawBody: string, header: string, secret: string) {
  const parts = Object.fromEntries(
    header.split(",").map((part) => part.split("=") as [string, string]),
  );
  const timestamp = Number(parts.t);
  // Reject replays outside your own tolerance window.
  if (Math.abs(Date.now() / 1000 - timestamp) > 300) return false;
  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const a = Buffer.from(parts.v1 ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

## Delivery and retries

- Delivery is **best-effort at the moment of the ledger change**, inline. There
  is no scheduler; nothing is retried in the background.
- Each attempt has a 5-second timeout. A non-2xx response, a timeout, an
  unreachable host, or a redirect is recorded as a failure. Redirects are not
  followed so a signed payload is never forwarded to an unconfigured host.
- Every attempt is stored with its outcome, HTTP status, error, and duration.
- A failed delivery can be re-sent from the dashboard or
  `POST /api/v1/deliveries/:id/retry`. The re-send uses the **same event id and
  the same stored payload**, so a receiver that dedupes on `X-Litesubs-Event-Id`
  treats it as the same event. A delivery that already succeeded cannot be
  re-sent.
- Failures never roll back a purchase or a credit change. The ledger commits
  first; notification is best-effort.

## REST v1

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/v1/webhooks` | List endpoints (never includes the secret). |
| POST | `/api/v1/webhooks` | Create an endpoint; returns the signing secret **once**. |
| PATCH | `/api/v1/webhooks/:id` | Rename, change URL/events, or enable/disable. |
| DELETE | `/api/v1/webhooks/:id` | Delete an endpoint and its delivery history. |
| POST | `/api/v1/webhooks/:id/test` | Send a test `credits.changed` event. |
| GET | `/api/v1/deliveries` | Recent deliveries, filterable by `endpoint` and `status`. |
| POST | `/api/v1/deliveries/:id/retry` | Re-send one failed delivery. |

URLs must be HTTPS. Loopback (`http://127.0.0.1`, `http://localhost`) is allowed
so a receiver can be tested locally; nothing else over plaintext is accepted.

## Database

- `webhook_endpoints` — per creator: name, URL, events, `active`, `signing_secret`.
  `(creator_id, url)` is unique so two endpoints cannot double-deliver to one URL.
- `webhook_deliveries` — one row per `(endpoint, event)`, unique on that pair so a
  duplicate emission resolves to the existing delivery. Stores the payload
  verbatim, status, attempt count, response status, and last error.
- `webhook_delivery_attempts` — every attempt, unique per
  `(delivery_id, attempt_number)`, so history is append-only and auditable.
