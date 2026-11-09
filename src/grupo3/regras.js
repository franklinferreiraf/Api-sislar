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
