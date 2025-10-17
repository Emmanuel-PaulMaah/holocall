# HoloCall - Replit Setup

## Overview
HoloCall is a web-based international video calling app built on LiveKit with WebXR (AR) capabilities. It allows users to join shared rooms via URL and see each other's video/audio streams with support for mobile and desktop devices.

## Project Architecture

### Tech Stack
- **Backend**: Node.js + Express server
- **Frontend**: Vanilla JavaScript with ES modules
- **Video Infrastructure**: LiveKit (real-time SFU)
- **3D/AR**: Three.js + WebXR API
- **Port**: 5000 (frontend served from Express)

### Structure
```
/server          - Express server with API endpoints
  /index.js      - Main server file
  /package.json  - Server dependencies
/public          - Static frontend files
  /index.html    - Main UI
  /app.js        - Client-side application logic
  /styles.css    - Styling
/api             - Legacy Vercel serverless functions (not used in Replit)
```

## Configuration

### Environment Variables (Required)
The following secrets must be set in Replit Secrets:
- `LIVEKIT_URL` - LiveKit server WebSocket URL (wss://...)
- `LIVEKIT_API_KEY` - LiveKit API key
- `LIVEKIT_API_SECRET` - LiveKit API secret

### API Endpoints
- `GET /api/config` - Returns LiveKit URL configuration
- `GET /api/token?room={room}&user={user}` - Generates JWT token for room access

## Features

### Current Features
- 🌍 International video calls via LiveKit's global SFU
- 🎥 Real-time video + audio streaming
- 🔗 Shareable room links
- 📱 Cross-device support (desktop + mobile browsers)
- 🔐 Secure JWT token-based authentication
- 👓 WebXR AR mode ("Holo Mode") for supported devices
- 🎛️ In-call controls (mute, camera toggle, leave)

### WebXR AR Mode
- Places remote video feed as 3D plane in AR space
- Hit-test based placement when supported
- Fallback to camera-relative placement
- Works on AR-capable mobile devices

## Development

### Running Locally
The server automatically starts via Replit workflow on port 5000.

### Testing Video Calls
1. Open the app in two browser tabs
2. Enter the same room name in both
3. Enter different usernames
4. Click "Join" in both tabs
5. Grant camera/microphone permissions

## Deployment
The app is configured for Replit Autoscale deployment:
- Deployment command: `node server/index.js`
- Stateless architecture suitable for autoscaling
- Environment secrets automatically injected

## Recent Changes (Oct 17, 2025)
- Migrated from Vercel to Replit environment
- Updated server to bind to 0.0.0.0:5000
- Fixed API endpoint paths to match frontend expectations
- Removed dotenv dependency (using Replit secrets)
- Configured deployment for Autoscale
- Set up workflow for automatic server startup

## Notes
- The `/api` folder contains legacy Vercel serverless functions - the Express server handles these endpoints instead
- AR features require HTTPS and AR-capable devices (most modern smartphones)
- LiveKit credentials must be configured before the app can facilitate calls
