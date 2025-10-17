# HoloCall

HoloCall is a web-based international calling app built on [LiveKit](https://livekit.io) and deployed to [Vercel](https://vercel.com).  
It allows anyone to join a shared room via URL and see each other’s video/audio streams, with support for mobile + desktop across regions.

## Features (current)
- **International calls**: works worldwide using LiveKit’s global SFU  
- **Video + Audio**: real-time 1:1 calling from browser to browser  
- **Shareable link**: deployed at https://holocall.vercel.app (Vercel free tier)  
- **Cross-device**: works on desktop + mobile browsers (Chrome, Safari, etc.)  
- **Secure tokens**: API issues per-room JWT tokens at `/api/token`  
- **Config endpoint**: `/api/config` exposes the LiveKit URL to the client  

## Development
```bash
git clone https://github.com/YOUR-USERNAME/holocall.git
cd holocall
npm install
vercel dev
```

open http://localhost:3000, enter a room + name, and test with two tabs.
