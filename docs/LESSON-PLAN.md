# Lesson plan: free booking that keeps the click

Google appointment schedules and Capsule CRM, wired so that every booking lands in the CRM with the ad or link that caused it. Two tracks: one for a single person with nothing to install, one for a team with n8n. The repository this sits in has everything both tracks need.

## Who this is for

- A sole practitioner, consultant or adviser who wants bookings in Capsule without paying for a scheduler. Track A.
- A small business or advice practice with several people taking bookings, or that already runs n8n. Track B.
- Trainers and consultants who set this up for clients. The facilitator notes at the end are for you.

You do not need to write code on either track. Track A is two files pasted into a Google Apps Script project. Track B is two JSON files imported into n8n.

## Pick a track

| | Track A: solo | Track B: team |
|---|---|---|
| Hosts | One calendar | Any number, round robin per meeting type |
| What runs the logic | Google Apps Script, inside your own Google account | n8n (Cloud or self-hosted) |
| Cost | Nothing | n8n's smallest plan, or nothing if self-hosted |
| How the watcher wakes | A calendar trigger (fires on change) plus a 15-minute safety timer | A two-minute poll across every host calendar |
| Time to set up | About 45 minutes | About 90 minutes |
| Attribution | Note on the opportunity, optional DataTag fields | Same |
| Routing, weighting, server-side conversions | No | Yes, or easy to add |

If you have one calendar and no routing to do, take Track A. If you have two hosts or more, or you want the n8n workflows as a base to extend, take Track B. Both share Modules 1 and 2.

## What you will have at the end

1. A `/book/` page on your own site that captures attribution and then shows your Google booking page.
2. A Capsule pipeline where every request appears at **New** with its source, and every booked slot moves it to **Meeting Booked** with the time and link.
3. Cancellations recorded automatically.
4. On Track B, a rollout plan for moving a team off a paid scheduler without losing a booking.

## Before you start

| You need | Notes |
|---|---|
| Google Workspace or a Google account | Business Starter and personal accounts get one booking page per person; several pages and email reminders need Business Standard or above, Workspace Individual, or Google One Premium. |
| Capsule CRM | A plan with API access and admin rights. The Free plan allows one pipeline and five custom fields, so on Free keep the attribution in the note and skip the DataTag. Confirm API access on your plan before you start. |
| n8n (Track B only) | Cloud or self-hosted on HTTPS. |
| A page you can edit | Anywhere you can paste HTML and JavaScript. |

## The principle (10 minutes, both tracks)

A booking page does one job: it lets a stranger pick a slot. Somewhere along the way we asked it to do three more: know who the person is, know where they came from, and tell the CRM. Paid schedulers do that with redirects, prefilled links and webhooks, and charge per seat for it.

Google's booking page does none of those three. No redirect after booking, no prefill from the URL, no webhook. If you try to wire it the way you wired Calendly, you give up in an afternoon, and that is why nobody has.

So we stop asking the booking page to carry anything. **Capture first** on a form you own. **Then book** on Google's page. **Then watch the calendar**, because the event that appears on the host's calendar is the one signal Google gives reliably, and the Calendar API reads it for free.

**Check yourself:** explain in two sentences why the UTM has to be captured before the visitor sees the booking page, not after. If you can, the rest is plumbing.

## Module 1: Capsule schema (15 minutes, both tracks)

**Why.** Both tracks look for milestones by name, and optionally for a DataTag that holds the attribution fields. Build the shelf before the boxes arrive.

**Do.**
1. Settings, then Sales Pipelines. In your pipeline (Free and Starter have one; call it **Enquiries** if you can name it) make sure these milestones exist: New, Contacted, Meeting Booked, Meeting Held, then Won and Lost. On Track A you can run `createMilestones()` from the script instead of clicking.
2. Optional, if your plan has room for eight custom fields: Settings, then Tags, then Add DataTag called **Attribution** with text fields utm_source, utm_medium, utm_campaign, utm_content, gclid, fbclid, landing_url, booking_key.
3. My Preferences, then API Authentication Tokens. Generate one and keep it somewhere safe.
4. Optional check from a terminal: `export CAPSULE_TOKEN='...'` then `bash capsule/lookup.sh`.

**Check.** The pipeline shows the milestones in that order. If you made the DataTag, `lookup.sh` lists its eight fields.

**Common mistake.** Making the attribution fields as plain custom fields rather than inside a DataTag. It still works, but every person record then shows eight empty fields.

## Module 2: Google booking pages (10 minutes, both tracks)

**Why.** One appointment schedule per meeting type. The schedule's title becomes the event title on the calendar, which is how the watcher later tells a quick chat from a longer conversation.

**Do.**
1. In Google Calendar, Create, then Appointment schedule. Name it as you will refer to it, for example *A quick chat* (10 min) and *A conversation* (40 min). The watcher matches on these words.
2. Booking form: keep first name, last name and email. Turn on email verification if your edition offers it.
3. Booking confirmations and the calendar invite stay on. They carry the reschedule and cancel links, which you are not building yourself.
4. Reminders: on if your edition allows it. The text cannot be edited.
5. Share, then **Website embed**. Copy the long `calendar.google.com/calendar/appointments/schedules/...` URL. That is the one that loads inside a frame.
6. Repeat for each meeting type (and on Track B, for each host).

**Check.** Book a test slot with a personal email. The event appears on the calendar with you as organiser and the test address as a guest, and that inbox gets a confirmation.

**Common mistake.** Copying the short `calendar.app.google` link. It works as a plain link but is not the embed form. Another: on Business Starter a second schedule is refused; either upgrade one user or run one meeting type.

---

## Track A: solo, with Apps Script

### Module A1: The script (15 minutes)

**Why.** Apps Script is a free place inside your Google account to run small jobs. It can read your calendar without any OAuth setup, it can call Capsule's API, and Google will fire it whenever your calendar changes. One project does both halves of the recipe.

**Do.**
1. Go to script.google.com, New project, name it *Booking to Capsule*.
2. Replace the contents of `Code.gs` with `appsscript/Code.gs` from the repository.
3. Project Settings (the cog), tick *Show "appsscript.json" manifest file in editor*, open it and replace its contents with `appsscript/appsscript.json`. That enables the Calendar service and sets the web app to run as you.
4. Still in Project Settings, under Script Properties add `CAPSULE_TOKEN` (the token from Module 1) and `FORM_SECRET` (any long random string; a password generator is fine).
5. Back in the editor, edit `CONFIG` at the top: your email domain in `INTERNAL_DOMAINS`, the words from your schedule titles in `SUMMARY_MATCH` and `MEETING_TYPES`, your time zone, and `PIPELINE_NAME` if your account has more than one pipeline.
6. Select `setup` in the function dropdown and Run. Approve the permissions when asked (calendar, external requests, triggers). Read the log.

**Check.** The log says the Capsule token works, lists your milestones, and says two triggers were installed. If it warns about a missing milestone, run `createMilestones()` and then `setup()` again.

**Common mistakes.** Pasting the token into the code instead of Script Properties. Leaving `INTERNAL_DOMAINS` as the example domain, so you appear as a guest on your own meetings.

### Module A2: Deploy and test the form half (10 minutes)

**Do.**
1. Run `testBooking()` from the editor. It simulates a form submission.
2. In Capsule, find "Test Booking". You should see one person, one opportunity at New with tags `form:booking`, `booking:quick`, `src:lesson`, and a note that starts "Booking requested".
3. Run `testBooking()` again. No second person, no second opportunity, one more note. That is the dedupe working.
4. Deploy, then New deployment, type Web app, Execute as *Me*, Who has access *Anyone*. Deploy, approve, copy the URL ending in `/exec`.
5. Paste that URL into a browser tab. It should show a small JSON reply with `ok: true`.

**Check.** The test person is in Capsule and the `/exec` URL answers.

**Common mistake.** Choosing *Anyone with Google account* instead of *Anyone*; visitors to your page are anonymous. Another: after editing the code, forgetting Deploy, then Manage deployments, then Edit, then New version. The URL only updates when you publish a new version.

### Module A3: The page and the calendar half (15 minutes)

**Why.** With one host, the page already knows both booking URLs, so it shows the Google page the moment the form is valid. The Capsule write happens in the background, and the calendar trigger finishes the story.

**Do.**
1. Copy `form/book-solo.html` to `/book/` on your site, or lift its form and script into your template.
2. Set `SCRIPT_URL` to the `/exec` URL, `FORM_SECRET` to the same value as the script property, and the two `BOOKING_PAGES` URLs from Module 2.
3. Visit `/book/?utm_source=google&utm_medium=cpc&utm_campaign=lesson&gclid=test123`, submit with a fresh test email, and book a slot on the Google page that appears.
4. Wait a minute. Open the Apps Script project, Executions, and confirm `onCalendarChanged` ran.

**Check.** In Capsule the new person has an opportunity at Meeting Booked, the tag `booking:quick` or `booking:conversation`, a note with the utm values and gclid, and a second note that starts "Meeting booked" with the day, time and calendar link. Cancel the event from the invite in your test inbox; within a minute or two the opportunity gains `booking:cancelled` and a note.

If the Executions list shows the trigger ran but Capsule has nothing, open that execution's log; the error names the Capsule call that failed.

**Common mistakes.** The schedule title does not contain any `SUMMARY_MATCH` word, so the watcher ignores the booking. The form's `FORM_SECRET` does not match the script property, so `doPost` refuses the request (the Executions log shows "bad secret").

### Going live on Track A

Put the real links in, remove the test person from Capsule, and point every booking link you have (email signature, LinkedIn, Google Business Profile) at `/book/?utm_source=...`. Never link to the Google page directly, or the attribution dies there.

---

## Track B: a team, with n8n

### Module B1: The router workflow (20 minutes)

**Why.** This is the half that answers the form. It must reply fast, so it responds with the booking page before it talks to Capsule at all, and it picks a host by round robin.

**Do.**
1. In n8n, Credentials, then Header Auth. Name `Authorization`, value `Bearer <your Capsule token>`.
2. Import `workflows/booking-router.json`. Open each node that starts with *Capsule:* and select the credential.
3. Open **Settings**. Fill in hosts, their booking page URLs per meeting type, the pipeline and milestone names from Module 1, and the eight field names in `attribution_fields` if you made the DataTag.
4. Activate the workflow. Open the Webhook node and copy the **production** URL.
5. Test from a terminal:

```bash
curl -s -X POST "https://YOUR-N8N/webhook/book" -H "Content-Type: application/json" \
  -d '{"first_name":"Test","last_name":"Person","email":"you+test@yourdomain.co.nz","meeting_type":"discovery","need":"Trying the router","consent":true,"utm_source":"lesson","utm_campaign":"module3","booking_key":"bk_lesson"}'
```

**Check.** The reply is JSON with `ok: true` and a `booking_url`. In Capsule, a new person, an opportunity at New with tags `form:booking`, `booking:discovery`, `src:lesson`, and a note that starts "Booking requested". Run the same curl again: no second person, no second opportunity, one more note.

**Common mistakes.** Forgetting to select the credential on one of the eight Capsule nodes (the execution shows exactly which). Milestone names that differ from the pipeline by a letter.

### Module B2: The watcher workflow (15 minutes)

**Why.** Google will not tell you about a booking. The watcher asks every two minutes which events changed on every host's calendar, and only acts on ones with an outside guest it has not seen at that version.

**Do.**
1. Credentials, then Google Calendar OAuth2. Sign in as an account that can see every host's calendar. For a team, share each host's calendar with a shared account ("See all event details"), or use a service account with domain-wide delegation.
2. Import `workflows/calendar-watcher.json`. Select the Google credential on the Google node and the Capsule credential on the Capsule nodes.
3. Open **Settings**. Hosts with their calendar ids (usually the email address), your own email domain in `internal_domains`, the time zone, and the meeting type words that appear in your schedule titles.
4. Click Execute workflow once. The first run looks back 24 hours and should find the test booking from Module 2.
5. Activate.

**Check.** In Capsule, the person from Module 2 now has an opportunity at Meeting Booked, the right `booking:` tag, and a note that starts "Meeting booked". If that person never used the form, they also carry `src:calendar-direct`, which is the watcher telling you a booking bypassed your page. Cancel the event from the invite; within two minutes the opportunity gains `booking:cancelled`.

**Common mistakes.** The Google account cannot see a host's calendar (the Google node shows a 404 for that calendar; the watcher skips it and does not advance the window). Internal domain not set, so every internal meeting looks like a booking.

### Module B3: The form on your site (15 minutes)

**Do.**
1. Copy `form/book.html` to `/book/` on your site, or lift its form and script into your template.
2. Set `N8N_WEBHOOK` to the production webhook URL.
3. In the router's Webhook node, replace `*` in Allowed Origins with your site's origin, for example `https://www.yourdomain.co.nz`.
4. Visit `/book/?utm_source=google&utm_medium=cpc&utm_campaign=lesson&gclid=test123` and submit with a fresh test email. Pick a slot on the Google page that appears.

**Check.** The note in Capsule lists utm_source, utm_medium, utm_campaign, gclid and the landing URL. Two minutes later the opportunity is at Meeting Booked.

**Common mistakes.** Forgetting the CORS origin, which shows as a failed fetch in the browser console. Testing with an email that already exists in Capsule and wondering why no person was created (that is correct behaviour).

### Module B4: Rolling it out to a team (10 minutes)

**Why.** The workflows are the easy part. The hard part is every link, button and email template that still points at the old scheduler, and advisers who have one habit.

**Do, in this order, with a gate between each.**
1. **Pilot one host for a week.** Their booking links go to `/book/`. Everyone else stays on the old tool. Gate: every booking for that host appears in Capsule, no duplicates, no missed cancellation.
2. **Keep the old scheduler live as a catch-net for 30 days.** If it already writes to Capsule, leave that running. Stray links will keep arriving from old emails and ads.
3. **Re-point every feeder** to `/book/?utm_source=...`: Google Business Profile's appointment link, social bios, email signatures, ad thank-you buttons, email templates, the manual link people paste. Never link to a Google booking page directly.
4. **All hosts on.** Gate: one full week where every booking across the team is in Capsule and matches the calendar count.
5. **Switch off the old tool** when the 30 days are up and the catch-net has caught nothing for a fortnight. Export its history first.

**Check.** Count bookings on the calendars for a week and count opportunities that reached Meeting Booked in Capsule. They should match.

---

## Assessment checklist

- [ ] The pipeline has the milestones in order; the DataTag, if made, has eight fields.
- [ ] Track A: `setup()` reports the token works and two triggers installed. Track B: both workflows active with credentials on every Capsule node.
- [ ] A test submission creates one person, one opportunity, one note; a second submission adds only a note.
- [ ] A test booking reaches Meeting Booked, with the calendar link in the note.
- [ ] A cancellation adds `booking:cancelled`.
- [ ] A visit with utm parameters shows them in the note.
- [ ] Track A: `FORM_SECRET` matches in both places. Track B: Allowed Origins is your site, not `*`.
- [ ] Every public booking link points at `/book/`, none at Google directly.

## Variations

- **Another CRM.** Track A: replace the Capsule helpers at the bottom of `Code.gs`. Track B: replace the eight `Capsule:` HTTP nodes in each workflow. The pattern (find by email, create, list open deals, create deal, update stage, add note) exists in every CRM API.
- **No code at all.** Make's free tier (about a thousand operations a month, 15-minute scheduling) can run a watcher-shaped scenario: Google Calendar watch events, Capsule search, create or update opportunity, add note. Zapier's free tier allows only two-step zaps, which is not enough for the find-then-update sequence. Neither captures the form half for free.
- **Reminders without the Google premium tier.** Capsule's Transpond, or any email tool with an API, can send a reminder sequence triggered from the Meeting Booked milestone. The note has the start time.
- **Server-side conversions.** Track B: enable the last node of the watcher and point it at your own endpoint for Meta CAPI, Google Ads offline conversions (the gclid is on the person) or your analytics tool. Track A: add a `UrlFetchApp` call at the end of `handleBooking_`.
- **Weighted routing.** Track B only: replace the round robin in *Pick host and booking page*; it is 20 lines of JavaScript.

## Facilitator notes

- Have every participant make their Capsule token and Google appointment schedule before the session. Modules 1 and 2 are the slow ones when done live.
- Run a room on one track. Mixed rooms work if the Track A people start their Apps Script project while the Track B people import workflows, but the checks diverge after Module 2.
- Track A's `testBooking()` is the moment to show Capsule filling up without a page in sight. Track B's equivalent is the curl in Module B1.
- The most common question is "why not just use Google's page directly?" The answer is the `src:calendar-direct` tag. Let one person book from a direct link and show the room what the CRM knows about them (nothing about where they came from) versus the person who came through the form.
- For Track B, finish with Module B4 even if time is short. The workflows will work; the rollout is what fails.
