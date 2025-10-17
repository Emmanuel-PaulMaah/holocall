import express from 'express';
import cors from 'cors';
import { AccessToken } from 'livekit-server-sdk';

const app = express();
app.use(cors());
app.use(express.json());

// serve the static client from ../public
import { fileURLToPath } from 'url';
import path from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
app.use(express.static(path.join(__dirname, '..', 'public')));

// simple config endpoint for the client (safe to expose)
app.get('/api/config', (req, res) => {
  res.json({ livekitUrl: process.env.LIVEKIT_URL || '' });
});

// token minting endpoint
app.get('/api/token', async (req, res) => {
  try {
    const room = (req.query.room || 'default').toString();
    const user = (req.query.user || `web-${Math.random().toString(36).slice(2)}`).toString();

    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: user,
    });
    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    res.type('text/plain').send(token);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'failed_to_create_token' });
  }
});

const port = process.env.PORT || 5000;
app.listen(port, '0.0.0.0', () => {
  console.log(`✅ server running on http://0.0.0.0:${port}`);
});
