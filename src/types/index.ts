export type CookieJar = Record<string, string>;

export interface LoginOptions {
  email?: string;
  password?: string;
  session?: string;
  userAgent?: string;
}

export interface SessionData {
  cookies: CookieJar;
  userID: string;
  xs?: string;
  c_user?: string;
  createdAt: number;
}

export interface SendMessageOptions {
  threadID: string;
  message: string;
  attachments?: Array<{ path?: string; url?: string; id?: string }>;
  mentionIDs?: string[];
}

export interface GraphQLRequest {
  docId?: string;
  query?: string;
  variables?: Record<string, any>;
}

export interface PluginContext {
  client: import('../core/RequestBuilder').RequestBuilder;
  sendMessage: (opts: SendMessageOptions) => Promise<any>;
  on: (event: string, handler: (...args: any[]) => void) => void;
}

export interface Message {
  threadID: string;
  senderID: string;
  messageID: string;
  body: string;
  attachments: any[];
}

export interface Command {
  name: string;
  description?: string;
  execute: (ctx: any, args: string[]) => Promise<void>;
}
