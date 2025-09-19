# HoloCall — Dark UI Design Brief
_Last updated: 2025-09-19_

## Goals
- Modern, **dark** interface that feels minimal and premium.
- **Responsive**: compact on phones, wider layouts on desktop.
- **Simple controls** with color-coded buttons (Join=green, Leave=red).
- No device dropdowns on main UI; defaults auto-pick devices.
- **Remote video is full-screen**, **local preview is a small circle** at bottom-right.
- Future AR: local preview disappears; **AR canvas** supports drag-to-move & pinch-to-scale.

## Pages & States
1. **Landing / Join**
   - Center card with app title.
   - Inputs: **Room** and **Name** only.
   - One primary **Join** button (green).
   - Subtle helper text: “share the room with anyone on your link.”

2. **In-Call**
   - **Remote video full-viewport** (mobile + desktop).
   - **Local preview**: circular, ~80–112px, bottom-right, subtle border/shadow.
   - **Control bar** (floating at bottom, centered):
     - Red **Leave** (phone down icon).
     - Gray **Mute** toggle (mic icon).
     - Gray **Camera** toggle (video icon).
     - (Hidden for now) **AR** toggle (when we add AR mode).
   - Non-blocking toasts for errors/status.

3. **AR Mode (future)**
   - Remote plane replaced by **WebXR/Three.js canvas**.
   - **Local bubble hidden**.
   - Canvas: **drag to move**, **pinch to scale**, “Reset placement”.

## Visual System
- **Palette**:
  - Background: `#0f1115`
  - Panel: `#171a21`
  - Borders: `#1f2430`
  - Text primary: `#e8eaf0`
  - Text muted: `#9aa3b2`
  - Brand accent: `#6ee7ff`
  - Success/Join: `#64d18a`
  - Danger/Leave: `#ff5577`
  - Button gray: `#121622`
- **Radii**: 10–16px on panels, **circular** for floating local preview.
- **Elevation**: 1–2 subtle shadows only.
- **Typography**: system UI font stack; 14–16px base.

## Interaction
- **Join flow**: enter room+name → Join → request mic/cam → connect → In-Call.
- **Autoplay-safe**: local preview always muted; remote audio muted until user clicks “Enable sound”.
- **Device selection**: hidden from main UI; optional Settings modal later.
- **Errors**: toast bottom-right; logs panel behind `?debug=1`.

## Responsive Rules
- **Mobile (≤480px)**:
  - Join card edge-to-edge with padding.
  - Control bar: icon-only round buttons.
  - Local preview ~84px diameter.
- **Tablet (481–1024px)**:
  - Join card max-width ~420px.
  - Control bar: icons + short labels.
- **Desktop (≥1025px)**:
  - Join card max-width ~520px.
  - More generous spacing.
  - Local preview ~96–112px.

## Tailwind Setup (tomorrow)
- Use **CDN** first, migrate to build later if needed.
- File split:
  - `public/index.html` — markup with Tailwind classes.
  - `public/app.js` — LiveKit logic + UI state.
  - `public/styles.css` — tiny overrides if needed.

## Components
- **JoinCard**: Title, Room input, Name input, Join button, footnote.
- **CallStage**: Remote full video, Local preview circle, Control bar, Toasts.
- **DebugPanel**: hidden unless `?debug=1`.

## Accessibility
- Contrast ≥ WCAG AA.
- Visible focus states.
- Reduced motion respected.
- Icons have `aria-label`.

## Acceptance Criteria
- Scales cleanly from iPhone width → desktop 1440px.
- Remote fills viewport, local bubble anchored bottom-right.
- Join = green, Leave = red, toggles gray.
- No mic/cam dropdowns visible.
- Autoplay-safe.
- AR toggle placeholder exists in code.

## Implementation Checklist (tomorrow)
- [ ] Add Tailwind via CDN.
- [ ] Build JoinCard with room + name + Join.
- [ ] Build CallStage with remote full-viewport, local bubble, control bar.
- [ ] Wire Join → token fetch → connect → publish tracks.
- [ ] Add toasts + minimal debug.
- [ ] Prepare AR toggle hook.
- [ ] Commit as new branch `ui-dark` and deploy to Vercel preview.
