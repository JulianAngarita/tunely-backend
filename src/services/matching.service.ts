import { TrackCandidate, MatchResult, Song } from '../types';

const WEIGHTS = { title: 0.40, artist: 0.30, album: 0.10, duration: 0.10, popularity: 0.10 } as const;
export const AUTO_MATCH_THRESHOLD = 70;

const stringSimilarity = (a = '', b = ''): number => {
  if (!a || !b) return 0;
  a = a.toLowerCase().trim();
  b = b.toLowerCase().trim();
  if (a === b) return 1;
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return 1 - dp[m][n] / Math.max(m, n);
};

const durationSimilarity = (msA?: number, msB?: number): number => {
  if (!msA || !msB) return 0.5;
  const diff = Math.abs(msA - msB) / 1000;
  if (diff <= 2) return 1;
  if (diff <= 5) return 0.8;
  if (diff <= 10) return 0.5;
  return 0;
};

export const scoreCandidate = (source: Pick<Song, 'title' | 'artist' | 'album' | 'duration_ms'>, candidate: TrackCandidate): number => {
  const total =
    stringSimilarity(source.title, candidate.title)       * WEIGHTS.title +
    stringSimilarity(source.artist, candidate.artist)     * WEIGHTS.artist +
    stringSimilarity(source.album, candidate.album)       * WEIGHTS.album +
    durationSimilarity(source.duration_ms, candidate.duration_ms) * WEIGHTS.duration +
    ((candidate.popularity ?? 0) / 100)                   * WEIGHTS.popularity;

  return Math.round(total * 100);
};

export const rankCandidates = (
  source: Pick<Song, 'title' | 'artist' | 'album' | 'duration_ms'>,
  candidates: TrackCandidate[]
): MatchResult => {
  const ranked = candidates
    .map((c) => ({ ...c, score: scoreCandidate(source, c) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  return {
    best: ranked[0] ?? null,
    suggestions: ranked,
    autoMatch: (ranked[0]?.score ?? 0) >= AUTO_MATCH_THRESHOLD,
  };
};
