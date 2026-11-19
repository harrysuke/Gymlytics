import { env } from './env';

export interface Notifier {
  send(channel: 'sms' | 'email' | 'push', to: string, message: string): Promise<void>;
}

class ConsoleNotifier implements Notifier {
  async send(channel: 'sms' | 'email' | 'push', to: string, message: string): Promise<void> {
    console.log(`[notify:${channel}] ${to}: ${message}`);
  }
}

class TwilioNotifier implements Notifier {
  async send(_channel: 'sms' | 'email' | 'push', to: string, message: string): Promise<void> {
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;
    if (!sid || !token || !from) throw new Error('Twilio is not configured');
    const body = new URLSearchParams({ To: to, From: from, Body: message });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString('base64')}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body,
    });
    if (!response.ok) throw new Error(`Twilio send failed (${response.status})`);
  }
}

class SendGridNotifier implements Notifier {
  async send(_channel: 'sms' | 'email' | 'push', to: string, message: string): Promise<void> {
    const key = process.env.SENDGRID_API_KEY;
    if (!key) throw new Error('SendGrid is not configured');
    const response = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: process.env.EMAIL_FROM ?? 'noreply@gymlytics.app' },
        subject: 'Gymlytics academy update',
        content: [{ type: 'text/plain', value: message }],
      }),
    });
    if (!response.ok) throw new Error(`SendGrid send failed (${response.status})`);
  }
}

/** Uses real providers when configured, console otherwise (dev + tests). */
export function createNotifier(): Notifier {
  const sms = process.env.TWILIO_ACCOUNT_SID ? new TwilioNotifier() : null;
  const email = process.env.SENDGRID_API_KEY ? new SendGridNotifier() : null;
  const fallback = new ConsoleNotifier();
  if (!sms && !email) return fallback;
  return {
    async send(channel, to, message) {
      if (channel === 'sms' && sms) return sms.send(channel, to, message);
      if (channel === 'email' && email) return email.send(channel, to, message);
      return fallback.send(channel, to, message);
    },
  };
}

export const notifier = createNotifier();
export { env };
