const { Events } = require('discord.js');
const { sendMail } = require('./mailer');
const { getThread } = require('./support-thread-store');

const CONTACT_CHANNEL_ID = process.env.CONTACT_CHANNEL_ID; // channel ID for your support/contact channel

async function sendReply(thread, body) {
  const subject = /^re:/i.test(thread.subject) ? thread.subject : `Re: ${thread.subject}`;
  await sendMail({
    to: thread.to,
    subject,
    text: body,
    inReplyTo: thread.originalMessageId || undefined,
    references: thread.originalMessageId || undefined,
  });
}

function start(client) {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) {
    console.log('[support-reply-bridge] GMAIL_USER/GMAIL_APP_PASSWORD not set — skipping until configured');
    return;
  }

  client.on(Events.MessageCreate, async (message) => {
    try {
      if (message.channelId !== CONTACT_CHANNEL_ID) return;
      if (message.author.bot) return;
      if (!message.reference?.messageId) return; // only replies-to-a-specific-message trigger a send

      const thread = getThread(message.reference.messageId);
      if (!thread) return; // reply to something other than a tracked support-email post

      const body = message.content.trim();
      if (!body) return;

      await sendReply(thread, body);
      await message.react('✅');
    } catch (err) {
      console.error('[support-reply-bridge] failed to send reply:', err.message);
      await message.reply(`⚠️ Failed to send email reply: ${err.message}`).catch(() => {});
    }
  });
}

module.exports = { start, sendReply };
