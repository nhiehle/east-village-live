# East Village Live

A phone-friendly PWA that shows a unified live-music schedule for venues around 14th Street and Avenue A.

## Run Locally

```bash
npm run refresh:data
npm run dev
```

Open http://localhost:4173.

## Daily Data Refresh

The app can run as a static GitHub Pages site. The scheduled GitHub Action refreshes `data/events.json` once a day from the venue adapters, so the phone app does not need a laptop or always-on server.

## GitHub Pages

After pushing this repo to GitHub:

1. Go to Settings -> Pages.
2. Set Source to "Deploy from a branch".
3. Choose the `main` branch and `/ (root)`.
4. Save.

Then open the Pages URL on iPhone Safari and choose Share -> Add to Home Screen.
