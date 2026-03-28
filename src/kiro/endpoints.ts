const kiroApiHost = (region: string) => `https://q.${region}.amazonaws.com`;

export function buildListAvailableModelsUrl(input: {
  region: string;
  profileArn: string | undefined;
  includeProfileArn: boolean;
}) {
  const u = new URL("/ListAvailableModels", kiroApiHost(input.region));
  u.searchParams.set("origin", "AI_EDITOR");
  if (input.includeProfileArn && input.profileArn) {
    u.searchParams.set("profileArn", input.profileArn);
  }
  return u.toString();
}
