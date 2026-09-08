import nodemailer from 'nodemailer';
import { type Notifier } from '../ports/notifier.ts';

/** v0.1 adapter (D16): any SMTP relay for e-mail; push is wired at M10 with Expo's push service. */
export function smtpNotifier(smtpUrl: string, from: string): Notifier {
  const transport = nodemailer.createTransport(smtpUrl);
  return {
    async sendEmail(msg) { await transport.sendMail({ from, to: msg.to, subject: msg.subject, text: msg.text }); },
    async sendPush() { /* not yet: Expo push arrives with M10 */ },
  };
}
