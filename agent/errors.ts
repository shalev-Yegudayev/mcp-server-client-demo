// Maps error message substrings to HTTP status + user-facing message.
// Order matters: more specific patterns first.
const ERROR_CLASSIFICATIONS: Array<{
  match: string[];
  status: number;
  message: string;
}> = [
  {
    match: ['ECONNREFUSED', 'ENOENT', 'connection timeout'],
    status: 503,
    message: 'Vulnerability database is unavailable. Please ensure the MCP server is running.',
  },
  {
    match: ['ENOTFOUND', 'getaddrinfo'],
    status: 503,
    message: 'Unable to reach the AI service. Please check your connection.',
  },
  {
    match: ['quota', 'resource'],
    status: 503,
    message: 'AI service is temporarily unavailable. Please try again later.',
  },
  {
    match: ['timeout'],
    status: 504,
    message: 'Request timed out. Please try a simpler question.',
  },
];

export function classifyError(message: string): { status: number; userMessage: string } {
  for (const entry of ERROR_CLASSIFICATIONS) {
    if (entry.match.some((pattern) => message.includes(pattern))) {
      return { status: entry.status, userMessage: entry.message };
    }
  }
  return { status: 500, userMessage: 'An unexpected error occurred. Please try again.' };
}
