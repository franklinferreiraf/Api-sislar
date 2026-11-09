// Cadastro único da equipe — versão mínima da Fatia 1 (nome, vínculo, status, usuário).
// Cargo, setor, contatos, especialidade e disponibilidade entram na Fatia 3 (US-082, US-091, US-092).
import { Router } from "express";
import { z } from "zod";
import { audit, notFound } from "../../db/helpers.js";
import { prisma } from "../../db/prisma.js";
import { HttpError } from "../../lib/httpError.js";
import { pageMeta, pageSchema } from "../../lib/paging.js";
import { likeTerm } from "../../lib/schemas.js";
import { asyncHandler } from "../../middleware/async.js";
import { requirePerm } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { idParam, usuarioId } from "../../grupo3/validacao.js";

const router = Router();

const vinculo = z.enum(["funcionario", "voluntario", "externo"]);
const status = z.enum(["ativo", "inativo"]);

const corpo = z.object({
  nome: z.string().trim().min(3).max(160),
  vinculo,
  usuarioId: usuarioId.nullish(),
});

const selectSql = `
  SELECT c.id, c.nome, c.vinculo::text AS vinculo, c.status::text AS status, c.criado_em, c.atualizado_em,
         u.id AS usuario_id, u.name AS usuario_nome
  FROM grupo3.colaborador c
  LEFT JOIN public.users u ON u.ref = c.usuario_ref
`;

function paraColaborador(row) {
  return {
    id: row.id,
    nome: row.nome,
    vinculo: row.vinculo,
    status: row.status,
    usuario: row.usuario_id ? { id: row.usuario_id, nome: row.usuario_nome } : null,
    criadoEm: row.criado_em,
    atualizadoEm: row.atualizado_em,
  };
}

export async function buscarColaborador(id, db = prisma) {
  const rows = await db.$queryRawUnsafe(`${selectSql} WHERE c.id = $1::uuid`, id);
  return rows[0] ? paraColaborador(rows[0]) : null;
}

async function refDoUsuario(db, id, ignorarColaboradorId = null) {
  if (!id) return null;
  const users = await db.$queryRaw`SELECT ref, active FROM public.users WHERE id = ${id}`;
  if (!users[0]) throw new HttpError(422, "Dados inválidos", [{ path: "usuarioId", message: "Usuário não encontrado." }]);
  const vinculado = await db.$queryRaw`
    SELECT id FROM grupo3.colaborador
    WHERE usuario_ref = ${users[0].ref}::uuid AND (${ignorarColaboradorId}::uuid IS NULL OR id <> ${ignorarColaboradorId}::uuid)
  `;
  if (vinculado[0]) throw new HttpError(409, "Este usuário já está vinculado a outro colaborador.");
  return users[0].ref;
}

router.get(
  "/colaboradores",
  requirePerm("equipe.visualizar", "agenda.criar", "agenda.editar"),
  validate(pageSchema.extend({
    vinculo: vinculo.optional(),
    status: status.optional(),
    q: z.string().trim().min(1).max(80).optional(),
  }), "query"),
  asyncHandler(async (req, res) => {
    const { page, limit, vinculo: v, status: s, q } = req.query;
    const rows = await prisma.$queryRawUnsafe(
      `${selectSql.replace("SELECT", "SELECT count(*) OVER()::int AS total,")}
       WHERE ($1::text IS NULL OR c.vinculo::text = $1)
         AND ($2::text IS NULL OR c.status::text = $2)
         AND ($3::text IS NULL OR c.nome ILIKE $3)
       ORDER BY lower(c.nome) LIMIT $4 OFFSET $5`,
      v ?? null, s ?? null, q ? likeTerm(q) : null, limit, (page - 1) * limit,
    );
    res.json({ data: rows.map(paraColaborador), meta: pageMeta(page, limit, rows[0]?.total ?? 0) });
  }),
);

router.get(
  "/colaboradores/:id",
  requirePerm("equipe.visualizar", "agenda.criar", "agenda.editar"),
  validate(idParam, "params"),
  asyncHandler(async (req, res) => {
    const colaborador = await buscarColaborador(req.params.id);
    if (!colaborador) notFound("Colaborador não encontrado.");
    res.json(colaborador);
  }),
);

router.post(
  "/colaboradores",
  requirePerm("equipe.criar"),
  validate(corpo),
  asyncHandler(async (req, res) => {
    const colaborador = await prisma.$transaction(async (tx) => {
      const ref = await refDoUsuario(tx, req.body.usuarioId);
      const rows = await tx.$queryRaw`
        INSERT INTO grupo3.colaborador (nome, vinculo, usuario_ref)
        VALUES (${req.body.nome}, ${req.body.vinculo}::grupo3.vinculo_colaborador, ${ref}::uuid)
        RETURNING id
      `;
      await audit(tx, {
        userId: req.user.id, action: "colaborador.criar", entity: "grupo3.colaborador",
        entityId: rows[0].id, payload: { resultado: "sucesso", vinculo: req.body.vinculo, usuarioId: req.body.usuarioId ?? null },
      });
      return buscarColaborador(rows[0].id, tx);
    });
    res.status(201).json(colaborador);
  }),
);

router.put(
  "/colaboradores/:id",
  requirePerm("equipe.editar"),
  validate(idParam, "params"),
  validate(corpo),
  asyncHandler(async (req, res) => {
    const colaborador = await prisma.$transaction(async (tx) => {
      const atual = await buscarColaborador(req.params.id, tx);
      if (!atual) notFound("Colaborador não encontrado.");
      const ref = await refDoUsuario(tx, req.body.usuarioId, atual.id);
      await tx.$executeRaw`
        UPDATE grupo3.colaborador
        SET nome = ${req.body.nome}, vinculo = ${req.body.vinculo}::grupo3.vinculo_colaborador, usuario_ref = ${ref}::uuid
        WHERE id = ${atual.id}::uuid
      `;
      await audit(tx, {
        userId: req.user.id, action: "colaborador.editar", entity: "grupo3.colaborador", entityId: atual.id,
        payload: { resultado: "sucesso", anterior: { vinculo: atual.vinculo, usuarioId: atual.usuario?.id ?? null }, novo: { vinculo: req.body.vinculo, usuarioId: req.body.usuarioId ?? null } },
      });
      return buscarColaborador(atual.id, tx);
    });
    res.json(colaborador);
  }),
);

router.patch(
  "/colaboradores/:id/status",
  requirePerm("equipe.excluir"),
  validate(idParam, "params"),
  validate(z.object({ status })),
  asyncHandler(async (req, res) => {
    const colaborador = await prisma.$transaction(async (tx) => {
      const atual = await buscarColaborador(req.params.id, tx);
      if (!atual) notFound("Colaborador não encontrado.");
      await tx.$executeRaw`
        UPDATE grupo3.colaborador SET status = ${req.body.status}::grupo3.status_colaborador WHERE id = ${atual.id}::uuid
      `;
      await audit(tx, {
        userId: req.user.id, action: `colaborador.${req.body.status === "ativo" ? "ativar" : "inativar"}`,
        entity: "grupo3.colaborador", entityId: atual.id, payload: { resultado: "sucesso", anterior: atual.status },
      });
      return buscarColaborador(atual.id, tx);
    });
    res.json(colaborador);
  }),
);

export default router;
