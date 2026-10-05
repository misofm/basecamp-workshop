export function ErrorMessage({ error, onRetry }: { error: Error; onRetry: () => void }) {
  return (
    <div className="error-box" role="alert">
      <p>Something went wrong: {error.message}</p>
      <button className="button" onClick={onRetry}>
        Try again
      </button>
    </div>
  );
}
