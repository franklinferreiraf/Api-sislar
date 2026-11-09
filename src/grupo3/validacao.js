import { z } from "zod";
import { HttpError } from "../lib/httpError.js";
import { CATEGORIAS, STATUS_AGENDAMENTO } from "./regras.js";

export const uuid = z.string().uuid("Identificador inválido.");
export const idosoId = z.string().regex(/^[A-Za-z0-9_-]+$/, "Identificador de idoso inválido.");
export const usuarioId = z.string().regex(/^[A-Za-z0-9_-]+$/, "Identificador de usuário inválido.");
export const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a data no formato AAAA-MM-DD.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Data inválida.");

// ISO 8601 com fuso explícito (Z ou ±hh:mm), gravado em UTC.
export const dataHora = z.string()
  .datetime({ offset: true, message: "Use data e hora ISO 8601 com fuso (ex.: 2026-11-10T14:00:00-03:00)." })
  .transform((value) => new Date(value));

export const categoria = z.enum(CATEGORIAS);
export const statusAgendamento = z.enum(STATUS_AGENDAMENTO);
export const duracaoMin = z.number().int().min(5, "Duração mínima de 5 minutos.").max(720, "Duração máxima de 12 horas.");
export const texto = (max) => z.string().trim().min(1).max(max);
export const motivo = z.string().trim().min(3, "Informe o motivo com ao menos 3 caracteres.").max(1000);

export const idParam = z.object({ id: uuid });

export function temPermissao(usuario, ...codigos) {
  return codigos.some((codigo) => usuario.permissions.includes(codigo));
}

export function exigirPermissao(usuario, ...codigos) {
  if (!temPermissao(usuario, ...codigos)) {
    throw new HttpError(403, "Você não tem autorização para esta ação.");
  }
}

export function validarIntervalo(inicio, fim) {
  if (inicio && fim && fim <= inicio) {
    throw new HttpError(422, "Dados inválidos", [{ path: "fim", message: "O fim precisa ser depois do início." }]);
  }
}
