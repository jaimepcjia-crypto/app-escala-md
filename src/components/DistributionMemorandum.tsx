export function DistributionMemorandum({ isManager }: { isManager: boolean }) {
  return (
    <section className="panel rounded-lg p-4">
      <div className="mb-2">
        <p className="ui-font text-xs font-bold uppercase tracking-[0.16em] text-signal">Memorando</p>
        <h2 className="text-xl font-bold">Como os plantões são distribuídos</h2>
        <p className="ui-font mt-1 text-xs text-graphite">
          Ordem de decisão usada pelo motor. Não existem pesos percentuais.
        </p>
      </div>

      <div className="ui-font space-y-3 text-sm">
        <div className="rounded-md border border-graphite/15 bg-paper p-3">
          <div className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-graphite">
            1. Travas absolutas
          </div>
          <ul className="list-disc pl-5 text-graphite">
            <li>Indisponibilidade: quem marcou “não pode” naquele horário não entra.</li>
            <li>Plantão externo: só corretores autorizados a fazer externo.</li>
            <li>Não pode estar em dois plantões no mesmo horário.</li>
            <li>Corretor inativo não entra na distribuição.</li>
          </ul>
        </div>

        <div className="rounded-md border border-sand/35 bg-sand/10 p-3">
          <div className="mb-1 text-xs font-bold uppercase tracking-[0.12em] text-graphite">
            2. Metas internas definidas pelo gerente
          </div>
          {isManager ? <ManagerEffortRules /> : <BrokerEffortRules />}
        </div>

        <div className="rounded-md border border-graphite/15 bg-linen/50 p-3">
          <div className="mb-2 text-xs font-bold uppercase tracking-[0.12em] text-graphite">
            Critérios normais após as metas internas
          </div>
          <ol className="space-y-2 text-graphite">
            <li>
              <strong className="text-ink">3. Equilíbrio histórico.</strong> Quem já pegou mais
              plantões no geral cede a vez, para a distribuição ficar justa.
            </li>
            <li>
              <strong className="text-ink">4. Evitar concentração no mesmo tipo.</strong> Evita que
              sempre o mesmo corretor pegue o mesmo tipo de plantão.
            </li>
            <li>
              <strong className="text-ink">5. Distribuição ao longo da semana.</strong> Evita
              acumular muitos plantões do mesmo corretor na mesma semana.
            </li>
            <li>
              <strong className="text-ink">6. Desempate determinístico.</strong> Quando os demais
              critérios empatam, o motor usa uma regra estável e reproduzível.
            </li>
          </ol>
        </div>

        <p className="text-xs text-graphite">
          Observação: o gerente pode pedir à IA o “modo mais equilibrado”, que aumenta a influência
          dos critérios de equilíbrio nessa geração.
        </p>
      </div>
    </section>
  );
}

function ManagerEffortRules() {
  return (
    <div className="text-graphite">
      <p>
        O <strong className="text-ink">Nível de esforço</strong> atua antes dos critérios normais.
        As metas somente são tentadas quando respeitam todas as travas absolutas e existem vagas.
      </p>
      <ul className="mt-2 space-y-1">
        <li><strong className="text-ink">Muito Alto:</strong> tenta garantir 2 vagas em cada um dos 2 melhores plantões.</li>
        <li><strong className="text-ink">Alto:</strong> tenta garantir 1 vaga em cada um dos 2 melhores plantões.</li>
        <li><strong className="text-ink">Baixo:</strong> tenta garantir 3 vagas no total entre os 2 piores plantões.</li>
        <li><strong className="text-ink">Médio:</strong> tenta garantir 2 vagas no total entre os 2 piores plantões.</li>
      </ul>
      <p className="mt-2">
        Quando faltam vagas, a prioridade é: <strong className="text-ink">Muito Alto → Alto → Baixo → Médio</strong>.
        Corretores Ferreira ativos sem nível de esforço bloqueiam a geração.
      </p>
    </div>
  );
}

function BrokerEffortRules() {
  return (
    <div className="text-graphite">
      <p>
        Antes dos critérios normais de equilíbrio, o motor tenta cumprir metas internas definidas
        pelo gerente, sempre respeitando as travas absolutas e a existência de vagas.
      </p>
      <p className="mt-2">
        As avaliações, classificações individuais e detalhes dessas metas são confidenciais e
        visíveis exclusivamente ao gerente.
      </p>
    </div>
  );
}
