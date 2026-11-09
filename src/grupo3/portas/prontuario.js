// Porta de integração com o prontuário (Grupo 1 — US-023, US-030, US-031).
// Ainda não existem a linha do tempo nem as regras de visibilidade do prontuário no repositório,
// por isso os dois contratos abaixo são stubs isolados.

/**
 * Regra de visibilidade do prontuário (US-031). O Grupo 3 já exige a permissão do módulo clínico;
 * esta porta acrescenta a restrição por idoso quando o Grupo 1 a definir.
 * TODO(integracao-G1): delegar para a regra de visibilidade do prontuário.
 */
export async function podeVerIdoso(_usuario, _idoso) {
  return true;
}

/**
 * Publica um registro de atendimento na linha do tempo do idoso (US-030 / US-086).
 * Contrato: { idosoRef, origem: "grupo3", tipo, referenciaId, ocorridoEm, profissional, resumo }.
 * Retorna o status da publicação para ser guardado e reenviado depois.
 * TODO(integracao-G1): chamar a linha do tempo do prontuário quando existir.
 */
export async function publicarNoProntuario(_registro) {
  return { status: "pendente_integracao" };
}
