/** Whether a nonzero `gh auth status` still proves a working login (some gh versions exit 1 while signed in). */
export function ghAuthStatusOutputIsSignedIn(output: string): boolean {
  // gh still lists a revoked token as the active account, next to «Failed to log in».
  if (output.includes('Failed to log in') || /token .* is invalid/.test(output)) {
    return false
  }
  return output.includes('Logged in') || output.includes('Active account: true')
}
