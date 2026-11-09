// Dados de demonstração do Grupo 3 (agenda única, tipos de atendimento e equipe mínima).
import { gerarLembretes } from "../grupo3/lembretes.js";

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
  // [chave, nome, vínculo, usuário, cargo, setor, especialidade, registro, e-mail, telefone] — dados fictícios
  ["medico", "Dr. Paulo Ferraz Neto", "funcionario", "s05", "Médico geriatra", "Atendimento médico", "clinica_medica", "CRM-SP 000.789 (fictício)", "paulo.ferraz@lardoirmaovelho.example", "(11) 90000-0005"],
  ["fisio", "Renata Gouveia", "funcionario", "s06", "Fisioterapeuta", "Fisioterapia", "fisioterapia", "CREFITO-3 000.321 (fictício)", "renata.gouveia@lardoirmaovelho.example", "(11) 90000-0006"],
  ["dentista", "Dra. Luciana Prado", "voluntario", "s07", "Cirurgiã-dentista voluntária", "Odontologia", "odontologia", "CRO-SP 000.654 (fictício)", "luciana.prado@lardoirmaovelho.example", "(11) 90000-0007"],
  ["farmacia", "Tiago Menezes", "funcionario", "s08", "Farmacêutico", "Farmácia", "farmacia", "CRF-SP 000.987 (fictício)", null, "(11) 90000-0008"],
  ["enfermeira", "Carla Beatriz Nunes", "funcionario", "s03", "Enfermeira responsável técnica", "Enfermagem", "enfermagem", "COREN-SP 000.123 (fictício)", null, "(11) 90000-0003"],
  ["voluntaria", "Helena Duarte", "voluntario", "s11", "Voluntária de cuidados pessoais", "Voluntariado", null, null, null, "(11) 90000-0011"],
  ["cabeleireiro", "Jorge Matias (cabeleireiro)", "externo", null, "Cabeleireiro", "Cuidados pessoais", null, null, null, "(11) 90000-0099"],
  ["medico_voluntario", "Dra. Sônia Campos", "voluntario", null, "Médica clínica voluntária", "Atendimento médico", "clinica_medica", "CRM-SP 000.111 (fictício)", null, null],
];

function emDiaLocal(dias) {
  const date = new Date();
  date.setDate(date.getDate() + dias);
  const mes = String(date.getMonth() + 1).padStart(2, "0");
  const dia = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mes}-${dia}`;
}

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
  for (const [chave, nome, vinculo, usuario, cargo, setor, especialidade, registro, email, telefone] of COLABORADORES) {
    const ref = usuario ? await refDe(tx, "users", usuario) : null;
    const rows = await tx.$queryRaw`
      INSERT INTO grupo3.colaborador (nome, vinculo, usuario_ref, cargo, setor, especialidade, registro_profissional, email, telefone)
      VALUES (${nome}, ${vinculo}::grupo3.vinculo_colaborador, ${ref}::uuid, ${cargo}, ${setor}, ${especialidade},
              ${registro}, ${email}, ${telefone})
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
    if (!encerrado) await gerarLembretes(tx, rows[0].id);
  }

  // Disponibilidade declarada (dia ISO: 1 = segunda).
  const disponibilidades = [
    ["medico", 1, "08:00", "12:00"], ["medico", 3, "08:00", "12:00"], ["medico", 5, "08:00", "12:00"],
    ["medico_voluntario", 2, "08:00", "12:00"],
    ["dentista", 2, "13:00", "17:00"], ["dentista", 4, "13:00", "17:00"],
    ["voluntaria", 1, "14:00", "17:00"], ["voluntaria", 4, "14:00", "17:00"],
  ];
  for (const [chave, diaSemana, inicio, fim] of disponibilidades) {
    await tx.$executeRaw`
      INSERT INTO grupo3.disponibilidade_colaborador (colaborador_id, dia_semana, hora_inicio, hora_fim)
      VALUES (${colaboradores[chave]}::uuid, ${diaSemana}, ${inicio}::time, ${fim}::time)
    `;
  }

  // Necessidade mínima: clínico de segunda a sexta de manhã; odontologia terça e quinta à tarde.
  const coberturas = [
    ...[1, 2, 3, 4, 5].map((diaSemana) => ["clinica_medica", diaSemana, "08:00", "12:00", 1]),
    ["odontologia", 2, "13:00", "17:00", 1],
    ["odontologia", 4, "13:00", "17:00", 1],
  ];
  for (const [especialidade, diaSemana, inicio, fim, minimo] of coberturas) {
    await tx.$executeRaw`
      INSERT INTO grupo3.cobertura_necessaria (especialidade, dia_semana, hora_inicio, hora_fim, quantidade_minima)
      VALUES (${especialidade}, ${diaSemana}, ${inicio}::time, ${fim}::time, ${minimo})
    `;
  }

  // Escala dos próximos 14 dias conforme a disponibilidade (deixa lacunas onde não há ninguém).
  const escalaIds = {};
  for (let offset = 0; offset < 14; offset += 1) {
    const data = emDiaLocal(offset);
    const diaSemana = ((new Date(`${data}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
    for (const [chave, dia, inicio, fim] of disponibilidades) {
      if (dia !== diaSemana || !["medico", "medico_voluntario", "dentista"].includes(chave)) continue;
      const especialidade = chave === "dentista" ? "odontologia" : "clinica_medica";
      const rows = await tx.$queryRaw`
        INSERT INTO grupo3.escala (colaborador_id, especialidade, local, data, hora_inicio, hora_fim, situacao, criado_por_ref)
        VALUES (${colaboradores[chave]}::uuid, ${especialidade}, ${chave === "dentista" ? "Consultório odontológico" : "Consultório 1"},
                ${data}::date, ${inicio}::time, ${fim}::time, 'confirmada', ${autor}::uuid)
        RETURNING id
      `;
      escalaIds[`${chave}:${offset}`] = rows[0].id;
    }
  }

  // Presença de hoje: quem está trabalhando.
  const hoje = emDiaLocal(0);
  const presencas = [
    ["enfermeira", "presente", "07:00", null, "Plantão diurno", null],
    ["farmacia", "presente", "08:00", null, "Dispensação", null],
    ["voluntaria", "presente", "14:00", "16:30", "Cuidados pessoais", null],
    ["cabeleireiro", "ausente", null, null, null, "Remarcou para a próxima semana."],
  ];
  for (const [chave, situacao, entrada, saida, atividade, justificativa] of presencas) {
    await tx.$executeRaw`
      INSERT INTO grupo3.presenca (colaborador_id, data, situacao, hora_entrada, hora_saida, atividade, justificativa, registrado_por_ref)
      VALUES (${colaboradores[chave]}::uuid, ${hoje}::date, ${situacao}::grupo3.situacao_presenca, ${entrada}::time,
              ${saida}::time, ${atividade}, ${justificativa}, ${autor}::uuid)
    `;
  }
}
