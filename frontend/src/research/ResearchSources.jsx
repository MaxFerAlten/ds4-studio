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
            {s.authorVerification ? (
              s.authorVerification.found ? (
                <a
                  className="research-author-verified ok"
                  href={`https://orcid.org/${s.authorVerification.orcidId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={
                    s.authorVerification.institutions?.length
                      ? `Affiliations: ${s.authorVerification.institutions.join(", ")}`
                      : "ORCID record found"
                  }
                >
                  ✓ ORCID {s.authorVerification.author}
                  {s.authorVerification.institutions?.length
                    ? ` · ${s.authorVerification.institutions[0]}`
                    : ""}
                </a>
              ) : (
                <span className="research-author-verified none" title="No ORCID record matched this author">
                  ? ORCID {s.authorVerification.author}: nessun riscontro
                </span>
              )
            ) : null}
            {s.snippet ? <p className="research-source-snippet">{s.snippet.slice(0, 240)}</p> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
