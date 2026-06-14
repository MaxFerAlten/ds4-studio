export function ResearchSources({ sources }) {
  if (!sources.length) return null;
  return (
    <div className="research-sources">
      <h3>Sources ({sources.length})</h3>
      <ul>
        {sources.map((s) => (
          <li key={s.id} className="research-source">
            <span className="research-source-id">{s.id}</span>
            <span className="research-source-title">{s.title}</span>
            {s.provider ? <span className="research-source-provider">{s.provider}</span> : null}
            <span className={`research-source-kind ${s.kind}`}>{s.kind}</span>
            {s.url ? (
              <a className="research-source-url" href={s.url} target="_blank" rel="noopener noreferrer">
                {s.url}
              </a>
            ) : null}
            {s.snippet ? <p className="research-source-snippet">{s.snippet.slice(0, 240)}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
