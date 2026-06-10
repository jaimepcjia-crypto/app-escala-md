// Base de regras permanentes do app, reutilizada pelo system prompt da IA central (ver ai-agent.ts).
export const APP_KNOWLEDGE = [
  "O App Escala MD possui três áreas: Publicar Escala, Indisponibilidades e Escala. Corretores acessam Indisponibilidades e Escala; o gerente também acessa Publicar Escala.",
  "Toda escala vai de segunda-feira a domingo. Upload do XLSX, geração e publicação da próxima escala só podem ocorrer no sábado ou domingo anteriores.",
  "O XLSX é validado automaticamente ao ser selecionado. Antes da publicação, o gerente pode excluí-lo e substituí-lo. Após a publicação, o arquivo não pode ser substituído.",
  "O gerente pode reorganizar por arraste a prioridade dos melhores plantões a qualquer momento. A nova ordem orienta próximas gerações e redistribuições solicitadas à IA.",
  "Somente o próprio corretor pode inserir ou alterar sua indisponibilidade, chamada NÃO PODE. O gerente apenas consulta.",
  "Indisponibilidades podem ser editadas entre hoje e os próximos 12 meses, exceto em semanas com escala já publicada.",
  "A indisponibilidade é uma trava absoluta: nem o gerente nem a IA podem colocar o corretor naquele horário. O corretor precisa alterar o NÃO PODE e o gerente deve fazer um novo pedido.",
  "A IA conduz o motor. Depois da confirmação do gerente, o motor atende às decisões da IA mesmo quando contrariam critérios flexíveis de distribuição, mas jamais ignora uma indisponibilidade registrada.",
  "Também são travas absolutas: corretor inativo, plantão externo sem autorização e dois plantões no mesmo horário.",
  "A escala não pode ser editada diretamente. O gerente solicita alterações à IA; toda proposta válida exige confirmação antes da execução.",
  "A IA analisa critérios de distribuição antes de propor uma alteração. O gerente pode confirmar uma mudança que contrarie critérios flexíveis, mas o app registra avisos visíveis. Travas absolutas nunca podem ser ultrapassadas.",
  "Pedidos múltiplos de alteração são atômicos: ou todos são executados, ou nenhum.",
  "O motor considera o nível de esforço de cada corretor — classificação interna do gerente — além de equilíbrio total, concentração por tipo de plantão, distribuição semanal, histórico, autorização externa e indisponibilidades. Esta IA atende apenas o gerente, então pode explicar abertamente o nível de esforço e o equilíbrio; os corretores não acessam esta IA nem esses dados.",
  "A aba Escala mostra a escala publicada em grade semanal moderna, análise da publicação, avisos e histórico. Corretores Ferreira aparecem destacados em roxo.",
  "A escala publicada e seus avisos são visíveis para gerente e corretores. O histórico e os downloads XLSX permanecem disponíveis ao gerente.",
  "A IA pode consultar o histórico de escalas publicadas por corretor, plantão e período. A interpretação extrai os filtros, mas a contagem é calculada diretamente nos registros publicados.",
  "De segunda a sexta, pedidos da IA sem semana explícita miram a escala em vigor. No sábado e domingo, miram por padrão a próxima escala publicada. O gerente pode dizer escala atual ou próxima escala.",
  "Ao redistribuir a escala em vigor, a IA preserva todos os plantões até o fim do dia atual, conta o que já foi trabalhado na semana e reorganiza somente os dias seguintes."
];
