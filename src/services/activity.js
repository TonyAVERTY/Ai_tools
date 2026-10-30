import { now } from '../db.js';
import { memberTeamIds } from '../teams.js';
import { roleTaskByJob } from './roles.js';

export async function activitySnapshot(db, userId) {
    const teamIds = await memberTeamIds(db, userId);
    const mine = teamIds.length ? `(j.user_id = ? OR p.team_id IN (${teamIds.map(() => '?').join(',')}))` : 'j.user_id = ?';
    const mineArgs = [userId, ...teamIds];
    const queue = (await db.prepare(`SELECT COUNT(*) n FROM jobs j LEFT JOIN projects p ON p.id = j.project_id WHERE ${mine} AND (j.status = 'running'
      OR (j.status = 'queued' AND (j.run_after IS NULL OR j.run_after <= ?)))`).get(...mineArgs, now())).n;
    const scheduled = (await db.prepare(`SELECT COUNT(*) n FROM jobs j LEFT JOIN projects p ON p.id = j.project_id WHERE ${mine} AND j.status = 'queued' AND j.run_after > ?`).get(...mineArgs, now())).n;
    const jobs = (await db.prepare(`SELECT j.id, j.user_id, j.type, j.status, j.error, j.tokens_in, j.tokens_out, j.progress_json, j.run_after, j.started_at, j.created_at, p.id pid, p.name project
      FROM jobs j LEFT JOIN projects p ON p.id = j.project_id
      WHERE ${mine} AND (j.status IN ('queued','running') OR (j.status = 'error' AND j.created_at > ${now() - 86400}
        AND NOT EXISTS (SELECT 1 FROM jobs newer WHERE newer.user_id = j.user_id AND newer.type = j.type AND newer.id > j.id AND (newer.project_id = j.project_id OR (newer.project_id IS NULL AND j.project_id IS NULL)))))
      ORDER BY j.status = 'running' DESC, j.status = 'error' ASC, COALESCE(j.run_after, 0), j.id LIMIT 20`).all(...mineArgs)).map((r) => ({
      id: r.id, type: r.type, label: roleTaskByJob(r.type)?.label, status: r.status, error: r.error, projectId: r.pid, project: r.project, canViewLogs: Number(r.user_id) === Number(userId),
      tokensUsed: Number(r.tokens_in || 0) + Number(r.tokens_out || 0),
      progress: r.progress_json ? JSON.parse(r.progress_json) : null,
      runAfter: r.run_after, startedAt: r.started_at, createdAt: r.created_at,
    }));
  return {queue,scheduled,jobs};
}
