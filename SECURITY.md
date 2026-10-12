# Security policy

## Supported versions

Only the latest commit on `main` is supported. Fixes are not backported.

## What counts as a vulnerability here

- A way to read or change someone's Capsule data through the Apps Script web app or the n8n router.
- A way to make the watcher write to Capsule for events it should ignore.
- Anything in the repo that leaks a token, a script URL or a form secret.

The `FORM_SECRET` and honeypot on the booking page are spam resistance, not authentication. The web app and the router only create or update the enquiry that was submitted. A report that the secret is visible in the page source is expected behaviour, but a way to use the endpoint for more than that is a real report.

## Reporting

Report privately through GitHub: the **Security** tab of this repository, then **Report a vulnerability**. Please do not open a public issue.

Include the track (Apps Script or n8n), what you did, what happened, and what you expected. Do not include real tokens or personal data.

You should get a reply within a week. If the report is confirmed, the fix and a short note go into [CHANGELOG.md](CHANGELOG.md), with credit if you want it.

## If you leaked your own token

Revoke it in Capsule (My Preferences, then API Authentication Tokens), make a new one, and update the Script Property or the n8n credential. For Apps Script, also create a new deployment if you changed the `FORM_SECRET`.
