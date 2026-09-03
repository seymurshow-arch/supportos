import type { KnowledgeSource } from "./loadKnowledge";

export type KnowledgeSearchPlan = {
  canonicalQuestion: string;
  searchPhrases: string[];
  answerSignals: string[];
  topicHints: string[];
};

export type EvidenceChunk = {
  source: KnowledgeSource;
  score: number;
  text: string;
  matchedPhrases: string[];
};

function normalize(value: string) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[’'`´]/g, "")
    .replace(/[^\p{L}\p{N}$%+./×x\s-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function uniq(values: string[]) {
  return Array.from(
    new Set(
      values
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

function tokens(value: string) {
  return uniq(
    normalize(value)
      .split(/\s+/)
      .filter((token) => token.length >= 2)
  );
}

type Section = {
  heading: string;
  text: string;
  index: number;
};

function splitIntoSections(text: string): Section[] {
  const lines = String(text || "").split(/\n/);
  const sections: Section[] = [];

  let heading = "Document start";
  let buffer: string[] = [];

  function flush() {
    const body = buffer.join("\n").trim();

    if (body) {
      sections.push({
        heading,
        text: body,
        index: sections.length,
      });
    }

    buffer = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (buffer.length && buffer[buffer.length - 1] !== "") {
        buffer.push("");
      }
      continue;
    }

    if (line.startsWith("[[SECTION]]")) {
      flush();
      heading =
        line.replace(/^\[\[SECTION\]\]\s*/, "").trim() ||
        "Untitled section";
      buffer.push(heading);
      continue;
    }

    buffer.push(line);
  }

  flush();

  // A source with no [[SECTION]] markers is still one searchable section.
  if (!sections.length && text.trim()) {
    sections.push({
      heading: "Document",
      text: text.trim(),
      index: 0,
    });
  }

  return sections;
}

function phraseVariants(plan: KnowledgeSearchPlan, originalQuestion: string) {
  const phrases = uniq([
    originalQuestion,
    plan.canonicalQuestion,
    ...plan.searchPhrases,
    ...plan.answerSignals,
    ...plan.topicHints,
  ]);

  return phrases
    .map((value) => normalize(value))
    .filter((value) => value.length >= 2);
}

function scoreText(
  source: KnowledgeSource,
  section: Section,
  phrases: string[],
  queryTokens: string[]
) {
  const title = normalize(source.title);
  const heading = normalize(section.heading);
  const text = normalize(section.text);

  let score = 0;
  const matchedPhrases: string[] = [];

  for (const phrase of phrases) {
    if (!phrase) continue;

    const inTitle = title.includes(phrase);
    const inHeading = heading.includes(phrase);
    const inText = text.includes(phrase);

    if (inTitle) {
      score += 90;
      matchedPhrases.push(phrase);
    }

    if (inHeading) {
      score += 130;
      matchedPhrases.push(phrase);
    }

    if (inText) {
      // Exact compound phrase in body is stronger than loose token overlap.
      score += phrase.includes(" ") ? 65 : 22;
      matchedPhrases.push(phrase);
    }
  }

  // Token overlap catches variants such as "minimum amount" vs "minimum credit".
  let tokenHits = 0;

  for (const token of queryTokens) {
    if (heading.includes(token)) {
      score += 18;
      tokenHits += 1;
    } else if (text.includes(token)) {
      score += 5;
      tokenHits += 1;
    }
  }

  if (tokenHits >= 4) score += 35;
  if (tokenHits >= 7) score += 45;

  // The priority never forces an irrelevant source above a relevant one.
  // It is only a tiny tie-breaker for equally relevant evidence.
  if (source.priority === 1 && score > 0) {
    score += 2;
  }

  return {
    score,
    matchedPhrases: uniq(matchedPhrases),
  };
}

function buildWindow(
  sections: Section[],
  centerIndex: number,
  maxChars: number
) {
  /*
   * Include the matching section plus neighboring sections.
   *
   * This is important for Notion pages where a value can be split like:
   *   "2. Weekly Bonus"
   *   ...
   *   "Bonus details"
   *   Minimum credit: $20
   *
   * A narrow single-section snippet would miss the answer.
   */
  const order: number[] = [centerIndex];

  for (let distance = 1; distance <= 3; distance += 1) {
    if (centerIndex + distance < sections.length) {
      order.push(centerIndex + distance);
    }

    if (centerIndex - distance >= 0) {
      order.push(centerIndex - distance);
    }
  }

  // Restore document order after choosing the neighborhood.
  order.sort((a, b) => a - b);

  let result = "";

  for (const index of order) {
    const section = sections[index];
    if (!section) continue;

    const part = section.text.trim();
    if (!part) continue;

    const next = result ? `${result}\n\n${part}` : part;

    if (next.length > maxChars) {
      if (!result) {
        return next.slice(0, maxChars);
      }
      break;
    }

    result = next;
  }

  return result;
}

export function collectBroadEvidence(
  sources: KnowledgeSource[],
  originalQuestion: string,
  plan: KnowledgeSearchPlan,
  options?: {
    maxChunks?: number;
    maxChars?: number;
    maxChunkChars?: number;
  }
) {
  const maxChunks = options?.maxChunks ?? 28;
  const maxChars = options?.maxChars ?? 78_000;
  const maxChunkChars = options?.maxChunkChars ?? 7_000;

  const phrases = phraseVariants(plan, originalQuestion);
  const queryTokens = tokens(
    [
      originalQuestion,
      plan.canonicalQuestion,
      ...plan.searchPhrases,
      ...plan.answerSignals,
      ...plan.topicHints,
    ].join(" ")
  );

  const candidates: Array<{
    source: KnowledgeSource;
    sections: Section[];
    sectionIndex: number;
    score: number;
    matchedPhrases: string[];
  }> = [];

  /*
   * IMPORTANT: every loaded source is scanned.
   * We do not stop after the first matching Notion page or first matching Terms part.
   */
  for (const source of sources) {
    const sections = splitIntoSections(source.text);

    for (let i = 0; i < sections.length; i += 1) {
      const scored = scoreText(
        source,
        sections[i],
        phrases,
        queryTokens
      );

      if (scored.score <= 0) continue;

      candidates.push({
        source,
        sections,
        sectionIndex: i,
        score: scored.score,
        matchedPhrases: scored.matchedPhrases,
      });
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.source.priority !== b.source.priority) {
      return a.source.priority - b.source.priority;
    }
    return a.source.title.localeCompare(b.source.title);
  });

  const evidence: EvidenceChunk[] = [];
  const usedSourceWindows = new Map<string, number[]>();
  let totalChars = 0;

  for (const candidate of candidates) {
    if (evidence.length >= maxChunks) break;
    if (totalChars >= maxChars) break;

    const previousCenters =
      usedSourceWindows.get(candidate.source.id) || [];

    // Avoid sending almost the same neighboring section window repeatedly.
    if (
      previousCenters.some(
        (center) => Math.abs(center - candidate.sectionIndex) <= 2
      )
    ) {
      continue;
    }

    const remaining = maxChars - totalChars;
    const chunkBudget = Math.min(maxChunkChars, remaining);

    if (chunkBudget < 500) break;

    const text = buildWindow(
      candidate.sections,
      candidate.sectionIndex,
      chunkBudget
    );

    if (!text.trim()) continue;

    evidence.push({
      source: candidate.source,
      score: candidate.score,
      text,
      matchedPhrases: candidate.matchedPhrases,
    });

    usedSourceWindows.set(candidate.source.id, [
      ...previousCenters,
      candidate.sectionIndex,
    ]);

    totalChars += text.length;
  }

  /*
   * Safety fallback:
   * If lexical retrieval still produced nothing, send compact starts of
   * every source that fits. This is slower/less precise but prevents the
   * system from declaring "not found" just because a user used unusual wording.
   */
  if (!evidence.length) {
    for (const source of sources) {
      if (evidence.length >= maxChunks) break;
      if (totalChars >= maxChars) break;

      const remaining = maxChars - totalChars;
      const text = source.text.slice(
        0,
        Math.min(maxChunkChars, remaining)
      );

      if (!text.trim()) continue;

      evidence.push({
        source,
        score: 0,
        text,
        matchedPhrases: [],
      });

      totalChars += text.length;
    }
  }

  const context = evidence
    .map((item, index) =>
      [
        `EVIDENCE ${index + 1}`,
        `SOURCE_ID: ${item.source.id}`,
        `SOURCE_TYPE: ${item.source.sourceType}`,
        `PRIORITY: ${item.source.priority}`,
        `TITLE: ${item.source.title}`,
        `URL: ${item.source.url || "-"}`,
        `RETRIEVAL_SCORE: ${item.score}`,
        `MATCHED: ${item.matchedPhrases.join(", ") || "-"}`,
        "CONTENT:",
        item.text,
      ].join("\n")
    )
    .join("\n\n==============================\n\n");

  return {
    evidence,
    context,
    debug: {
      scannedSources: sources.length,
      candidateSections: candidates.length,
      evidenceChunks: evidence.length,
      totalEvidenceChars: totalChars,
      phrases,
      queryTokens,
      selected: evidence.map((item) => ({
        id: item.source.id,
        title: item.source.title,
        sourceType: item.source.sourceType,
        priority: item.source.priority,
        score: item.score,
        matchedPhrases: item.matchedPhrases,
        preview: item.text.slice(0, 1500),
      })),
    },
  };
}
