import { EventEmitter } from 'eventemitter3';
import { GraphQLClient } from './GraphQLClient';
import { RequestBuilder } from './RequestBuilder';
import { Logger } from './Logger';
import { FULL_DOC_IDS } from './DocIDRepository';

export interface EditMessageOptions {
  messageID: string;
  threadID: string;
  newBody: string;
}

export interface DeleteMessageOptions {
  messageID: string;
  threadID: string;
  deleteForEveryone?: boolean;
}

export interface MessageActionResult {
  success: boolean;
  messageID: string;
  error?: string;
  timestamp?: number;
}

export class MessageActionManager extends EventEmitter {
  private gql: GraphQLClient;
  private req: RequestBuilder;
  private logger: Logger;
  private editHistory: Map<string, { original: string; edits: string[] }> = new Map();

  constructor(gql: GraphQLClient, req: RequestBuilder) {
    super();
    this.gql = gql;
    this.req = req;
    this.logger = new Logger('MSG-ACTION');
  }

  async editMessage(options: EditMessageOptions): Promise<MessageActionResult> {
    const { messageID, threadID, newBody } = options;
    this.logger.info(`Editing message ${messageID}`);

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.MESSAGES.EDIT_MESSAGE.id,
        variables: {
          message_id: messageID,
          thread_id: threadID,
          message: {
            text: newBody
          }
        }
      }, false);

      if (response.errors) {
        throw new Error(response.errors[0]?.message || 'Edit failed');
      }

      if (!this.editHistory.has(messageID)) {
        this.editHistory.set(messageID, { original: '', edits: [] });
      }
      this.editHistory.get(messageID)!.edits.push(newBody);

      this.logger.success('Message edited');
      this.emit('message_edited', { messageID, threadID, newBody });

      return {
        success: true,
        messageID,
        timestamp: Date.now()
      };
    } catch (error: any) {
      this.logger.error('Failed to edit message:', error.message);
      return {
        success: false,
        messageID,
        error: error.message
      };
    }
  }

  async unsendMessage(messageID: string, threadID?: string): Promise<MessageActionResult> {
    this.logger.info(`Unsending message ${messageID}`);

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.MESSAGES.UNSEND_MESSAGE.id,
        variables: {
          message_id: messageID,
          thread_id: threadID
        }
      }, false);

      if (response.errors) {
        throw new Error(response.errors[0]?.message || 'Unsend failed');
      }

      this.logger.success('Message unsent');
      this.emit('message_unsent', { messageID, threadID });

      return {
        success: true,
        messageID,
        timestamp: Date.now()
      };
    } catch (error: any) {
      this.logger.error('Failed to unsend message:', error.message);
      return {
        success: false,
        messageID,
        error: error.message
      };
    }
  }

  async deleteForSelf(messageID: string, threadID?: string): Promise<MessageActionResult> {
    this.logger.info(`Deleting message ${messageID} for self`);

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.MESSAGES.DELETE_MESSAGE.id,
        variables: {
          message_id: messageID,
          thread_id: threadID,
          delete_for_self_only: true
        }
      }, false);

      if (response.errors) {
        throw new Error(response.errors[0]?.message || 'Delete failed');
      }

      this.logger.success('Message deleted for self');
      this.emit('message_deleted', { messageID, threadID, deletedForSelf: true });

      return {
        success: true,
        messageID,
        timestamp: Date.now()
      };
    } catch (error: any) {
      this.logger.error('Failed to delete message:', error.message);
      return {
        success: false,
        messageID,
        error: error.message
      };
    }
  }

  async deleteMessage(options: DeleteMessageOptions): Promise<MessageActionResult> {
    const { messageID, threadID, deleteForEveryone = false } = options;

    if (deleteForEveryone) {
      return this.unsendMessage(messageID, threadID);
    } else {
      return this.deleteForSelf(messageID, threadID);
    }
  }

  async batchUnsend(messageIDs: string[], threadID?: string): Promise<MessageActionResult[]> {
    this.logger.info(`Batch unsending ${messageIDs.length} messages`);
    
    const results: MessageActionResult[] = [];
    
    for (const messageID of messageIDs) {
      const result = await this.unsendMessage(messageID, threadID);
      results.push(result);
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    const successCount = results.filter(r => r.success).length;
    this.logger.info(`Batch unsend complete: ${successCount}/${messageIDs.length} successful`);

    return results;
  }

  async batchDelete(messageIDs: string[], threadID?: string): Promise<MessageActionResult[]> {
    this.logger.info(`Batch deleting ${messageIDs.length} messages`);
    
    const results: MessageActionResult[] = [];
    
    for (const messageID of messageIDs) {
      const result = await this.deleteForSelf(messageID, threadID);
      results.push(result);
      
      await new Promise(resolve => setTimeout(resolve, 300));
    }

    const successCount = results.filter(r => r.success).length;
    this.logger.info(`Batch delete complete: ${successCount}/${messageIDs.length} successful`);

    return results;
  }

  getEditHistory(messageID: string): { original: string; edits: string[] } | undefined {
    return this.editHistory.get(messageID);
  }

  clearEditHistory(): void {
    this.editHistory.clear();
    this.logger.debug('Edit history cleared');
  }

  getStats(): {
    editHistorySize: number;
  } {
    return {
      editHistorySize: this.editHistory.size
    };
  }
}
