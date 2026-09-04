/**
 * Push provider abstraction — FCM Android first; APNs/FCM iOS later without redesign.
 */

export type PushMessage = {
  title: string;
  body: string;
  data?: Record<string, string>;
};

export type PushSendResult = {
  ok: boolean;
  /** Provider reported the token as permanently invalid */
  invalidToken?: boolean;
  error?: string;
  providerMessageId?: string;
};

export interface PushProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(token: string, message: PushMessage): Promise<PushSendResult>;
}
