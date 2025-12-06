export type CookieJar = Record<string, string>;

export interface LoginOptions {
  email?: string;
  password?: string;
  session?: string;
  userAgent?: string;
  appState?: SessionData;
}

export interface SessionData {
  cookies: CookieJar;
  userID: string;
  xs?: string;
  c_user?: string;
  createdAt: number;
  fbDtsg?: string;
  jazoest?: string;
}

export interface SendMessageOptions {
  threadID: string;
  message: string;
  attachments?: Array<AttachmentInput>;
  mentionIDs?: string[];
  replyToMessageID?: string;
}

export interface AttachmentInput {
  path?: string;
  url?: string;
  id?: string;
  type?: 'image' | 'video' | 'audio' | 'file';
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
  attachments: Attachment[];
  timestamp: number;
  isGroup: boolean;
  mentions?: string[];
  replyTo?: string;
}

export interface Attachment {
  type: 'image' | 'video' | 'audio' | 'file' | 'sticker' | 'gif' | 'link';
  id?: string;
  url?: string;
  filename?: string;
  filesize?: number;
  width?: number;
  height?: number;
  duration?: number;
  previewUrl?: string;
  stickerID?: string;
}

export interface Command {
  name: string;
  description?: string;
  usage?: string;
  aliases?: string[];
  cooldown?: number;
  adminOnly?: boolean;
  execute: (ctx: CommandContext, args: string[]) => Promise<void>;
}

export interface CommandContext {
  message: Message;
  api?: any;
  sendMessage: (opts: SendMessageOptions) => Promise<any>;
  thread?: any;
  user?: any;
  reaction?: any;
}

export interface ThreadInfo {
  threadID: string;
  name: string;
  participantIDs: string[];
  isGroup: boolean;
  adminIDs: string[];
  emoji?: string;
  color?: string;
  imageUrl?: string;
  unreadCount: number;
  messageCount: number;
  lastMessage?: LastMessage;
  isArchived: boolean;
  isMuted: boolean;
  muteUntil?: number;
  nicknames: Record<string, string>;
}

export interface LastMessage {
  text: string;
  senderID: string;
  timestamp: number;
}

export interface UserInfo {
  userID: string;
  name: string;
  firstName?: string;
  lastName?: string;
  vanity?: string;
  profileUrl?: string;
  thumbSrc?: string;
  profilePicture?: ProfilePicture;
  gender?: string;
  isFriend: boolean;
  isBlocked: boolean;
  isVerified: boolean;
  isBusiness: boolean;
}

export interface ProfilePicture {
  small: string;
  medium: string;
  large: string;
}

export interface TypingEvent {
  threadID: string;
  userID: string;
  isTyping: boolean;
  timestamp: number;
}

export interface PresenceEvent {
  userID: string;
  status: 'online' | 'offline' | 'idle' | 'active';
  lastActive: number;
  device?: 'mobile' | 'web' | 'desktop';
}

export interface ReadReceiptEvent {
  threadID: string;
  readerID: string;
  timestamp: number;
  watermarkTimestamp?: number;
}

export interface ReactionEvent {
  messageID: string;
  threadID: string;
  userID: string;
  reaction: string;
  isRemoval: boolean;
  timestamp: number;
}

export interface ThreadUpdateEvent {
  threadID: string;
  type: 'name' | 'emoji' | 'color' | 'image' | 'nickname' | 'admin';
  oldValue?: any;
  newValue?: any;
  actorID: string;
  timestamp: number;
}

export interface ParticipantEvent {
  threadID: string;
  type: 'added' | 'removed' | 'left';
  userIDs: string[];
  actorID: string;
  timestamp: number;
}

export interface MessageEvent {
  type: 'new' | 'unsent' | 'deleted' | 'edited';
  message: Message;
  timestamp: number;
}

export interface AccountHealth {
  score: number;
  warnings: number;
  checkpoints: number;
  lastCheckpoint: number | null;
  requestsToday: number;
  messagesToday: number;
  lastRequest: number;
  isSuspicious: boolean;
  isRestricted: boolean;
}

export interface RateLimitStatus {
  tokens: number;
  burstTokens: number;
  capacity: number;
  burstCapacity: number;
  refillInterval: number;
  requestsInWindow: number;
}

export interface MQTTStatus {
  connected: boolean;
  reconnectAttempts: number;
  subscribedTopics: string[];
  lastMessageTime: number;
  queuedMessages: number;
}

export interface BitunFCAHealth {
  antiBan: AccountHealth;
  rateLimit: RateLimitStatus;
  mqtt: MQTTStatus;
  session: {
    valid: boolean;
    remainingLife: number | null;
  };
}
