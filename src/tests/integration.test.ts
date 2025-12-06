import { RequestBuilder } from '../core/RequestBuilder';
import { RateLimiter } from '../core/RateLimiter';
import { CooldownManager } from '../core/CooldownManager';
import { MessageParser } from '../core/MessageParser';

describe('RequestBuilder', () => {
  let req: RequestBuilder;

  beforeEach(() => {
    req = new RequestBuilder();
  });

  test('should build form data correctly', () => {
    const data = req.buildFormData({ foo: 'bar', num: 123 });
    expect(data.get('foo')).toBe('bar');
    expect(data.get('num')).toBe('123');
  });

  test('should set cookies correctly', () => {
    req.setCookies({ session: 'abc123', user: 'test' });
    const cookies = req.getCookies();
    expect(cookies.session).toBe('abc123');
    expect(cookies.user).toBe('test');
  });
});

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(10, 1000);
  });

  test('should allow consumption within capacity', () => {
    expect(limiter.consume(5)).toBe(true);
    expect(limiter.getRemaining()).toBe(5);
  });

  test('should deny consumption over capacity', () => {
    limiter.consume(10);
    expect(limiter.consume(1)).toBe(false);
  });

  test('should reset tokens', () => {
    limiter.consume(10);
    limiter.reset();
    expect(limiter.getRemaining()).toBe(10);
  });
});

describe('CooldownManager', () => {
  let cooldown: CooldownManager;

  beforeEach(() => {
    cooldown = new CooldownManager(100);
  });

  test('should allow first action', () => {
    expect(cooldown.allowed('user1')).toBe(true);
  });

  test('should block during cooldown', () => {
    cooldown.allowed('user1');
    expect(cooldown.allowed('user1')).toBe(false);
  });

  test('should reset cooldown', () => {
    cooldown.allowed('user1');
    cooldown.reset('user1');
    expect(cooldown.allowed('user1')).toBe(true);
  });
});

describe('MessageParser', () => {
  let parser: MessageParser;

  beforeEach(() => {
    parser = new MessageParser();
  });

  test('should parse message correctly', () => {
    const raw = {
      thread_id: 'thread123',
      from: 'user456',
      mid: 'msg789',
      body: 'Hello world'
    };

    const message = parser.parse(raw);
    
    expect(message.threadID).toBe('thread123');
    expect(message.senderID).toBe('user456');
    expect(message.messageID).toBe('msg789');
    expect(message.body).toBe('Hello world');
  });

  test('should emit message event', (done) => {
    parser.on('message', (msg) => {
      expect(msg.body).toBe('Test message');
      done();
    });

    parser.parse({ body: 'Test message' });
  });
});
