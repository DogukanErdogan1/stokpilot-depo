import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { getRequestUser, hashAccountPassword, normalizeEmail, type AuthenticatedUser } from "./auth.js";
import { db } from "./db.js";
import { AppError } from "./errors.js";
import { pageRows } from "./listing-service.js";
import { createMemberSchema, idParamsSchema, parse, teamListQuerySchema, updateMemberSchema, type UserRole } from "./validation.js";

const memberColumns = "id, full_name AS fullName, email, role, is_active AS active, created_at AS createdAt";
type Member = { id: string; fullName: string; email: string; role: UserRole; active: number; createdAt: string };

function requireTeamManager(actor: AuthenticatedUser): void {
  const allowed = db.prepare(`SELECT 1 FROM users u JOIN workspaces w ON w.id = u.workspace_id
    WHERE u.id = ? AND u.workspace_id = ? AND u.role = 'admin' AND u.is_active = 1 AND w.is_demo = 0`)
    .get(actor.id, actor.workspaceId);
  if (!allowed) throw new AppError(403, "TEAM_FORBIDDEN", "Ekip ayarlarını yalnızca çalışma alanı yöneticileri kullanabilir.");
}

function getMember(workspaceId: string, id: string): Member {
  const member = db.prepare(`SELECT ${memberColumns} FROM users WHERE workspace_id = ? AND id = ?`)
    .get(workspaceId, id) as Member | undefined;
  if (!member) throw new AppError(404, "MEMBER_NOT_FOUND", "Ekip üyesi bulunamadı.");
  return member;
}

export async function registerTeamRoutes(app: FastifyInstance) {
  app.get("/api/team", async request => {
    const actor = getRequestUser(request);
    requireTeamManager(actor);
    const { page, pageSize } = parse(teamListQuerySchema, request.query);
    const result = pageRows({
      prefix: "", from: "users", where: "WHERE workspace_id = ?", order: "is_active DESC, full_name COLLATE NOCASE, id",
      values: [actor.workspaceId],
    }, memberColumns, page, pageSize);
    return { ...result, items: result.items.map(member => ({ ...member, active: Boolean(member.active) })) };
  });

  app.post("/api/team", async (request, reply) => {
    const actor = getRequestUser(request);
    requireTeamManager(actor);
    const input = parse(createMemberSchema, request.body);
    const email = normalizeEmail(input.email);
    const digest = await hashAccountPassword(input.password);
    const member = db.transaction(() => {
      requireTeamManager(actor);
      if (db.prepare("SELECT 1 FROM users WHERE email = ?").get(email)) {
        throw new AppError(409, "EMAIL_UNAVAILABLE", "Bu e-posta adresiyle yeni hesap açılamıyor.");
      }
      const id = randomUUID();
      db.prepare("INSERT INTO users (id, workspace_id, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?, ?)")
        .run(id, actor.workspaceId, input.fullName, email, digest, input.role);
      return getMember(actor.workspaceId, id);
    }).immediate();
    return reply.code(201).send({ ...member, active: Boolean(member.active) });
  });

  app.patch("/api/team/:id", async request => {
    const actor = getRequestUser(request);
    requireTeamManager(actor);
    const { id } = parse(idParamsSchema, request.params);
    const input = parse(updateMemberSchema, request.body);
    const member = db.transaction(() => {
      requireTeamManager(actor);
      if (id === actor.id) throw new AppError(409, "OWN_ACCOUNT", "Kendi rolünü veya erişimini bu ekrandan değiştiremezsin.");
      const existing = getMember(actor.workspaceId, id);
      const active = input.active ?? Boolean(existing.active);
      db.prepare("UPDATE users SET role = ?, is_active = ? WHERE workspace_id = ? AND id = ?")
        .run(input.role ?? existing.role, Number(active), actor.workspaceId, id);
      if (!active) db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id);
      return getMember(actor.workspaceId, id);
    }).immediate();
    return { ...member, active: Boolean(member.active) };
  });
}
