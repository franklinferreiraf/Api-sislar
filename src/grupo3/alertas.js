// Jobs de alerta (T-008): tarefas atrasadas (US-096) e pendências odontológicas do ciclo (US-089).
// Sem notificação repetida: o que já foi avisado fica em grupo3.notificacao_controle (chave única).
import { prisma } from "../db/prisma.js";
import { permissionsFor } from "../lib/permissions.js";
import { enviarNotificacao } from "./portas/notificacoes.js";
import { chaveCicloOdonto, periodoDoCiclo, textoPendenciasOdonto } from "./regras.js";

async function configuracao(db, chave, padrao) {
  const rows = await db.$queryRaw`SELECT valor FROM grupo3.configuracao WHERE chave = ${chave}`;
  return rows[0]?.valor ?? padrao;
}

/**
 * Uma notificação por tarefa atrasada, para o usuário do responsável. Responsável sem usuário (ou com
 * usuário inativo) também é registrado, como "sem_destinatario", para não tentar a cada rodada.
 */
export async function processarTarefasAtrasadas({ agora = new Date(), limite = 100, enviar = enviarNotificacao } = {}) {
  const resumo = { processados: 0, notificadas: 0, semDestinatario: 0, falhas: 0 };
  await prisma.$transaction(async (tx) => {
    const fuso = await configuracao(tx, "fuso_horario", "America/Sao_Paulo");
    const tarefas = await tx.$queryRaw`
      SELECT t.id, t.titulo, t.prazo, u.id AS usuario_id, u.active AS usuario_ativo
      FROM grupo3.tarefa t
      JOIN grupo3.colaborador c ON c.id = t.responsavel_id
      LEFT JOIN public.users u ON u.ref = c.usuario_ref
      WHERE t.status IN ('pendente','em_andamento') AND t.prazo < ${agora}
        AND NOT EXISTS (SELECT 1 FROM grupo3.notificacao_controle n WHERE n.chave = 'tarefa_atrasada:' || t.id::text)
      ORDER BY t.prazo
      LIMIT ${limite}
      FOR UPDATE OF t SKIP LOCKED
    `;
    for (const tarefa of tarefas) {
      resumo.processados += 1;
      const temDestinatario = Boolean(tarefa.usuario_id && tarefa.usuario_ativo);
      await tx.$executeRawUnsafe("SAVEPOINT alerta_tarefa");
      try {
        const marcada = await tx.$queryRaw`
          INSERT INTO grupo3.notificacao_controle (chave, tipo, status, destinatarios)
          VALUES (${`tarefa_atrasada:${tarefa.id}`}, 'tarefa_atrasada', ${temDestinatario ? "enviada" : "sem_destinatario"}, ${temDestinatario ? 1 : 0})
          ON CONFLICT (chave) DO NOTHING
          RETURNING chave
        `;
        if (marcada.length && temDestinatario) {
          const prazo = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, dateStyle: "short", timeStyle: "short" }).format(tarefa.prazo);
          await enviar({
            usuarioId: tarefa.usuario_id, tipo: "tarefa", titulo: "Tarefa atrasada",
            corpo: `"${tarefa.titulo}" passou do prazo (${prazo}).`, link: `/tarefas/${tarefa.id}`,
          }, tx);
        }
        await tx.$executeRawUnsafe("RELEASE SAVEPOINT alerta_tarefa");
        if (marcada.length) resumo[temDestinatario ? "notificadas" : "semDestinatario"] += 1;
      } catch (error) {
        // Sem marcação: tenta de novo na próxima rodada.
        await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT alerta_tarefa");
        resumo.falhas += 1;
      }
    }
  }, { timeout: 60_000 });
  return resumo;
}

// Usuários ativos com a permissão (calculada pelos perfis, como na Fundação).
async function usuariosComPermissao(db, permissao) {
  const rows = await db.$queryRaw`
    SELECT u.id, array_agg(up.profile) AS perfis
    FROM public.users u JOIN public.user_profiles up ON up.user_id = u.id
    WHERE u.active
    GROUP BY u.id
  `;
  return rows.filter((row) => permissionsFor(row.perfis).has(permissao)).map((row) => row.id);
}

/**
 * Pendências odontológicas do ciclo vigente: um aviso por idoso por ciclo. Cada rodada que encontra idosos
 * ainda não avisados manda UM resumo (sem nomes) para cada usuário com atendimento-clinico.administrar.
 */
export async function processarPendenciasOdontologicas({ hoje = null, enviar = enviarNotificacao } = {}) {
  const resumo = { processados: 0, notificadas: 0, idososNovos: 0 };
  await prisma.$transaction(async (tx) => {
    // Uma rodada por vez entre instâncias.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('grupo3.alerta_odonto', 0))`;
    const dia = hoje ?? (await tx.$queryRaw`SELECT to_char((now() AT TIME ZONE grupo3.fuso_horario())::date, 'YYYY-MM-DD') AS d`)[0].d;
    const periodo = periodoDoCiclo(await configuracao(tx, "odontologia.ciclo", { modo: "semestre_civil", dias: 180 }), {}, dia);
    const ciclo = chaveCicloOdonto(periodo, dia);
    const pendentes = await tx.$queryRaw`
      WITH registros AS (
        SELECT idoso_ref, (realizado_em AT TIME ZONE grupo3.fuso_horario())::date AS data
        FROM grupo3.registro_clinico WHERE area = 'odontologica' AND status = 'finalizado'
        UNION ALL
        SELECT idoso_ref, data FROM grupo3.tratamento_externo WHERE area = 'odontologica'
      )
      SELECT p.ref::text AS ref
      FROM public.patients p
      WHERE NOT EXISTS (
        SELECT 1 FROM registros r WHERE r.idoso_ref = p.ref AND r.data BETWEEN ${periodo.inicio}::date AND ${periodo.fim}::date
      )
      AND NOT EXISTS (
        SELECT 1 FROM grupo3.notificacao_controle n WHERE n.chave = 'odonto_pendente:' || ${ciclo} || ':' || p.ref::text
      )
    `;
    resumo.processados = pendentes.length;
    if (!pendentes.length) return;
    const destinatarios = await usuariosComPermissao(tx, "atendimento-clinico.administrar");
    // Sem destinatário, não marca: o aviso sai quando houver alguém com a permissão.
    if (!destinatarios.length) return;
    for (const { ref } of pendentes) {
      await tx.$executeRaw`
        INSERT INTO grupo3.notificacao_controle (chave, tipo, status, destinatarios)
        VALUES (${`odonto_pendente:${ciclo}:${ref}`}, 'odonto_pendente', 'enviada', ${destinatarios.length})
        ON CONFLICT (chave) DO NOTHING
      `;
    }
    for (const usuarioId of destinatarios) {
      await enviar({
        usuarioId, tipo: "odontologia", titulo: "Pendências odontológicas",
        corpo: textoPendenciasOdonto(pendentes.length, periodo.rotulo),
        link: periodo.modo === "semestre_civil" ? `/odontologia/pendencias?ciclo=${periodo.rotulo}` : "/odontologia/pendencias",
      }, tx);
      resumo.notificadas += 1;
    }
    resumo.idososNovos = pendentes.length;
  }, { timeout: 60_000 });
  return resumo;
}
