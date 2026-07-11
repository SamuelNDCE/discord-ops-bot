const MAX_MESSAGES = 8; // keep last 4 exchanges — bounds context size for a small local model
const IDLE_TIMEOUT_MS = 20 * 60_000; // 20 min of inactivity starts a fresh thread

const threads = new Map(); // `${channelId}:${userId}` -> { messages: [{role, content}], lastActive }

const key = (channelId, userId) => `${channelId}:${userId}`;

function getHistory(channelId, userId) {
  const thread = threads.get(key(channelId, userId));
  if (!thread) return [];
  if (Date.now() - thread.lastActive > IDLE_TIMEOUT_MS) {
    threads.delete(key(channelId, userId));
    return [];
  }
  return thread.messages;
}

function append(channelId, userId, role, content) {
  const k = key(channelId, userId);
  const thread = threads.get(k) || { messages: [], lastActive: Date.now() };
  thread.messages.push({ role, content });
  if (thread.messages.length > MAX_MESSAGES) thread.messages = thread.messages.slice(-MAX_MESSAGES);
  thread.lastActive = Date.now();
  threads.set(k, thread);
}

function clear(channelId, userId) {
  threads.delete(key(channelId, userId));
}

module.exports = { getHistory, append, clear };
