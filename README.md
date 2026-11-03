# DriveDeck: your own in-car dashboard

DriveDeck is a head-unit style screen for the car. It's a plain static web app (HTML, CSS and JavaScript) that runs in the browser, with no server, no build step and no API keys.

The home screen is a photo dashboard: a full-width wallpaper (a dusk city skyline drawn in code, or **any photo you pick, such as your own car**), your own name in large type, weather with your town, a big clock, and a row of frosted-glass cards (now playing, voice assistant, live navigation map, speed, wallpaper, settings). Night is the default theme; Day is in Settings.

| Screen | What it does |
| --- | --- |
| **Home** | Wallpaper hero with your name, weather, date and clock; cards for now playing, the voice assistant, a live map (tap to navigate), speed and trip, wallpaper and settings |
| **Wallpaper photo** | Pick any photo, then drag it to choose which part shows and pinch (or use the slider) to zoom. To reposition later, press and hold the sky on the home screen, or use *Adjust* in Settings or My Car |
| **My Car** | Your car's model, year, plate, mileage and tyre pressures, with reminders for the service, inspection/MOT and insurance. The home card shows what's due next, and you can ask "when is my service?" |
| **Maps** | OpenStreetMap with follow mode, place search, routing, **spoken turn-by-turn directions with automatic rerouting**, and hand-off to Google Maps, Waze or Apple Maps |
| **Audio** | Plays music files from the device, internet radio streams, and **YouTube Music** playlists, albums and songs (paste a Share link; plays in YouTube's official player, which stays visible as YouTube requires). Bluetooth and steering-wheel buttons work through the Media Session API, and music is lowered while directions are spoken |
| **Phone** | Favorites and a dial pad. Calls and texts are handed to the phone through `tel:` and `sms:` links |
| **Settings** | Name on screen, wallpaper photo, units, Day/Night/Auto theme (Auto follows actual daylight), voice options, keep-screen-on, passenger mode, and a **simulated drive** for testing at your desk |

**Voice commands** use the mic button: *navigate to …*, *take me home*, *how long until we arrive*, *stop navigation*, *play*, *pause*, *next*, *play &lt;station&gt;*, *call &lt;name&gt;*, *text &lt;name&gt;*, *what's the weather*, *open maps*, *night mode*.

**Your data:** settings, favorites, stations and your wallpaper photo are stored only in this browser on this device.

**Driving lock:** above about 10 km/h (6 mph), typing is disabled and the screen asks you to use your voice. Passenger mode turns this off.

## Where it lives

**Live app:** https://mytkollij-lab.github.io/drivedeck/ (open it on your phone and choose *Add to Home Screen*).

It's hosted free on GitHub Pages, which provides the HTTPS that GPS and the microphone need. The site is published from the **`gh-pages`** branch, so to update the live app, push the same commit to both `main` and `gh-pages`.

Any static host works too (Netlify, Cloudflare Pages, Render Static Site): publish the repository root as-is.

To try it on your computer: run `python3 -m http.server 8000` in this folder and open `http://localhost:8000`. Browsers allow GPS on `localhost` without HTTPS.

## Install it as an app

DriveDeck installs straight from the website, with nothing to download. You get an icon on your desktop, Start menu, Dock or home screen, it opens in its own window without browser bars, and it still opens when you're offline (maps, routing and weather need a connection).

- **Windows / Mac, Chrome or Edge:** open the address above and click **Install** in *Settings*, or the install icon at the right end of the address bar.
- **Mac, Safari:** File › **Add to Dock**.
- **iPhone / iPad:** Safari › Share › **Add to Home Screen**.
- **Android:** Chrome menu (⋮) › **Install app**.

## Running it in the car

1. **Phone or tablet (easiest).** Open your DriveDeck address and choose *Add to Home Screen*. It launches full screen in landscape. Pair the phone to the car over Bluetooth so audio and directions play through the speakers.
2. **Raspberry Pi + touchscreen (a dedicated head unit).** Use a Pi 4 or 5 with a 7" touchscreen and a USB microphone, and run Chromium in kiosk mode:
   ```bash
   chromium-browser --kiosk --noerrdialogs --autoplay-policy=no-user-gesture-required \
     https://<your-username>.github.io/drivedeck/
   ```
   **Known gap:** Chromium on Linux can't read a USB GPS receiver directly, so on a Pi the browser usually gets no position. Speed and turn-by-turn won't work there until a small gpsd-to-browser bridge is added (not built yet). For now, a phone or tablet is the setup that works fully.

## Services used (free, no keys)

- Map tiles: OpenStreetMap (darkened in night mode), with OpenStreetMap France as a backup
- Place search: Nominatim
- Routing: OSRM public demo server (`router.project-osrm.org`)
- Weather: Open-Meteo (town name from Nominatim)
- YouTube Music: YouTube's official IFrame Player (no sign-in; there is no public YouTube Music API)

These public servers are fine for personal use, but they have fair-use limits and no uptime guarantee. OpenStreetMap's tile servers are for light, personal use. For anything beyond one car, self-host OSRM and a tile server, or switch to a paid provider. The URLs are all in `drive.js`.

## Files

```
index.html          screen layout
drive.css           styling (night + day themes, landscape + portrait)
drive.js            all logic: GPS, nav, voice, audio, phone, safety lock
manifest.json       installable app settings (name, icons, own window)
sw.js               service worker: lets the installed app open offline
icon*.png, icon.svg app icons
vendor/leaflet/     Leaflet 1.9.4 map library (BSD-2-Clause), bundled locally
vendor/fonts/       Inter (SIL Open Font License), bundled locally
```

## Why this isn't Apple CarPlay

CarPlay itself is a closed protocol (iAP2 plus streamed H.264 video). The car side must hold an **Apple MFi authentication chip**, and the iPhone refuses to connect without it. Cloning that protocol and getting past the authentication isn't a practical or legal DIY project. DriveDeck is a separate, original dashboard instead, and you control everything on it.

If you want real CarPlay on a DIY screen as well, the legitimate route is a licensed **USB CarPlay adapter** (for example a Carlinkit dongle, which contains the MFi chip) together with an open-source host app such as *react-carplay* / *node-carplay* on the Pi. That runs Apple's own CarPlay UI, so you can't customise it the way you can DriveDeck.

> Safety: set up destinations, favorites and stations before you drive. Use voice while moving.
