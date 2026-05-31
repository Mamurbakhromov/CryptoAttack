import { useEffect, useMemo, useState } from 'react';

import { fetchScoreDetail, fetchScoreMarketRegime, fetchScoresCurrent, fetchScoresTop, fetchScoringConfigCurrent } from '../api/sse';
import { getCoinClassificationClasses, getCoinClassificationFilterLabel, isCoinClassificationFilterActive, matchesCoinClassificationFilter, type CoinClassificationFilter } from '../coinClassification';
import { getExchangeFilterLabel, getMarketFilterLabel, isExchangeFilterActive, isMarketFilterActive, type ExchangeFilter, type MarketFilter } from '../exchangeFilters';
import type { ApiStatus, DashboardSnapshot, ExchangeMarket, ScoreDetailResponse, ScoreFlowBreakdownItem, ScoreListQuery, ScoreMarketRegime, ScoreMarketRegimeResponse, ScoreSnapshotSseEvent, ScoreSummary, ScoreUpdateSseEvent, ScoresListResponse, ScoreWorkerStatus, StorageStatusResponse } from '../types';
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

const allowedScoreWindows = [5, 15];
const defaultScoreWindows = allowedScoreWindows;
const confidenceOptions = [50, 75];
const scoreLeaderboardLimit = 5;
const risingCandidateLimit = 50;

export function ScoresPage(props: ScoresPageProps) {
  const [selectedWindowMinutes, setSelectedWindowMinutes] = useState<number | null>(null);
  const [configuredScoreWindows, setConfiguredScoreWindows] = useState<number[] | null>(null);
  const [minConfidence, setMinConfidence] = useState(50);
  const [changedSince, setChangedSince] = useState<string | null>(() => new Date(Date.now() - 15 * 60_000).toISOString());
  const [topBull, setTopBull] = useState<ScoresListResponse | null>(null);
  const [topBear, setTopBear] = useState<ScoresListResponse | null>(null);
  const [currentScores, setCurrentScores] = useState<ScoresListResponse | null>(null);
  const [marketRegime, setMarketRegime] = useState<ScoreMarketRegimeResponse | null>(null);
  const [selectedCoin, setSelectedCoin] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const serverScoreWindows = configuredScoreWindows ?? props.storageStatus?.workers.scores.windowsMinutes ?? props.status?.workers?.scores.windowsMinutes ?? null;
  const scoreWindows = useMemo(() => visibleScoreWindows(serverScoreWindows ?? defaultScoreWindows), [serverScoreWindows]);
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
      fetchScoresTop(props.authToken, { ...baseQuery, side: 'bull', limit: scoreLeaderboardLimit }, abortController.signal),
      fetchScoresTop(props.authToken, { ...baseQuery, side: 'bear', limit: scoreLeaderboardLimit }, abortController.signal),
      fetchScoresCurrent(props.authToken, { ...baseQuery, side: 'net', limit: risingCandidateLimit }, abortController.signal),
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
    setTopBull((response) => patchScoreResponse(response, liveUpdate, 'bull', scoreLeaderboardLimit, false));
    setTopBear((response) => patchScoreResponse(response, liveUpdate, 'bear', scoreLeaderboardLimit, false));
    setCurrentScores((response) => patchScoreResponse(response, liveUpdate, 'rising', risingCandidateLimit, canInsertLiveRows(props.classificationFilter, props.exchangeFilter, props.marketFilter)));
  }, [props.classificationFilter, props.exchangeFilter, props.liveScoreUpdate, props.marketFilter]);

  useEffect(() => {
    if (!selectedCoin) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelectedCoin(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [selectedCoin]);

  const bullRows = filterDirectionalRows(filterScoreRows(topBull?.scores ?? [], props), 'bull').slice(0, scoreLeaderboardLimit);
  const bearRows = filterDirectionalRows(filterScoreRows(topBear?.scores ?? [], props), 'bear').slice(0, scoreLeaderboardLimit);
  const risingRows = filterScoreRows(currentScores?.scores ?? [], props)
    .filter((score) => (score.recentScoreDelta ?? 0) > 0)
    .sort(compareRisingScores)
    .slice(0, scoreLeaderboardLimit);
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
        <ScoreLeaderboardPanel title="Top 5 Bull" subtitle="Strongest positive net edge after bearish pressure is subtracted." tone="bull" rows={bullRows} loading={loading} emptyCopy={emptyCopy(topBull, props.classificationFilter)} selectedCoin={selectedCoin} exchangeAvailability={props.exchangeAvailability} onSelectCoin={setSelectedCoin} />
        <ScoreLeaderboardPanel title="Top 5 Bear" subtitle="Strongest negative net edge after bullish pressure is subtracted." tone="bear" rows={bearRows} loading={loading} emptyCopy={emptyCopy(topBear, props.classificationFilter)} selectedCoin={selectedCoin} exchangeAvailability={props.exchangeAvailability} onSelectCoin={setSelectedCoin} />
        <ScoreLeaderboardPanel title="Rising Fast" subtitle="Coins whose net score moved up most recently." tone="rising" rows={risingRows} loading={loading} emptyCopy="No rising scores match these filters." selectedCoin={selectedCoin} exchangeAvailability={props.exchangeAvailability} onSelectCoin={setSelectedCoin} />
        <MarketRegimePanel regime={marketRegime} loading={loading} />
        <ScoreHealthPanel health={health} storageStatus={props.storageStatus} status={props.status} />
      </section>

      {selectedCoin ? (
        <div className="score-detail-modal-backdrop" role="presentation" onClick={() => setSelectedCoin(null)}>
          <div className="score-detail-modal" role="dialog" aria-modal="true" aria-label={`${selectedCoin} score detail`} onClick={(event) => event.stopPropagation()}>
            <button className="modal-close-button score-detail-modal-close" type="button" aria-label="Close score detail" onClick={() => setSelectedCoin(null)}>×</button>
            <ScoreDetailPanel
              authToken={props.authToken}
              coin={selectedCoin}
              query={baseQuery}
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
        {score.scoreState ? <span className="risk-tag muted">{formatFlowState(score.scoreState)}</span> : null}
        {score.tradeAction ? <span className={`risk-tag ${score.tradeAction === 'AVOID' ? '' : 'muted'}`}>{formatTradeAction(score.tradeAction)}</span> : null}
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

function ScoreDetailPanel({ authToken, coin, query }: { authToken: string | null; coin: string; query: ScoreListQuery }) {
  const [detail, setDetail] = useState<ScoreDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const abortController = new AbortController();
    setLoading(true);
    void fetchScoreDetail(authToken, coin, { ...query, side: 'net', limit: 1 }, abortController.signal)
      .then((nextDetail) => {
        setDetail(nextDetail);
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
  const displayCoin = score?.coin ?? coin;

  return (
    <section className={`panel score-detail-panel classification-row ${getCoinClassificationClasses(displayCoin)}`} aria-label={`${displayCoin} score detail`}>
      <div className="score-detail-hero">
        {score ? (
          <>
            <div className="score-detail-status-row">
              <button className="coin-button coin-button-large" type="button">{score.coin}</button>
              <span className={`regime-pill ${score.marketRegime ?? 'thin_data'}`}>{formatRegime(score.marketRegime)}</span>
              {score.scoreState ? <span className="risk-tag muted">Flow State {formatFlowState(score.scoreState)}</span> : null}
              {score.tradeAction ? <span className={`risk-tag ${score.tradeAction === 'AVOID' ? '' : 'muted'}`}>Action {formatTradeAction(score.tradeAction)}</span> : null}
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
          </>
        ) : null}
      </div>

      {error ? <div className="warning-banner">Score detail warning: {error}</div> : null}
      {loading ? <div className="empty-state">Loading {coin} score detail</div> : null}
      {!loading && !score ? <div className="empty-state">No current score found for {coin}.</div> : null}

      <div className="score-detail-grid">
        <FlowComponentsCard score={score} />
      </div>
    </section>
  );
}

function FlowComponentsCard({ score }: { score: ScoreSummary | null }) {
  const rows = componentRows(score);
  return (
    <section className="score-detail-card flow-components-card">
      <div className="score-detail-card-header">
        <h3>Flow Components</h3>
        <span>{score?.scoreConfigVersion === 'flow-v2' ? 'flow-v2' : 'Optional'}</span>
      </div>
      {score?.scoreState || score?.tradeAction ? (
        <div className="flow-state-grid">
          <FlowStateStat label="Flow State" value={formatFlowState(score.scoreState)} />
          <FlowStateStat label="Action" value={formatTradeAction(score.tradeAction)} />
        </div>
      ) : null}
      {rows.length ? (
        <div className="flow-component-grid">
          {rows.map((row) => <FlowComponentRow row={row} key={row.family} />)}
        </div>
      ) : <div className="empty-state">No flow-v2 component breakdown stored for this score.</div>}
    </section>
  );
}

function FlowStateStat({ label, value }: { label: string; value: string }) {
  return <div className="flow-state-stat"><span>{label}</span><strong>{value}</strong></div>;
}

interface FlowComponentDisplayRow {
  family: string;
  bull: number;
  bear: number;
  details: ScoreFlowBreakdownItem[];
}

function FlowComponentRow({ row }: { row: FlowComponentDisplayRow }) {
  const familyLabel = formatFlowFamily(row.family);
  const balance = componentBalance(row);
  const hasPressure = row.bull > 0 || row.bear > 0;
  const visibleDetails = flowVisibleDetails(row);
  const showDetails = visibleDetails.length > 0 && hasPressure;
  return (
    <article className={`flow-component-row ${componentTone(row)} ${hasPressure ? '' : 'quiet'}`}>
      <div className="flow-component-summary">
        <div>
          <strong>{familyLabel}</strong>
          <span>{componentInsight(row)}</span>
        </div>
        <div className="flow-component-score-stack" aria-label={`${familyLabel} total pressure`}>
          <span>Bull / Bear</span>
          <b>{formatComponentScore(row.bull)} / {formatComponentScore(row.bear)}</b>
          <small>{formatSignedScore(row.bull - row.bear)} net</small>
        </div>
      </div>
      {hasPressure ? (
        <div className="flow-component-balance" aria-label={`${familyLabel} bull bear balance`}>
          <span className="bull" style={{ width: `${balance.bull}%` }} />
          <span className="bear" style={{ width: `${balance.bear}%` }} />
        </div>
      ) : null}
      {showDetails ? (
        <div className={`flow-breakdown-lanes ${visibleDetails.length === 1 ? 'single' : ''}`} aria-label={`${familyLabel} breakdown`}>
          {visibleDetails.map((detail, index) => <FlowBreakdownLane detail={detail} familyLabel={familyLabel} key={`${row.family}-${detail.side ?? 'side'}-${index}`} />)}
        </div>
      ) : null}
    </article>
  );
}

function FlowBreakdownLane({ detail, familyLabel }: { detail: ScoreFlowBreakdownItem; familyLabel: string }) {
  const side = detail.side === 'bear' ? 'bear' : detail.side === 'bull' ? 'bull' : 'neutral';
  const sideLabel = formatFlowSidePressure(detail.side);
  const progress = breakdownProgress(detail);
  const showMath = hasFlowMath(detail);
  if (showMath) {
    return (
      <section className={`flow-breakdown-lane ${side} math-only`}>
        <FlowBreakdownMath detail={detail} />
        {detail.thinLiquidity ? <span className="flow-breakdown-warning">Thin cap</span> : null}
      </section>
    );
  }
  return (
    <section className={`flow-breakdown-lane ${side}`}>
      <div className="flow-breakdown-lane-head">
        <div>
          <span>{sideLabel}</span>
          <strong>{formatBreakdownNumber(detail.score)}</strong>
        </div>
        <small>{detail.newestReceivedAt ? `Latest ${formatTime(detail.newestReceivedAt)}` : 'No latest hit'}</small>
      </div>
      <div className="flow-lane-progress" aria-label={`${familyLabel} ${formatFlowSide(detail.side)} pressure bar`}>
        <span style={{ width: `${progress}%` }} />
      </div>
      <dl className="flow-lane-metrics">
        <div>
          <dt>Raw</dt>
          <dd>{formatBreakdownNumber(detail.rawScore)}</dd>
        </div>
        <div>
          <dt>Capacity</dt>
          <dd>{formatBreakdownNumber(detail.maxScore)}</dd>
        </div>
        <div>
          <dt>Hits</dt>
          <dd>{formatBreakdownNumber(detail.effectiveHits)}</dd>
        </div>
        <div>
          <dt>Multiplier</dt>
          <dd>{formatMultiplier(detail.multiplier)}</dd>
        </div>
      </dl>
      {detail.thinLiquidity ? <span className="flow-breakdown-warning">Thin cap</span> : null}
    </section>
  );
}

function FlowBreakdownMath({ detail }: { detail: ScoreFlowBreakdownItem }) {
  const mathRows = flowMathRows(detail);
  const rawBeforeCap = optionalNumber(detail.rawBeforeCap);
  const caps = flowCapRows(detail);
  const finalFormula = formatFlowFinalFormula(detail, caps);
  if (!mathRows.length && rawBeforeCap === null) return null;
  return (
    <div className="flow-lane-math">
      {mathRows.length ? (
        <section>
          <span>Math</span>
          <dl>
            {mathRows.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{formatBreakdownNumber(row.value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {caps.length ? (
        <section>
          <span>Caps</span>
          <dl>
            {caps.map((row) => (
              <div key={row.label}>
                <dt>{row.label}</dt>
                <dd>{formatBreakdownNumber(row.value)}</dd>
              </div>
            ))}
          </dl>
        </section>
      ) : null}
      {finalFormula ? <strong>{finalFormula}</strong> : null}
    </div>
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

function visibleScoreWindows(windows: number[]): number[] {
  const visible = normalizeScoreWindows(windows).filter((window) => allowedScoreWindows.includes(window));
  return visible.length ? visible : defaultScoreWindows;
}

function defaultScoreWindow(windows: number[]): number {
  return windows.includes(5) ? 5 : windows[0] ?? 5;
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
    scoreState: item.scoreState ?? row.scoreState ?? null,
    tradeAction: item.tradeAction ?? row.tradeAction ?? null,
    componentScores: item.componentScores ?? row.componentScores ?? null,
    flowBreakdown: item.flowBreakdown ?? row.flowBreakdown ?? null,
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
    scoreState: item.scoreState ?? null,
    tradeAction: item.tradeAction ?? null,
    componentScores: item.componentScores ?? null,
    flowBreakdown: item.flowBreakdown ?? null,
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

function formatComponentScore(value: number): string {
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(value);
}

function formatSignedScore(value: number): string {
  return `${value > 0 ? '+' : ''}${formatScore(value)}`;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
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

function formatFlowState(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  return formatEnumLabel(value);
}

function formatTradeAction(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  if (value === 'LONG_WATCH') return 'Bullish';
  if (value === 'SHORT_WATCH') return 'Bearish';
  return formatEnumLabel(value);
}

function formatFlowFamily(value: string): string {
  if (value === 'topOi') return 'Top OI';
  if (value === 'bigActivity') return 'Big Activity';
  return formatEnumLabel(value);
}

function componentRows(score: ScoreSummary | null): FlowComponentDisplayRow[] {
  const componentScores = score?.componentScores ?? null;
  const detailsByFamily = new Map<string, ScoreFlowBreakdownItem[]>();
  for (const detail of score?.flowBreakdown ?? []) {
    const family = typeof detail.family === 'string' ? detail.family : null;
    if (!family) continue;
    const details = detailsByFamily.get(family) ?? [];
    details.push(detail);
    detailsByFamily.set(family, details);
  }
  const preferredOrder = ['spot', 'derivatives', 'topOi', 'bigActivity'];
  const families = new Set<string>([
    ...Object.keys(componentScores ?? {}),
    ...detailsByFamily.keys()
  ]);
  return [...families]
    .sort((left, right) => flowFamilySortIndex(left, preferredOrder) - flowFamilySortIndex(right, preferredOrder) || left.localeCompare(right))
    .map((family) => {
      const scores = componentScores?.[family] ?? scoresFromBreakdown(detailsByFamily.get(family) ?? []);
      return {
        family,
        bull: Number(scores.bull ?? 0),
        bear: Number(scores.bear ?? 0),
        details: sortFlowDetails(detailsByFamily.get(family) ?? [])
      };
    });
}

function scoresFromBreakdown(details: ScoreFlowBreakdownItem[]): { bull: number; bear: number } {
  return details.reduce<{ bull: number; bear: number }>((totals, detail) => {
    if (detail.side === 'bull') totals.bull += numberValue(detail.score);
    if (detail.side === 'bear') totals.bear += numberValue(detail.score);
    return totals;
  }, { bull: 0, bear: 0 });
}

function sortFlowDetails(details: ScoreFlowBreakdownItem[]): ScoreFlowBreakdownItem[] {
  return [...details].sort((left, right) => flowSideSortIndex(left.side) - flowSideSortIndex(right.side));
}

function flowVisibleDetails(row: FlowComponentDisplayRow): ScoreFlowBreakdownItem[] {
  if (row.bull > 0 && row.bear > 0) return row.details;
  return row.details.filter((detail) => numberValue(detail.score) > 0);
}

function flowFamilySortIndex(family: string, preferredOrder: string[]): number {
  const index = preferredOrder.indexOf(family);
  return index >= 0 ? index : preferredOrder.length;
}

function flowSideSortIndex(side: string | undefined): number {
  if (side === 'bull') return 0;
  if (side === 'bear') return 1;
  return 2;
}

function componentTone(row: FlowComponentDisplayRow): 'bull' | 'bear' | 'neutral' {
  if (row.bull > row.bear) return 'bull';
  if (row.bear > row.bull) return 'bear';
  return 'neutral';
}

function componentInsight(row: FlowComponentDisplayRow): string {
  const net = row.bull - row.bear;
  if (net > 0) return `${formatSignedScore(net)} bull pressure`;
  if (net < 0) return `${formatSignedScore(net)} bear pressure`;
  return row.bull || row.bear ? 'Balanced pressure' : 'Quiet component';
}

function componentBalance(row: FlowComponentDisplayRow): { bull: number; bear: number } {
  const bull = Math.max(0, row.bull);
  const bear = Math.max(0, row.bear);
  const total = bull + bear;
  if (!total) return { bull: 50, bear: 50 };
  return {
    bull: clampPercent((bull / total) * 100),
    bear: clampPercent((bear / total) * 100)
  };
}

function breakdownProgress(detail: ScoreFlowBreakdownItem): number {
  const score = numberValue(detail.score);
  const maxScore = numberValue(detail.maxScore);
  if (maxScore <= 0) return score > 0 ? 100 : 0;
  return clampPercent((Math.max(0, score) / maxScore) * 100);
}

function hasFlowMath(detail: ScoreFlowBreakdownItem): boolean {
  return flowMathRows(detail).length > 0 || optionalNumber(detail.rawBeforeCap) !== null;
}

function flowMathRows(detail: ScoreFlowBreakdownItem): Array<{ label: string; value: number }> {
  const subpoints = detail.subpoints ?? {};
  const candidates: Array<[string, keyof typeof subpoints]> = [
    ['Dominance', 'dominancePoints'],
    ['Rel impact', 'relativeImpactPoints'],
    ['Delta', 'deltaPoints'],
    ['Rank', 'rankPoints'],
    ['1h hits', 'hitPoints'],
    ['OI move', 'oiPercentPoints'],
    ['Price conf', 'priceConfirmationPoints'],
    ['Amount', 'amountPoints'],
    ['Freshness', 'freshnessPoints']
  ];
  return candidates
    .map(([label, key]) => ({ label, value: subpointNumber(subpoints[key]) }))
    .filter((row): row is { label: string; value: number } => row.value !== null);
}

function flowCapRows(detail: ScoreFlowBreakdownItem): Array<{ label: string; value: number }> {
  const caps: Array<{ label: string; value: number | null }> = [
    { label: 'Volume cap', value: optionalNumber(detail.volumeCap) },
    { label: 'Activity cap', value: optionalNumber(detail.activityCap) },
    { label: 'Liquidity cap', value: optionalNumber(detail.liquidityCap) },
    { label: 'Max', value: optionalNumber(detail.maxScore) }
  ];
  return caps.filter((row): row is { label: string; value: number } => row.value !== null);
}

function formatFlowFinalFormula(detail: ScoreFlowBreakdownItem, caps: Array<{ label: string; value: number }>): string | null {
  const rawBeforeCap = optionalNumber(detail.rawBeforeCap);
  const finalScore = optionalNumber(detail.score);
  if (rawBeforeCap === null || finalScore === null || !caps.length) return null;
  const capText = caps.map((cap) => formatBreakdownNumber(cap.value)).join(', ');
  const multiplier = optionalNumber(detail.multiplier);
  const minText = `min(${formatBreakdownNumber(rawBeforeCap)}, ${capText})`;
  if (multiplier !== null && multiplier !== 1) return `${minText} x ${formatBreakdownNumber(multiplier)} = ${formatBreakdownNumber(finalScore)}`;
  return `${minText} = ${formatBreakdownNumber(finalScore)}`;
}

function numberValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function subpointNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value === 0) return null;
  return value;
}

function formatFlowSide(value: string | undefined): string {
  if (value === 'bull') return 'Bull';
  if (value === 'bear') return 'Bear';
  return 'Other';
}

function formatFlowSidePressure(value: string | undefined): string {
  if (value === 'bull') return 'Bull Pressure';
  if (value === 'bear') return 'Bear Pressure';
  return 'Other Pressure';
}

function formatBreakdownNumber(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatMultiplier(value: unknown): string {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'n/a';
  return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value)}x`;
}

function formatRiskTag(value: string): string {
  if (value === 'positive_funding_overheated') return 'Overheated Funding';
  return formatRuleKey(value);
}

function formatRuleKey(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

function formatEnumLabel(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase().replace(/\b\w/gu, (letter) => letter.toUpperCase());
}
