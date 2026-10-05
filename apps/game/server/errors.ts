/** An error whose message is safe to show to the player. */
export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}
