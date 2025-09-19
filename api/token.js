import { AccessToken } from 'livekit-server-sdk';

export default async function handler(req, res) {
  try {
    // sanity check your env vars are visible at runtime
    const hasKey = !!process.env.LIVEKIT_API_KEY;
    const hasSecret = !!process.env.LIVEKIT_API_SECRET;

    if (!hasKey || !hasSecret) {
      return res.status(500).json({
        error: 'missing_env',
        message: 'LIVEKIT_API_KEY and/or LIVEKIT_API_SECRET are not set on Vercel (Production).'
      });
    }

    const room = String(req.query.room || 'default');
    const user = String(req.query.user || 'web-' + Math.random().toString(36).slice(2));

    const at = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: user,
    });

    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true
    });

    const jwt = await at.toJwt();
    res.setHeader('Content-Type', 'text/plain');
    res.status(200).send(jwt);
  } catch (e) {
    console.error('token error', e);
    res.status(500).json({
      error: 'failed_to_create_token',
      message: e?.message || String(e)
    });
  }
}
