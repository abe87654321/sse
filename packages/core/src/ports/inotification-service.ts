export interface INotificationService {
  sendSms(phone: string, content: string): Promise<boolean>;
  sendEmail(email: string, subject: string, body: string): Promise<boolean>;
}
