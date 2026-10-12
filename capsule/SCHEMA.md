# Capsule schema

What the two workflows expect to find in your Capsule account. Ten minutes of clicking, done once. Nothing here needs a paid Capsule plan; the API and custom fields are on the Free plan too.

## 1. A pipeline for enquiries

Settings, then Sales Pipelines. Create (or rename) a pipeline called **Enquiries** with these milestones, in order:

| Milestone | Meaning | Set by |
|---|---|---|
| New | Someone asked for a call but has not picked a time yet | Router workflow |
| Contacted | You reached out first, or they replied | A person |
| Meeting Booked | A slot exists on a host's calendar | Watcher workflow |
| Meeting Held | The call happened | A person |
| Won | Became a client | A person |
| Lost | Did not proceed (use Capsule's lost reasons) | A person |

The names are what the workflows look for, and they are case-insensitive. Change them in both **Settings** nodes if you prefer other words. The watcher only moves an opportunity *forward* into Meeting Booked from New or Contacted. It never moves one back.

## 2. A DataTag called Attribution

Settings, then Tags, then **Add DataTag**. A DataTag is a tag with fields attached, so attribution sits on the person without cluttering every record. Add these text fields:

| Field | Holds |
|---|---|
| utm_source | e.g. google, facebook, newsletter |
| utm_medium | cpc, social, email |
| utm_campaign | your campaign name |
| utm_content | ad or creative |
| gclid | Google Ads click id (needed for offline conversions later) |
| fbclid | Meta click id |
| landing_url | the first page they landed on |
| booking_key | the id the form generated; ties the request to the calendar event |

Capsule's custom text fields are short, so the workflows cut every value at 250 characters. The full set is also written into the note on the opportunity, so nothing is lost if you skip the DataTag entirely.

## 3. Tags the workflows use

Plain tags are created on first use. You do not need to add them by hand.

| Tag | When |
|---|---|
| form:booking | Every person and opportunity created by the booking form |
| booking:discovery, booking:strategy | Which meeting type was requested or booked |
| booking:cancelled | A booked event was cancelled on the host's calendar |
| src:google, src:facebook, … | Mirrors utm_source so you can filter a saved list by source |
| src:calendar-direct | Someone booked from a direct Google link and skipped the form |
| Attribution | Applied automatically when the DataTag fields are written |

## 4. A personal access token

My Preferences (your avatar, top right), then **API Authentication Tokens**, then Generate. Copy it once. In n8n, create a **Header Auth** credential with name `Authorization` and value `Bearer <token>` and select it on every Capsule node in both workflows.

A token acts as the user who made it. Make it on an account that should own the records the workflows create, or on a dedicated "Automation" user if you have a spare seat.

## 5. Tell the router the field names

The workflows address custom fields by name plus the DataTag they belong to, so there are no ids to copy. Once the DataTag exists, list its field names in `attribution_fields` in the router's **Settings** node. Until then leave the list empty and the attribution goes into the note only.

To check what your account actually has:

```bash
export CAPSULE_TOKEN='paste-your-token-here'
bash capsule/lookup.sh
```

It prints your pipelines with their milestones, and every field definition with the DataTag it belongs to. Everything it does is read-only.

## Limits worth knowing

- Capsule rate-limits the API per user per hour. The `X-RateLimit-Limit` header on any response tells you your number; it is in the thousands. Each booking costs the router about six calls and the watcher about six more, so you will not get near it.
- Capsule search is fuzzy. The workflows only reuse a person on an exact email match, which is why a changed email address creates a new person. Merge them in Capsule when you see it.
- Capsule keeps no field history, so every change the workflows make is also written as a note.
