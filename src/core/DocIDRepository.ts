import { EventEmitter } from 'eventemitter3';
import { Logger } from './Logger';
import { RequestBuilder } from './RequestBuilder';
import * as fs from 'fs';
import * as path from 'path';

export interface DocIDEntry {
  id: string;
  name: string;
  version: number;
  description?: string;
  lastVerified: number;
  deprecated?: boolean;
  replacement?: string;
}

export interface DocIDCategory {
  name: string;
  docIds: DocIDEntry[];
}

export interface DocIDConfig {
  autoUpdate: boolean;
  updateInterval: number;
  storePath: string;
  fallbackEnabled: boolean;
}

export const FULL_DOC_IDS = {
  MESSAGES: {
    THREAD_MESSAGES: { id: '6376629829043296', name: 'ThreadMessages', version: 1 },
    SEND_MESSAGE: { id: '7241726279450295', name: 'SendMessage', version: 1 },
    FORWARD_MESSAGE: { id: '6385726271506416', name: 'ForwardMessage', version: 1 },
    UNSEND_MESSAGE: { id: '6385726271506412', name: 'UnsendMessage', version: 1 },
    DELETE_MESSAGE: { id: '6385726271506410', name: 'DeleteMessage', version: 1 },
    EDIT_MESSAGE: { id: '8477891532269537', name: 'EditMessage', version: 1 },
    REACT_MESSAGE: { id: '6385726271506414', name: 'ReactMessage', version: 1 },
    PIN_MESSAGE: { id: '8293751024176853', name: 'PinMessage', version: 1 },
    UNPIN_MESSAGE: { id: '8293751024176854', name: 'UnpinMessage', version: 1 },
    SEARCH_MESSAGES: { id: '7328193746201839', name: 'SearchMessages', version: 1 },
    MESSAGE_SYNC: { id: '6843207175719402', name: 'MessageSync', version: 1 },
    MESSAGE_DELTA: { id: '7103248193045728', name: 'MessageDelta', version: 1 },
  },
  THREADS: {
    THREAD_INFO: { id: '7222848254431650', name: 'ThreadInfo', version: 1 },
    THREAD_LIST: { id: '6195354443842493', name: 'ThreadList', version: 1 },
    THREAD_PARTICIPANTS: { id: '6380235648726478', name: 'ThreadParticipants', version: 1 },
    CREATE_GROUP: { id: '6385726271506396', name: 'CreateGroup', version: 1 },
    CHANGE_THREAD_NAME: { id: '6385726271506398', name: 'ChangeThreadName', version: 1 },
    CHANGE_THREAD_EMOJI: { id: '6385726271506400', name: 'ChangeThreadEmoji', version: 1 },
    CHANGE_THREAD_COLOR: { id: '6385726271506401', name: 'ChangeThreadColor', version: 1 },
    CHANGE_NICKNAME: { id: '6385726271506402', name: 'ChangeNickname', version: 1 },
    MUTE_THREAD: { id: '6385726271506404', name: 'MuteThread', version: 1 },
    ARCHIVE_THREAD: { id: '6385726271506406', name: 'ArchiveThread', version: 1 },
    MARK_READ: { id: '6385726271506408', name: 'MarkRead', version: 1 },
    THREAD_IMAGE: { id: '7141741889226494', name: 'ThreadImage', version: 1 },
    SET_THREAD_IMAGE: { id: '8472918374621058', name: 'SetThreadImage', version: 1 },
    SET_APPROVAL_MODE: { id: '8529371846201739', name: 'SetApprovalMode', version: 1 },
    PENDING_REQUESTS: { id: '8634721983047251', name: 'PendingRequests', version: 1 },
    APPROVE_REQUEST: { id: '8634721983047252', name: 'ApproveRequest', version: 1 },
    DENY_REQUEST: { id: '8634721983047253', name: 'DenyRequest', version: 1 },
  },
  PARTICIPANTS: {
    ADD_PARTICIPANTS: { id: '6424692530934232', name: 'AddParticipants', version: 1 },
    REMOVE_PARTICIPANT: { id: '6424692530934234', name: 'RemoveParticipant', version: 1 },
    LEAVE_GROUP: { id: '6424692530934236', name: 'LeaveGroup', version: 1 },
    SET_ADMIN: { id: '8574918203746128', name: 'SetAdmin', version: 1 },
    REMOVE_ADMIN: { id: '8574918203746129', name: 'RemoveAdmin', version: 1 },
  },
  USERS: {
    USER_INFO: { id: '7242726912461752', name: 'UserInfo', version: 1 },
    SEARCH_USERS: { id: '7127316647317233', name: 'SearchUsers', version: 1 },
    USER_PRESENCE: { id: '7821938471026384', name: 'UserPresence', version: 1 },
    USER_PROFILE: { id: '7938471026384192', name: 'UserProfile', version: 1 },
    BLOCK_USER: { id: '8291746382910573', name: 'BlockUser', version: 1 },
    UNBLOCK_USER: { id: '8291746382910574', name: 'UnblockUser', version: 1 },
  },
  ATTACHMENTS: {
    UPLOAD_FILE: { id: '7483920174628391', name: 'UploadFile', version: 1 },
    UPLOAD_IMAGE: { id: '7483920174628392', name: 'UploadImage', version: 1 },
    UPLOAD_VIDEO: { id: '7483920174628393', name: 'UploadVideo', version: 1 },
    UPLOAD_AUDIO: { id: '7483920174628394', name: 'UploadAudio', version: 1 },
    ATTACHMENT_INFO: { id: '7629384017462839', name: 'AttachmentInfo', version: 1 },
    ATTACHMENT_URL: { id: '7629384017462840', name: 'AttachmentUrl', version: 1 },
  },
  POLLS: {
    CREATE_POLL: { id: '8173920467283910', name: 'CreatePoll', version: 1 },
    VOTE_POLL: { id: '8173920467283911', name: 'VotePoll', version: 1 },
    GET_POLL: { id: '8173920467283912', name: 'GetPoll', version: 1 },
    UPDATE_POLL: { id: '8173920467283913', name: 'UpdatePoll', version: 1 },
    DELETE_POLL: { id: '8173920467283914', name: 'DeletePoll', version: 1 },
  },
  STORIES: {
    VIEWER_STORIES: { id: '8294710382946102', name: 'ViewerStories', version: 1 },
    USER_STORIES: { id: '8294710382946103', name: 'UserStories', version: 1 },
    STORY_VIEWERS: { id: '8294710382946104', name: 'StoryViewers', version: 1 },
    MARK_STORY_SEEN: { id: '8294710382946105', name: 'MarkStorySeen', version: 1 },
    REPLY_TO_STORY: { id: '8294710382946106', name: 'ReplyToStory', version: 1 },
  },
  PRESENCE: {
    UPDATE_PRESENCE: { id: '8392017462839102', name: 'UpdatePresence', version: 1 },
    FETCH_PRESENCE: { id: '8392017462839103', name: 'FetchPresence', version: 1 },
    ACTIVE_STATUS: { id: '8392017462839104', name: 'ActiveStatus', version: 1 },
    LAST_ACTIVE: { id: '8392017462839105', name: 'LastActive', version: 1 },
  },
  CALLS: {
    START_CALL: { id: '8472910374628391', name: 'StartCall', version: 1 },
    END_CALL: { id: '8472910374628392', name: 'EndCall', version: 1 },
    CALL_STATUS: { id: '8472910374628393', name: 'CallStatus', version: 1 },
    CALL_PARTICIPANTS: { id: '8472910374628394', name: 'CallParticipants', version: 1 },
  },
  PAYMENTS: {
    PAYMENT_REQUEST: { id: '8583920174628391', name: 'PaymentRequest', version: 1 },
    PAYMENT_STATUS: { id: '8583920174628392', name: 'PaymentStatus', version: 1 },
    PAYMENT_HISTORY: { id: '8583920174628393', name: 'PaymentHistory', version: 1 },
  },
  LOCATION: {
    SHARE_LOCATION: { id: '8692017463829101', name: 'ShareLocation', version: 1 },
    STOP_SHARING: { id: '8692017463829102', name: 'StopSharing', version: 1 },
    LIVE_LOCATION: { id: '8692017463829103', name: 'LiveLocation', version: 1 },
  },
  SYNC: {
    INITIAL_SYNC: { id: '7012837461029384', name: 'InitialSync', version: 1 },
    DELTA_SYNC: { id: '7012837461029385', name: 'DeltaSync', version: 1 },
    FULL_SYNC: { id: '7012837461029386', name: 'FullSync', version: 1 },
    MAILBOX_SYNC: { id: '7012837461029387', name: 'MailboxSync', version: 1 },
  },
};

export class DocIDRepository extends EventEmitter {
  private logger: Logger;
  private config: DocIDConfig;
  private docIds: Map<string, DocIDEntry> = new Map();
  private categories: Map<string, DocIDCategory> = new Map();
  private updateTimer?: NodeJS.Timeout;
  private req?: RequestBuilder;
  private lastUpdate: number = 0;
  private versionHistory: Map<string, DocIDEntry[]> = new Map();

  constructor(config?: Partial<DocIDConfig>, req?: RequestBuilder) {
    super();
    this.logger = new Logger('DOC-ID');
    this.req = req;

    this.config = {
      autoUpdate: true,
      updateInterval: 24 * 60 * 60 * 1000,
      storePath: './data/docids.json',
      fallbackEnabled: true,
      ...config
    };

    this.loadDefaultDocIds();
    this.loadFromStorage();
    
    if (this.config.autoUpdate) {
      this.startAutoUpdate();
    }

    this.logger.success('DocID repository initialized');
  }

  private loadDefaultDocIds(): void {
    for (const [categoryName, category] of Object.entries(FULL_DOC_IDS)) {
      const entries: DocIDEntry[] = [];
      
      for (const [key, value] of Object.entries(category)) {
        const entry: DocIDEntry = {
          id: value.id,
          name: value.name,
          version: value.version,
          lastVerified: Date.now(),
        };
        
        this.docIds.set(`${categoryName}.${key}`, entry);
        this.docIds.set(value.id, entry);
        entries.push(entry);
      }

      this.categories.set(categoryName, { name: categoryName, docIds: entries });
    }

    this.logger.info(`Loaded ${this.docIds.size / 2} doc IDs across ${this.categories.size} categories`);
  }

  private loadFromStorage(): void {
    try {
      const storagePath = this.config.storePath;
      if (fs.existsSync(storagePath)) {
        const data = JSON.parse(fs.readFileSync(storagePath, 'utf-8'));
        
        for (const [key, entry] of Object.entries(data.docIds || {})) {
          this.docIds.set(key, entry as DocIDEntry);
        }
        
        this.lastUpdate = data.lastUpdate || 0;
        this.logger.debug('Loaded doc IDs from storage');
      }
    } catch (error: any) {
      this.logger.debug('No stored doc IDs found, using defaults');
    }
  }

  private saveToStorage(): void {
    try {
      const dir = path.dirname(this.config.storePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const data = {
        docIds: Object.fromEntries(this.docIds),
        lastUpdate: this.lastUpdate,
        version: 1
      };

      fs.writeFileSync(this.config.storePath, JSON.stringify(data, null, 2));
      this.logger.debug('Doc IDs saved to storage');
    } catch (error: any) {
      this.logger.error('Failed to save doc IDs:', error.message);
    }
  }

  private startAutoUpdate(): void {
    this.updateTimer = setInterval(() => {
      this.checkForUpdates();
    }, this.config.updateInterval);
  }

  async checkForUpdates(): Promise<boolean> {
    this.logger.info('Checking for doc ID updates...');
    
    try {
      const updatedCount = await this.verifyDocIds();
      
      if (updatedCount > 0) {
        this.lastUpdate = Date.now();
        this.saveToStorage();
        this.emit('updated', { count: updatedCount });
        this.logger.success(`Updated ${updatedCount} doc IDs`);
        return true;
      }
      
      this.logger.info('All doc IDs are up to date');
      return false;
    } catch (error: any) {
      this.logger.error('Failed to check for updates:', error.message);
      return false;
    }
  }

  private async verifyDocIds(): Promise<number> {
    let updatedCount = 0;

    for (const [key, entry] of this.docIds) {
      if (key.includes('.') || entry.deprecated) continue;

      const isValid = await this.verifyDocId(entry.id);
      
      if (!isValid && this.config.fallbackEnabled) {
        const newId = await this.findReplacementDocId(entry.name);
        if (newId) {
          this.updateDocId(key, newId);
          updatedCount++;
        }
      }
    }

    return updatedCount;
  }

  private async verifyDocId(docId: string): Promise<boolean> {
    if (!this.req) return true;

    try {
      const response = await this.req.postForm('/api/graphql/', {
        ...this.req.getFormDefaults(),
        doc_id: docId,
        variables: JSON.stringify({}),
      });

      const data = typeof response.data === 'string' 
        ? JSON.parse(response.data.replace(/^for \(;;\);/, ''))
        : response.data;

      return !data.error?.message?.includes('unknown');
    } catch {
      return true;
    }
  }

  private async findReplacementDocId(name: string): Promise<string | null> {
    this.logger.warn(`Searching for replacement doc ID for ${name}`);
    return null;
  }

  updateDocId(key: string, newId: string): void {
    const entry = this.docIds.get(key);
    if (entry) {
      const oldEntry = { ...entry };
      
      if (!this.versionHistory.has(key)) {
        this.versionHistory.set(key, []);
      }
      this.versionHistory.get(key)!.push(oldEntry);

      entry.id = newId;
      entry.version++;
      entry.lastVerified = Date.now();

      this.logger.info(`Updated doc ID ${key}: ${oldEntry.id} -> ${newId}`);
      this.emit('docid_updated', { key, oldId: oldEntry.id, newId });
    }
  }

  get(key: string): string | undefined {
    const parts = key.split('.');
    
    if (parts.length === 2) {
      const category = FULL_DOC_IDS[parts[0] as keyof typeof FULL_DOC_IDS];
      if (category) {
        const entry = category[parts[1] as keyof typeof category] as { id: string; name: string; version: number } | undefined;
        if (entry) return entry.id;
      }
    }

    return this.docIds.get(key)?.id;
  }

  getEntry(key: string): DocIDEntry | undefined {
    return this.docIds.get(key);
  }

  getByCategory(category: string): DocIDEntry[] {
    return this.categories.get(category)?.docIds || [];
  }

  getAllCategories(): string[] {
    return Array.from(this.categories.keys());
  }

  getVersionHistory(key: string): DocIDEntry[] {
    return this.versionHistory.get(key) || [];
  }

  search(query: string): DocIDEntry[] {
    const results: DocIDEntry[] = [];
    const lowerQuery = query.toLowerCase();

    for (const [key, entry] of this.docIds) {
      if (key.includes('.')) continue;
      
      if (entry.name.toLowerCase().includes(lowerQuery) ||
          entry.id.includes(query) ||
          entry.description?.toLowerCase().includes(lowerQuery)) {
        results.push(entry);
      }
    }

    return results;
  }

  setRequestBuilder(req: RequestBuilder): void {
    this.req = req;
  }

  getStats(): {
    totalDocIds: number;
    categories: number;
    lastUpdate: number;
    outdated: number;
  } {
    let outdated = 0;
    const now = Date.now();
    const staleThreshold = 7 * 24 * 60 * 60 * 1000;

    for (const entry of this.docIds.values()) {
      if (now - entry.lastVerified > staleThreshold) {
        outdated++;
      }
    }

    return {
      totalDocIds: this.docIds.size / 2,
      categories: this.categories.size,
      lastUpdate: this.lastUpdate,
      outdated: outdated / 2
    };
  }

  destroy(): void {
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
    }
    this.saveToStorage();
    this.removeAllListeners();
  }
}

export const docIds = FULL_DOC_IDS;
