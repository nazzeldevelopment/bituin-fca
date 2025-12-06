import { EventEmitter } from 'eventemitter3';
import { RequestBuilder } from './RequestBuilder';
import { GraphQLClient } from './GraphQLClient';
import { Logger } from './Logger';
import { randomString } from '../utils/helpers';

export interface Poll {
  pollID: string;
  threadID: string;
  creatorID: string;
  question: string;
  options: PollOption[];
  totalVotes: number;
  expiresAt?: number;
  isMultipleChoice: boolean;
  isAnonymous: boolean;
  hasVoted: boolean;
  myVotes: string[];
  createdAt: number;
}

export interface PollOption {
  optionID: string;
  text: string;
  votes: number;
  voterIDs?: string[];
  isSelected: boolean;
}

export interface CreatePollOptions {
  threadID: string;
  question: string;
  options: string[];
  expiresInHours?: number;
  isMultipleChoice?: boolean;
  isAnonymous?: boolean;
}

export interface Story {
  storyID: string;
  authorID: string;
  authorName: string;
  mediaType: 'photo' | 'video' | 'text';
  mediaUrl?: string;
  thumbnailUrl?: string;
  text?: string;
  backgroundColor?: string;
  duration?: number;
  expiresAt: number;
  createdAt: number;
  viewCount: number;
  hasViewed: boolean;
  canReply: boolean;
  reactions?: StoryReaction[];
}

export interface StoryReaction {
  userID: string;
  reaction: string;
  timestamp: number;
}

export interface VanishModeState {
  threadID: string;
  isEnabled: boolean;
  enabledBy?: string;
  enabledAt?: number;
  messageLifespan: number;
}

export interface PaymentRequest {
  requestID: string;
  threadID: string;
  requesterID: string;
  amount: number;
  currency: string;
  note?: string;
  status: 'pending' | 'completed' | 'cancelled' | 'declined';
  createdAt: number;
}

export interface LocationShare {
  shareID: string;
  threadID: string;
  senderID: string;
  latitude: number;
  longitude: number;
  accuracy?: number;
  placeName?: string;
  address?: string;
  isLive: boolean;
  expiresAt?: number;
  updatedAt: number;
}

export interface CallInfo {
  callID: string;
  threadID: string;
  initiatorID: string;
  participants: string[];
  type: 'audio' | 'video' | 'group_audio' | 'group_video';
  status: 'ringing' | 'active' | 'ended' | 'missed' | 'declined';
  startedAt?: number;
  endedAt?: number;
  duration?: number;
}

export interface ScheduledMessage {
  scheduleID: string;
  threadID: string;
  message: string;
  attachments?: any[];
  scheduledFor: number;
  createdAt: number;
  status: 'pending' | 'sent' | 'failed' | 'cancelled';
}

export class EdgeFeaturesManager extends EventEmitter {
  private req: RequestBuilder;
  private gql: GraphQLClient;
  private logger: Logger;
  private vanishModeStates: Map<string, VanishModeState> = new Map();
  private activePolls: Map<string, Poll> = new Map();
  private scheduledMessages: Map<string, ScheduledMessage> = new Map();
  private scheduleTimer?: NodeJS.Timeout;

  constructor(req: RequestBuilder, gql?: GraphQLClient) {
    super();
    this.req = req;
    this.gql = gql || new GraphQLClient(req);
    this.logger = new Logger('EDGE-FEATURES');
    this.startScheduleChecker();
    this.logger.success('Edge features manager initialized');
  }

  async createPoll(options: CreatePollOptions): Promise<Poll | null> {
    this.logger.info(`Creating poll in thread ${options.threadID}`);
    
    try {
      const formDefaults = this.req.getFormDefaults();
      const pollOptions = options.options.map((text, index) => ({
        text,
        id: `option_${index}_${randomString(8)}`,
      }));

      const response = await this.gql.request({
        docId: '5850714198297331',
        variables: {
          input: {
            thread_id: options.threadID,
            question_text: options.question,
            options: pollOptions,
            expires_in_seconds: options.expiresInHours ? options.expiresInHours * 3600 : null,
            is_multiple_choice: options.isMultipleChoice || false,
            is_anonymous: options.isAnonymous || false,
            client_mutation_id: randomString(16),
          },
        },
      });

      if (response?.data?.messenger_poll_create?.poll) {
        const pollData = response.data.messenger_poll_create.poll;
        const poll: Poll = {
          pollID: pollData.id,
          threadID: options.threadID,
          creatorID: formDefaults.__user || '',
          question: options.question,
          options: pollOptions.map((opt, i) => ({
            optionID: opt.id,
            text: opt.text,
            votes: 0,
            isSelected: false,
          })),
          totalVotes: 0,
          expiresAt: options.expiresInHours ? Date.now() + options.expiresInHours * 3600000 : undefined,
          isMultipleChoice: options.isMultipleChoice || false,
          isAnonymous: options.isAnonymous || false,
          hasVoted: false,
          myVotes: [],
          createdAt: Date.now(),
        };

        this.activePolls.set(poll.pollID, poll);
        this.logger.success(`Poll created: ${poll.pollID}`);
        this.emit('poll_created', poll);
        return poll;
      }

      return null;
    } catch (error: any) {
      this.logger.error('Failed to create poll:', error.message);
      return null;
    }
  }

  async votePoll(pollID: string, optionIDs: string[]): Promise<boolean> {
    this.logger.info(`Voting on poll ${pollID}`);
    
    try {
      const response = await this.gql.request({
        docId: '5906647339407234',
        variables: {
          input: {
            poll_id: pollID,
            option_ids: optionIDs,
            client_mutation_id: randomString(16),
          },
        },
      });

      if (response?.data?.messenger_poll_vote?.success) {
        const poll = this.activePolls.get(pollID);
        if (poll) {
          poll.hasVoted = true;
          poll.myVotes = optionIDs;
          poll.options.forEach(opt => {
            opt.isSelected = optionIDs.includes(opt.optionID);
            if (opt.isSelected) opt.votes++;
          });
          poll.totalVotes++;
        }
        
        this.logger.success('Vote recorded');
        this.emit('poll_voted', { pollID, optionIDs });
        return true;
      }

      return false;
    } catch (error: any) {
      this.logger.error('Failed to vote on poll:', error.message);
      return false;
    }
  }

  async getPollResults(pollID: string): Promise<Poll | null> {
    try {
      const response = await this.gql.request({
        docId: '5850714198297331',
        variables: {
          poll_id: pollID,
          include_voters: true,
        },
      });

      if (response?.data?.poll) {
        const pollData = response.data.poll;
        const poll: Poll = {
          pollID: pollData.id,
          threadID: pollData.thread_id,
          creatorID: pollData.creator_id,
          question: pollData.question_text,
          options: pollData.options.map((opt: any) => ({
            optionID: opt.id,
            text: opt.text,
            votes: opt.vote_count || 0,
            voterIDs: opt.voters?.map((v: any) => v.id),
            isSelected: opt.is_selected,
          })),
          totalVotes: pollData.total_votes,
          expiresAt: pollData.expires_at,
          isMultipleChoice: pollData.is_multiple_choice,
          isAnonymous: pollData.is_anonymous,
          hasVoted: pollData.has_voted,
          myVotes: pollData.my_votes || [],
          createdAt: pollData.created_at,
        };

        this.activePolls.set(pollID, poll);
        return poll;
      }

      return null;
    } catch (error: any) {
      this.logger.error('Failed to get poll results:', error.message);
      return null;
    }
  }

  async getStories(userIDs?: string[]): Promise<Story[]> {
    this.logger.debug('Fetching stories');
    
    try {
      const response = await this.gql.request({
        docId: '6203761179626969',
        variables: {
          user_ids: userIDs || [],
          include_expired: false,
        },
      });

      if (response?.data?.stories?.edges) {
        const stories: Story[] = response.data.stories.edges.map((edge: any) => {
          const node = edge.node;
          return {
            storyID: node.id,
            authorID: node.author?.id || '',
            authorName: node.author?.name || '',
            mediaType: node.media_type || 'photo',
            mediaUrl: node.media_url,
            thumbnailUrl: node.thumbnail_url,
            text: node.text,
            backgroundColor: node.background_color,
            duration: node.duration,
            expiresAt: node.expires_at * 1000,
            createdAt: node.created_at * 1000,
            viewCount: node.view_count || 0,
            hasViewed: node.has_viewed || false,
            canReply: node.can_reply !== false,
            reactions: node.reactions?.map((r: any) => ({
              userID: r.user_id,
              reaction: r.reaction,
              timestamp: r.timestamp * 1000,
            })),
          };
        });

        this.logger.success(`Fetched ${stories.length} stories`);
        return stories;
      }

      return [];
    } catch (error: any) {
      this.logger.error('Failed to fetch stories:', error.message);
      return [];
    }
  }

  async viewStory(storyID: string): Promise<boolean> {
    try {
      const response = await this.gql.request({
        docId: '6220431788027445',
        variables: {
          story_id: storyID,
          client_mutation_id: randomString(16),
        },
      });

      if (response?.data?.story_view?.success) {
        this.logger.debug(`Viewed story ${storyID}`);
        this.emit('story_viewed', storyID);
        return true;
      }

      return false;
    } catch (error: any) {
      this.logger.error('Failed to view story:', error.message);
      return false;
    }
  }

  async reactToStory(storyID: string, reaction: string): Promise<boolean> {
    try {
      const response = await this.gql.request({
        docId: '6243018689125891',
        variables: {
          story_id: storyID,
          reaction,
          client_mutation_id: randomString(16),
        },
      });

      if (response?.data?.story_reaction?.success) {
        this.logger.success(`Reacted to story ${storyID}`);
        this.emit('story_reacted', { storyID, reaction });
        return true;
      }

      return false;
    } catch (error: any) {
      this.logger.error('Failed to react to story:', error.message);
      return false;
    }
  }

  async replyToStory(storyID: string, message: string): Promise<boolean> {
    try {
      const response = await this.gql.request({
        docId: '6255789214478553',
        variables: {
          story_id: storyID,
          message,
          client_mutation_id: randomString(16),
        },
      });

      if (response?.data?.story_reply?.success) {
        this.logger.success(`Replied to story ${storyID}`);
        this.emit('story_replied', { storyID, message });
        return true;
      }

      return false;
    } catch (error: any) {
      this.logger.error('Failed to reply to story:', error.message);
      return false;
    }
  }

  async enableVanishMode(threadID: string): Promise<boolean> {
    this.logger.info(`Enabling vanish mode for thread ${threadID}`);
    
    try {
      const formDefaults = this.req.getFormDefaults();
      const response = await this.gql.request({
        docId: '5915439731814599',
        variables: {
          input: {
            thread_id: threadID,
            is_enabled: true,
            client_mutation_id: randomString(16),
          },
        },
      });

      if (response?.data?.messenger_vanish_mode?.success) {
        const state: VanishModeState = {
          threadID,
          isEnabled: true,
          enabledBy: formDefaults.__user,
          enabledAt: Date.now(),
          messageLifespan: 0,
        };
        
        this.vanishModeStates.set(threadID, state);
        this.logger.success('Vanish mode enabled');
        this.emit('vanish_mode_enabled', state);
        return true;
      }

      return false;
    } catch (error: any) {
      this.logger.error('Failed to enable vanish mode:', error.message);
      return false;
    }
  }

  async disableVanishMode(threadID: string): Promise<boolean> {
    this.logger.info(`Disabling vanish mode for thread ${threadID}`);
    
    try {
      const response = await this.gql.request({
        docId: '5915439731814599',
        variables: {
          input: {
            thread_id: threadID,
            is_enabled: false,
            client_mutation_id: randomString(16),
          },
        },
      });

      if (response?.data?.messenger_vanish_mode?.success) {
        this.vanishModeStates.delete(threadID);
        this.logger.success('Vanish mode disabled');
        this.emit('vanish_mode_disabled', threadID);
        return true;
      }

      return false;
    } catch (error: any) {
      this.logger.error('Failed to disable vanish mode:', error.message);
      return false;
    }
  }

  isVanishModeEnabled(threadID: string): boolean {
    return this.vanishModeStates.get(threadID)?.isEnabled || false;
  }

  getVanishModeState(threadID: string): VanishModeState | undefined {
    return this.vanishModeStates.get(threadID);
  }

  async sendPaymentRequest(threadID: string, amount: number, currency: string, note?: string): Promise<PaymentRequest | null> {
    this.logger.info(`Sending payment request: ${amount} ${currency}`);
    
    try {
      const formDefaults = this.req.getFormDefaults();
      const response = await this.gql.request({
        docId: '6012345678901234',
        variables: {
          input: {
            thread_id: threadID,
            amount: Math.round(amount * 100),
            currency: currency.toUpperCase(),
            note: note || '',
            client_mutation_id: randomString(16),
          },
        },
      });

      if (response?.data?.payment_request?.request) {
        const data = response.data.payment_request.request;
        const request: PaymentRequest = {
          requestID: data.id,
          threadID,
          requesterID: formDefaults.__user || '',
          amount,
          currency: currency.toUpperCase(),
          note,
          status: 'pending',
          createdAt: Date.now(),
        };

        this.logger.success(`Payment request created: ${request.requestID}`);
        this.emit('payment_requested', request);
        return request;
      }

      return null;
    } catch (error: any) {
      this.logger.error('Failed to send payment request:', error.message);
      return null;
    }
  }

  async cancelPaymentRequest(requestID: string): Promise<boolean> {
    try {
      const response = await this.gql.request({
        docId: '6012345678901235',
        variables: {
          request_id: requestID,
          client_mutation_id: randomString(16),
        },
      });

      if (response?.data?.cancel_payment_request?.success) {
        this.logger.success('Payment request cancelled');
        this.emit('payment_cancelled', requestID);
        return true;
      }

      return false;
    } catch (error: any) {
      this.logger.error('Failed to cancel payment request:', error.message);
      return false;
    }
  }

  async shareLocation(threadID: string, latitude: number, longitude: number, options?: { 
    isLive?: boolean; 
    duration?: number;
    placeName?: string;
  }): Promise<LocationShare | null> {
    this.logger.info(`Sharing location in thread ${threadID}`);
    
    try {
      const formDefaults = this.req.getFormDefaults();
      const response = await this.gql.request({
        docId: '5954321098765432',
        variables: {
          input: {
            thread_id: threadID,
            latitude,
            longitude,
            is_live: options?.isLive || false,
            duration_minutes: options?.isLive ? (options?.duration || 60) : undefined,
            place_name: options?.placeName,
            client_mutation_id: randomString(16),
          },
        },
      });

      if (response?.data?.location_share?.share) {
        const data = response.data.location_share.share;
        const share: LocationShare = {
          shareID: data.id,
          threadID,
          senderID: formDefaults.__user || '',
          latitude,
          longitude,
          placeName: options?.placeName,
          isLive: options?.isLive || false,
          expiresAt: options?.isLive ? Date.now() + (options?.duration || 60) * 60000 : undefined,
          updatedAt: Date.now(),
        };

        this.logger.success(`Location shared: ${share.shareID}`);
        this.emit('location_shared', share);
        return share;
      }

      return null;
    } catch (error: any) {
      this.logger.error('Failed to share location:', error.message);
      return null;
    }
  }

  async stopLiveLocation(shareID: string): Promise<boolean> {
    try {
      const response = await this.gql.request({
        docId: '5954321098765433',
        variables: {
          share_id: shareID,
          client_mutation_id: randomString(16),
        },
      });

      if (response?.data?.stop_live_location?.success) {
        this.logger.success('Live location stopped');
        this.emit('live_location_stopped', shareID);
        return true;
      }

      return false;
    } catch (error: any) {
      this.logger.error('Failed to stop live location:', error.message);
      return false;
    }
  }

  async initiateCall(threadID: string, type: 'audio' | 'video'): Promise<CallInfo | null> {
    this.logger.info(`Initiating ${type} call in thread ${threadID}`);
    
    try {
      const formDefaults = this.req.getFormDefaults();
      const response = await this.gql.request({
        docId: '5876543210987654',
        variables: {
          input: {
            thread_id: threadID,
            call_type: type,
            client_mutation_id: randomString(16),
          },
        },
      });

      if (response?.data?.initiate_call?.call) {
        const data = response.data.initiate_call.call;
        const call: CallInfo = {
          callID: data.id,
          threadID,
          initiatorID: formDefaults.__user || '',
          participants: data.participants || [formDefaults.__user],
          type,
          status: 'ringing',
          startedAt: Date.now(),
        };

        this.logger.success(`Call initiated: ${call.callID}`);
        this.emit('call_initiated', call);
        return call;
      }

      return null;
    } catch (error: any) {
      this.logger.error('Failed to initiate call:', error.message);
      return null;
    }
  }

  async endCall(callID: string): Promise<boolean> {
    try {
      const response = await this.gql.request({
        docId: '5876543210987655',
        variables: {
          call_id: callID,
          client_mutation_id: randomString(16),
        },
      });

      if (response?.data?.end_call?.success) {
        this.logger.success('Call ended');
        this.emit('call_ended', callID);
        return true;
      }

      return false;
    } catch (error: any) {
      this.logger.error('Failed to end call:', error.message);
      return false;
    }
  }

  async scheduleMessage(threadID: string, message: string, scheduledFor: Date): Promise<ScheduledMessage | null> {
    if (scheduledFor.getTime() <= Date.now()) {
      this.logger.error('Scheduled time must be in the future');
      return null;
    }

    const scheduleID = randomString(16);
    const scheduled: ScheduledMessage = {
      scheduleID,
      threadID,
      message,
      scheduledFor: scheduledFor.getTime(),
      createdAt: Date.now(),
      status: 'pending',
    };

    this.scheduledMessages.set(scheduleID, scheduled);
    this.logger.success(`Message scheduled for ${scheduledFor.toISOString()}`);
    this.emit('message_scheduled', scheduled);
    
    return scheduled;
  }

  async cancelScheduledMessage(scheduleID: string): Promise<boolean> {
    const scheduled = this.scheduledMessages.get(scheduleID);
    if (!scheduled) return false;

    if (scheduled.status !== 'pending') {
      this.logger.warn('Cannot cancel non-pending scheduled message');
      return false;
    }

    scheduled.status = 'cancelled';
    this.scheduledMessages.delete(scheduleID);
    this.logger.success('Scheduled message cancelled');
    this.emit('scheduled_message_cancelled', scheduleID);
    return true;
  }

  getScheduledMessages(threadID?: string): ScheduledMessage[] {
    const messages = Array.from(this.scheduledMessages.values());
    if (threadID) {
      return messages.filter(m => m.threadID === threadID && m.status === 'pending');
    }
    return messages.filter(m => m.status === 'pending');
  }

  private startScheduleChecker(): void {
    this.scheduleTimer = setInterval(() => {
      const now = Date.now();
      
      for (const [scheduleID, scheduled] of this.scheduledMessages.entries()) {
        if (scheduled.status === 'pending' && scheduled.scheduledFor <= now) {
          this.emit('scheduled_message_due', scheduled);
          scheduled.status = 'sent';
        }
      }
    }, 10000);
  }

  handlePollEvent(event: any): void {
    const pollID = event.poll_id || event.pollId;
    if (!pollID) return;

    if (event.type === 'poll_vote') {
      const poll = this.activePolls.get(pollID);
      if (poll) {
        poll.totalVotes++;
        const option = poll.options.find(o => o.optionID === event.option_id);
        if (option) option.votes++;
      }
      this.emit('poll_vote_received', event);
    }
  }

  handleVanishModeEvent(event: any): void {
    const threadID = event.thread_id || event.threadId;
    if (!threadID) return;

    const state: VanishModeState = {
      threadID,
      isEnabled: event.is_enabled !== false,
      enabledBy: event.enabled_by,
      enabledAt: event.enabled_at ? event.enabled_at * 1000 : Date.now(),
      messageLifespan: event.message_lifespan || 0,
    };

    if (state.isEnabled) {
      this.vanishModeStates.set(threadID, state);
      this.emit('vanish_mode_enabled', state);
    } else {
      this.vanishModeStates.delete(threadID);
      this.emit('vanish_mode_disabled', threadID);
    }
  }

  handleCallEvent(event: any): void {
    const callID = event.call_id || event.callId;
    if (!callID) return;

    const call: Partial<CallInfo> = {
      callID,
      threadID: event.thread_id,
      type: event.call_type || 'audio',
      status: event.status,
    };

    this.emit('call_event', call);

    switch (event.status) {
      case 'ringing':
        this.emit('incoming_call', call);
        break;
      case 'active':
        this.emit('call_started', call);
        break;
      case 'ended':
        call.duration = event.duration;
        this.emit('call_ended', call);
        break;
      case 'missed':
        this.emit('call_missed', call);
        break;
      case 'declined':
        this.emit('call_declined', call);
        break;
    }
  }

  destroy(): void {
    if (this.scheduleTimer) {
      clearInterval(this.scheduleTimer);
    }
    this.vanishModeStates.clear();
    this.activePolls.clear();
    this.scheduledMessages.clear();
    this.removeAllListeners();
    this.logger.info('Edge features manager destroyed');
  }
}
