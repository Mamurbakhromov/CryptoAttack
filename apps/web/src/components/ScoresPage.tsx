import { useEffect, useMemo, useState } from 'react';

import { fetchScoreDetail, fetchScoreEvidence, fetchScoreMarketRegime, fetchScoresCurrent, fetchScoresTop, fetchScoreTimeline, fetchScoringConfigCurrent } from '../api/sse';
import { getCoinClassificationClasses, getCoinClassificationFilterLabel, isCoinClassificationFilterActive, matchesCoinClassificationFilter, type CoinClassificationFilter } from '../coinClassification';
import { getExchangeFilterLabel, getMarketFilterLabel, isExchangeFilterActive, isMarketFilterActive, type ExchangeFilter, type MarketFilter } from '../exchangeFilters';
import type { ApiStatus, DashboardSnapshot, ExchangeMarket, NormalizedEvent, ScoreDetailResponse, ScoreEvidenceItem, ScoreEvidenceResponse, ScoreEvidenceSide, ScoreListQuery, ScoreMarketRegime, ScoreMarketRegimeResponse, ScoreSnapshotSseEvent, ScoreSummary, ScoreTimelinePoint, ScoreTimelineResponse, ScoreUpdateSseEvent, ScoresListResponse, ScoreWorkerStatus, StorageStatusResponse } from '../types';
import { ExchangeChips, getCoinExchangeChips, type ExchangeAvailabilityByMarket, type ExchangeChipInfo } from './ExchangeChips';
import { formatDateTime, formatTime } from './format';

interface ScoresPageProps {
  authToken: string | null;
  classificationFilter: CoinClassificationFilter;
  exchangeFilter: ExchangeFilter;
  marketFilter: MarketFilter;
  exchangeAvailability: ExchangeAvailabilityByMarket;
  snapshot: DashboardSnapshot;
  status: ApiStatus | null;
  liveScoreUpdate: ScoreUpdateSseEvent | null;
  liveScoreSnapshot: ScoreSnapshotSseEvent | null;
  storageStatus: StorageStatusResponse | null;
}

const defaultScoreWindows = [5, 15, 60, 240, 1_440];
const confidenceOptions = [0, 25, 50, 75];

export function ScoresPage(props: ScoresPageProps) {
  const [selectedWindowMinutes, setSelectedWindowMinutes] = useState<number | null>(null);
  const [configuredScoreWindows, setConfiguredScoreWindows] = useState<number[] | null>(null);
  const [minConfidence, setMinConfidence] = useState(0);
  const [changedSince, setChangedSince] = useState<string | null>(null);
  const [topBull, setTopBull] = useState<ScoresListResponse | null>(null);
  const [topBear, setTopBear] = useState<ScoresListResponse | null>(null);
  const [currentScores, setCurrentScores] = useState<ScoresListResponse | null>(null);
  const [marketRegime, setMarketRegime] = useState<ScoreMarketRegimeResponse | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const serverScoreWindows = configuredScoreWindows ?? props.storageStatus?.workers.scores.windowsMinutes ?? props.status?.workers?.scores.windowsMinutes ?? null;
  const scoreWindows = useMemo(() => normalizeScoreWindows(serverScoreWindows ?? defaultScoreWindows), [serverScoreWindows]);
  const windowMinutes = selectedWindowMinutes && scoreWindows.includes(selectedWindowMinutes) ? selectedWindowMinutes : defaultScoreWindow(scoreWindows);
  const hasConfiguredScoreWindows = Boolean(serverScoreWindows?.length);

  useEffect(() => {
    const abortController = new AbortController();
    void fetchScoringConfigCurrent(props.authToken, { includeRules: false }, abortController.signal)
      .then((response) => setConfiguredScoreWindows(normalizeScoreWindows(response.config.windows.map((window) => window.minutes))))
      .catch(() => {
        if (!abortController.signal.aborted) setConfiguredScoreWindows(null);
      });
    return () => abortController.abort();
  }, [props.authToken]);

  useEffect(() => {
    if (selectedWindowMinutes && !scoreWindows.includes(selectedWindowMinutes)) setSelectedWindowMinutes(null);
  }, [scoreWindows, selectedWindowMinutes]);

  const baseQuery = useMemo(() => buildScoreQuery({
    windowMinutes: hasConfiguredScoreWindows ? windowMinutes : null,
    minConfidence,
    changedSince,
    classificationFilter: props.classificationFilter
  }), [changedSince, hasConfiguredScoreWindows, minConfidence, props.classificationFilter, windowMinutes]);

  useEffect(() => {
    const abortController = new AbortController();
    setLoading(true);

    void Promise.all([
      fetchScoresTop(props.authToken, { ...baseQuery, side: 'bull', limit: 10 }, abortController.signal),
      fetchScoresTop(props.authToken, { ...baseQuery, side: 'bear', limit: 10 }, abortController.signal),
      fetchScoresCurrent(props.authToken, { ...baseQuery, side: 'net', limit: 50 }, abortController.signal),
      fetchScoreMarketRegime(props.authToken, { ...baseQuery, side: 'net', limit: 500 }, abortController.signal)
    ])
      .then(([bull, bear, current, regime]) => {
        setTopBull(bull);
        setTopBear(bear);
        setCurrentScores(current);
        setMarketRegime(regime);
        setError(null);
      })
      .catch((fetchError: unknown) => {
        if (!abortController.signal.aborted) setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      })
      .finally(() => {
        if (!abortController.signal.aborted) setLoading(false);
      });

    return () => abortController.abort();
  }, [baseQuery, props.authToken, reloadKey]);

  useEffect(() => {
    const liveUpdate = props.liveScoreUpdate;
    if (!liveUpdate) return;
    setTopBull((response) => patchScoreResponse(response, liveUpdate, 'bull', 10, false));
    setTopBear((response) => patchScoreResponse(response, liveUpdate, 'bear', 10, false));
    setCurrentScores((response) => patchScoreResponse(response, liveUpdate, 'rising', 50, canInsertLiveRows(props.classificationFilter, props.exchangeFilter, props.marketFilter)));
  }, [props.classificationFilter, props.exchangeFilter, props.liveScoreUpdate, props.marketFilter]);

  useEffect(() => {
    if (!selectedCoin) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedCoin(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedCoin]);

  const bullRows = filterDirectionalRows(filterScoreRows(topBull?.scores ?? [], props), 'bull').slice(0, 10);
  const bearRows = filterDirectionalRows(filterScoreRows(topBear?.scores ?? [], props), 'bear').slice(0, 10);
  const risingRows = filterScoreRows(currentScores?.scores ?? [], props)
    .filter((score) => (score.recentScoreDelta ?? 0) > 0)
    .sort(compareRisingScores)
    .slice(0, 10);
  const visibleCurrentScores = filterScoreRows(currentScores?.scores ?? [], props);
  const thinDataCount = visibleCurrentScores.filter((score) => score.confidenceScore < 25).length;
  const health = props.storageStatus?.workers.scores ?? props.liveScoreSnapshot?.health ?? props.status?.workers?.scores ?? null;
  const storageUnavailable = [topBull, topBear, currentScores].some((response) => response?.enabled === false);

  const toggleChangedSince = () => {
    setChangedSince((current) => current ? null : new Date(Date.now() - 15 * 60_000).toISOString());
  };

  return (
    <main className="mx-auto grid max-w-[1800px] gap-3 px-4 py-3 md:px-6">
      <section className="page-hero scores">
        <h1>Scores</h1>
        <span>15m bull/bear/net conviction from scored live events</span>
      </section>

      <section className="panel scores-controls-panel">
        <div className="scores-controls">
          <div className="scores-control-group" role="group" aria-label="Score window">
            {scoreWindows.map((minutes) => (
              <button className={`control-button ${windowMinutes === minutes ? 'active' : ''}`} type="button" onClick={() => setSelectedWindowMinutes(minutes)} key={minutes}>
                {formatWindow(minutes)}
              </button>
            ))}
          </div>
          <div className="scores-control-group" role="group" aria-label="Minimum confidence">
            {confidenceOptions.map((confidence) => (
              <button className={`control-button ${minConfidence === confidence ? 'active' : ''}`} type="button" onClick={() => setMinConfidence(confidence)} key={confidence}>
                Conf {confidence}+
              </button>
            ))}
          </div>
          <button className={`control-button ${changedSince ? 'active' : ''}`} type="button" onClick={toggleChangedSince}>
            Changed last 15m
          </button>
          <button className="control-button" type="button" disabled={loading} onClick={() => setReloadKey((value) => value + 1)}>
            {loading ? 'Refreshing' : 'Refresh'}
          </button>
        </div>
        <p className="scores-filter-note">
          {formatScoreFilterNote(props.classificationFilter, props.exchangeFilter, props.marketFilter)}
        </p>
      </section>

      {error ? <div className="warning-banner">Scores warning: {error}</div> : null}
      {storageUnavailable ? <div className="warning-banner">Score storage is unavailable. Live events are still updating, but ranked scores cannot be shown.</div> : null}
      {thinDataCount > 0 && minConfidence < 25 ? <div className="warning-banner">Thin-data warning: {thinDataCount} visible score{thinDataCount === 1 ? '' : 's'} are below 25 confidence. Treat these rankings as provisional.</div> : null}

      <section className="scores-grid">
        <ScoreLeaderboardPanel title="Top 10 Bull" subtitle="Strongest positive net edge after bearish pressure is subtracted." tone="bull" rows={bullRows} loading={loading} emptyCopy={emptyCopy(topBull, props.classificationFilter)} selectedCoin={selectedCoin} exchangeAvailability={props.exchangeAvailability} onSelectCoin={setSelectedCoin} />
        <ScoreLeaderboardPanel title="Top 10 Bear" subtitle="Strongest negative net edge after bullish pressure is subtracted." tone="bear" rows={bearRows} loading={loading} emptyCopy={emptyCopy(topBear, props.classificationFilter)} selectedCoin={selectedCoin} exchangeAvailability={props.exchangeAvailability} onSelectCoin={setSelectedCoin} />
        <ScoreLeaderboardPanel title="Rising Fast" subtitle="Coins whose net score moved up most recently." tone="rising" rows={risingRows} loading={loading} emptyCopy="No rising scores match these filters." selectedCoin={selectedCoin} exchangeAvailability={props.exchangeAvailability} onSelectCoin={setSelectedCoin} />
        <MarketRegimePanel regime={marketRegime} loading={loading} />
        <ScoreHealthPanel health={health} storageStatus={props.storageStatus} status={props.status} />
      </section>

      {selectedCoin ? (
        <div className="score-detail-modal-backdrop" role="presentation" onClick={() => setSelectedCoin(null)}>
          <div className="score-detail-modal" role="dialog" aria-modal="true" aria-labelledby="score-detail-title" onClick={(event) => event.stopPropagation()}>
            <button className="modal-close-button score-detail-modal-close" type="button" aria-label="Close score detail" onClick={() => setSelectedCoin(null)}>×</button>
            <ScoreDetailPanel
              authToken={props.authToken}
              coin={selectedCoin}
              query={baseQuery}
              snapshot={props.snapshot}
              exchangeAvailability={props.exchangeAvailability}
            />
          </div>
        </div>
      ) : null}
    </main>
  );
}

function ScoreLeaderboardPanel(props: { title: string; subtitle: string; tone: 'bull' | 'bear' | 'rising'; rows: ScoreSummary[]; loading: boolean; emptyCopy: string; selectedCoin: string | null; exchangeAvailability: ExchangeAvailabilityByMarket; onSelectCoin: (coin: string) => void }) {
  return (
    <section className={`panel score-panel ${props.tone}`}>
      <div className="panel-header">
        <div>
          <h2>{props.title}</h2>
          <p>{props.subtitle}</p>
        </div>
        <span className="count-pill">{props.rows.length ? `${props.rows.length} rows` : props.loading ? 'Loading' : 'Empty'}</span>
      </div>
      <div className="score-row-list">
        {props.rows.length ? props.rows.map((score, index) => (
          <ScoreRow score={{ ...score, rank: index + 1 }} tone={props.tone} selected={props.selectedCoin === score.coin} exchangeAvailability={props.exchangeAvailability} onSelect={() => props.onSelectCoin(score.coin)} key={`${props.title}-${score.coin}`} />
        )) : <div className="empty-state">{props.loading ? 'Loading scored coins' : props.emptyCopy}</div>}
      </div>
    </section>
  );
}

function ScoreRow({ score, tone, selected, exchangeAvailability, onSelect }: { score: ScoreSummary; tone: 'bull' | 'bear' | 'rising'; selected: boolean; exchangeAvailability: ExchangeAvailabilityByMarket; onSelect: () => void }) {
  const exchanges = getScoreExchangeChips(score, exchangeAvailability);
  const markets = getScoreMarkets(score, exchangeAvailability);
  return (
    <article className={`score-row classification-row ${getCoinClassificationClasses(score.coin)} ${selected ? 'selected' : ''}`}>
      <div className="score-row-main">
        <span className={`score-rank ${tone}`}>#{score.rank}</span>
        <button className="coin-button coin-button-large" type="button" onClick={onSelect}>{score.coin}</button>
        <div className="score-row-meta">
          <span>Ex</span>
          {exchanges.length ? <ExchangeChips chips={exchanges} /> : <strong>Unknown</strong>}
        </div>
        <div className="score-row-meta">
          <span>Mkt</span>
          <strong>{markets.join(' + ') || 'Unknown'}</strong>
        </div>
      </div>
      <div className="score-metrics" aria-label={`${score.coin} score metrics`}>
        <ScoreMetric label="Bull" value={score.bullScore} tone="bull" />
        <ScoreMetric label="Bear" value={score.bearScore} tone="bear" />
        <ScoreMetric label="Edge" value={score.netScore} tone={score.netScore >= 0 ? 'bull' : 'bear'} signed />
        <span className={`confidence-badge ${confidenceTone(score.confidenceScore)}`}>{confidenceLabel(score.confidenceScore)} {formatScore(score.confidenceScore)}</span>
      </div>
      <div className="score-row-context">
        <span className="score-reason" title={score.primaryReason ?? undefined}>{score.primaryReason ?? score.dominantSignal ?? 'No dominant reason yet'}</span>
        {score.riskTags.length ? <RiskTags tags={score.riskTags} /> : null}
        <span className={`delta-badge ${(score.recentScoreDelta ?? 0) >= 0 ? 'up' : 'down'}`}>{formatDelta(score.recentScoreDelta)}</span>
        <span className="score-updated">{formatTime(score.latestScoreTs)}</span>
        <button className="score-detail-link" type="button" onClick={onSelect}>Detail</button>
      </div>
    </article>
  );
}

function ScoreMetric({ label, value, tone, signed = false }: { label: string; value: number; tone: 'bull' | 'bear'; signed?: boolean }) {
  return <span className={`score-metric ${tone}`}><small>{label}</small>{signed ? formatSignedScore(value) : formatScore(value)}</span>;
}

function MarketRegimePanel({ regime, loading }: { regime: ScoreMarketRegimeResponse | null; loading: boolean }) {
  const activeRegime = regime?.regime ?? 'thin_data';
  return (
    <section className={`panel score-panel regime ${activeRegime}`}>
      <div className="panel-header">
        <div>
          <h2>Market Regime</h2>
          <p>Summarizes current scored coins, not the whole crypto market.</p>
        </div>
        <span className="count-pill">{loading ? 'Loading' : regime ? `${regime.sampledCoins} sampled` : 'Waiting'}</span>
      </div>
      {regime ? (
        <div className="regime-grid">
          <div className="regime-primary">
            <span>Regime</span>
            <strong>{formatRegime(activeRegime)}</strong>
          </div>
          <RegimeStat label="Bullish" value={regime.bullishCoinCount} />
          <RegimeStat label="Bearish" value={regime.bearishCoinCount} />
          <RegimeStat label="Mixed" value={regime.mixedCount} />
          <RegimeStat label="Quiet" value={regime.quietCount} />
          <RegimeStat label="Avg Conf" value={`${formatScore(regime.averageConfidence)}%`} />
          <RegimeStat label="Freshness" value={regime.dataFreshness.latestAgeSeconds === null ? 'Waiting' : `${regime.dataFreshness.latestAgeSeconds}s`} />
        </div>
      ) : <div className="empty-state">{loading ? 'Loading market regime' : 'No scored market regime yet'}</div>}
    </section>
  );
}

function RegimeStat({ label, value }: { label: string; value: number | string }) {
  return <div className="regime-stat"><span>{label}</span><strong>{value}</strong></div>;
}

function ScoreHealthPanel({ health, storageStatus, status }: { health: ScoreWorkerStatus | null; storageStatus: StorageStatusResponse | null; status: ApiStatus | null }) {
  const storage = storageStatus?.storage ?? status?.storage ?? null;
  const operationalHealth = storageStatus?.health ?? status?.health ?? null;
  const storageWarning = operationalHealth && (operationalHealth.state === 'degraded' || operationalHealth.state === 'unhealthy') ? operationalHealth.reasons.join(', ') || operationalHealth.state : null;
  return (
    <section className={`panel score-panel health ${operationalHealth?.state ?? health?.state ?? 'disabled'}`}>
      <div className="panel-header">
        <div>
          <h2>Score Health</h2>
          <p>Freshness and worker state for score computation.</p>
        </div>
        <span className="count-pill">{health?.state ?? 'disabled'}</span>
      </div>
      <div className="health-grid">
        <RegimeStat label="Queue" value={health?.queueDepth ?? 0} />
        <RegimeStat label="Pending" value={health?.pendingCoinCount ?? 0} />
        <RegimeStat label="Written" value={health?.written ?? 0} />
        <RegimeStat label="Failed" value={health?.failed ?? 0} />
        <RegimeStat label="Latest" value={formatTime(health?.latestScoreTs)} />
        <RegimeStat label="Storage" value={storage?.state ?? 'disabled'} />
      </div>
      <p className="health-summary">{scoreHealthSummary(health, operationalHealth)}</p>
      {storageWarning ? <div className="warning-banner mt-3">Storage/scoring health warning: {storageWarning}</div> : null}
      {health?.lastError ? <div className="warning-banner mt-3">Score worker warning: {health.lastError}</div> : null}
    </section>
  );
}

function ScoreDetailPanel({ authToken, coin, query, snapshot, exchangeAvailability }: { authToken: string | null; coin: string; query: ScoreListQuery; snapshot: DashboardSnapshot; exchangeAvailability: ExchangeAvailabilityByMarket }) {
  const [detail, setDetail] = useState<ScoreDetailResponse | null>(null);
  const [timeline, setTimeline] = useState<ScoreTimelineResponse | null>(null);
  const [evidence, setEvidence] = useState<ScoreEvidenceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    setLoading(true);
    void Promise.all([
      fetchScoreDetail(authToken, coin, { ...query, side: 'net', limit: 1 }, abortController.signal),
      fetchScoreTimeline(authToken, coin, { ...query, side: 'net', limit: 60 }, abortController.signal),
      fetchScoreEvidence(authToken, coin, { ...query, side: 'net', limit: 80 }, abortController.signal)
    ])
      .then(([nextDetail, nextTimeline, nextEvidence]) => {
        setDetail(nextDetail);
        setTimeline(nextTimeline);
        setEvidence(nextEvidence);
        setError(null);
      })
      .catch((fetchError: unknown) => {
        if (!abortController.signal.aborted) setError(fetchError instanceof Error ? fetchError.message : String(fetchError));
      })
      .finally(() => {
        if (!abortController.signal.aborted) setLoading(false);
      });
    return () => abortController.abort();
  }, [authToken, coin, query]);

  const score = detail?.score ?? null;
  const events = latestEventsForCoin(snapshot, coin);
  const evidenceRows = evidence?.evidence ?? [];
  const displayCoin = score?.coin ?? coin;
  const scoreExchangeChips = score ? getScoreExchangeChips(score, exchangeAvailability) : [];
  const scoreMarkets = score ? getScoreMarkets(score, exchangeAvailability) : [];

  return (
    <section className={`panel score-detail-panel classification-row ${getCoinClassificationClasses(displayCoin)}`} aria-label={`${displayCoin} score detail`}>
      <div className="score-detail-hero">
        <div className="score-detail-hero-top">
          <div className="score-detail-title-lockup">
            <span className="score-detail-kicker">Live score detail</span>
            <h2 id="score-detail-title">{displayCoin} Score Detail</h2>
            <p>{score?.primaryReason ?? 'Evidence is ordered by latest score time and largest contribution. Recency decay means older alerts count less.'}</p>
          </div>
        </div>

        {score ? (
          <>
            <div className="score-detail-status-row">
              <button className="coin-button coin-button-large" type="button">{score.coin}</button>
              <span className={`regime-pill ${score.marketRegime ?? 'thin_data'}`}>{formatRegime(score.marketRegime)}</span>
              <span className={`delta-badge ${(score.recentScoreDelta ?? 0) >= 0 ? 'up' : 'down'}`}>{formatDelta(score.recentScoreDelta)}</span>
              <span className="score-updated">Scored {formatTime(score.latestScoreTs)}</span>
            </div>

            <div className="score-detail-vitals" aria-label={`${score.coin} score metrics`}>
              <ScoreHeroMetric label="Bull Pressure" value={score.bullScore} tone="bull" caption="Supportive evidence" />
              <ScoreHeroMetric label="Bear Pressure" value={score.bearScore} tone="bear" caption="Risk and sell evidence" />
              <ScoreHeroMetric label={score.netScore >= 0 ? 'Bull Edge' : 'Bear Edge'} value={score.netScore} tone={score.netScore >= 0 ? 'bull' : 'bear'} caption="Bull minus bear" signed />
              <ScoreConfidenceCard value={score.confidenceScore} />
            </div>

            <ScorePressureBar score={score} />

            <div className="score-detail-context">
              <div className="score-detail-context-item">
                <span>Exchanges</span>
                <div>{scoreExchangeChips.length ? <ExchangeChips chips={scoreExchangeChips} /> : <strong>Unknown</strong>}</div>
              </div>
              <div className="score-detail-context-item">
                <span>Markets</span>
                <strong>{scoreMarkets.join(' + ') || 'Unknown'}</strong>
              </div>
              <div className="score-detail-context-item">
                <span>Window</span>
                <strong>{formatWindow(score.windowMinutes)}</strong>
              </div>
              <div className="score-detail-context-item">
                <span>Evidence</span>
                <strong>{score.evidenceSummary.total}</strong>
              </div>
            </div>
          </>
        ) : null}
      </div>

      {error ? <div className="warning-banner">Score detail warning: {error}</div> : null}
      {loading ? <div className="empty-state">Loading {coin} score detail</div> : null}
      {!loading && !score ? <div className="empty-state">No current score found for {coin}.</div> : null}

      <div className="score-detail-grid">
        <section className="score-detail-card">
          <h3>Score Timeline</h3>
          <ScoreTimelineMiniChart points={timeline?.snapshots ?? []} />
        </section>
        <section className="score-detail-card">
          <h3>Latest Normalized Events</h3>
          {events.length ? events.map((event) => <LatestEventRow event={event} key={event.id} />) : <div className="empty-state">No live normalized events for {coin} in the current buffer.</div>}
        </section>
        <EvidenceSection title="Bull Evidence" side="bull" evidence={evidenceRows} />
        <EvidenceSection title="Bear Evidence" side="bear" evidence={evidenceRows} />
        <EvidenceSection title="Risk Evidence" side="risk" evidence={evidenceRows} />
        <section className="score-detail-card">
          <h3>Forward Returns</h3>
          <div className="empty-state">Forward return attribution placeholder. The storage worker can label returns, but this UI waits for a dedicated attribution API.</div>
        </section>
      </div>
    </section>
  );
}

function ScoreHeroMetric({ label, value, tone, caption, signed = false }: { label: string; value: number; tone: 'bull' | 'bear'; caption: string; signed?: boolean }) {
  return (
    <article className={`score-hero-metric ${tone}`}>
      <span>{label}</span>
      <strong>{signed ? formatSignedScore(value) : formatScore(value)}</strong>
      <small>{caption}</small>
    </article>
  );
}

function ScoreConfidenceCard({ value }: { value: number }) {
  const percent = clampPercent(value);
  const tone = confidenceTone(value);
  const color = tone === 'high' ? '#34d399' : tone === 'medium' ? '#60a5fa' : '#f59e0b';
  return (
    <article className={`score-confidence-card ${tone}`} aria-label={`Confidence ${formatScore(value)}`}>
      <span>Confidence</span>
      <div className="score-confidence-ring" style={{ background: `conic-gradient(${color} ${percent}%, rgba(148, 163, 184, 0.18) 0)` }}>
        <div>
          <strong>{formatScore(value)}</strong>
          <small>{confidenceLabel(value)}</small>
        </div>
      </div>
    </article>
  );
}

function ScorePressureBar({ score }: { score: ScoreSummary }) {
  const bull = Math.max(0, score.bullScore);
  const bear = Math.max(0, score.bearScore);
  const total = bull + bear;
  const bullWidth = total ? clampPercent((bull / total) * 100) : 50;
  const bearWidth = 100 - bullWidth;
  return (
    <div className="score-pressure-card" aria-label={`${score.coin} bull bear pressure balance`}>
      <div className="score-pressure-labels">
        <span>Bull {formatScore(score.bullScore)}</span>
        <strong>{formatSignedScore(score.netScore)} net edge</strong>
        <span>Bear {formatScore(score.bearScore)}</span>
      </div>
      <div className="score-pressure-track" aria-hidden="true">
        <span className="score-pressure-fill bull" style={{ width: `${bullWidth}%` }} />
        <span className="score-pressure-fill bear" style={{ width: `${bearWidth}%` }} />
      </div>
    </div>
  );
}

function ScoreTimelineMiniChart({ points }: { points: ScoreTimelinePoint[] }) {
  const ordered = [...points].reverse().slice(-40);
  const latest = ordered[ordered.length - 1] ?? null;
  const polyline = ordered.map((point, index) => `${ordered.length <= 1 ? 50 : (index / (ordered.length - 1)) * 100},${clampTimelineY(point.netScore)}`).join(' ');
  return ordered.length ? (
    <div className="score-timeline-chart">
      {latest ? (
        <div className="score-timeline-stats">
          <TimelineStat label="Latest Net" value={formatSignedScore(latest.netScore)} />
          <TimelineStat label="Confidence" value={formatScore(latest.confidenceScore)} />
          <TimelineStat label="Events" value={latest.eventCount} />
        </div>
      ) : null}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label="Net score timeline">
        <line x1="0" x2="100" y1="50" y2="50" />
        <polyline points={polyline} />
      </svg>
      <div className="score-timeline-points">
        {points.slice(0, 6).map((point) => (
          <span key={point.scoreSnapshotId}>{formatTime(point.ts)} · {formatSignedScore(point.netScore)} net · {formatDelta(point.recentScoreDelta)}</span>
        ))}
      </div>
    </div>
  ) : <div className="empty-state">No score history yet.</div>;
}

function TimelineStat({ label, value }: { label: string; value: number | string }) {
  return <div className="score-timeline-stat"><span>{label}</span><strong>{value}</strong></div>;
}

function EvidenceSection({ title, side, evidence }: { title: string; side: ScoreEvidenceSide; evidence: ScoreEvidenceItem[] }) {
  const rows = evidence.filter((item) => item.side === side).slice(0, 10);
  const maxContribution = Math.max(1, ...rows.map((item) => Math.abs(item.contribution)));
  return (
    <section className={`score-detail-card evidence-card ${side}`}>
      <div className="score-detail-card-header">
        <h3>{title}</h3>
        <span>{rows.length ? `${rows.length} signals` : 'None'}</span>
      </div>
      {rows.length ? rows.map((item) => <EvidenceRow item={item} maxContribution={maxContribution} key={item.evidenceKey} />) : <div className="empty-state">No {side} evidence in the latest score window.</div>}
    </section>
  );
}

function EvidenceRow({ item, maxContribution }: { item: ScoreEvidenceItem; maxContribution: number }) {
  const exchange = stringPayload(item.payload, 'exchange');
  const market = stringPayload(item.payload, 'market');
  const contributionWidth = item.contribution === 0 ? 0 : Math.max(8, clampPercent((Math.abs(item.contribution) / maxContribution) * 100));
  return (
    <article className={`evidence-row ${item.side}`}>
      <div className="evidence-row-main">
        <span className="evidence-contribution">{formatSignedScore(item.contribution)}</span>
        <div>
          <strong>{item.reason}</strong>
          <span>{item.feedKey} · {formatRuleKey(item.ruleKey)} · {formatTime(item.sourceReceivedAt)}</span>
        </div>
      </div>
      <div className="evidence-bar-track" aria-hidden="true">
        <span className="evidence-bar-fill" style={{ width: `${contributionWidth}%` }} />
      </div>
      <div className="evidence-pills">
        <span className="chip">Decay {item.decayMultiplier.toFixed(2)}</span>
        <span className="chip">Weight {formatScore(item.weight)}</span>
        {exchange ? <span className="chip">{exchange}</span> : null}
        {market ? <span className="chip">{market}</span> : null}
      </div>
    </article>
  );
}

function LatestEventRow({ event }: { event: NormalizedEvent }) {
  return (
    <article className="evidence-row latest-event-row event">
      <span className="latest-event-dot" aria-hidden="true" />
      <div>
        <strong>{event.title}</strong>
        <span>{event.feedKey} · {formatTime(event.receivedAt)} · {event.coins.join(', ') || event.entries.map((entry) => entry.coin).filter(Boolean).join(', ')}</span>
      </div>
    </article>
  );
}

function RiskTags({ tags }: { tags: string[] }) {
  if (!tags.length) return <span className="risk-tag muted">No risk tags</span>;
  return (
    <span className="risk-tag-row">
      {tags.slice(0, 3).map((tag) => <span className="risk-tag" key={tag}>{formatRiskTag(tag)}</span>)}
      {tags.length > 3 ? <span className="risk-tag muted">+{tags.length - 3}</span> : null}
    </span>
  );
}

function buildScoreQuery(input: { windowMinutes: number | null; minConfidence: number; changedSince: string | null; classificationFilter: CoinClassificationFilter }): ScoreListQuery {
  const query: ScoreListQuery = {
    minConfidence: input.minConfidence
  };
  if (input.windowMinutes !== null) query.windowMinutes = input.windowMinutes;
  if (input.changedSince) query.updatedSince = input.changedSince;
  if (input.classificationFilter.length === 1 && input.classificationFilter[0] === 'halal') query.halal = true;
  return query;
}

function normalizeScoreWindows(windows: number[]): number[] {
  const unique = [...new Set(windows.filter((window) => Number.isInteger(window) && window > 0))].sort((left, right) => left - right);
  return unique.length ? unique : defaultScoreWindows;
}

function defaultScoreWindow(windows: number[]): number {
  return windows.includes(15) ? 15 : windows[0] ?? 15;
}

function filterScoreRows(rows: ScoreSummary[], props: Pick<ScoresPageProps, 'classificationFilter' | 'exchangeFilter' | 'marketFilter' | 'exchangeAvailability'>): ScoreSummary[] {
  return rows.filter((row) => {
    if (!matchesCoinClassificationFilter(row.coin, props.classificationFilter)) return false;
    if (isExchangeFilterActive(props.exchangeFilter) && !scoreMatchesExchangeFilter(row, props.exchangeFilter, props.exchangeAvailability)) return false;
    if (isMarketFilterActive(props.marketFilter) && !scoreMatchesMarketFilter(row, props.marketFilter, props.exchangeAvailability)) return false;
    return true;
  });
}

function scoreMatchesExchangeFilter(score: ScoreSummary, exchangeFilter: ExchangeFilter, exchangeAvailability: ExchangeAvailabilityByMarket): boolean {
  const chips = getScoreExchangeChips(score, exchangeAvailability);
  if (!chips.length) return true;
  return chips.some((chip) => exchangeFilter.includes(chip.exchange as ExchangeFilter[number]));
}

function scoreMatchesMarketFilter(score: ScoreSummary, marketFilter: MarketFilter, exchangeAvailability: ExchangeAvailabilityByMarket): boolean {
  const markets = getScoreMarkets(score, exchangeAvailability).map((market) => market === 'Futures' ? 'perpetual' : 'spot');
  if (!markets.length) return true;
  return markets.some((market) => marketFilter.includes(market));
}

function getScoreExchangeChips(score: ScoreSummary, exchangeAvailability: ExchangeAvailabilityByMarket): ExchangeChipInfo[] {
  const markets = getScoreMarketKeys(score, exchangeAvailability);
  const chips = markets.flatMap((market) => getCoinExchangeChips(score.coin, market, exchangeAvailability));
  const seen = new Set<string>();
  return chips.filter((chip) => {
    if (seen.has(chip.exchange)) return false;
    seen.add(chip.exchange);
    return true;
  });
}

function getScoreMarkets(score: ScoreSummary, exchangeAvailability: ExchangeAvailabilityByMarket): string[] {
  return getScoreMarketKeys(score, exchangeAvailability).map((market) => market === 'perpetual' ? 'Futures' : 'Spot');
}

function getScoreMarketKeys(score: ScoreSummary, exchangeAvailability: ExchangeAvailabilityByMarket): ExchangeMarket[] {
  const inferred = new Set<ExchangeMarket>();
  for (const feedKey of score.evidenceSummary.feedKeys) {
    if (feedKey.includes('spot')) inferred.add('spot');
    if (feedKey.includes('derivatives') || feedKey.includes('oi') || feedKey.includes('funding')) inferred.add('perpetual');
    if (feedKey === 'pricealerts' || feedKey === 'volalerts') {
      inferred.add('spot');
      inferred.add('perpetual');
    }
  }
  if (!inferred.size && exchangeAvailability.spot.has(score.coin)) inferred.add('spot');
  if (!inferred.size && exchangeAvailability.perpetual.has(score.coin)) inferred.add('perpetual');
  return [...inferred];
}

function patchScoreResponse(response: ScoresListResponse | null, event: ScoreUpdateSseEvent, sortMode: 'bull' | 'bear' | 'rising', limit: number, allowInsert: boolean): ScoresListResponse | null {
  if (!response) return response;
  if (response.scoreConfigVersion !== event.scoreVersion) return response;
  const rows = [...response.scores];
  for (const item of event.scores) {
    if (item.windowMinutes !== response.windowMinutes) continue;
    const index = rows.findIndex((row) => row.coin === item.coin);
    if (index >= 0) rows[index] = mergeLiveScore(rows[index] as ScoreSummary, item, event);
    else if (allowInsert) rows.push(liveScoreToSummary(item, event));
  }
  rows.sort(sortMode === 'rising' ? compareRisingScores : sortMode === 'bull' ? compareBullScores : compareBearScores);
  const filteredRows = sortMode === 'rising' ? rows : filterDirectionalRows(rows, sortMode);
  return { ...response, scores: rerank(filteredRows.slice(0, limit)), total: Math.min(filteredRows.length, limit), generatedAt: event.generatedAt };
}

function filterDirectionalRows(rows: ScoreSummary[], side: 'bull' | 'bear'): ScoreSummary[] {
  return rows.filter((row) => side === 'bull' ? row.netScore > 0 : row.netScore < 0);
}

function mergeLiveScore(row: ScoreSummary, item: ScoreUpdateSseEvent['scores'][number], event: ScoreUpdateSseEvent): ScoreSummary {
  return {
    ...row,
    latestScoreTs: item.ts,
    bullScore: item.bullScore,
    bearScore: item.bearScore,
    netScore: item.netScore,
    confidenceScore: item.confidenceScore,
    dominantSignal: item.dominantSignal,
    marketRegime: item.marketRegime,
    recentScoreDelta: item.netScoreDelta,
    updatedAt: event.generatedAt,
    evidenceSummary: { ...row.evidenceSummary, total: Math.max(row.evidenceSummary.total, item.evidenceCount) }
  };
}

function liveScoreToSummary(item: ScoreUpdateSseEvent['scores'][number], event: ScoreUpdateSseEvent): ScoreSummary {
  return {
    coin: item.coin,
    scoreConfigVersion: event.scoreVersion,
    windowMinutes: item.windowMinutes,
    latestScoreTs: item.ts,
    bullScore: item.bullScore,
    bearScore: item.bearScore,
    netScore: item.netScore,
    confidenceScore: item.confidenceScore,
    rank: 999,
    updatedAt: event.generatedAt,
    dominantSignal: item.dominantSignal,
    marketRegime: item.marketRegime,
    primaryReason: item.dominantSignal ? formatRuleKey(item.dominantSignal) : 'Live score update',
    riskTags: [],
    evidenceSummary: { total: item.evidenceCount, topRuleKeys: item.dominantSignal ? [item.dominantSignal] : [], feedKeys: [], sides: [] },
    recentScoreDelta: item.netScoreDelta
  };
}

function canInsertLiveRows(classificationFilter: CoinClassificationFilter, exchangeFilter: ExchangeFilter, marketFilter: MarketFilter): boolean {
  return !exchangeFilter.length && !marketFilter.length && classificationFilter.length === 0;
}

function rerank(rows: ScoreSummary[]): ScoreSummary[] {
  return rows.map((row, index) => ({ ...row, rank: index + 1 }));
}

function compareBullScores(left: ScoreSummary, right: ScoreSummary): number {
  return right.netScore - left.netScore || right.bullScore - left.bullScore || right.confidenceScore - left.confidenceScore || Date.parse(right.latestScoreTs) - Date.parse(left.latestScoreTs);
}

function compareBearScores(left: ScoreSummary, right: ScoreSummary): number {
  return left.netScore - right.netScore || right.bearScore - left.bearScore || right.confidenceScore - left.confidenceScore || Date.parse(right.latestScoreTs) - Date.parse(left.latestScoreTs);
}

function compareRisingScores(left: ScoreSummary, right: ScoreSummary): number {
  return (right.recentScoreDelta ?? 0) - (left.recentScoreDelta ?? 0) || Math.abs(right.netScore) - Math.abs(left.netScore) || right.confidenceScore - left.confidenceScore;
}

function latestEventsForCoin(snapshot: DashboardSnapshot, coin: string): NormalizedEvent[] {
  const normalized = coin.toUpperCase();
  return Object.values(snapshot.feeds)
    .flatMap((feed) => feed.events)
    .filter((event) => event.coins.some((item) => item.toUpperCase() === normalized) || event.entries.some((entry) => entry.coin?.toUpperCase() === normalized))
    .sort((left, right) => Date.parse(right.receivedAt) - Date.parse(left.receivedAt))
    .slice(0, 8);
}

function emptyCopy(response: ScoresListResponse | null, classificationFilter: CoinClassificationFilter): string {
  if (response?.enabled === false) return 'Score storage is unavailable.';
  if (!isCoinClassificationFilterActive(classificationFilter)) return 'No scores available yet.';
  return `No scores match ${getCoinClassificationFilterLabel(classificationFilter)}.`;
}

function formatActiveFilters(classificationFilter: CoinClassificationFilter, exchangeFilter: ExchangeFilter, marketFilter: MarketFilter): string {
  const parts = [
    classificationFilter.length ? getCoinClassificationFilterLabel(classificationFilter) : null,
    exchangeFilter.length ? getExchangeFilterLabel(exchangeFilter) : null,
    marketFilter.length ? getMarketFilterLabel(marketFilter) : null
  ].filter((item): item is string => Boolean(item));
  return parts.length ? parts.join(', ') : 'All coins, exchanges, and markets';
}

function formatScoreFilterNote(classificationFilter: CoinClassificationFilter, exchangeFilter: ExchangeFilter, marketFilter: MarketFilter): string {
  const activeFilters = formatActiveFilters(classificationFilter, exchangeFilter, marketFilter);
  const serverFilters: string[] = [];
  if (classificationFilter.length === 1 && classificationFilter[0] === 'halal') serverFilters.push('halal');
  const serverCopy = serverFilters.length ? ` Server-side score API filters: ${serverFilters.join(', ')}.` : '';
  return `Global filters apply here: ${activeFilters}. Exchange and market selections use listing availability, so a coin stays visible when it is available on the selected exchange/market.${serverCopy}`;
}

function scoreHealthSummary(health: ScoreWorkerStatus | null, operationalHealth: StorageStatusResponse['health'] | ApiStatus['health'] | null): string {
  if (operationalHealth?.state === 'unhealthy') return 'Unhealthy: storage or scoring needs attention before scores can be trusted.';
  if (operationalHealth?.state === 'degraded') return 'Degraded: scores may be stale or incomplete; check warnings below.';
  if (!health?.enabled) return 'Disabled: score computation is not running in this environment.';
  if (!health.latestScoreTs) return 'Waiting: score worker is enabled but has not written a score yet.';
  const ageMs = Date.now() - Date.parse(health.latestScoreTs);
  if (Number.isFinite(ageMs) && ageMs > health.intervalMs * 2) return 'Stale: latest score is older than two score intervals.';
  return 'Fresh: score worker is current and storage is healthy.';
}

function confidenceTone(value: number): 'high' | 'medium' | 'low' | 'thin' {
  if (value >= 75) return 'high';
  if (value >= 50) return 'medium';
  if (value >= 25) return 'low';
  return 'thin';
}

function confidenceLabel(value: number): string {
  const tone = confidenceTone(value);
  return tone === 'thin' ? 'Thin' : tone[0]?.toUpperCase() + tone.slice(1);
}

function formatScore(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value);
}

function formatSignedScore(value: number): string {
  return `${value > 0 ? '+' : ''}${formatScore(value)}`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function clampTimelineY(netScore: number): number {
  return Math.max(4, Math.min(96, 50 - netScore / 2));
}

function formatDelta(value: number | null): string {
  if (value === null) return 'Move 0';
  return `Move ${formatSignedScore(value)}`;
}

function formatWindow(minutes: number): string {
  if (minutes < 60) return `${minutes}m`;
  if (minutes === 1_440) return '24h';
  return `${minutes / 60}h`;
}

function formatRegime(value: ScoreMarketRegime | null | undefined): string {
  if (value === 'thin_data') return 'Thin Data';
  if (value === 'conflicted') return 'Mixed';
  if (!value) return 'Waiting';
  return value[0]?.toUpperCase() + value.slice(1);
}

function formatRiskTag(value: string): string {
  if (value === 'positive_funding_overheated') return 'Overheated Funding';
  return formatRuleKey(value);
}

function formatRuleKey(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function stringPayload(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === 'string' && value.trim() ? value : null;
}
