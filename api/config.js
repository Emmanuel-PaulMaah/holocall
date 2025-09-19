export default async function handler(_req, res) {
  res.status(200).json({ livekitUrl: process.env.LIVEKIT_URL || '' });
}
