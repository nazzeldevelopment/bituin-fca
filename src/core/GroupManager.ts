import { EventEmitter } from 'eventemitter3';
import { GraphQLClient } from './GraphQLClient';
import { RequestBuilder } from './RequestBuilder';
import { Logger } from './Logger';
import { FULL_DOC_IDS } from './DocIDRepository';

export interface AdminRoleOptions {
  threadID: string;
  userID: string;
  isAdmin: boolean;
}

export interface ThreadImageOptions {
  threadID: string;
  imageUrl?: string;
  imagePath?: string;
}

export interface ApprovalModeOptions {
  threadID: string;
  enabled: boolean;
}

export interface JoinRequest {
  userID: string;
  userName: string;
  profileUrl: string;
  requestedAt: number;
  threadID: string;
}

export interface GroupMember {
  userID: string;
  name: string;
  isAdmin: boolean;
  nickname?: string;
  joinedAt?: number;
}

export class GroupManager extends EventEmitter {
  private gql: GraphQLClient;
  private req: RequestBuilder;
  private logger: Logger;
  private pendingRequests: Map<string, JoinRequest[]> = new Map();

  constructor(gql: GraphQLClient, req: RequestBuilder) {
    super();
    this.gql = gql;
    this.req = req;
    this.logger = new Logger('GROUP-MGR');
  }

  async setAdminRole(options: AdminRoleOptions): Promise<boolean> {
    const { threadID, userID, isAdmin } = options;
    this.logger.info(`${isAdmin ? 'Adding' : 'Removing'} admin role for ${userID}`);

    try {
      const docId = isAdmin 
        ? FULL_DOC_IDS.PARTICIPANTS.SET_ADMIN.id 
        : FULL_DOC_IDS.PARTICIPANTS.REMOVE_ADMIN.id;

      const response = await this.gql.request({
        docId,
        variables: {
          thread_id: threadID,
          participant_id: userID,
          is_admin: isAdmin
        }
      }, false);

      if (response.errors) {
        throw new Error(response.errors[0]?.message || 'Failed to update admin role');
      }

      this.logger.success(`Admin role ${isAdmin ? 'added' : 'removed'} for ${userID}`);
      this.emit('admin_role_changed', { threadID, userID, isAdmin });

      return true;
    } catch (error: any) {
      this.logger.error('Failed to update admin role:', error.message);
      return false;
    }
  }

  async addAdmin(threadID: string, userID: string): Promise<boolean> {
    return this.setAdminRole({ threadID, userID, isAdmin: true });
  }

  async removeAdmin(threadID: string, userID: string): Promise<boolean> {
    return this.setAdminRole({ threadID, userID, isAdmin: false });
  }

  async setThreadImage(options: ThreadImageOptions): Promise<boolean> {
    const { threadID, imageUrl, imagePath } = options;
    this.logger.info(`Setting thread image for ${threadID}`);

    try {
      let imageData: string | undefined;

      if (imagePath) {
        const fs = await import('fs');
        if (fs.existsSync(imagePath)) {
          const buffer = fs.readFileSync(imagePath);
          imageData = buffer.toString('base64');
        }
      }

      const response = await this.gql.request({
        docId: FULL_DOC_IDS.THREADS.SET_THREAD_IMAGE.id,
        variables: {
          thread_id: threadID,
          image_url: imageUrl,
          image_data: imageData
        }
      }, false);

      if (response.errors) {
        throw new Error(response.errors[0]?.message || 'Failed to set thread image');
      }

      this.logger.success('Thread image updated');
      this.emit('thread_image_changed', { threadID });

      return true;
    } catch (error: any) {
      this.logger.error('Failed to set thread image:', error.message);
      return false;
    }
  }

  async removeThreadImage(threadID: string): Promise<boolean> {
    this.logger.info(`Removing thread image for ${threadID}`);

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.THREADS.SET_THREAD_IMAGE.id,
        variables: {
          thread_id: threadID,
          remove_image: true
        }
      }, false);

      if (response.errors) {
        throw new Error(response.errors[0]?.message || 'Failed to remove thread image');
      }

      this.logger.success('Thread image removed');
      return true;
    } catch (error: any) {
      this.logger.error('Failed to remove thread image:', error.message);
      return false;
    }
  }

  async setApprovalMode(options: ApprovalModeOptions): Promise<boolean> {
    const { threadID, enabled } = options;
    this.logger.info(`${enabled ? 'Enabling' : 'Disabling'} approval mode for ${threadID}`);

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.THREADS.SET_APPROVAL_MODE.id,
        variables: {
          thread_id: threadID,
          approval_mode: enabled ? 1 : 0
        }
      }, false);

      if (response.errors) {
        throw new Error(response.errors[0]?.message || 'Failed to set approval mode');
      }

      this.logger.success(`Approval mode ${enabled ? 'enabled' : 'disabled'}`);
      this.emit('approval_mode_changed', { threadID, enabled });

      return true;
    } catch (error: any) {
      this.logger.error('Failed to set approval mode:', error.message);
      return false;
    }
  }

  async getPendingRequests(threadID: string): Promise<JoinRequest[]> {
    this.logger.info(`Fetching pending join requests for ${threadID}`);

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.THREADS.PENDING_REQUESTS.id,
        variables: {
          thread_id: threadID
        }
      });

      const nodes = response.data?.thread?.pending_participants?.nodes || [];
      
      const requests: JoinRequest[] = nodes.map((node: any) => ({
        userID: node.id || node.participant_id,
        userName: node.name || '',
        profileUrl: node.profile_url || node.url || '',
        requestedAt: parseInt(node.requested_at || node.timestamp) || Date.now(),
        threadID
      }));

      this.pendingRequests.set(threadID, requests);
      this.logger.success(`Found ${requests.length} pending requests`);

      return requests;
    } catch (error: any) {
      this.logger.error('Failed to fetch pending requests:', error.message);
      return [];
    }
  }

  async approveJoinRequest(threadID: string, userID: string): Promise<boolean> {
    this.logger.info(`Approving join request from ${userID}`);

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.THREADS.APPROVE_REQUEST.id,
        variables: {
          thread_id: threadID,
          participant_id: userID
        }
      }, false);

      if (response.errors) {
        throw new Error(response.errors[0]?.message || 'Failed to approve request');
      }

      const requests = this.pendingRequests.get(threadID) || [];
      this.pendingRequests.set(threadID, requests.filter(r => r.userID !== userID));

      this.logger.success('Join request approved');
      this.emit('request_approved', { threadID, userID });

      return true;
    } catch (error: any) {
      this.logger.error('Failed to approve request:', error.message);
      return false;
    }
  }

  async denyJoinRequest(threadID: string, userID: string): Promise<boolean> {
    this.logger.info(`Denying join request from ${userID}`);

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.THREADS.DENY_REQUEST.id,
        variables: {
          thread_id: threadID,
          participant_id: userID
        }
      }, false);

      if (response.errors) {
        throw new Error(response.errors[0]?.message || 'Failed to deny request');
      }

      const requests = this.pendingRequests.get(threadID) || [];
      this.pendingRequests.set(threadID, requests.filter(r => r.userID !== userID));

      this.logger.success('Join request denied');
      this.emit('request_denied', { threadID, userID });

      return true;
    } catch (error: any) {
      this.logger.error('Failed to deny request:', error.message);
      return false;
    }
  }

  async approveAllRequests(threadID: string): Promise<number> {
    const requests = await this.getPendingRequests(threadID);
    let approved = 0;

    for (const request of requests) {
      const success = await this.approveJoinRequest(threadID, request.userID);
      if (success) approved++;
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    this.logger.info(`Approved ${approved}/${requests.length} requests`);
    return approved;
  }

  async denyAllRequests(threadID: string): Promise<number> {
    const requests = await this.getPendingRequests(threadID);
    let denied = 0;

    for (const request of requests) {
      const success = await this.denyJoinRequest(threadID, request.userID);
      if (success) denied++;
      
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    this.logger.info(`Denied ${denied}/${requests.length} requests`);
    return denied;
  }

  async getGroupMembers(threadID: string): Promise<GroupMember[]> {
    this.logger.info(`Fetching members for ${threadID}`);

    try {
      const response = await this.gql.request({
        docId: FULL_DOC_IDS.THREADS.THREAD_PARTICIPANTS.id,
        variables: {
          thread_id: threadID
        }
      });

      const thread = response.data?.thread;
      const participants = thread?.all_participants?.nodes || [];
      const adminIDs = new Set(thread?.admin_ids || []);
      const nicknames = thread?.customization_info?.participant_customizations || [];
      
      const nicknameMap: Record<string, string> = {};
      for (const c of nicknames) {
        if (c.nickname) {
          nicknameMap[c.participant_id] = c.nickname;
        }
      }

      const members: GroupMember[] = participants.map((p: any) => ({
        userID: p.id,
        name: p.name || '',
        isAdmin: adminIDs.has(p.id),
        nickname: nicknameMap[p.id],
        joinedAt: parseInt(p.joined_at) || undefined
      }));

      this.logger.success(`Found ${members.length} members`);
      return members;
    } catch (error: any) {
      this.logger.error('Failed to fetch members:', error.message);
      return [];
    }
  }

  async getAdmins(threadID: string): Promise<GroupMember[]> {
    const members = await this.getGroupMembers(threadID);
    return members.filter(m => m.isAdmin);
  }

  getCachedPendingRequests(threadID: string): JoinRequest[] {
    return this.pendingRequests.get(threadID) || [];
  }

  clearCache(): void {
    this.pendingRequests.clear();
    this.logger.debug('Group manager cache cleared');
  }
}
