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
  /forgot-password.html - Password reset request page
  /update-password.html - New password entry page
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
- 🔑 **Password Reset** - Self-service password recovery via email
- 🌍 **International video calls** - Via LiveKit's global SFU
- 🎥 **Real-time video + audio** - Streaming between authenticated users
- 📱 **Cross-device support** - Desktop + mobile browsers
- 🔒 **Protected endpoints** - Only authenticated users can create calls
- 👤 **User sessions** - HTTP-only cookie-based sessions with 7-day expiry
- 👓 **WebXR AR mode** - "Holo Mode" for supported devices
- 🎛️ **In-call controls** - Mute, camera toggle, leave with confirmation
- 🎬 **Video quality selector** - Choose 360p, 720p (HD), or 1080p (Full HD) with live switching during calls

### WebXR AR Mode
- Places remote video feed as 3D plane in AR space
- Hit-test based placement when supported
- Fallback to camera-relative placement
- Works on AR-capable mobile devices
- **Touch gesture controls**:
  - Tap to place video in AR space
  - Single finger drag to reposition video
  - Two finger pinch/spread to resize (0.3x to 4x scale)
  - Orange outline border appears during manipulation for visual feedback

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
3. Forgot password? Users can request a password reset email at `/forgot-password.html`
4. Password reset email contains a magic link to `/update-password.html`
5. On successful auth, a session cookie is created (7-day expiry)
6. Session cookies are HTTP-only and secured in production
7. Protected API endpoints verify session before granting access

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

### Authentication Redirect Fix (Oct 17, 2025)
- **Fixed auth check race condition** - App now properly waits for authentication before initializing
- **Proper redirect flow** - Unauthenticated users are immediately redirected to login page
- **Async initialization** - Added `init()` function that awaits auth check before setting up event listeners
- **Custom domain support** - Works correctly on holocall.replit.app, holocall.vercel.app, and all Replit/Vercel domains
- **No UI flash** - Users no longer see the Join button before being redirected

### Password Reset Feature (Oct 17, 2025)
- **Self-service password recovery** - Users can reset their password via email without admin intervention
- **Forgot password page** - `/forgot-password.html` allows users to request password reset
- **Secure reset flow** - Supabase sends magic link to user's email with temporary access token
- **Update password page** - `/update-password.html` allows setting new password after email verification
- **Password validation** - Minimum 6 characters, password confirmation matching
- **Improved UX** - "Forgotten password" link prominently displayed on login page
- **Account recovery** - Users can regain access to locked or unconfirmed accounts
- **Success feedback** - Clear visual confirmation when reset email is sent and password is updated

### Video Quality Selector (Oct 18, 2025)
- **Quality dropdown in header** - Select between 360p, 720p (HD default), and 1080p (Full HD)
- **Live quality switching** - Change video quality during active calls without disconnecting
- **Privacy-first design** - Camera mute state is preserved when switching quality
- **Smooth transitions** - Quality selector is disabled during track replacement to prevent race conditions
- **Smart constraints** - Each quality level has optimized resolution and frame rate:
  - 360p: 640x360 @ 24fps (low bandwidth)
  - 720p: 1280x720 @ 30fps (balanced default)
  - 1080p: 1920x1080 @ 30fps (high quality)
- **User feedback** - Toast notifications confirm quality changes
- **Error handling** - Graceful fallback with helpful messages if quality switch fails

### AR Gesture Controls (Oct 18, 2025)
- **Touch-based video manipulation** - Drag and resize remote video feed in AR space using natural gestures
- **Single finger drag** - Reposition video plane anywhere in 3D space with camera-relative movement
- **Two finger pinch/spread** - Resize video from 0.3x to 4x original size with smooth scaling
- **Visual feedback** - Orange outline border appears during manipulation for clear interaction state
- **Smart movement scaling** - Drag distance adapts based on video distance from camera for natural feel
- **Seamless gesture transitions** - Smoothly switch from drag to pinch without lifting all fingers
- **Proper cleanup** - Touch handlers automatically removed when exiting AR mode
- **Works with hit-testing** - Gesture controls complement tap-to-place functionality

## Notes
- The `/api` folder contains legacy Vercel serverless functions - the Express server handles these endpoints instead
- AR features require HTTPS and AR-capable devices (most modern smartphones)
- LiveKit credentials must be configured before the app can facilitate calls
- Video quality can be changed before or during calls - the new setting applies to your outgoing video stream
