import { RequestBuilder } from './RequestBuilder';
import { GraphQLRequest } from '../types';
import { Logger } from './Logger';

export class GraphQLClient {
  private req: RequestBuilder;
  private logger: Logger;

  constructor(req: RequestBuilder) {
    this.req = req;
    this.logger = new Logger('GRAPHQL');
  }

  async request(q: GraphQLRequest): Promise<any> {
    this.logger.debug(`Executing GraphQL request: ${q.docId || 'custom query'}`);
    
    const payload = q.query 
      ? { query: q.query, variables: JSON.stringify(q.variables || {}) }
      : { doc_id: q.docId, variables: JSON.stringify(q.variables || {}) };

    try {
      const res = await this.req.post('/api/graphql/', payload, { 
        'Content-Type': 'application/x-www-form-urlencoded'
      });
      
      this.logger.success('GraphQL request completed');
      return res.data;
    } catch (error: any) {
      this.logger.error('GraphQL request failed:', error.message);
      throw error;
    }
  }

  async getThreadMessages(threadID: string, limit: number = 20): Promise<any> {
    this.logger.info(`Fetching messages from thread ${threadID}`);
    
    return this.request({
      docId: '6376629829043296',
      variables: {
        thread_id: threadID,
        limit: limit
      }
    });
  }

  async getThreadInfo(threadID: string): Promise<any> {
    this.logger.info(`Fetching thread info: ${threadID}`);
    
    return this.request({
      docId: '7222848254431650',
      variables: {
        thread_id: threadID
      }
    });
  }
}
