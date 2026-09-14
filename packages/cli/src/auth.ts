// Core takes a token as a parameter and never learns where it came from. Shelling out to gh is a
// subprocess call, which is runtime-specific, so it lives here rather than in the shared layer.

export type TokenSource = {
  ghAuthToken(): Promise<string | undefined>;
  env(): string | undefined;
};

export class MissingTokenError extends Error {
  constructor() {
    super("no GitHub token found. Run `gh auth login`, or set GITHUB_TOKEN.");
    this.name = "MissingTokenError";
  }
}

export const defaultTokenSource: TokenSource = {
  async ghAuthToken() {
    try {
      const proc = Bun.spawn(["gh", "auth", "token"], { stdout: "pipe", stderr: "ignore" });
      const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);

      if (exitCode !== 0) {
        return undefined;
      }

      const token = stdout.trim();
      return token === "" ? undefined : token;
    } catch {
      // gh is not installed, or could not be started
      return undefined;
    }
  },

  env() {
    return process.env.GITHUB_TOKEN;
  },
};

export async function resolveToken(source: TokenSource = defaultTokenSource): Promise<string> {
  const fromGh = await source.ghAuthToken();
  if (fromGh !== undefined) {
    return fromGh;
  }

  const fromEnv = source.env();
  if (fromEnv !== undefined && fromEnv !== "") {
    return fromEnv;
  }

  throw new MissingTokenError();
}
