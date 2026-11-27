# End-to-end test

Drives every page of the real app in a browser: onboarding, calendars, workouts and PRs, food, sleep, email, chat,
Home Assistant (a stand-in server), settings, family link, export, backup and restore, the kill switch,
phone and desktop layouts, and an accessibility scan.

```sh
npm run local            # in one terminal; start from an empty database (delete apps/worker/.wrangler)
npm i -D playwright axe-core && npx playwright install chromium
npm run e2e              # in another terminal
```

It needs internet for the real calendar, food and barcode checks. Each check prints PASS or FAIL.
