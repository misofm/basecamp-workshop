import { Link } from "react-router";

export function NotFoundPage() {
  return (
    <section className="empty-state">
      <h1>Page not found</h1>
      <p className="lead">There is nothing at this address.</p>
      <Link to="/" className="button">
        Back to the catalog
      </Link>
    </section>
  );
}
