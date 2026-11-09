// Dados de demonstração do Grupo 3 (agenda única, tipos de atendimento e equipe mínima).

const TIPOS = [
  // [nome, categoria, duração, exige motivo cancelar, exige motivo reagendar, permite sobreposição]
  ["Consulta médica", "consulta_medica", 30, true, true, false],
  ["Consulta odontológica", "consulta_odontologica", 40, true, true, false],
  ["Sessão de fisioterapia", "fisioterapia", 40, true, false, false],
  ["Fisioterapia em grupo", "fisioterapia", 60, true, false, true],
  ["Corte de cabelo", "cuidado_pessoal", 30, false, false, false],
  ["Barba", "cuidado_pessoal", 20, false, false, false],
  ["Unhas", "cuidado_pessoal", 30, false, false, false],
  ["Atendimento da farmácia", "farmacia", 15, true, false, false],
  ["Avaliação multiprofissional", "avaliacao", 60, true, true, false],
];

const COLABORADORES = [
  // [chave, nome, vínculo, usuário]
  ["medico", "Dr. Paulo Ferraz Neto", "funcionario", "s05"],
  ["fisio", "Renata Gouveia", "funcionario", "s06"],
  ["dentista", "Dra. Luciana Prado", "voluntario", "s07"],
  ["farmacia", "Tiago Menezes", "funcionario", "s08"],
  ["enfermeira", "Carla Beatriz Nunes", "funcionario", "s03"],
  ["voluntaria", "Helena Duarte", "voluntario", "s11"],
  ["cabeleireiro", "Jorge Matias (cabeleireiro)", "externo", null],
];

function emDias(dias, horas, minutos = 0) {
  const date = new Date();
  date.setDate(date.getDate() + dias);
  date.setHours(horas, minutos, 0, 0);
  return date;
}

async function refDe(tx, tabela, id) {
  const rows = tabela === "users"
    ? await tx.$queryRaw`SELECT ref FROM public.users WHERE id = ${id}`
    : await tx.$queryRaw`SELECT ref FROM public.patients WHERE id = ${id}`;
  if (!rows[0]) throw new Error(`Sem UUID de ${tabela} ${id}.`);
  return rows[0].ref;
}

export async function seedGrupo3(tx) {
  const tipos = {};
  for (const [nome, categoria, duracao, motivoCancelar, motivoReagendar, sobreposicao] of TIPOS) {
    const rows = await tx.$queryRaw`
      INSERT INTO grupo3.tipo_atendimento (
        nome, categoria, duracao_padrao_min, exige_motivo_cancelamento, exige_motivo_reagendamento, permite_sobreposicao
      ) VALUES (${nome}, ${categoria}::grupo3.categoria_atendimento, ${duracao}, ${motivoCancelar}, ${motivoReagendar}, ${sobreposicao})
      RETURNING id
    `;
    tipos[nome] = { id: rows[0].id, duracao };
  }

  const colaboradores = {};
  for (const [chave, nome, vinculo, usuario] of COLABORADORES) {
    const ref = usuario ? await refDe(tx, "users", usuario) : null;
    const rows = await tx.$queryRaw`
      INSERT INTO grupo3.colaborador (nome, vinculo, usuario_ref)
      VALUES (${nome}, ${vinculo}::grupo3.vinculo_colaborador, ${ref}::uuid)
      RETURNING id
    `;
    colaboradores[chave] = rows[0].id;
  }

  const autor = await refDe(tx, "users", "s01");
  const agendamentos = [
    // [idoso, tipo, colaborador, quando, status, observações]
    ["p02", "Sessão de fisioterapia", "fisio", emDias(-2, 15), "realizado", "Treino de marcha com andador."],
    ["p02", "Sessão de fisioterapia", "fisio", emDias(1, 15), "agendado", "Treino de marcha com andador."],
    ["p05", "Fisioterapia em grupo", "fisio", emDias(1, 9), "agendado", null],
    ["p07", "Fisioterapia em grupo", "fisio", emDias(1, 9), "agendado", null],
    ["p01", "Consulta médica", "medico", emDias(2, 10), "agendado", "Revisão de pressão arterial."],
    ["p03", "Consulta odontológica", "dentista", emDias(3, 14), "agendado", "Avaliação de prótese."],
    ["p04", "Corte de cabelo", "cabeleireiro", emDias(1, 10), "agendado", null],
    ["p06", "Unhas", "voluntaria", emDias(1, 14), "agendado", null],
    ["p08", "Atendimento da farmácia", "farmacia", emDias(0, 16), "agendado", null],
  ];
  for (const [idoso, tipo, colaborador, inicio, status, observacoes] of agendamentos) {
    const idosoRef = await refDe(tx, "patients", idoso);
    const encerrado = status !== "agendado";
    const rows = await tx.$queryRaw`
      INSERT INTO grupo3.agendamento (
        idoso_ref, tipo_id, profissional_id, inicio, duracao_min, observacoes, status,
        responsavel_realizacao_id, concluido_em, registrado_por_ref, criado_por_ref
      ) VALUES (
        ${idosoRef}::uuid, ${tipos[tipo].id}::uuid, ${colaboradores[colaborador]}::uuid, ${inicio}, ${tipos[tipo].duracao},
        ${observacoes}, ${status}::grupo3.status_agendamento,
        ${encerrado ? colaboradores[colaborador] : null}::uuid, ${encerrado ? inicio : null},
        ${encerrado ? autor : null}::uuid, ${autor}::uuid
      ) RETURNING id
    `;
    await tx.$executeRaw`
      INSERT INTO grupo3.historico_agendamento (agendamento_id, acao, novo, autor_ref)
      VALUES (${rows[0].id}::uuid, 'criado', ${JSON.stringify({ status: "agendado" })}::jsonb, ${autor}::uuid)
    `;
  }
}
