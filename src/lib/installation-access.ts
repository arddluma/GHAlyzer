import { userOctokit } from "@/lib/github-app";
import type { Session } from "@/lib/session";

/**
 * Verifies that the signed-in user has access to the given installation and
 * that the installation is for the expected owner. Returns the installation
 * id on success, throws on failure. Guards against IDOR via guessed
 * installation_id values.
 */
export async function verifyUserInstallation(
  session: Session,
  expectedOwner: string
): Promise<number> {
  const octokit = userOctokit(session.userToken);
  const { data } = await octokit.apps.listInstallationsForAuthenticatedUser({
    per_page: 100,
  });
  const match = data.installations.find((i) => {
    const login =
      i.account && "login" in i.account ? i.account.login : undefined;
    return login?.toLowerCase() === expectedOwner.toLowerCase();
  });
  if (!match) {
    const err: any = new Error(
      `No GitHub App installation for '${expectedOwner}' that you have access to. Install the app on that account first.`
    );
    err.status = 403;
    throw err;
  }
  return match.id;
}
