# Contributing

Thanks for looking. This is a small recipe, not a product, so the bar for a change is simple: it has to keep the recipe free, dependency-free and easy to paste into someone else's accounts.

## Before you open an issue

- **Remove every secret.** A Capsule token, a Google appointment URL, an Apps Script `/exec` URL or a `FORM_SECRET` pasted into an issue is public the moment you post it. Replace them with `<redacted>`.
- **Say which track.** Track A is the Apps Script in `appsscript/`. Track B is the n8n workflows in `workflows/`.
- **Say what your accounts are.** Your Google edition (personal, Business Starter, Business Standard, Workspace Individual and so on) and your Capsule plan change what works.
- Setup questions are welcome as issues. Use the "Setup question" form.

## Proposing a change

1. Open an issue first for anything bigger than a typo, so we can agree the shape before you spend an evening on it.
2. Fork the repo and branch from `main`.
3. Keep it plain. Track A is one `.gs` file and a manifest; the booking pages are HTML and JavaScript with no framework and no build step. Please keep it that way.
4. Test against your own accounts, using the checks in [docs/LESSON-PLAN.md](docs/LESSON-PLAN.md) for the track you touched: a form submission, a booking, a cancellation.
5. Update the README, the lesson plan and [CHANGELOG.md](CHANGELOG.md) if behaviour changes.
6. Open a pull request and fill in the template.

## Editing the n8n workflows

Import the JSON into your own n8n, make the change there, export the workflow and replace the file. Before you commit, check the export for credential ids, webhook URLs and anything account-specific, and put the placeholders back. Keep the sticky notes current, because they are the setup guide inside n8n.

## What will not be merged

- Affiliate links, tracking pixels or anything that phones home.
- Real ids, tokens or URLs from anyone's accounts.
- New dependencies, build tools or frameworks for the booking pages.

## Adapting it to another CRM

A port to HubSpot, Pipedrive or anything else is welcome as its own folder or as a fork. Keep the Google side and the form unchanged so the lesson plan still applies.

## Conduct

Everyone taking part follows the [code of conduct](CODE_OF_CONDUCT.md).
