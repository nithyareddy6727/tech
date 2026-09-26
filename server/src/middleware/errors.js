export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error);
  const message = error?.message || 'Internal server error.';
  const status = error.status || (message.includes('not found') ? 404 : 400);
  if (status >= 500) console.error(error);
  res.status(status).json({ error: message });
}