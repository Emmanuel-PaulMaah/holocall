# Developer Notes

## Architecture
- **Frontend**: static site (`public/index.html`) with LiveKit JS SDK
- **Backend**: Vercel serverless functions (`api/config.js`, `api/token.js`)
- **Infra**: LiveKit Cloud SFU
- **Deployment**: Vercel (free tier)

## Endpoints
- `/api/config` → returns `{ livekitUrl }`
- `/api/token?room=ROOM&user=USER` → returns signed JWT for joining

## Debugging
- `/api/debug` → confirms env vars available
- Browser console logs → prints connection events + track subscribe
- If video doesn’t render → check `autoplay` + `muted` attributes

## Gotchas
- Env vars must be in **Production** scope on Vercel
- HTTPS required for mic/cam access
- Safari prefers H.264 (LiveKit handles this)

## Future Work
- Consider moving to dedicated domain (`holocall.app`)
- Add TURN servers if needed for stricter corporate networks
- Replace Skypack/jsDelivr CDN import with npm bundling (parcel/vite)
