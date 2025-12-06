import { EventEmitter } from 'eventemitter3';
import { GraphQLClient, DOC_IDS } from './GraphQLClient';
import { Logger } from './Logger';

export interface Reaction {
  userID: string;
  reaction: string;
  timestamp: number;
}

export interface ReactionEvent {
  messageID: string;
  threadID: string;
  userID: string;
  reaction: string;
  isRemoval: boolean;
  timestamp: number;
}

export const REACTIONS = {
  LIKE: '👍',
  LOVE: '❤️',
  HAHA: '😆',
  WOW: '😮',
  SAD: '😢',
  ANGRY: '😠',
  CARE: '🥰',
  FIRE: '🔥',
  CELEBRATE: '🎉',
  HUNDRED: '💯',
};

export class ReactionManager extends EventEmitter {
  private gql: GraphQLClient;
  private logger: Logger;
  private reactionCache: Map<string, Reaction[]> = new Map();

  constructor(gql: GraphQLClient) {
    super();
    this.gql = gql;
    this.logger = new Logger('REACTION');
  }

  async addReaction(messageID: string, reaction: string): Promise<boolean> {
    this.logger.info(`Adding reaction ${reaction} to message ${messageID}`);
    
    try {
      const success = await this.gql.sendReaction(messageID, reaction);
      
      if (success) {
        this.logger.success('Reaction added');
        this.emit('reaction_added', { messageID, reaction });
      }
      
      return success;
    } catch (error: any) {
      this.logger.error('Failed to add reaction:', error.message);
      return false;
    }
  }

  async removeReaction(messageID: string): Promise<boolean> {
    this.logger.info(`Removing reaction from message ${messageID}`);
    
    try {
      const response = await this.gql.request({
        docId: DOC_IDS.REACT_MESSAGE,
        variables: {
          message_id: messageID,
          reaction: ''
        }
      });

      const success = !response.errors;
      if (success) {
        this.logger.success('Reaction removed');
        this.emit('reaction_removed', { messageID });
      }
      
      return success;
    } catch (error: any) {
      this.logger.error('Failed to remove reaction:', error.message);
      return false;
    }
  }

  async getReactions(messageID: string): Promise<Reaction[]> {
    this.logger.info(`Getting reactions for message ${messageID}`);
    
    const cached = this.reactionCache.get(messageID);
    if (cached) {
      return cached;
    }

    try {
      const response = await this.gql.request({
        docId: '7156429441067463',
        variables: { message_id: messageID }
      });

      const reactions: Reaction[] = [];
      const reactors = response.data?.message?.message_reactions || [];
      
      for (const reactor of reactors) {
        reactions.push({
          userID: reactor.user?.id || '',
          reaction: reactor.reaction || '',
          timestamp: Date.now()
        });
      }

      this.reactionCache.set(messageID, reactions);
      setTimeout(() => this.reactionCache.delete(messageID), 60000);

      return reactions;
    } catch (error: any) {
      this.logger.error('Failed to get reactions:', error.message);
      return [];
    }
  }

  async toggleReaction(messageID: string, reaction: string): Promise<boolean> {
    const reactions = await this.getReactions(messageID);
    const hasReaction = reactions.some(r => r.reaction === reaction);
    
    if (hasReaction) {
      return this.removeReaction(messageID);
    } else {
      return this.addReaction(messageID, reaction);
    }
  }

  handleReactionEvent(event: any): void {
    const reactionEvent: ReactionEvent = {
      messageID: event.messageId || event.message_id,
      threadID: event.threadId || event.thread_id,
      userID: event.userId || event.user_id || event.actor_id,
      reaction: event.reaction || '',
      isRemoval: !event.reaction || event.reaction === '',
      timestamp: Date.now()
    };

    if (reactionEvent.isRemoval) {
      this.emit('reaction_received_remove', reactionEvent);
    } else {
      this.emit('reaction_received_add', reactionEvent);
    }

    this.reactionCache.delete(reactionEvent.messageID);
  }

  static get REACTIONS() {
    return REACTIONS;
  }
}
