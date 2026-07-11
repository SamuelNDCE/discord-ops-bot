const nodemailer = require('nodemailer');
const { BUSINESS_NAME } = require('./lib');

function isConfigured() {
  return !!(process.env.GMAIL_USER && process.env.GMAIL_APP_PASSWORD);
}

function buildTransport() {
  const { GMAIL_USER, GMAIL_APP_PASSWORD } = process.env;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: GMAIL_USER, pass: GMAIL_APP_PASSWORD },
  });
}

async function sendMail({ to, subject, text, inReplyTo, references }) {
  const transport = buildTransport();
  await transport.sendMail({
    from: `"${BUSINESS_NAME} Support" <${process.env.GMAIL_USER}>`,
    to,
    subject,
    text,
    inReplyTo,
    references,
  });
}

module.exports = { sendMail, isConfigured };
