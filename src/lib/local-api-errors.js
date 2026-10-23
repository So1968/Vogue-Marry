// Messages d'erreur de connexion compréhensibles, sans masquer les erreurs HTTP.
export function explainLocalApiFailure(error) {
  if (error?.name === "TimeoutError") {
    return new Error("Le serveur local Vogue Merry ne répond pas assez vite. Les données non confirmées doivent être conservées.");
  }
  if (error?.name === "AbortError") return error;
  if (error instanceof TypeError) {
    return new Error("Connexion au serveur local Vogue Merry impossible. Vérifiez qu'il est démarré sur le port 8010 ; ne supprimez pas les données locales.");
  }
  return error;
}
