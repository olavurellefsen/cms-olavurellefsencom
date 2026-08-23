export async function requestFederatedCmsSession(
  host,
  authContextToken,
  fetchImplementation = fetch,
) {
  const authContext = await host.getContext(authContextToken);
  const token = await authContext?.getLatestToken();
  if (!token) {
    throw new Error("The Umbraco backoffice session is not available.");
  }

  return fetchImplementation("/api/olavur-sync/cms-session", {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
    },
  });
}
