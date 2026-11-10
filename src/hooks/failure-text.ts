export const readFailureText = (failure: unknown): string | undefined => {
  const isError = failure instanceof Error;
  return isError ? failure.stack : String(failure);
};
