// Reconciliação de nomes de plantão na importação do XLSX.
// O gerente decide se um nome "parecido mas diferente" é um plantão novo ou só renome/erro de grafia.

export function normalizeName(value: string | null | undefined) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

function levenshtein(a: string, b: string) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 0; i < a.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < b.length; j += 1) {
      const cost = a[i] === b[j] ? 0 : 1;
      current.push(Math.min(current[j] + 1, previous[j + 1] + 1, previous[j] + cost));
    }
    previous = current;
  }
  return previous[b.length];
}

// "Pequena mudança" = grafia/acento/espaço/uma letra. Não dispara para nomes claramente distintos.
export function isSmallChange(a: string, b: string) {
  const left = normalizeName(a);
  const right = normalizeName(b);
  if (!left || !right || left === right) return false;
  const distance = levenshtein(left, right);
  const longest = Math.max(left.length, right.length);
  if (longest <= 3) return distance <= 1;
  return distance <= 2;
}

export type PlantaoClassification =
  | { rawName: string; status: "KNOWN"; canonicalName: string }
  | { rawName: string; status: "ALIAS"; canonicalName: string }
  | { rawName: string; status: "AMBIGUOUS"; suggestion: string }
  | { rawName: string; status: "NEW" };

// Classifica cada nome distinto vindo do XLSX contra os nomes conhecidos e os aliases já decididos.
export function classifyImportedPlantoes(input: {
  parsedNames: string[];
  knownNames: string[];
  aliases: Map<string, string>;
}): PlantaoClassification[] {
  const knownByNorm = new Map(input.knownNames.map((name) => [normalizeName(name), name]));
  const distinct = [...new Set(input.parsedNames.map((name) => name.trim()).filter(Boolean))];

  return distinct.map((rawName) => {
    const norm = normalizeName(rawName);
    const known = knownByNorm.get(norm);
    if (known) return { rawName, status: "KNOWN", canonicalName: known };
    const alias = input.aliases.get(norm);
    if (alias) return { rawName, status: "ALIAS", canonicalName: alias };

    let best: { name: string; distance: number } | null = null;
    for (const name of input.knownNames) {
      if (!isSmallChange(rawName, name)) continue;
      const distance = levenshtein(norm, normalizeName(name));
      if (!best || distance < best.distance) best = { name, distance };
    }
    if (best) return { rawName, status: "AMBIGUOUS", suggestion: best.name };
    return { rawName, status: "NEW" };
  });
}

export type PlantaoTimeSlot = { localName: string; startHour: number | null };

export type ImportChangeSummary = {
  added: string[];
  removed: string[];
  timeChanged: Array<{ localName: string; from: number[]; to: number[] }>;
};

function hoursByLocal(slots: PlantaoTimeSlot[]) {
  const map = new Map<string, Set<number>>();
  for (const slot of slots) {
    if (slot.startHour === null || slot.startHour === undefined) continue;
    const set = map.get(slot.localName) ?? new Set<number>();
    set.add(slot.startHour);
    map.set(slot.localName, set);
  }
  return map;
}

// Compara os plantões Ferreira da nova planilha contra a anterior: novos, removidos e com horário alterado.
export function buildImportChangeSummary(previous: PlantaoTimeSlot[], current: PlantaoTimeSlot[]): ImportChangeSummary {
  const previousHours = hoursByLocal(previous);
  const currentHours = hoursByLocal(current);
  const sorted = (set: Set<number>) => [...set].sort((left, right) => left - right);

  const added = [...currentHours.keys()].filter((name) => !previousHours.has(name)).sort();
  const removed = [...previousHours.keys()].filter((name) => !currentHours.has(name)).sort();
  const timeChanged: ImportChangeSummary["timeChanged"] = [];
  for (const [name, currentSet] of currentHours) {
    const previousSet = previousHours.get(name);
    if (!previousSet) continue;
    const from = sorted(previousSet);
    const to = sorted(currentSet);
    if (from.join(",") !== to.join(",")) timeChanged.push({ localName: name, from, to });
  }
  timeChanged.sort((left, right) => left.localName.localeCompare(right.localName));

  return { added, removed, timeChanged };
}
