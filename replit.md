# HoloCall - Replit Setup

## Overview
HoloCall is a web-based international video calling application built on LiveKit with integrated WebXR (AR) capabilities. Its primary purpose is to enable users to join shared virtual rooms via a unique URL, facilitating real-time video and audio communication. The application supports both mobile and desktop browsers, offering a seamless communication experience with an optional augmented reality "Holo Mode." Key capabilities include robust user authentication, one-to-one and group video calls, and interactive AR features for placing video feeds in a 3D environment. The project aims to provide a next-generation communication platform that combines traditional video conferencing with immersive AR experiences, catering to a broad user base.

## User Preferences
I prefer clear, actionable instructions and concise explanations. When suggesting code changes, provide the most impactful modifications first. I appreciate iterative development, so please propose small, testable changes. Always confirm major architectural decisions before implementation. Ensure that all communication is direct and avoids ambiguity.

## System Architecture

### UI/UX Decisions
The application features a clean, responsive design compatible with both desktop and mobile devices. Navigation is handled by a persistent main navigation bar with four key links: Call, Profile, Find People, and My People, each with clean SVG icons. Notification badges with pulsing animations are used to indicate pending friend requests. User profiles include profile picture uploads with automatic resizing and compression, unique usernames, and default gradient avatars. The "My People" interface utilizes touch-friendly, swipeable cards with online status indicators and quick-call buttons. In-call controls are intuitive, offering mute, camera toggle, and a video quality selector. The WebXR AR mode provides visual feedback with an orange outline border during manipulation gestures.

### Technical Implementations
The application is built with a Node.js + Express backend for API services and a frontend using Vanilla JavaScript with ES modules, Three.js, and the WebXR API for AR features. LiveKit handles real-time video and audio infrastructure. Supabase provides authentication services with session cookies. Frontend logic is modularized into `ui-controller.js` for UI state, `connection-manager.js` for LiveKit, and `ar-controller.js` for WebXR functionality, orchestrated by `app.js`.

### Feature Specifications
- **User Authentication:** Login/signup, password reset via email, and session management using Supabase Auth with HTTP-only cookies.
- **International Video Calls:** Real-time video and audio streaming via LiveKit, supporting cross-device communication.
- **WebXR AR Mode:** Places remote video feeds as 3D planes in an augmented reality space. Supports hit-test based placement, fallback to camera-relative placement, and touch gesture controls for repositioning (single-finger drag) and resizing (two-finger pinch/spread).
- **In-Call Controls:** Mute, camera toggle, leave call confirmation, and a video quality selector (360p, 720p, 1080p) with live switching. Optimized bitrates (360p: 600 kbps, 720p: 1 Mbps, 1080p: 2 Mbps) and simulcast are enabled.
- **Social Features:** User profiles with customizable usernames, bios, interests, and profile pictures. A friend network allows searching users, sending/receiving/accepting friend requests with real-time notifications, and managing friendships. The "My People" interface displays friends with online status and quick-call options.

### System Design Choices
The application uses an Express server (`server/index.js`) to serve static frontend files from the `/public` directory. Authentication is handled server-side via Supabase, creating secure, HTTP-only session cookies with a 7-day expiry. API endpoints for configuration, authentication, user data, and LiveKit token generation are protected. The architecture is stateless, designed for Replit Autoscale deployment. Error handling is robust, providing clear, actionable messages for network, permission, and device-related issues, with graceful degradation and automatic cleanup. CORS is strictly validated against trusted domains.

## External Dependencies

-   **LiveKit:** Real-time communication (SFU) infrastructure for video and audio calls.
-   **Supabase:** Provides user authentication, database services (for profiles, friend requests, friendships), and Supabase Storage for profile picture uploads.
-   **Three.js:** JavaScript 3D library used for rendering in WebXR AR mode.
-   **WebXR API:** Browser API enabling augmented reality experiences.