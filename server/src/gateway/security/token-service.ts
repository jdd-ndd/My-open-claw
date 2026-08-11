/**
 * TokenService - JWT token issuance and verification.
 */

import { createHmac, randomBytes } from 'node:crypto';

export interface TokenPayload {
  sub: string;
  iat: number;
  exp: number;
  scope: string[];
  jti: string;
}

export interface TokenInfo {
  id: string;
  userId: string;
  scopes: string[];
  createdAt: number;
  expiresAt: number;
  prefix: string;
}

export interface TokenServiceConfig {
  secret: string;
  defaultExpiryDays: number;
}

export class TokenInvalidError extends Error {
  constructor(message = 'Invalid token') {
    super(message);
    this.name = 'TokenInvalidError';
  }
}

export class TokenExpiredError extends Error {
  constructor(expiredAt: number) {
    super(`Token expired at ${expiredAt}`);
    this.name = 'TokenExpiredError';
  }
}

export class TokenService {
  private readonly secret: Buffer;
  private readonly defaultExpirySeconds: number;
  private readonly issuedTokens = new Map<string, TokenInfo>();

  constructor(config?: Partial<TokenServiceConfig>) {
    this.secret = Buffer.from(config?.secret ?? 'myopenclaw-default-secret-change-me', 'utf-8');
    this.defaultExpirySeconds = (config?.defaultExpiryDays ?? 30) * 24 * 3600;
  }

  issue(userId: string, scopes: string[], expiryDays?: number): { token: string; info: TokenInfo } {
    const now = Math.floor(Date.now() / 1000);
    const exp = now + (expiryDays ?? Math.floor(this.defaultExpirySeconds / 86400)) * 86400;
    const jti = randomBytes(12).toString('hex');

    const payload: TokenPayload = {
      sub: userId,
      iat: now,
      exp,
      scope: scopes,
      jti,
    };

    const token = this.sign(payload);
    const prefix = `${token.slice(0, 20)}...`;

    const info: TokenInfo = {
      id: jti,
      userId,
      scopes,
      createdAt: now * 1000,
      expiresAt: exp * 1000,
      prefix,
    };

    this.issuedTokens.set(jti, info);
    return { token, info };
  }

  verify(token: string): TokenPayload {
    const payload = this.unsign(token);
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      throw new TokenExpiredError(payload.exp);
    }
    return payload;
  }

  revoke(tokenId: string): void {
    this.issuedTokens.delete(tokenId);
  }

  listTokens(userId?: string): TokenInfo[] {
    const all = Array.from(this.issuedTokens.values());
    return userId ? all.filter((token) => token.userId === userId) : all;
  }

  private sign(payload: TokenPayload): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerPart = toBase64Url(JSON.stringify(header));
    const payloadPart = toBase64Url(JSON.stringify(payload));
    const unsigned = `${headerPart}.${payloadPart}`;
    const signature = createHmac('sha256', this.secret).update(unsigned).digest('base64url');
    return `sk-myopenclaw-${unsigned}.${signature}`;
  }

  private unsign(token: string): TokenPayload {
    if (!token.startsWith('sk-myopenclaw-')) {
      throw new TokenInvalidError('Invalid token prefix');
    }

    const raw = token.slice('sk-myopenclaw-'.length);
    const parts = raw.split('.');
    if (parts.length !== 3) {
      throw new TokenInvalidError('Invalid token format');
    }

    const [headerPart, payloadPart, signature] = parts;
    const unsigned = `${headerPart}.${payloadPart}`;
    const expectedSignature = createHmac('sha256', this.secret).update(unsigned).digest('base64url');
    if (signature !== expectedSignature) {
      throw new TokenInvalidError('Invalid token signature');
    }

    try {
      const payloadJson = fromBase64Url(payloadPart);
      return JSON.parse(payloadJson) as TokenPayload;
    } catch {
      throw new TokenInvalidError('Invalid token payload');
    }
  }
}

function toBase64Url(input: string): string {
  return Buffer.from(input, 'utf-8').toString('base64url');
}

function fromBase64Url(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf-8');
}
