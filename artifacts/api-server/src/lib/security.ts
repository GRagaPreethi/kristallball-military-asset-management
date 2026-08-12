import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";

export type Role = "ADMIN" | "BASE_COMMANDER" | "LOGISTICS_OFFICER";

export type AuthUser = {
  id: number;
  username: string;
  role: Role;
  baseId: number | null;
  baseName: string | null;
  lastActiveAt: Date | null;
};

type TokenPayload = {
  userId: number;
  role: Role;
  baseId: number | null;
};

const secret = process.env.SESSION_SECRET;

if (!secret) {
  throw new Error("SESSION_SECRET must be set");
}

const signingSecret = secret;

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 10);
}

export async function comparePassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function createToken(user: AuthUser): string {
  const payload: TokenPayload = {
    userId: user.id,
    role: user.role,
    baseId: user.baseId,
  };
  return jwt.sign(payload, signingSecret, { expiresIn: "8h" });
}

export function readToken(token: string): TokenPayload {
  return jwt.verify(token, signingSecret) as unknown as TokenPayload;
}