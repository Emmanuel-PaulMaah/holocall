// Memorable Room ID Generator
// Generates room IDs in format: adjective-color-noun (e.g., "happy-blue-coconut")

const adjectives = [
  'happy', 'bright', 'calm', 'swift', 'quiet', 'bold', 'warm', 'cool', 'gentle', 'strong',
  'smart', 'quick', 'brave', 'wise', 'kind', 'neat', 'wild', 'free', 'fresh', 'sunny',
  'lucky', 'jolly', 'merry', 'proud', 'sweet', 'grand', 'fancy', 'royal', 'noble', 'epic'
];

const colors = [
  'red', 'blue', 'green', 'yellow', 'orange', 'purple', 'pink', 'teal', 'coral', 'mint',
  'gold', 'silver', 'violet', 'indigo', 'crimson', 'azure', 'emerald', 'amber', 'jade', 'ruby',
  'navy', 'lime', 'cyan', 'magenta', 'bronze', 'pearl', 'ivory', 'sage', 'rose', 'plum'
];

const nouns = [
  'tiger', 'eagle', 'dolphin', 'panda', 'lion', 'wolf', 'bear', 'hawk', 'owl', 'fox',
  'star', 'moon', 'cloud', 'wave', 'mountain', 'river', 'ocean', 'forest', 'meadow', 'valley',
  'thunder', 'lightning', 'breeze', 'storm', 'rainbow', 'sunset', 'sunrise', 'comet', 'galaxy', 'phoenix'
];

function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

export function generateRoomId() {
  const adjective = getRandomElement(adjectives);
  const color = getRandomElement(colors);
  const noun = getRandomElement(nouns);
  return `${adjective}-${color}-${noun}`;
}

export function isValidRoomId(roomId) {
  if (!roomId || typeof roomId !== 'string') return false;
  const parts = roomId.split('-');
  return parts.length === 3 && parts.every(part => part.length > 0);
}
