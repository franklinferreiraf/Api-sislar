// Regras de negócio do Grupo 3 sem acesso a banco, para teste unitário.

export const STATUS_AGENDAMENTO = ["agendado", "realizado", "nao_realizado", "cancelado"];
export const STATUS_REALIZACAO = ["realizado", "nao_realizado"];

export const CATEGORIAS = [
  "consulta_medica",
  "consulta_odontologica",
  "fisioterapia",
  "cuidado_pessoal",
  "farmacia",
  "avaliacao",
  "outro",
];

// Categorias com dado de saúde (LGPD): o conteúdo livre só aparece para quem tem a permissão clínica.
const PERMISSAO_CLINICA = {
  consulta_medica: "atendimento-clinico.visualizar",
  consulta_odontologica: "atendimento-clinico.visualizar",
  avaliacao: "atendimento-clinico.visualizar",
  fisioterapia: "fisioterapia.visualizar",
};

const CAMPOS_SENSIVEIS = ["observacoes", "motivoStatus", "observacaoRealizacao"];

function ms(value) {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

export function calcularFim(inicio, duracaoMin) {
  return new Date(ms(inicio) + duracaoMin * 60_000);
}

// Intervalos semiabertos [inicio, fim): encostar no fim do outro não é sobreposição.
export function sobrepoe(a, b) {
  return ms(a.inicio) < ms(b.fim) && ms(b.inicio) < ms(a.fim);
}

/**
 * Há conflito quando o mesmo profissional tem outro agendamento "agendado" que se sobrepõe.
 * Exceção: os dois são do MESMO tipo e esse tipo permite sobreposição (ex.: atendimento em grupo).
 * `novo` e cada `existente` têm { id?, profissionalId, tipoId, permiteSobreposicao, inicio, fim, status? }.
 */
export function emConflito(novo, existente) {
  if (existente.id && novo.id && existente.id === novo.id) return false;
  if ((existente.status ?? "agendado") !== "agendado") return false;
  if (existente.profissionalId !== novo.profissionalId) return false;
  if (!sobrepoe(novo, existente)) return false;
  const mesmoTipoComExcecao = existente.tipoId === novo.tipoId && novo.permiteSobreposicao === true;
  return !mesmoTipoComExcecao;
}

export function filtrarConflitos(novo, existentes) {
  return existentes.filter((existente) => emConflito(novo, existente));
}

export function podeAlterar(status) {
  return status === "agendado";
}

export function podeTransitar(de, para) {
  return de === "agendado" && ["realizado", "nao_realizado", "cancelado"].includes(para);
}

// A realização pode ser registrada a partir de `toleranciaMin` minutos antes do início.
export function podeRegistrarRealizacao(inicio, toleranciaMin, agora = new Date()) {
  return ms(agora) >= ms(inicio) - toleranciaMin * 60_000;
}

export function exigeMotivo(tipo, acao) {
  if (acao === "cancelar") return tipo.exigeMotivoCancelamento === true;
  if (acao === "reagendar") return tipo.exigeMotivoReagendamento === true;
  return false;
}

export function motivoValido(motivo) {
  return typeof motivo === "string" && motivo.trim().length >= 3;
}

export function permissaoClinica(categoria) {
  return PERMISSAO_CLINICA[categoria] ?? null;
}

/**
 * Esconde texto livre de agendamentos clínicos para quem não tem a permissão clínica.
 * O profissional do próprio agendamento sempre vê o conteúdo.
 */
export function mascarar(agendamento, usuario, colaboradorId = null) {
  const exigida = permissaoClinica(agendamento.tipo?.categoria);
  if (!exigida) return agendamento;
  if (usuario.permissions.includes(exigida)) return agendamento;
  if (colaboradorId && agendamento.profissional?.id === colaboradorId) return agendamento;
  const copia = { ...agendamento, conteudoRestrito: true };
  for (const campo of CAMPOS_SENSIVEIS) {
    if (copia[campo] != null) copia[campo] = null;
  }
  return copia;
}

export function mascararHistorico(item, categoria, usuario, ehProfissional = false) {
  const exigida = permissaoClinica(categoria);
  if (!exigida || ehProfissional || usuario.permissions.includes(exigida)) return item;
  const limpar = (valor) => {
    if (!valor) return valor;
    const copia = { ...valor };
    for (const campo of CAMPOS_SENSIVEIS) delete copia[campo];
    return copia;
  };
  return { ...item, anterior: limpar(item.anterior), novo: limpar(item.novo), motivo: null, conteudoRestrito: true };
}

// ---------- Lembretes (US-074) ----------

export const STATUS_LEMBRETE = ["pendente", "enviado", "entregue", "falha", "sem_destinatario", "cancelado"];

/**
 * Horários de envio dos lembretes de um agendamento. Atendimento já iniciado não gera lembrete.
 * Antecedências que já passaram viram um único envio imediato (o de menor antecedência), para não
 * disparar vários avisos atrasados de uma vez.
 */
export function calcularEnvios(inicio, antecedencias, agora = new Date()) {
  const inicioMs = ms(inicio);
  const agoraMs = ms(agora);
  if (inicioMs <= agoraMs) return [];
  const unicas = [...new Set(antecedencias)].sort((a, b) => b - a);
  const futuros = [];
  let atrasada = null;
  for (const antecedenciaMin of unicas) {
    const enviarMs = inicioMs - antecedenciaMin * 60_000;
    if (enviarMs > agoraMs) futuros.push({ antecedenciaMin, enviarEm: new Date(enviarMs) });
    else if (atrasada === null || antecedenciaMin < atrasada) atrasada = antecedenciaMin;
  }
  if (atrasada !== null) futuros.push({ antecedenciaMin: atrasada, enviarEm: new Date(agoraMs) });
  return futuros;
}

export function statusInicialLembrete(usuarioRef) {
  return usuarioRef ? "pendente" : "sem_destinatario";
}

// Depois de uma falha: volta para a fila até esgotar as tentativas.
export function statusAposFalha(tentativas, maxTentativas) {
  return tentativas >= maxTentativas ? "falha" : "pendente";
}

// ---------- Janela de atendimento (US-070) ----------

export function minutosDoDia(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

export function janelaValida(inicio, fim) {
  if (!inicio || !fim) return true;
  return minutosDoDia(fim) > minutosDoDia(inicio);
}

// ---------- Escala e cobertura (US-083, US-084) ----------

export function minutosParaHorario(minutos) {
  const h = String(Math.floor(minutos / 60)).padStart(2, "0");
  const m = String(minutos % 60).padStart(2, "0");
  return `${h}:${m}`;
}

// Dia da semana ISO (1 = segunda ... 7 = domingo) de uma data AAAA-MM-DD.
export function diaSemanaIso(data) {
  const dia = new Date(`${data}T00:00:00Z`).getUTCDay();
  return dia === 0 ? 7 : dia;
}

export function horariosSobrepoem(a, b) {
  return minutosDoDia(a.inicio) < minutosDoDia(b.fim) && minutosDoDia(b.inicio) < minutosDoDia(a.fim);
}

/**
 * Trechos da faixa necessária com menos profissionais escalados que o mínimo.
 * `necessidade` = { inicio: "HH:MM", fim: "HH:MM", minimo }; `turnos` = [{ inicio, fim }] do mesmo dia e área.
 * Trechos vizinhos com a mesma contagem são unidos.
 */
export function calcularLacunas(necessidade, turnos) {
  const ini = minutosDoDia(necessidade.inicio);
  const fim = minutosDoDia(necessidade.fim);
  const faixas = turnos.map((t) => [minutosDoDia(t.inicio), minutosDoDia(t.fim)]);
  const marcos = new Set([ini, fim]);
  for (const [a, b] of faixas) {
    if (a > ini && a < fim) marcos.add(a);
    if (b > ini && b < fim) marcos.add(b);
  }
  const ordenados = [...marcos].sort((x, y) => x - y);
  const lacunas = [];
  for (let i = 0; i < ordenados.length - 1; i += 1) {
    const a = ordenados[i];
    const b = ordenados[i + 1];
    const escalados = faixas.filter(([t0, t1]) => t0 <= a && t1 >= b).length;
    if (escalados >= necessidade.minimo) continue;
    const ultima = lacunas[lacunas.length - 1];
    if (ultima && ultima.fimMin === a && ultima.escalados === escalados) {
      ultima.fimMin = b;
    } else {
      lacunas.push({ inicioMin: a, fimMin: b, escalados });
    }
  }
  return lacunas.map((l) => ({
    inicio: minutosParaHorario(l.inicioMin),
    fim: minutosParaHorario(l.fimMin),
    necessario: necessidade.minimo,
    escalados: l.escalados,
    faltam: necessidade.minimo - l.escalados,
  }));
}

/**
 * O turno cabe numa disponibilidade declarada? Sem disponibilidade cadastrada, devolve null (sem aviso).
 * `disponibilidades` = [{ diaSemana, inicio: "HH:MM", fim: "HH:MM" }].
 */
export function dentroDaDisponibilidade(disponibilidades, diaSemana, inicio, fim) {
  if (!disponibilidades.length) return null;
  return disponibilidades.some((d) => d.diaSemana === diaSemana
    && minutosDoDia(d.inicio) <= minutosDoDia(inicio) && minutosDoDia(d.fim) >= minutosDoDia(fim));
}

// ---------- Contatos da equipe ----------

const CAMPOS_CONTATO = ["email", "telefone"];

// Contatos e dados pessoais do colaborador só com equipe.visualizar.
export function mascararContatos(colaborador, usuario) {
  if (usuario.permissions.includes("equipe.visualizar")) return colaborador;
  const copia = { ...colaborador, contatosRestritos: true };
  for (const campo of CAMPOS_CONTATO) copia[campo] = null;
  return copia;
}
