/**
 * Préférences d'affichage.
 *
 * Distinctes des réglages du moteur (`REGLAGES_PLAN`) : celles-ci ne changent
 * rien à la planification ni à la mémoire, seulement au confort d'usage. Elles
 * voyagent tout de même dans le même fichier de sauvegarde, pour qu'un
 * export/import restitue l'application telle qu'on l'avait laissée.
 */

export const PREFERENCES_DEFAUT = {
  /** Brasser les propositions à chaque passage. Désactiver revient à mémoriser
   *  des positions plutôt que du contenu : à ne faire qu'en connaissance de cause. */
  melangerPropositions: true,
  /** Délai avant d'enchaîner après une bonne réponse. 0 = attendre un appui. */
  // 0 = on attend un appui sur « Suivant ». C'est le comportement voulu :
  // le retour et l'explication ne doivent jamais être escamotés.
  delaiEnchainementMs: 0,
};

export function fusionner(enregistrees) {
  return { ...PREFERENCES_DEFAUT, ...(enregistrees ?? {}) };
}
