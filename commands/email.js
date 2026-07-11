const { SlashCommandBuilder } = require('discord.js');
const { sendMail, isConfigured } = require('../mailer');
const { BUSINESS_NAME } = require('../lib');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Gate to the support team, not the whole server — this sends real mail from the business's own address.
const ALLOWED_ROLE_NAMES = [`${BUSINESS_NAME} support`, 'admin'];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('email')
    .setDescription('Send an email from the support inbox configured in .env')
    .addStringOption((o) => o.setName('to').setDescription('Recipient email address').setRequired(true))
    .addStringOption((o) => o.setName('message').setDescription('Email body').setRequired(true))
    .addStringOption((o) =>
      o.setName('subject').setDescription(`Subject (default: "Message from ${BUSINESS_NAME} Support")`).setRequired(false)
    ),
  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const roles = interaction.member?.roles?.cache;
    const allowed = roles && [...roles.values()].some((r) => ALLOWED_ROLE_NAMES.includes(r.name));
    if (!allowed) {
      await interaction.editReply(`You need the **${BUSINESS_NAME} support** (or **admin**) role to send email from here.`);
      return;
    }

    if (!isConfigured()) {
      await interaction.editReply("Email sending isn't configured yet (GMAIL_USER/GMAIL_APP_PASSWORD missing in .env).");
      return;
    }

    const to = interaction.options.getString('to', true).trim();
    const message = interaction.options.getString('message', true);
    const subject = interaction.options.getString('subject') || `Message from ${BUSINESS_NAME} Support`;

    if (!EMAIL_RE.test(to)) {
      await interaction.editReply(`"${to}" doesn't look like a valid email address.`);
      return;
    }

    try {
      await sendMail({ to, subject, text: message });
      await interaction.editReply(`✅ Sent to **${to}** — subject: "${subject}"`);
    } catch (err) {
      await interaction.editReply(`Failed to send: ${err.message}`);
    }
  },
};
