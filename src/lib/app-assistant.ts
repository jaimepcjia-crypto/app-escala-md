import { requestLlmJson } from "@/lib/llm";

export const APP_KNOWLEDGE = [
  "O App Escala MD possui três áreas: Publicar Escala, Indisponibilidades e Escala/Ranking. Corretores acessam Indisponibilidades e Escala/Ranking; o gerente também acessa Publicar Escala.",
  "Toda escala vai de segunda-feira a domingo. Upload do XLSX, alteração da prioridade dos plantões, geração e publicação da próxima escala só podem ocorrer no sábado ou domingo anteriores.",
  "O XLSX é validado automaticamente ao ser selecionado. Antes da publicação, o gerente pode excluí-lo e substituí-lo. Após a publicação, o arquivo não pode ser substituído.",
  "O gerente classifica os melhores plantões por arraste no fim de semana. Durante a semana, essa classificação fica visível, esmaecida e somente leitura.",
  "Somente o próprio corretor pode inserir ou alterar sua indisponibilidade, chamada NÃO PODE. O gerente apenas consulta.",
  "Indisponibilidades podem ser editadas entre hoje e os próximos 12 meses, exceto em semanas com escala já publicada.",
  "A indisponibilidade é uma trava absoluta: nem o gerente nem a IA podem colocar o corretor naquele horário. O corretor precisa alterar o NÃO PODE e o gerente deve fazer um novo pedido.",
  "Também são travas absolutas: corretor inativo, plantão externo sem autorização e dois plantões no mesmo horário.",
  "A escala não pode ser editada diretamente. O gerente solicita alterações à IA; toda proposta válida exige confirmação antes da execução.",
  "A IA analisa critérios de distribuição antes de propor uma alteração. O gerente pode confirmar uma mudança que contrarie critérios flexíveis, mas o app registra avisos visíveis. Travas absolutas nunca podem ser ultrapassadas.",
  "Pedidos múltiplos de alteração são atômicos: ou todos são executados, ou nenhum.",
  "O motor considera vendas/meritocracia, reservas nos melhores plantões, equilíbrio total, concentração por tipo de plantão, distribuição semanal, histórico, autorização externa e indisponibilidades.",
  "A aba Escala/Ranking mostra a escala publicada em grade semanal moderna, ranking, análise da publicação, avisos e histórico. Corretores Ferreira aparecem destacados em dourado.",
  "A escala publicada e seus avisos são visíveis para gerente e corretores. O histórico e os downloads XLSX permanecem disponíveis ao gerente.",
  "De segunda a sexta, pedidos da IA sem semana explícita miram a escala em vigor. No sábado e domingo, miram por padrão a próxima escala publicada. O gerente pode dizer escala atual ou próxima escala."
];

export type AppAssistantContext = {
  workflow: {
    isOpen: boolean;
    currentWeekStart: string;
    currentWeekEnd: string;
    nextWeekStart: string;
    nextWeekEnd: string;
    opensOn: string;
    daysUntilOpen: number;
  };
  brokers: {
    activeFerreira: number;
    inactiveFerreira: number;
    authorizedForExternal: number;
  };
  nextWeek: {
    availabilityConfirmed: number;
    availabilityTotal: number;
    importStatus: string;
    importFileName: string | null;
    published: boolean;
  };
  currentWeek: {
    published: boolean;
    totalAssignments: number;
    ferreiraAssignments: number;
    externalImportedAssignments: number;
    uncoveredAssignments: number;
    alerts: number;
  };
  priorities: string[];
};

export function appAssistantSystemPrompt() {
  return [
    "Você é a assistente especialista do App Escala MD.",
    "Responda dúvidas sobre funcionamento, regras, telas, permissões, dados e estado atual do app em português do Brasil.",
    "Esta etapa é somente informativa: não execute, prometa executar nem simule alterações no motor.",
    "Use apenas as regras e o estado atual fornecidos. Não invente dados.",
    "Diferencie claramente regra permanente de estado atual quando isso ajudar.",
    "Não exponha senhas, emails, IDs internos, detalhes de banco, código ou configuração.",
    "Se a dúvida pedir uma ação, explique como solicitá-la à IA operacional.",
    "Se não houver informação suficiente, diga exatamente o que não é possível determinar.",
    "Responda de forma objetiva, mas completa.",
    "Retorne somente um objeto json válido com a chave answer.",
    `REGRAS DO APP:\n- ${APP_KNOWLEDGE.join("\n- ")}`
  ].join("\n");
}

export async function answerAppQuestion(command: string, context: AppAssistantContext) {
  const result = await requestLlmJson<{ answer: string }>({
    system: appAssistantSystemPrompt(),
    user: JSON.stringify({ pergunta: command, estadoAtual: context }),
    schema: {
      type: "OBJECT",
      properties: { answer: { type: "STRING" } },
      required: ["answer"]
    }
  });
  return result.parsed.answer.trim();
}
