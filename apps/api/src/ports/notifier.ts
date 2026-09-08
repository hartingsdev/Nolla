/** D16: e-mail and push leave the core only through this port. */
export interface Notifier {
  sendEmail(msg: { to: string; subject: string; text: string }): Promise<void>;
  sendPush(deviceTokens: readonly string[], payload: { title: string; body: string; data?: Record<string, string> }): Promise<void>;
}

/** Records instead of sending; used by tests and local dev without SMTP. */
export class RecordingNotifier implements Notifier {
  readonly emails: { to: string; subject: string; text: string }[] = [];
  readonly pushes: { deviceTokens: readonly string[]; title: string; body: string }[] = [];
  sendEmail(msg: { to: string; subject: string; text: string }): Promise<void> { this.emails.push(msg); return Promise.resolve(); }
  sendPush(deviceTokens: readonly string[], payload: { title: string; body: string }): Promise<void> { this.pushes.push({ deviceTokens, ...payload }); return Promise.resolve(); }
}
