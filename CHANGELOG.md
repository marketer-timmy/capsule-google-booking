# Changelog

All notable changes to this project are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Track C: Cal.com's free plan as the slot picker for one person. `cal/Code.gs` receives the booking form and Cal.com's booking webhooks in one Apps Script web app, with no calendar watcher. `form/book-cal.html` embeds the Cal.com booking page with the name, email and a booking key filled in. Checked against a simulated Capsule and a public Cal.com link; not yet run with a real Cal.com webhook.
- README: "The tools it runs on", with disclosed affiliate links to Capsule CRM and n8n through the author's disclosure pages.

## [0.1.0] - 2026-10-12

### Added

- Track A: a Google Apps Script (`appsscript/Code.gs`) that receives the booking form as a web app, writes the person, opportunity and note into Capsule, and watches the calendar through an installable calendar trigger plus a 15-minute timer. Running in production on the author's site since 12 October 2026.
- Track B: two n8n workflows, a booking router with round robin per meeting type and a calendar watcher that polls every host's calendar every two minutes. Built from the same design; not yet run against live accounts.
- Booking pages for both tracks (`form/book-solo.html`, `form/book.html`): capture first-touch attribution for 90 days, then show the Google booking page in a frame.
- Capsule schema and a read-only id lookup script (`capsule/`).
- A six-module lesson plan with a check at every step (`docs/LESSON-PLAN.md`), the flow diagram and an animated capture of the booking page.
- Contributing guide, security policy, code of conduct, issue and pull request templates, and a citation file.

[Unreleased]: https://github.com/marketer-timmy/capsule-google-booking/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/marketer-timmy/capsule-google-booking/releases/tag/v0.1.0
