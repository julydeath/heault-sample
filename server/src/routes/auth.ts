import { NextFunction, Request, Response, Router } from "express";
import crypto from "node:crypto";
import twilio from "twilio";
import { getCollection, isMongoConfigured } from "../services/database";

const router = Router();
const memoryOtps = new Map<string, { codeHash: string; expiresAt: number; attempts: number; mode: AuthMode }>();
const memoryUsers = new Map<string, Record<string, unknown>>();
let authIndexesPromise: Promise<void> | null = null;

type AuthMode = "signup" | "login";

type UserDoc = {
  phoneE164: string;
  name?: string;
  dob?: string;
  gender?: string;
  blood?: string;
  photo?: string;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
};

export type AuthenticatedUser = UserDoc & {
  _id?: unknown;
};

export type AuthenticatedRequest = Request & {
  auth?: {
    token: string;
    phoneE164: string;
    userId: string;
    user: AuthenticatedUser;
  };
};

function normalizeAuthMode(value: unknown): AuthMode {
  return value === "signup" || value === "create" || value === "register" ? "signup" : "login";
}

function cleanCountryCode(value = "+91") {
  const digits = String(value || "").replace(/\D/g, "");
  return `+${digits || "91"}`;
}

function normalizePhone(countryCode = "+91", phone = "") {
  const digits = String(phone || "").replace(/\D/g, "");
  const code = cleanCountryCode(countryCode);
  return `${code}${digits}`;
}

function hashOtp(phoneE164: string, code: string) {
  return crypto.createHash("sha256").update(`${phoneE164}:${code}:${process.env.OTP_HASH_SALT || "heault-dev"}`).digest("hex");
}

function otpBypassEnabled() {
  return process.env.OTP_BYPASS !== "0";
}

async function ensureAuthIndexes() {
  if (!authIndexesPromise) {
    authIndexesPromise = (async () => {
      const users = await getCollection<UserDoc>("users");
      const otps = await getCollection("otp_challenges");
      const sessions = await getCollection("sessions");
      await users?.createIndex({ phoneE164: 1 }, { unique: true }).catch(() => undefined);
      await users?.createIndex({ updatedAt: -1 }).catch(() => undefined);
      await otps?.createIndex({ phoneE164: 1, mode: 1 }).catch(() => undefined);
      await otps?.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => undefined);
      await sessions?.createIndex({ token: 1 }, { unique: true }).catch(() => undefined);
      await sessions?.createIndex({ phoneE164: 1 }).catch(() => undefined);
    })();
  }
  return authIndexesPromise;
}

async function findUserByPhone(phoneE164: string) {
  const users = await getCollection<UserDoc>("users");
  if (users) return users.findOne({ phoneE164 });
  return memoryUsers.get(phoneE164) || null;
}

function publicUser(user: AuthenticatedUser | null | undefined) {
  if (!user) return null;
  return {
    id: user._id ? String(user._id) : user.phoneE164,
    phoneE164: user.phoneE164,
    name: user.name || "",
    dob: user.dob || "",
    gender: user.gender || "",
    blood: user.blood || "",
    photo: user.photo || "",
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  };
}

async function createUser(phoneE164: string) {
  const now = new Date();
  const users = await getCollection<UserDoc>("users");
  if (users) {
    const existing = await users.findOne({ phoneE164 });
    if (existing) return existing;
    await users.insertOne({ phoneE164, createdAt: now, updatedAt: now, lastLoginAt: now });
    return users.findOne({ phoneE164 });
  }

  const user = { phoneE164, createdAt: now, updatedAt: now, lastLoginAt: now };
  memoryUsers.set(phoneE164, user);
  return user;
}

async function touchUserLogin(phoneE164: string) {
  const now = new Date();
  const users = await getCollection<UserDoc>("users");
  if (users) {
    await users.updateOne({ phoneE164 }, { $set: { updatedAt: now, lastLoginAt: now } });
    return users.findOne({ phoneE164 });
  }

  const existing = memoryUsers.get(phoneE164);
  if (!existing) return null;
  const user = { ...existing, updatedAt: now, lastLoginAt: now };
  memoryUsers.set(phoneE164, user);
  return user;
}

function bearerToken(req: Request) {
  const header = req.headers.authorization || "";
  const match = String(header).match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

export async function getAuthenticatedUser(req: Request) {
  await ensureAuthIndexes();
  const token = bearerToken(req);
  if (!token) return null;

  const sessions = await getCollection<{ token: string; phoneE164: string; createdAt: Date; lastSeenAt: Date }>("sessions");
  const users = await getCollection<UserDoc>("users");
  if (sessions && users) {
    const session = await sessions.findOne({ token });
    if (!session) return null;
    const user = await users.findOne({ phoneE164: session.phoneE164 });
    if (!user) return null;
    await sessions.updateOne({ token }, { $set: { lastSeenAt: new Date() } }).catch(() => undefined);
    return {
      token,
      phoneE164: session.phoneE164,
      userId: String(user._id),
      user: user as AuthenticatedUser,
    };
  }

  for (const [phoneE164, user] of memoryUsers.entries()) {
    if (token.endsWith(phoneE164.slice(-4))) {
      return { token, phoneE164, userId: phoneE164, user: user as AuthenticatedUser };
    }
  }
  return null;
}

export async function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    const auth = await getAuthenticatedUser(req);
    if (!auth) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    req.auth = auth;
    next();
  } catch {
    res.status(401).json({ error: "Authentication required." });
  }
}

async function saveBypassOtp(phoneE164: string, code: string, mode: AuthMode) {
  const record = {
    phoneE164,
    mode,
    codeHash: hashOtp(phoneE164, code),
    expiresAt: new Date(Date.now() + 10 * 60 * 1000),
    attempts: 0,
    createdAt: new Date(),
  };
  const otps = await getCollection("otp_challenges");
  if (otps) {
    await otps.updateOne({ phoneE164, mode }, { $set: record }, { upsert: true });
    return;
  }
  memoryOtps.set(`${mode}:${phoneE164}`, { codeHash: record.codeHash, expiresAt: record.expiresAt.getTime(), attempts: 0, mode });
}

async function verifyBypassOtp(phoneE164: string, code: string, mode: AuthMode) {
  const expectedHash = hashOtp(phoneE164, code);
  const otps = await getCollection<{ phoneE164: string; mode?: AuthMode; codeHash: string; expiresAt: Date; attempts: number }>("otp_challenges");
  if (otps) {
    const record = await otps.findOne({ phoneE164, mode });
    if (!record || record.expiresAt.getTime() < Date.now()) return false;
    await otps.updateOne({ phoneE164, mode }, { $inc: { attempts: 1 } });
    return record.attempts < 5 && record.codeHash === expectedHash;
  }

  const record = memoryOtps.get(`${mode}:${phoneE164}`);
  if (!record || record.expiresAt < Date.now()) return false;
  record.attempts += 1;
  return record.attempts <= 5 && record.codeHash === expectedHash;
}

function twilioVerifyClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const serviceSid = process.env.TWILIO_VERIFY_SERVICE_SID;
  if (!accountSid || !authToken || !serviceSid) {
    throw new Error("Twilio Verify is not configured. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_VERIFY_SERVICE_SID or use OTP_BYPASS=1.");
  }
  return { client: twilio(accountSid, authToken), serviceSid };
}

router.post("/auth/start", async (req, res) => {
  const { countryCode = "+91", phone = "", mode: rawMode } = req.body || {};
  const mode = normalizeAuthMode(rawMode);
  const phoneE164 = normalizePhone(countryCode, phone);

  if (phoneE164.length < 8) {
    res.status(400).json({ error: "A valid phone number with country code is required." });
    return;
  }

  try {
    await ensureAuthIndexes();
    const existingUser = await findUserByPhone(phoneE164);
    if (mode === "signup" && existingUser) {
      res.status(409).json({ error: "An account already exists for this mobile number. Please login instead.", accountExists: true, mode });
      return;
    }
    if (mode === "login" && !existingUser) {
      res.status(404).json({ error: "No account found for this mobile number. Please create an account first.", accountExists: false, mode });
      return;
    }

    if (otpBypassEnabled()) {
      await saveBypassOtp(phoneE164, "1234", mode);
      res.json({ status: "otp_sent", phoneE164, bypass: true, mode, accountExists: Boolean(existingUser), database: isMongoConfigured() ? "mongodb" : "memory" });
      return;
    }

    const { client, serviceSid } = twilioVerifyClient();
    await client.verify.v2.services(serviceSid).verifications.create({ to: phoneE164, channel: "sms" });
    res.json({ status: "otp_sent", phoneE164, bypass: false, mode, accountExists: Boolean(existingUser), database: isMongoConfigured() ? "mongodb" : "memory" });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not start OTP verification." });
  }
});

router.post("/auth/verify", async (req, res) => {
  const { countryCode = "+91", phone = "", phoneE164: suppliedPhone, code = "", mode: rawMode } = req.body || {};
  const mode = normalizeAuthMode(rawMode);
  const phoneE164 = suppliedPhone || normalizePhone(countryCode, phone);
  const cleanCode = String(code || "").replace(/\D/g, "");

  if (!phoneE164 || cleanCode.length < 4) {
    res.status(400).json({ error: "Phone number and OTP code are required." });
    return;
  }

  try {
    await ensureAuthIndexes();
    let verified = false;
    if (otpBypassEnabled()) {
      verified = await verifyBypassOtp(phoneE164, cleanCode, mode);
    } else {
      const { client, serviceSid } = twilioVerifyClient();
      const result = await client.verify.v2.services(serviceSid).verificationChecks.create({ to: phoneE164, code: cleanCode });
      verified = result.status === "approved";
    }

    if (!verified) {
      res.status(401).json({ error: "Invalid or expired OTP." });
      return;
    }

    const existingUser = await findUserByPhone(phoneE164);
    if (mode === "login" && !existingUser) {
      res.status(404).json({ error: "No account found for this mobile number. Please create an account first.", accountExists: false, mode });
      return;
    }
    if (mode === "signup" && existingUser) {
      res.status(409).json({ error: "An account already exists for this mobile number. Please login instead.", accountExists: true, mode });
      return;
    }

    const user = mode === "signup"
      ? await createUser(phoneE164)
      : await touchUserLogin(phoneE164);
    const token = crypto.randomBytes(32).toString("hex");
    const sessions = await getCollection("sessions");
    if (sessions) {
      await sessions.insertOne({ token, phoneE164, createdAt: new Date(), lastSeenAt: new Date() });
    }
    res.json({ status: "verified", token, user: publicUser(user as AuthenticatedUser), mode });
  } catch (error) {
    res.status(500).json({ error: error instanceof Error ? error.message : "Could not verify OTP." });
  }
});

router.get("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  res.json({ user: publicUser(req.auth?.user) });
});

router.patch("/me", requireAuth, async (req: AuthenticatedRequest, res) => {
  const allowed = ["name", "dob", "gender", "blood", "photo"] as const;
  const patch: Record<string, string> = {};
  for (const key of allowed) {
    if (typeof req.body?.[key] === "string") {
      patch[key] = req.body[key].trim().slice(0, key === "photo" ? 600 : 120);
    }
  }

  const users = await getCollection<UserDoc>("users");
  const now = new Date();
  if (users && req.auth?.phoneE164) {
    await users.updateOne({ phoneE164: req.auth.phoneE164 }, { $set: { ...patch, updatedAt: now } });
    const user = await users.findOne({ phoneE164: req.auth.phoneE164 });
    res.json({ user: publicUser(user as AuthenticatedUser) });
    return;
  }

  const existing = req.auth?.phoneE164 ? memoryUsers.get(req.auth.phoneE164) : null;
  const user = { ...existing, ...patch, updatedAt: now };
  if (req.auth?.phoneE164) memoryUsers.set(req.auth.phoneE164, user);
  res.json({ user: publicUser(user as AuthenticatedUser) });
});

router.post("/auth/logout", requireAuth, async (req: AuthenticatedRequest, res) => {
  const sessions = await getCollection("sessions");
  if (sessions && req.auth?.token) {
    await sessions.deleteOne({ token: req.auth.token });
  }
  res.json({ status: "logged_out" });
});

export default router;
