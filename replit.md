# HoloCall - Replit Setup

## Overview
HoloCall is a web-based international video calling app built on LiveKit with WebXR (AR) capabilities. It allows users to join shared rooms via URL and see each other's video/audio streams with support for mobile and desktop devices.

## Project Architecture

### Tech Stack
- **Backend**: Node.js + Express server
- **Authentication**: Supabase Auth with session cookies
- **Frontend**: Vanilla JavaScript with ES modules
- **Video Infrastructure**: LiveKit (real-time SFU)
- **3D/AR**: Three.js + WebXR API
- **Port**: 5000 (frontend served from Express)

### Structure
```
/server          - Express server with API endpoints
  /index.js      - Main server file with auth middleware
  /package.json  - Server dependencies
/public          - Static frontend files (ES modules)
  /index.html    - Main video call UI
  /login.html    - Login page
  /signup.html   - Signup page
  /app.js        - Main orchestrator (coordinates modules)
  /ui-controller.js      - UI state management and DOM updates
  /connection-manager.js - LiveKit connection logic
  /ar-controller.js      - WebXR/AR functionality
  /auth.js       - Client-side authentication logic
  /styles.css    - Styling for all pages
/api             - Legacy Vercel serverless functions (not used in Replit)
```

## Configuration

### Environment Variables (Required)
The following secrets must be set in Replit Secrets:
- `LIVEKIT_URL` - LiveKit server WebSocket URL (wss://...)
- `LIVEKIT_API_KEY` - LiveKit API key
- `LIVEKIT_API_SECRET` - LiveKit API secret
- `SUPABASE_URL` - Supabase project URL
- `SUPABASE_ANON_KEY` - Supabase anonymous key
- `JWT_SECRET` - (Optional) Custom secret for session tokens

### API Endpoints
- `GET /api/config` - Returns LiveKit and Supabase configuration
- `POST /api/auth/session` - Creates authenticated session cookie
- `POST /api/auth/logout` - Clears session cookie
- `GET /api/auth/user` - Returns current authenticated user (protected)
- `GET /api/token?room={room}` - Generates LiveKit JWT token for room access (protected)

## Features

### Current Features
- 🔐 **User Authentication** - Login/signup with Supabase Auth
- 🌍 **International video calls** - Via LiveKit's global SFU
- 🎥 **Real-time video + audio** - Streaming between authenticated users
- 📱 **Cross-device support** - Desktop + mobile browsers
- 🔒 **Protected endpoints** - Only authenticated users can create calls
- 👤 **User sessions** - HTTP-only cookie-based sessions with 7-day expiry
- 👓 **WebXR AR mode** - "Holo Mode" for supported devices
- 🎛️ **In-call controls** - Mute, camera toggle, leave with confirmation

### WebXR AR Mode
- Places remote video feed as 3D plane in AR space
- Hit-test based placement when supported
- Fallback to camera-relative placement
- Works on AR-capable mobile devices

## Development

### Running Locally
The server automatically starts via Replit workflow on port 5000.

### Testing Video Calls
1. Create an account at `/signup.html` or login at `/login.html`
2. After login, you'll be redirected to the main app
3. Enter a room name and click "Join"
4. Open another browser tab (or different browser)
5. Login with a different account
6. Enter the same room name and click "Join"
7. Grant camera/microphone permissions when prompted
8. You should see each other's video feeds

### Authentication Flow
1. Unauthenticated users are redirected to `/login.html`
2. Users can sign up or login via Supabase Auth
3. On successful auth, a session cookie is created (7-day expiry)
4. Session cookies are HTTP-only and secured in production
5. Protected API endpoints verify session before granting access

## Deployment
The app is configured for Replit Autoscale deployment:
- Deployment command: `node server/index.js`
- Stateless architecture suitable for autoscaling
- Environment secrets automatically injected

## Recent Changes (Oct 17, 2025)

### Initial Replit Migration
- Migrated from Vercel to Replit environment
- Updated server to bind to 0.0.0.0:5000
- Fixed API endpoint paths to match frontend expectations
- Removed dotenv dependency (using Replit secrets)
- Configured deployment for Autoscale
- Set up workflow for automatic server startup

### Authentication Implementation
- Added Supabase authentication integration
- Created login and signup pages with proper UI/UX
- Implemented session-based authentication using HTTP-only cookies
- Protected `/api/token` endpoint - requires authentication
- Added auth middleware with JWT session verification
- Updated main app to check authentication on load
- Added user info display and logout functionality
- Removed manual username input (now uses authenticated user's name)
- Enhanced security with protected API endpoints

### Security Hardening
- Fixed critical CORS vulnerability - replaced wildcard origin with validated allowlist
- CORS validates all domains against trusted Replit suffixes (.replit.dev, .repl.co)
- Production: HTTPS-only for Replit domains (prevents downgrade attacks)
- Development: HTTP localhost allowed only when NODE_ENV is not 'production'
- Domain validation prevents environment variable poisoning attacks
- Untrusted domains are logged and rejected
- Added JWT_SECRET enforcement at startup to prevent token forgery
- Implemented automatic token refresh for 7-day session persistence

### Code Refactoring (Oct 17, 2025)
- Modularized app.js (344 lines) into three focused modules:
  - **ui-controller.js** - UI state management, DOM updates, toast notifications, auth checks
  - **connection-manager.js** - LiveKit room connection, track management, media helpers
  - **ar-controller.js** - WebXR/AR session management, Three.js scene, hit-test logic
  - **app.js** - Slim orchestrator that coordinates all modules
- Improved maintainability and separation of concerns
- All modules use ES6 imports/exports
- No functionality changes - pure refactoring

### Error Handling Improvements (Oct 17, 2025)
- **Production-ready error handling** - All error messages are plain-language with actionable next steps
- **Join flow error handling** - Session expiration, permission denied (403), network/server errors with clear guidance
- **Media permission errors** - Immediate lock icon guidance for camera/mic denials, works with audio-only fallback
- **Graceful degradation** - Falls back to audio-only mode if camera fails, shows success confirmation
- **Network recovery** - Join button immediately available on disconnect, reconnection attempts with count
- **Device errors** - Device not found, device in use, unsupported camera - each with specific instructions
- **Automatic cleanup** - Join button re-enabled before retry message appears for reliable manual retry
- **Complete coverage** - All error scenarios handled with user-friendly, actionable messaging

## Notes
- The `/api` folder contains legacy Vercel serverless functions - the Express server handles these endpoints instead
- AR features require HTTPS and AR-capable devices (most modern smartphones)
- LiveKit credentials must be configured before the app can facilitate calls
