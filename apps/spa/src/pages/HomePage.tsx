import { useState } from "react";
import { ErrorMessage } from "../components/ErrorMessage";
import { ReleaseGrid } from "../components/ReleaseGrid";
import { loadCatalog } from "../lib/miso";
import { useAsync } from "../lib/useAsync";

export function HomePage() {
  const { data: releases, loading, error, retry } = useAsync(loadCatalog, []);
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
        <ReleaseGrid releases={visible} loading={loading} emptyText="No published releases yet." />
      )}
    </>
  );
}
