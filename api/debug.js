export default function handler(_req, res) {
  const url = process.env.LIVEKIT_URL || '';
  const key = process.env.LIVEKIT_API_KEY || '';
  const sec = process.env.LIVEKIT_API_SECRET || '';
  res.status(200).json({
    hasUrl: !!url,
    hasKey: !!key,
    hasSecret: !!sec,
    url,                  // safe to show
    keyLen: key.length,   // don’t show the key itself
    secLen: sec.length    // don’t show the secret itself
  });
}
