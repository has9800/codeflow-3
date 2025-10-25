import type { AnnResult } from './AnnIndex.js';
import type { Bm25Hit } from './Bm25Index.js';

export type CandidateSource = 'ANN' | 'BM25';

export interface Candidate {
  id: string;
  score: number;
  source: CandidateSource;
}

export interface FusedCandidate {
  id: string;
  fusedScore: number;
  rank: number;
  sources: Map<CandidateSource, number>;
}

export function buildCandidatePool(
  annResults: AnnResult[],
  bm25Results: Bm25Hit[]
): Candidate[] {
  const candidates: Candidate[] = [];

  for (const hit of annResults) {
    candidates.push({
      id: hit.id,
      score: hit.score,
      source: 'ANN',
    });
  }

  for (const hit of bm25Results) {
    candidates.push({
      id: hit.id,
      score: hit.score,
      source: 'BM25',
    });
  }

  return candidates;
}

export function reciprocalRankFusion(
  annResults: AnnResult[],
  bm25Results: Bm25Hit[],
  topK: number,
  k = 60
): FusedCandidate[] {
  const sources: Array<{ results: { id: string; score: number }[]; source: CandidateSource }> = [
    { results: annResults, source: 'ANN' },
    { results: bm25Results, source: 'BM25' },
  ];

  const scores = new Map<
    string,
    { value: number; sources: Map<CandidateSource, number> }
  >();

  for (const { results, source } of sources) {
    results.forEach((hit, index) => {
      const fused = scores.get(hit.id) ?? {
        value: 0,
        sources: new Map<CandidateSource, number>(),
      };
      fused.value += 1 / (k + index + 1);
      fused.sources.set(source, hit.score);
      scores.set(hit.id, fused);
    });
  }

  const fusedList: FusedCandidate[] = Array.from(scores.entries())
    .map(([id, data]) => ({
      id,
      fusedScore: data.value,
      rank: 0,
      sources: data.sources,
    }))
    .sort((a, b) => b.fusedScore - a.fusedScore)
    .slice(0, topK);

  fusedList.forEach((candidate, index) => {
    candidate.rank = index + 1;
  });

  return fusedList;
}
