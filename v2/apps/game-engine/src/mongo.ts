import { MongoClient, type Collection, type Db } from "mongodb";
import type { TimeControl } from "@chessguru/protocol";

const URI = process.env.MONGO_URI ?? "mongodb://127.0.0.1:27017/chessguru";

let client: MongoClient | null = null;
let dbP: Promise<Db> | null = null;

function getDb(): Promise<Db> {
  if (!dbP) {
    client = new MongoClient(URI);
    dbP = client.connect().then((c) => c.db()); // db name comes from the URI path
  }
  return dbP;
}

export async function collection(name: string): Promise<Collection> {
  return (await getDb()).collection(name);
}

export interface RatingChange {
  white: { before: number; after: number };
  black: { before: number; after: number };
}

export interface PersistedGame {
  variant: string;
  rated: boolean;
  speed: string;
  players: { white: string | null; black: string | null };
  initialFen: string;
  moves: string[];
  result: string | null;
  status: string;
  timeControl: TimeControl;
  rating?: RatingChange | null;
  startedAt: Date;
  finishedAt: Date;
}

/** Upsert a finished game into chessguru.live_games (idempotent on re-persist). */
export async function persistGame(gameId: string, g: PersistedGame): Promise<void> {
  const c = await collection("live_games");
  await c.updateOne({ _id: gameId as never }, { $set: { ...g } }, { upsert: true });
}
