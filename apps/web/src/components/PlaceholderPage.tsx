interface PlaceholderPageProps {
  title: string;
  subtitle: string;
  tone: 'amounts' | 'news' | 'flows' | 'smart-money' | 'onchain-alpha';
}

export function PlaceholderPage({ title, subtitle, tone }: PlaceholderPageProps) {
  return (
    <main className="mx-auto grid max-w-[1800px] gap-3 px-4 py-3 md:px-6">
      <section className={`page-hero ${tone}`}>
        <h1>{title}</h1>
        <span>{subtitle}</span>
      </section>
      <section className="panel min-h-[320px]">
        <div className="panel-header">
          <div>
            <h2>Coming Next</h2>
            <p>This page is reserved for the next feed integration batch.</p>
          </div>
          <span className="count-pill">Skeleton</span>
        </div>
        <div className="empty-state">Navigation is ready; live feed widgets will be added here step by step.</div>
      </section>
    </main>
  );
}
