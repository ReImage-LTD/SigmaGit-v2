import { config, getWebUrl } from '../config';
import * as nodemailer from 'nodemailer';
import { Resend } from 'resend';

let resendClient: Resend | null = null;
let smtpTransporter: nodemailer.Transporter | null = null;

function getResend(): Resend | null {
  if (!config.email.resendApiKey) {
    return null;
  }

  if (!resendClient) {
    resendClient = new Resend(config.email.resendApiKey);
  }

  return resendClient;
}

function getSmtpTransporter(): nodemailer.Transporter | null {
  if (!config.email.smtp.host || !config.email.smtp.user || !config.email.smtp.pass) {
    return null;
  }

  if (!smtpTransporter) {
    smtpTransporter = nodemailer.createTransport({
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: config.email.smtp.secure,
      auth: {
        user: config.email.smtp.user,
        pass: config.email.smtp.pass,
      },
    });
  }

  return smtpTransporter;
}

export type SendEmailOptions = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export async function sendEmail(options: SendEmailOptions): Promise<boolean> {
  const provider = config.email.provider;

  if (provider === 'smtp') {
    const transporter = getSmtpTransporter();

    if (!transporter) {
      console.warn('[Email] SMTP not configured, emails will not be sent');
      return false;
    }

    try {
      await transporter.sendMail({
        from: config.email.fromAddress,
        to: options.to,
        subject: options.subject,
        html: options.html,
        text: options.text,
      });

      return true;
    } catch (err) {
      console.error('[Email] Error sending email via SMTP:', err);
      return false;
    }
  }

  const resend = getResend();

  if (!resend) {
    console.warn('[Email] Resend not configured, emails will not be sent');
    return false;
  }

  try {
    const { error } = await resend.emails.send({
      from: config.email.fromAddress,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    if (error) {
      console.error('[Email] Failed to send email via Resend:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('[Email] Error sending email via Resend:', err);
    return false;
  }
}

const emailBrandHeader = `
  <table border="0" cellpadding="0" cellspacing="0" width="100%" style="background: #24292f; border-radius: 6px 6px 0 0;">
    <tr>
      <td style="padding: 24px 24px;">
        <img src="https://sigmagit.com/logo-email.png" alt="Sigmagit" width="120" height="32" style="display:block;"/>
      </td>
    </tr>
  </table>
`;

const emailContainerStyle = `
  background: #ffffff;
  border-radius: 0 0 6px 6px;
  border: 1px solid #d0d7de;
  border-top: none;
  max-width: 540px;
  margin: 0 auto;
  padding: 32px;
  font-family: -apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;
  color: #24292f;
`;

const githubButtonStyle = `
  display: inline-block;
  padding: 12px 28px;
  font-weight: 600;
  color: #fff;
  background: linear-gradient(180deg, #2ea44f 0%, #22863a 100%);
  border-radius: 6px;
  text-decoration: none;
  box-shadow: 0 1px 0 #22863a;
  margin: 20px 0;
`;

function githubPanel(content: string) {
  return `<div style="background: #f6f8fa; padding: 16px 20px; border-radius: 6px; margin: 24px 0; color: #57606a; font-size: 14px;">
    ${content}
  </div>`;
}

export async function sendPasswordResetEmail(
  to: string,
  token: string,
  username: string,
): Promise<boolean> {
  const webUrl = getWebUrl();
  // URL fragments are not sent in HTTP requests, referrers, proxy logs, or server analytics.
  const resetUrl = `${webUrl}/reset-password#token=${encodeURIComponent(token)}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Reset your password</title>
</head>
<body style="background: #f6f8fa; padding: 30px 0; min-width: 100vw;">
  <div style="max-width: 540px; margin: 0 auto;">
    ${emailBrandHeader}
    <div style="${emailContainerStyle}">
      <h1 style="font-size: 22px; margin-top: 0; margin-bottom: 18px;">Reset your Sigmagit password</h1>
      <p style="font-size: 16px;">Hi <strong>@${username}</strong>,</p>
      <p style="font-size: 15px; margin-bottom: 6px;">
        A request was received to reset your Sigmagit account password.
      </p>
      <a href="${resetUrl}" style="${githubButtonStyle}">Reset password</a>
      ${githubPanel("This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.")}
      <hr style="border: none; border-top: 1px solid #d0d7de; margin: 32px 0;" />
      <p style="color: #57606a; font-size: 14px;">If the button above does not work, copy and paste the link below into your browser:</p>
      <div style="background: #f6f8fa; border-radius: 6px; padding: 12px; color: #57606a; font-size: 13px; word-break: break-all;">
        <a style="color: #0969da;" href="${resetUrl}">${resetUrl}</a>
      </div>
    </div>
    <div style="text-align: center; color: #8c959f; font-size: 12px; margin-top: 24px;">
      <span>Sent by Sigmagit • <a href="https://sigmagit.com" style="color: #848d97; text-decoration: underline;">sigmagit.com</a></span>
    </div>
  </div>
</body>
</html>
`;

  const text = `
Reset your password

Hi @${username},

A request was received to reset your Sigmagit account password.

Reset password: ${resetUrl}

This link will expire in 1 hour. If you didn't request a password reset, you can safely ignore this email.

If the button above does not work, copy and paste this link in your browser:

${resetUrl}
`;

  return sendEmail({
    to,
    subject: 'Reset your Sigmagit password',
    html,
    text,
  });
}

export async function sendVerificationEmail(
  to: string,
  token: string,
  username: string,
): Promise<boolean> {
  const webUrl = getWebUrl();
  const verifyUrl = `${webUrl}/verify-email?token=${token}`;

  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Verify your email</title>
</head>
<body style="background: #f6f8fa; padding: 30px 0; min-width: 100vw;">
  <div style="max-width: 540px; margin: 0 auto;">
    ${emailBrandHeader}
    <div style="${emailContainerStyle}">
      <h1 style="font-size: 22px; margin-top: 0; margin-bottom: 18px;">Verify your email address</h1>
      <p style="font-size: 16px;">Welcome to <strong>Sigmagit</strong>, <strong>@${username}</strong>!</p>
      <p style="font-size: 15px; margin-bottom: 6px;">
        Please verify your email address to activate your Sigmagit account.
      </p>
      <a href="${verifyUrl}" style="${githubButtonStyle}">Verify email</a>
      ${githubPanel('This link will expire in 24 hours.')}
      <hr style="border: none; border-top: 1px solid #d0d7de; margin: 32px 0;" />
      <p style="color: #57606a; font-size: 14px;">If the button above does not work, copy and paste the link below into your browser:</p>
      <div style="background: #f6f8fa; border-radius: 6px; padding: 12px; color: #57606a; font-size: 13px; word-break: break-all;">
        <a style="color: #0969da;" href="${verifyUrl}">${verifyUrl}</a>
      </div>
    </div>
    <div style="text-align: center; color: #8c959f; font-size: 12px; margin-top: 24px;">
      <span>Sent by Sigmagit • <a href="https://sigmagit.com" style="color: #848d97; text-decoration: underline;">sigmagit.com</a></span>
    </div>
  </div>
</body>
</html>
`;

  const text = `
Verify your email address

Welcome to Sigmagit, @${username}!

Please verify your email address to activate your Sigmagit account.

Verify email: ${verifyUrl}

This link will expire in 24 hours.

If the button above does not work, copy and paste this link in your browser:

${verifyUrl}
`;

  return sendEmail({
    to,
    subject: 'Verify your Sigmagit email',
    html,
    text,
  });
}

export async function sendNotificationEmail(
  to: string,
  title: string,
  body: string,
  actionUrl?: string,
  actionText?: string,
): Promise<boolean> {
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${title}</title>
</head>
<body style="background: #f6f8fa; padding: 30px 0; min-width: 100vw;">
  <div style="max-width: 540px; margin: 0 auto;">
    ${emailBrandHeader}
    <div style="${emailContainerStyle}">
      <h1 style="font-size: 22px; margin-top: 0; margin-bottom: 18px;">${title}</h1>
      <p style="font-size: 15px; margin-bottom: 6px;">${body}</p>
      ${
        actionUrl && actionText
          ? `<a href="${actionUrl}" style="${githubButtonStyle}">${actionText}</a>`
          : ``
      }
      ${githubPanel('You are receiving this notification as a user of Sigmagit.')}
    </div>
    <div style="text-align: center; color: #8c959f; font-size: 12px; margin-top: 24px;">
      <span>Sent by Sigmagit • <a href="https://sigmagit.com" style="color: #848d97; text-decoration: underline;">sigmagit.com</a></span>
    </div>
  </div>
</body>
</html>
`;

  const text = `${title}

${body}
${actionUrl && actionText ? `\n${actionText}: ${actionUrl}` : ''}

You are receiving this notification as a user of Sigmagit.
`;

  return sendEmail({
    to,
    subject: title,
    html,
    text,
  });
}
