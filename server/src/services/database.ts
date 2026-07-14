import { MongoClient, Db, Document } from "mongodb";

let clientPromise: Promise<MongoClient> | null = null;

export function isMongoConfigured() {
  return Boolean(process.env.MONGODB_URI);
}

export async function getDatabase(): Promise<Db | null> {
  const uri = process.env.MONGODB_URI;
  if (!uri) return null;

  if (!clientPromise) {
    clientPromise = new MongoClient(uri).connect();
  }

  const client = await clientPromise;
  return client.db(process.env.MONGODB_DB_NAME || "heault");
}

export async function getCollection<T extends Document = Document>(name: string) {
  const db = await getDatabase();
  return db ? db.collection<T>(name) : null;
}
