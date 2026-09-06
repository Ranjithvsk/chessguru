import type { Db } from "mongodb";

// Play.tsx renders the opponent as `opponent.replace(/^u:/, "")`, and real accounts are
// lowercase `_id`s like `ranjith_vsk` — so these have to look like that, not like handles.
const FIRST = [
  "arjun", "aditya", "rohan", "karthik", "vishal", "nikhil", "sandeep", "praveen",
  "harish", "manoj", "deepak", "suresh", "vinay", "ajay", "rahul", "gokul",
  "priya", "sneha", "divya", "anjali", "meera", "kavya", "lakshmi", "shruti",
  "nithya", "ramya", "swathi", "pooja", "revathi", "aishwarya",
];
const LAST = [
  "nair", "menon", "iyer", "pillai", "reddy", "rao", "sharma", "verma",
  "kumar", "shetty", "hegde", "bhat", "kulkarni", "desai", "patel", "joshi",
  "krishnan", "raman", "sundar", "prasad", "murthy", "gowda", "chandran", "varma",
];

/** Build a name pool that cannot collide with a real account. */
export async function buildNamePool(db: Db): Promise<string[]> {
  const all: string[] = [];
  for (const f of FIRST) for (const l of LAST) all.push(`${f}_${l}`);

  const taken = await db.collection("users").find({ _id: { $in: all as never[] } }, { projection: { _id: 1 } }).toArray();
  const takenIds = new Set(taken.map((d) => String(d._id)));
  const free = all.filter((n) => !takenIds.has(n));
  if (!free.length) throw new Error("no free bot names");
  return free;
}
