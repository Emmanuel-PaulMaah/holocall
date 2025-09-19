
# AGENTS.md — HoloCall Project

## Purpose
This file gives context and instructions for coding agents working on **HoloCall**.  
Think of it as a guide so agents don’t have to guess: setup, build, conventions, architecture, future goals.

---

## Project Overview
- **HoloCall** is a browser-based, international video-calling app using **LiveKit Cloud SFU**.  
- Deployed via **Vercel** with secure token APIs (`/api/config`, `/api/token`).  
- Remote video + audio stream. Local preview bubble. Responsive layout.  
- Plans to add AR support, richer UI/UX, multi-party, background removal, etc.

---

## Setup & Development

```bash
git clone https://github.com/Emmanuel-PaulMaah/holocall.git
cd holocall
npm install
vercel dev
````

* Required environment variables (for dev & production):

  * `LIVEKIT_URL` – your livekit websocket URL
  * `LIVEKIT_API_KEY`
  * `LIVEKIT_API_SECRET`

* API routes:

  * `/api/config` → returns `{ livekitUrl }`
  * `/api/token?room=ROOM&user=USER` → returns JWT to join LiveKit room

---

## Commands

| Purpose                  | Command                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Run locally              | `vercel dev`                                                                          |
| Deploy to production     | `vercel --prod`                                                                       |
| Commit & push design doc | `git add UI_DESIGN_BRIEF.md && git commit -m "docs: add UI design brief" && git push` |
| Reset to main UI         | `git checkout main && git reset --hard origin/main`                                   |

---

## UI / Styling Conventions

* Dark theme only. Color palette: background `#0f1115`, panels `#171a21`, accents `#6ee7ff`, “join” green, “leave” red, toggles gray.
* Remote video fills viewport; local preview is a floating circle (bottom-right).
* Inputs are just room + name. No device selectors in main flow.
* Buttons: color coded (green = join/start, red = leave/stop, gray = toggles).
* Responsive: mobile vs desktop layouts; full-width on small screens; floating controls; no overflow.

---

## Architecture & Code Structure

* `public/` folder:

  * `index.html` – front-end UI + logic (LiveKit client)
  * possible split later: `public/app.js`, `public/styles.css`
* `api/` folder:

  * `config.js` – returns LiveKit URL config
  * `token.js` – generates JWT tokens
* LiveKit handles transport; front-end handles rendering, toggles, UI states.

---

## Future Work & Priorities

1. Implement the dark + modern UI variant (“ui-dark”) per UI design brief.
2. Add AR mode: remote plane replaced by AR canvas; pinch-scale + drag; remove local preview.
3. Multi-party rooms.
4. Background removal, avatars, subtitles, reactions.
5. Error handling, analytics, connection quality indicators.

---

## Best Practices

* Commit small, atomic changes → easier to review.
* Always test locally (`vercel dev`) before deploying.
* Use `?debug=1` or check logs to diagnose remote video / token / env issues.
* Keep environment variables secret. Never commit secrets.

---

## Onboarding Tips (for agents)

* If asked to work on UI, refer to `UI_DESIGN_BRIEF.md` for style + layout rules.
* Use live environment for testing (production link).
* Always use “Join → connect → publish tracks” flow to verify features.
* Check browser console logs + `/api/debug` endpoint to verify environment setup.

```

---

If you drop this in, agents (or future you + me) will have a clear, shared understanding of how to jump in.  

Want me to commit this for you and push the `AGENTS.md` file (as part of your `main` branch)?
::contentReference[oaicite:0]{index=0}
```
