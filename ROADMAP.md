
# HoloCall Roadmap

## Phase 0 — Foundation (done ✅)
- Set up LiveKit Cloud project
- Token server (API routes on Vercel)
- Frontend calling page
- Vercel deploy with env vars
- Confirmed working calls worldwide

## Phase 1 — UI/UX overhaul
- Join screen (room + name)
- Incoming call modal (accept/decline)
- In-call HUD: mute, camera toggle, AR toggle
- Toasts for permissions/network errors
- Mobile-first layout polish

## Phase 2 — AR integration
- Replace `<video>` element with Three.js `VideoTexture`
- Plane placement + pinch-to-scale
- Reset + persist placement

## Phase 3 — Multi-party support
- LiveKit rooms with >2 participants
- Grid layout (non-AR)
- “Screen wall” placement (AR)

## Phase 4 — Collaboration features
- Subtitles (Web Speech API → overlay text)
- Emoji reactions (billboarded sprites)
- Screen share (separate AR plane)

## Phase 5 — Immersive upgrades
- Background removal (MediaPipe → alpha matte)
- Depth-aware occlusion (ARCore/ARKit)
- Full-body pose tracking → avatars

## Phase 6 — Scaling
- Analytics (join time, drop rate, bitrate)
- Error monitoring + reconnect flows
- Turnkey domain (`holocall.app`)
