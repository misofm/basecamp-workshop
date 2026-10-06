import { useState } from "react";
import { ErrorMessage } from "../components/ErrorMessage";
import { ReleaseGrid } from "../components/ReleaseGrid";
import { useCatalog } from "../lib/useCatalog";

export function HomePage() {
  const { releases, loading, error, retry, fresh } = useCatalog();
  const [genre, setGenre] = useState<string | null>(null);

  const genres = [...new Set(releases?.flatMap((release) => release.genres))].sort();
  const visible = genre ? releases?.filter((release) => release.genres.includes(genre)) : releases;

  return (
    <>
      <section className="page-intro">
        <h1>New releases</h1>
        <p className="lead">
          Every release below was read straight from the Sui blockchain and the open Miso API, right in your
          browser.
        </p>
      </section>

      {genres.length > 0 && (
        <div className="chips" role="group" aria-label="Filter by genre">
          <button className={genre === null ? "chip active" : "chip"} onClick={() => setGenre(null)}>
            All
          </button>
          {genres.map((name) => (
            <button key={name} className={genre === name ? "chip active" : "chip"} onClick={() => setGenre(name)}>
              {name}
            </button>
          ))}
        </div>
      )}

      {error ? (
        <ErrorMessage error={error} onRetry={retry} />
      ) : (
        releases?.length === 0 ? (
        <div className="empty-state">
          <p>No releases published yet — this page updates by itself.</p>
        </div>
      ) : (
        <ReleaseGrid releases={visible} loading={loading} fresh={fresh} />
      )
      )}
    </>
  );
}
