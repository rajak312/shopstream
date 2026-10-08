import { randomUUID } from 'node:crypto';
import type { AuthUser, Logger, Role } from '@shopstream/platform';
import { Schema, type Connection, type Model } from 'mongoose';
import { hashPassword, verifyPassword } from './password';

export interface UserDoc {
  _id: string;
  email: string;
  name: string;
  passwordHash: string;
  role: Role;
  createdAt: Date;
}

const userSchema = new Schema<UserDoc>(
  {
    _id: String,
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    name: { type: String, required: true },
    passwordHash: { type: String, required: true },
    role: { type: String, required: true, default: 'CUSTOMER' },
    createdAt: { type: Date, required: true },
  },
  { collection: 'users', versionKey: false },
);

export class EmailTakenError extends Error {}

export function toAuthUser(u: UserDoc): AuthUser {
  return { id: u._id, email: u.email, name: u.name, role: u.role };
}

export class UsersRepository {
  readonly users: Model<UserDoc>;

  constructor(conn: Connection) {
    this.users = conn.model<UserDoc>('User', userSchema);
  }

  async init(): Promise<void> {
    await this.users.createCollection().catch(() => undefined);
    await this.users.syncIndexes();
  }

  findById(id: string) {
    return this.users.findById(id).lean();
  }

  async register(email: string, password: string, name: string, role: Role = 'CUSTOMER'): Promise<UserDoc> {
    const doc: UserDoc = {
      _id: randomUUID(),
      email: email.toLowerCase().trim(),
      name: name.trim(),
      passwordHash: await hashPassword(password),
      role,
      createdAt: new Date(),
    };
    try {
      await this.users.create(doc);
    } catch (err) {
      if ((err as { code?: number }).code === 11000) throw new EmailTakenError('Email already registered');
      throw err;
    }
    return doc;
  }

  async authenticate(email: string, password: string): Promise<UserDoc | null> {
    const user = await this.users.findOne({ email: email.toLowerCase().trim() }).lean();
    // Always run the KDF so response time does not reveal whether the email exists.
    const ok = await verifyPassword(
      password,
      user?.passwordHash ?? 'scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$AAAA',
    );
    return user && ok ? user : null;
  }

  /** Idempotently creates the demo account advertised on the login page. */
  async ensureDemoUser(email: string, password: string, name: string, logger: Logger): Promise<UserDoc> {
    const existing = await this.users.findOne({ email: email.toLowerCase() }).lean();
    if (existing) return existing;
    try {
      const user = await this.register(email, password, name, 'CUSTOMER');
      logger.info({ email }, 'demo user created');
      return user;
    } catch (err) {
      if (err instanceof EmailTakenError)
        return (await this.users.findOne({ email: email.toLowerCase() }).lean())!;
      throw err;
    }
  }
}
