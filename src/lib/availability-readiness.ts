export function availabilityReadiness(activeBrokerIds: string[], confirmedBrokerIds: string[]) {
  const active = new Set(activeBrokerIds);
  const confirmed = new Set(confirmedBrokerIds.filter((brokerId) => active.has(brokerId)));
  return {
    total: active.size,
    confirmed: confirmed.size,
    allConfirmed: active.size > 0 && confirmed.size === active.size
  };
}

export function brokerIdentityChanged(currentName: string, nextName: string) {
  return currentName.trim().toLocaleLowerCase("pt-BR") !== nextName.trim().toLocaleLowerCase("pt-BR");
}
