# HoloCall - Replit Setup

## Overview
HoloCall is a web-based international video calling application leveraging LiveKit for real-time communication and WebXR for integrated Augmented Reality (AR) experiences. It enables users to join shared virtual rooms via unique URLs, supporting both mobile and desktop browsers. The application's core purpose is to provide seamless video and audio communication with an innovative "Holo Mode" that places video feeds or 3D avatars into an augmented reality environment. Key features include robust user authentication, one-to-one and group video calls, and interactive AR capabilities, aiming to deliver a next-generation communication platform.

## User Preferences
I prefer clear, actionable instructions and concise explanations. When suggesting code changes, provide the most impactful modifications first. I appreciate iterative development, so please propose small, testable changes. Always confirm major architectural decisions before implementation. Ensure that all communication is direct and avoids ambiguity.

## System Architecture

### UI/UX Decisions
The application features a responsive design with a persistent main navigation bar. User profiles are accessible via a clickable username in the header. Notification badges indicate pending friend requests. During active calls, navigation links are disabled, and UI elements are hidden in WebXR AR mode except for the exit button. User profiles support profile picture uploads, unique usernames, and default gradient avatars. The "My People" interface uses swipeable cards with online status and quick-call buttons. In-call controls are intuitive (mute, camera toggle, video quality selector). Call sounds use Web Audio API oscillators. The incoming call modal includes accept, decline, and ignore options. WebXR AR mode provides visual feedback with an orange outline during object manipulation.

### Technical Implementations
The application uses a Node.js + Express backend and a Vanilla JavaScript frontend with ES modules, Three.js, and the WebXR API. LiveKit manages real-time video/audio. Supabase handles authentication with session cookies. Frontend logic is modularized into `ui-controller.js`, `connection-manager.js`, and `ar-controller.js`, orchestrated by `app.js`.

### Feature Specifications
-   **User Authentication:** Supabase Auth for login/signup, password reset, and HTTP-only cookie-based session management.
-   **International Video Calls:** Real-time video/audio streaming via LiveKit, supporting cross-device communication with optimized bitrates and simulcast.
-   **WebXR AR Mode (Avatar-Only):** Displays Ready Player Me 3D avatars in AR space with audio-only communication, addressing Android dual-camera conflicts. Local camera is disabled upon AR entry. Avatars load at ground level and are interactively repositionable/resizable via touch gestures, with visual bounding box feedback. Avatar models are inspected for rigging and blend shapes.
-   **In-Call Controls:** Mute, camera toggle, leave call confirmation, and a video quality selector (360p, 720p, 1080p).
-   **Social Features:** User profiles with customizable details, a friend network with search, requests, and real-time notifications. "My People" displays friends with online status and quick-call options.
-   **Web Push Notifications:** Service worker-based notifications for incoming calls, utilizing VAPID keys and JWT-based one-time decline tokens.

### System Design Choices
The application uses an Express server to serve static frontend files. Supabase handles server-side authentication, creating secure HTTP-only session cookies. API endpoints for configuration, authentication, user data, and LiveKit token generation are protected. The architecture is stateless, designed for Replit Autoscale. Robust error handling provides clear messages and graceful degradation. CORS is strictly validated. AR mode includes device compatibility detection with graceful fallbacks for non-ARCore devices and an avatar skeletal animation system with idle and speaking animations, blended via audio-reactive triggers using Web Audio API.

## External Dependencies

-   **LiveKit:** Real-time communication (SFU) infrastructure for video and audio calls.
-   **Supabase:** User authentication, database services (profiles, friend requests), and Supabase Storage for profile pictures.
-   **Three.js:** JavaScript 3D library for rendering in WebXR AR mode and loading GLTF 3D models.
-   **WebXR API:** Browser API for augmented reality experiences.
-   **web-push:** Node.js library for sending web push notifications with VAPID authentication.
-   **Ready Player Me:** 3D avatar platform providing customizable GLB avatars for AR Holo Mode.