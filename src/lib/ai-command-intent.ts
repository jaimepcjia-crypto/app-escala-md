export type DirectOperationalAction =
  | "CHECK_UNAVAILABILITY"
  | "GENERATE_AND_PUBLISH"
  | "EXPLAIN_FAIRNESS"
  | "REGENERATE_MORE_BALANCED"
  | "CANCEL_PUBLICATION";

function normalize(value: string) {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();
}

export function directOperationalAction(command: string): DirectOperationalAction | null {
  const normalized = normalize(command);
  if (/^(publique|gere|monte|crie)(\s+e\s+publique)?\b.*\bescala\b/.test(normalized)) return "GENERATE_AND_PUBLISH";
  if (/^(cancele|despublique|retire)\b.*\b(publicacao|escala publicada)\b/.test(normalized)) return "CANCEL_PUBLICATION";
  if (/^(verifique|confira|cheque)\b.*\b(nao pode|indisponibilidade|indisponibilidades)\b/.test(normalized)) return "CHECK_UNAVAILABILITY";
  if (/^(explique|analise|avalie)\b.*\b(justica|distribuicao|equilibrio)\b/.test(normalized)) return "EXPLAIN_FAIRNESS";
  if (/^(regenere|refaca|gere novamente)\b.*\b(equilibrio|equilibrada|balanceada)\b/.test(normalized)) return "REGENERATE_MORE_BALANCED";
  return null;
}
