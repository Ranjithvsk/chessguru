// GET /api/me/challenges — student's own past "find the good moves"
// challenge answers. Populated from the `classChallenges` collection
// which class-ws writes on each challenge_end.
//
// Session-based: no need for a userId param; we filter by req.session.userId.

import { Controller, Get, Query, Req, UnauthorizedException } from "@nestjs/common";
import { InjectConnection } from "@nestjs/mongoose";
import { Connection } from "mongoose";

interface StudentChallengeRow {
  classId: string;
  classTitle?: string;
  positionFen: string;
  startFen: string;
  prompt: string;
  startedAt: string;
  endedAt: string;
  myMovesSan: string[];
  myFinalFen?: string;
  myTimeMs?: number;
  totalAnswers: number;         // how many students answered — for context
}

@Controller("me")
export class MyChallengesController {
  constructor(@InjectConnection() private readonly conn: Connection) {}

  @Get("challenges")
  async myChallenges(@Req() req: any, @Query("limit") limitRaw?: string): Promise<{ challenges: StudentChallengeRow[] }> {
    const userId: string | undefined = req?.session?.userId;
    if (!userId) throw new UnauthorizedException();
    const limit = Math.min(200, Math.max(1, parseInt(limitRaw || "50", 10) || 50));

    const rows = await this.conn.db!
      .collection("classChallenges")
      .find({ "answers.userId": userId }, {
        projection: { classId: 1, positionFen: 1, startFen: 1, prompt: 1, startedAt: 1, endedAt: 1, answers: 1 },
      })
      .sort({ endedAt: -1 })
      .limit(limit)
      .toArray();

    if (rows.length === 0) return { challenges: [] };

    // Enrich each row with the class title (best-effort — missing classSchedules docs shouldn't break the page).
    const classIds = Array.from(new Set(rows.map((r: any) => String(r.classId))));
    const classDocs = classIds.length
      ? await this.conn.db!.collection("classSchedules").find({ _id: { $in: classIds as any } }, { projection: { title: 1 } }).toArray()
      : [];
    const titleById = new Map(classDocs.map((c: any) => [String(c._id), String(c.title || "")]));

    const out: StudentChallengeRow[] = rows.map((r: any) => {
      const answers: any[] = Array.isArray(r.answers) ? r.answers : [];
      const mine = answers.find((a) => a?.userId === userId) ?? null;
      const myTimeMs = mine && mine.firstMoveAt && mine.lastMoveAt
        ? new Date(mine.lastMoveAt).getTime() - new Date(mine.firstMoveAt).getTime()
        : undefined;
      return {
        classId: String(r.classId),
        classTitle: titleById.get(String(r.classId)) || undefined,
        positionFen: String(r.positionFen ?? ""),
        startFen: String(r.startFen ?? r.positionFen ?? ""),
        prompt: String(r.prompt ?? ""),
        startedAt: (r.startedAt instanceof Date ? r.startedAt : new Date(r.startedAt)).toISOString(),
        endedAt: (r.endedAt instanceof Date ? r.endedAt : new Date(r.endedAt)).toISOString(),
        myMovesSan: Array.isArray(mine?.movesSan) ? mine.movesSan.map(String) : [],
        myFinalFen: mine?.finalFen ? String(mine.finalFen) : undefined,
        myTimeMs,
        totalAnswers: answers.length,
      };
    });
    return { challenges: out };
  }
}
